package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
)

func storedOTA(t *testing.T, version, kind, board string, used time.Time) (otaArtifactResponse, []byte) {
	t.Helper()
	data := otaManifestBundle(t, fmt.Sprintf(`{"version":%q,"kind":%q,"board":%q,"files":[]}`, version, kind, board))
	sha := fmt.Sprintf("%x", sha256.Sum256(data))
	path := testH.otaArtifactPath(sha)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, used, used); err != nil {
		t.Fatal(err)
	}
	return otaArtifactResponse{Version: version, Kind: kind, Board: board, SHA256: sha, URL: otaArtifactPrefix + sha, Size: int64(len(data))}, data
}

func storedRollout(t *testing.T, artifact otaArtifactResponse, created time.Time) uint {
	t.Helper()
	var id uint
	err := testDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("INSERT INTO ota_rollouts (version,url,sha256,created_by,created_at) VALUES (?,?,?,'test',?)", artifact.Version, artifact.URL, artifact.SHA256, created).Error; err != nil {
			return err
		}
		return tx.Raw("SELECT LAST_INSERT_ID()").Scan(&id).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func assertArtifactExists(t *testing.T, sha string, want bool) {
	t.Helper()
	_, err := os.Stat(testH.otaArtifactPath(sha))
	if want && err != nil || !want && !os.IsNotExist(err) {
		t.Fatalf("artifact %s: exists=%v, want %v (%v)", sha, err == nil, want, err)
	}
}

func newerOTAVersions(t *testing.T, now time.Time) {
	t.Helper()
	for i := 1; i <= 3; i++ {
		storedOTA(t, fmt.Sprintf("new-%d", i), "application", "", now.Add(-time.Duration(i)*24*time.Hour))
	}
}

func TestOTAStorageRetainsThreeVersionsPerBoardAndPreviewIsReadOnly(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	var expired []otaArtifactResponse
	var bytes int64
	for _, group := range []struct{ kind, board string }{{"application", ""}, {"firmware", "nanopi-zero2"}, {"firmware", "nanopi-r28s"}} {
		for i := 0; i < 5; i++ {
			a, _ := storedOTA(t, fmt.Sprintf("v%d", i), group.kind, group.board, now.Add(-time.Duration(40+i)*24*time.Hour))
			if i >= 3 {
				expired = append(expired, a)
				bytes += a.Size
			}
		}
	}
	report, err := testH.collectOTAStorage(context.Background(), false, now)
	if err != nil {
		t.Fatal(err)
	}
	if report.ArtifactCount != 15 || report.ProtectedCount != 9 || report.CandidateCount != 6 || report.CandidateBytes != bytes || report.RemovedCount != 0 {
		t.Fatalf("preview: %+v", report)
	}
	for _, a := range expired {
		assertArtifactExists(t, a.SHA256, true)
	}
	report, err = testH.collectOTAStorage(context.Background(), true, now)
	if err != nil || report.RemovedCount != 6 || report.RemovedBytes != bytes {
		t.Fatalf("cleanup: %+v %v", report, err)
	}
	for _, a := range expired {
		assertArtifactExists(t, a.SHA256, false)
	}
	report, err = testH.collectOTAStorage(context.Background(), true, now)
	if err != nil || report.CandidateCount != 0 || report.RemovedCount != 0 {
		t.Fatalf("retry: %+v %v", report, err)
	}
}

func TestOTAStorageRetainsAllAssignmentStatesAndSharedReferences(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	newerOTAVersions(t, now)
	for i, status := range []string{"pending", "installing", "done", "failed", "rolled_back"} {
		a, _ := storedOTA(t, "assigned-"+status, "application", "", now.Add(-90*24*time.Hour))
		id := storedRollout(t, a, now.Add(-90*24*time.Hour))
		// Another unassigned rollout referencing the same SHA must not cause deletion.
		storedRollout(t, a, now.Add(-80*24*time.Hour))
		mac := fmt.Sprintf("00000000%04d", i+1)
		insertTestNode(t, mac)
		mustExec(t, "INSERT INTO ota_assignments (node_mac,rollout_id,status,assigned_at) VALUES (?,?,?,?)", mac, id, status, now.Add(-90*24*time.Hour))
	}
	orphan, _ := storedOTA(t, "orphan", "application", "", now.Add(-90*24*time.Hour))
	report, err := testH.collectOTAStorage(context.Background(), true, now)
	if err != nil || report.ProtectedCount != 8 || report.RemovedCount != 1 {
		t.Fatalf("references: %+v %v", report, err)
	}
	assertArtifactExists(t, orphan.SHA256, false)
	if scalar(t, "SELECT COUNT(*) FROM ota_rollouts") != 10 || scalar(t, "SELECT COUNT(*) FROM ota_assignments") != 5 {
		t.Fatal("cleanup deleted rollout history or assignments")
	}
}

func TestOTAStorageGracePeriodAndDuplicateVersions(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	// Three builds of the same version still leave two older versions protected.
	for i := 0; i < 3; i++ {
		storedOTA(t, "v3", "application", fmt.Sprintf("build-%d", i), now.Add(-time.Duration(35+i)*24*time.Hour))
	}
	v2, _ := storedOTA(t, "v2", "application", "", now.Add(-40*24*time.Hour))
	v1, _ := storedOTA(t, "v1", "application", "", now.Add(-41*24*time.Hour))
	expired, _ := storedOTA(t, "v0", "application", "", now.Add(-42*24*time.Hour))
	report, err := testH.collectOTAStorage(context.Background(), true, now)
	if err != nil || report.RemovedCount != 3 {
		t.Fatalf("version retention: %+v %v", report, err)
	}
	assertArtifactExists(t, v2.SHA256, true)
	assertArtifactExists(t, v1.SHA256, true)
	assertArtifactExists(t, expired.SHA256, false)
	// A recently created rollout renews retention even for a legacy file with an old mtime.
	recent, _ := storedOTA(t, "recent-reference", "application", "", now.Add(-90*24*time.Hour))
	storedRollout(t, recent, now.Add(-time.Hour))
	testH.collectOTAStorage(context.Background(), true, now)
	assertArtifactExists(t, recent.SHA256, true)
	// A duplicate upload also renews the grace period before a rollout exists.
	old, data := storedOTA(t, "reuploaded", "application", "", now.Add(-90*24*time.Hour))
	resp := uploadTestOTA(t, data, true)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	testH.collectOTAStorage(context.Background(), true, now)
	assertArtifactExists(t, old.SHA256, true)
}

func TestOTAStorageRemovesAbandonedUploadsButNotUnknownFilesOrLinks(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	outside := filepath.Join(t.TempDir(), "keep")
	os.WriteFile(outside, []byte("outside"), 0600)
	old := now.Add(-25 * time.Hour)
	for _, entry := range []struct {
		name string
		when time.Time
	}{{".upload-123", old}, {".upload-456", now}, {"operator-notes", old}} {
		p := filepath.Join(testCfg.OTAArtifactDir, entry.name)
		os.WriteFile(p, []byte("data"), 0600)
		os.Chtimes(p, entry.when, entry.when)
	}
	for i, when := range []time.Time{old, now} {
		dir := filepath.Join(testCfg.OTAArtifactDir, ".uploads", strings.Repeat(fmt.Sprint(i+1), 64))
		os.MkdirAll(dir, 0700)
		os.WriteFile(filepath.Join(dir, "0"), []byte("chunk"), 0600)
		os.Symlink(outside, filepath.Join(dir, "link"))
		os.Chtimes(dir, when, when)
	}
	os.Symlink(outside, testH.otaArtifactPath(strings.Repeat("a", 64)))
	malformed := strings.Repeat("b", 64)
	os.WriteFile(testH.otaArtifactPath(malformed), []byte("bad"), 0600)
	os.Chtimes(testH.otaArtifactPath(malformed), old, old)
	report, err := testH.collectOTAStorage(context.Background(), true, now)
	if err != nil || report.RemovedCount != 2 || report.RemovedBytes != 9 || len(report.Errors) != 1 {
		t.Fatalf("staging: %+v %v", report, err)
	}
	for _, path := range []string{outside, filepath.Join(testCfg.OTAArtifactDir, ".upload-456"), filepath.Join(testCfg.OTAArtifactDir, "operator-notes"), testH.otaArtifactPath(malformed)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("removed protected file: %s", path)
		}
	}
}

func TestOTAStorageFailureAndDisabledRetentionNeverDeleteArtifacts(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	newerOTAVersions(t, now)
	a, _ := storedOTA(t, "old", "application", "", now.Add(-90*24*time.Hour))
	broken := *testH
	broken.DB = testDB.Session(&gorm.Session{NewDB: true})
	broken.DB.Error = errors.New("database unavailable")
	if _, err := broken.collectOTAStorage(context.Background(), true, now); err == nil {
		t.Fatal("ignored database failure")
	}
	assertArtifactExists(t, a.SHA256, true)
	testCfg.OTARetentionDays = 0
	report, err := testH.collectOTAStorage(context.Background(), true, now)
	if err != nil || report.RemovedCount != 0 {
		t.Fatalf("disabled: %+v %v", report, err)
	}
	assertArtifactExists(t, a.SHA256, true)
}

func TestOTAStorageCleanupCannotRaceNewAssignment(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	newerOTAVersions(t, now)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	for i := 0; i < 8; i++ {
		a, _ := storedOTA(t, fmt.Sprintf("race-%d", i), "application", "", now.Add(-90*24*time.Hour))
		id := storedRollout(t, a, now.Add(-90*24*time.Hour))
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		var status int
		var cleanupErr error
		go func() {
			defer wg.Done()
			<-start
			resp := doJSON("POST", fmt.Sprintf("/admin/ota/rollouts/%d/assign", id), assignRequest{NodeMACs: []string{mac}}, adminCookie())
			status = resp.StatusCode
			resp.Body.Close()
		}()
		go func() {
			defer wg.Done()
			<-start
			_, cleanupErr = testH.collectOTAStorage(context.Background(), true, now)
		}()
		close(start)
		wg.Wait()
		if cleanupErr != nil {
			t.Fatal(cleanupErr)
		}
		if status != 200 && status != 409 {
			t.Fatalf("unexpected assign status: %d", status)
		}
		assertArtifactExists(t, a.SHA256, status == 200)
		if status == 200 && scalar(t, "SELECT COUNT(*) FROM ota_assignments WHERE rollout_id=?", id) != 1 {
			t.Fatal("assignment lost")
		}
	}
}

func TestOTAStorageMissingBundleCannotBeAssignedAndCanBeRestored(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	newerOTAVersions(t, now)
	a, data := storedOTA(t, "old", "application", "", now.Add(-90*24*time.Hour))
	id := storedRollout(t, a, now.Add(-90*24*time.Hour))
	testH.collectOTAStorage(context.Background(), true, now)
	resp := doJSON("GET", fmt.Sprintf("/admin/ota/rollouts/%d", id), nil, adminCookie())
	assertStatus(t, resp, 200)
	if parseJSON(resp)["artifact_missing"] != true {
		t.Fatal("missing artifact not visible")
	}
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	resp = doJSON("POST", fmt.Sprintf("/admin/ota/rollouts/%d/assign", id), assignRequest{NodeMACs: []string{mac}}, adminCookie())
	assertStatus(t, resp, 409)
	resp.Body.Close()
	if scalar(t, "SELECT COUNT(*) FROM ota_assignments") != 0 {
		t.Fatal("assigned deleted bundle")
	}
	resp = uploadTestOTA(t, data, true)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("POST", fmt.Sprintf("/admin/ota/rollouts/%d/assign", id), assignRequest{NodeMACs: []string{mac}}, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doJSON("GET", "/admin/ota/rollouts", nil, adminCookie())
	if parseJSONArray(resp)[0]["artifact_missing"] != false {
		t.Fatal("restored artifact still missing")
	}
}

type pausedOTAReader struct {
	io.Reader
	ready, release chan struct{}
	once           sync.Once
}

func (r *pausedOTAReader) Read(p []byte) (int, error) {
	r.once.Do(func() { close(r.ready); <-r.release })
	return r.Reader.Read(p)
}

func TestOTAStorageActiveUploadSurvivesNonBlockingSweep(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	body := &pausedOTAReader{Reader: bytes.NewReader(otaTestBundle(t)), ready: make(chan struct{}), release: make(chan struct{})}
	req := httptest.NewRequest("POST", "/admin/ota/bundles", body)
	req.AddCookie(adminCookie())
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); testH.HandleAdminUploadOTA(rec, req) }()
	select {
	case <-body.ready:
	case <-time.After(5 * time.Second):
		close(body.release)
		t.Fatal("upload never read body")
	}
	stale := filepath.Join(testCfg.OTAArtifactDir, ".upload-555")
	if err := os.WriteFile(stale, []byte("abandoned"), 0600); err != nil {
		close(body.release)
		t.Fatal(err)
	}
	report, err := testH.collectOTAStorage(context.Background(), true, time.Now().Add(48*time.Hour))
	close(body.release)
	<-done
	if err != nil || report.RemovedCount != 1 {
		t.Fatalf("slow upload blocked or was deleted by sweep: %+v %v", report, err)
	}

	if rec.Code != 200 {
		t.Fatalf("active upload damaged: %d %s", rec.Code, rec.Body.String())
	}
}

type pausedOTAResponse struct {
	*httptest.ResponseRecorder
	ready, release chan struct{}
	once           sync.Once
}

func (w *pausedOTAResponse) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.ready); <-w.release })
	return w.ResponseRecorder.Write(p)
}

func TestOTAStorageOpenDownloadSurvivesReassignmentAndCleanup(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	newerOTAVersions(t, now)
	a, data := storedOTA(t, "old", "application", "", now.Add(-90*24*time.Hour))
	id := storedRollout(t, a, now.Add(-90*24*time.Hour))
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	mustExec(t, "INSERT INTO ota_assignments (node_mac,rollout_id,status,assigned_at) VALUES (?,?,'pending',?)", mac, id, now)
	req := httptest.NewRequest("GET", "/nodes/"+mac+"/ota-bundle/"+a.SHA256, nil)
	req.SetPathValue("mac", mac)
	req.SetPathValue("sha", a.SHA256)
	req.Header.Set("Authorization", "Bearer "+deviceToken(t, mac))
	w := &pausedOTAResponse{ResponseRecorder: httptest.NewRecorder(), ready: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() { defer close(done); testH.HandleNodeOTABundle(w, req) }()
	select {
	case <-w.ready:
	case <-time.After(5 * time.Second):
		close(w.release)
		t.Fatal("download never started")
	}
	newArtifact, _ := storedOTA(t, "new-current", "application", "", now)
	next := storedRollout(t, newArtifact, now)
	resp := doJSON("POST", fmt.Sprintf("/admin/ota/rollouts/%d/assign", next), assignRequest{NodeMACs: []string{mac}}, adminCookie())
	status := resp.StatusCode
	resp.Body.Close()
	_, err := testH.collectOTAStorage(context.Background(), true, now)
	close(w.release)
	<-done
	if err != nil || status != 200 {
		t.Fatalf("reassignment/cleanup: %d %v", status, err)
	}
	assertArtifactExists(t, a.SHA256, false)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatal("in-flight download was interrupted or corrupted")
	}
}

func TestOTAStorageCleanupPermissionsAndAutomaticStartupSweep(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	now := time.Now().UTC()
	newerOTAVersions(t, now)
	a, _ := storedOTA(t, "old", "application", "", now.Add(-90*24*time.Hour))
	createTestUser(t, "reader", "password123", "viewer")
	for _, cookie := range []*http.Cookie{nil, userCookieWithRole("reader", "viewer")} {
		resp := doJSON("POST", "/admin/ota/storage/cleanup", nil, cookie)
		if resp.StatusCode != 401 && resp.StatusCode != 403 {
			t.Fatalf("cleanup unauthorized: %d", resp.StatusCode)
		}
		resp.Body.Close()
	}
	assertArtifactExists(t, a.SHA256, true)
	resp := doJSON("GET", "/admin/ota/storage", nil, adminCookie())
	assertStatus(t, resp, 200)
	var preview otaStorageReport
	decodeBody(t, resp, &preview)
	if preview.CandidateCount != 1 || preview.RetentionDays != 30 {
		t.Fatalf("preview API: %+v", preview)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); testH.StartOTAStorageLoop(ctx) }()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(testH.otaArtifactPath(a.SHA256)); os.IsNotExist(err) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("janitor did not stop")
	}
	assertArtifactExists(t, a.SHA256, false)
	resp = doJSON("POST", "/admin/ota/storage/cleanup", nil, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	if scalar(t, "SELECT COUNT(*) FROM audit_logs WHERE action='ota_cleanup'") != 1 {
		t.Fatal("manual cleanup not audited")
	}
}

func TestOTAStorageWaitingForPublicationLockCanCancel(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	unlock, err := testH.lockOTAStorage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := testH.collectOTAStorage(ctx, true, time.Now()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting cleanup did not cancel: %v", err)
	}
}
