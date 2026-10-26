package handler

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func otaTestBundle(t *testing.T) []byte {
	t.Helper()
	return otaManifestBundle(t, `{"version":"2.0","kind":"application","files":[]}`)
}

func otaManifestBundle(t *testing.T, content string) []byte {
	t.Helper()
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tw := tar.NewWriter(gz)
	manifest := []byte(content)
	if err := tw.WriteHeader(&tar.Header{Name: "bundle/manifest.json", Mode: 0600, Size: int64(len(manifest))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(manifest); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func uploadTestOTA(t *testing.T, data []byte, authenticated bool) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("POST", testServer.URL+"/admin/ota/bundles", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/gzip")
	if authenticated {
		req.AddCookie(adminCookie())
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func otaStorage(t *testing.T) {
	t.Helper()
	previous := testCfg.OTAArtifactDir
	previousDays := testCfg.OTARetentionDays
	testCfg.OTARetentionDays = 30
	testCfg.OTAArtifactDir = t.TempDir()
	t.Cleanup(func() { testCfg.OTAArtifactDir = previous; testCfg.OTARetentionDays = previousDays })
}

func TestOTAUploadDownloadAndAssignmentAuthorization(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	data := otaTestBundle(t)
	resp := uploadTestOTA(t, data, false)
	if resp.StatusCode != 401 && resp.StatusCode != 403 {
		t.Fatal("upload allowed without admin session")
	}
	resp.Body.Close()
	resp = uploadTestOTA(t, data, true)
	assertStatus(t, resp, 200)
	var artifact otaArtifactResponse
	decodeBody(t, resp, &artifact)
	if artifact.Version != "2.0" || artifact.SHA256 != fmt.Sprintf("%x", sha256.Sum256(data)) || artifact.Size != int64(len(data)) {
		t.Fatalf("bad upload metadata: %+v", artifact)
	}
	resp = uploadTestOTA(t, data, true)
	assertStatus(t, resp, 200)
	resp.Body.Close()
	entries, _ := os.ReadDir(testCfg.OTAArtifactDir)
	if len(entries) != 2 { // bundle plus the persistent storage lock
		t.Fatal("duplicate upload left extra files")
	}
	mac, other := "aabbccddeeff", "112233445566"
	insertTestNode(t, mac)
	insertTestNode(t, other)
	token := deviceToken(t, mac)
	otherToken := deviceToken(t, other)
	resp = doJSON("POST", "/admin/ota/rollouts", createRolloutRequest{Version: artifact.Version, URL: artifact.URL, SHA256: artifact.SHA256, NodeMACs: []string{mac}}, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doBearer("GET", "/nodes/"+mac+"/ota-version", nil, token)
	info := parseJSON(resp)
	downloadURL := info["url"].(string)
	resp = doBearer("GET", downloadURL, nil, token)
	assertStatus(t, resp, 200)
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Equal(got, data) {
		t.Fatal("download corrupted")
	}
	resp = doBearer("GET", downloadURL, nil, otherToken)
	if resp.StatusCode != 403 && resp.StatusCode != 401 {
		t.Fatal("cross-device download allowed")
	}
	resp.Body.Close()
	resp = doBearer("GET", "/nodes/"+other+"/ota-bundle/"+artifact.SHA256, nil, otherToken)
	assertStatus(t, resp, 404)
	resp.Body.Close()
	req, _ := http.NewRequest("GET", testServer.URL+downloadURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Range", "bytes=0-9")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	assertStatus(t, resp, 206)
	got, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Equal(got, data[:10]) {
		t.Fatal("range download corrupted")
	}
}

func TestOTARejectInvalidUploadAndSource(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	resp := uploadTestOTA(t, []byte("not a bundle"), true)
	assertStatus(t, resp, 400)
	resp.Body.Close()
	entries, _ := os.ReadDir(testCfg.OTAArtifactDir)
	if len(entries) != 1 || entries[0].Name() != ".storage.lock" {
		t.Fatal("invalid upload retained")
	}
	for _, source := range []string{"file:///etc/passwd", "https://user:pass@example.com/bundle", "registry://" + strings.Repeat("a", 64)} {
		resp = doJSON("POST", "/admin/ota/rollouts", createRolloutRequest{Version: "2.0", URL: source, SHA256: strings.Repeat("a", 64)}, adminCookie())
		assertStatus(t, resp, 400)
		resp.Body.Close()
	}
	resp = uploadTestOTA(t, otaTestBundle(t), true)
	var artifact otaArtifactResponse
	decodeBody(t, resp, &artifact)
	resp = doJSON("POST", "/admin/ota/rollouts", createRolloutRequest{Version: "wrong", URL: artifact.URL, SHA256: artifact.SHA256}, adminCookie())
	assertStatus(t, resp, 400)
	resp.Body.Close()
}

func TestOTAProgressAndRollbackAreTerminalAndAssignmentScoped(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	token := deviceToken(t, mac)
	resp := doJSON("POST", "/admin/ota/rollouts", createRolloutRequest{Version: "2.0", URL: "https://example.com/bundle", SHA256: strings.Repeat("a", 64), NodeMACs: []string{mac}}, adminCookie())
	assertStatus(t, resp, 200)
	resp.Body.Close()
	resp = doBearer("GET", "/nodes/"+mac+"/ota-version", nil, token)
	assignment := parseJSON(resp)["assignment_token"].(string)
	for _, status := range []string{"installing", "rolled_back", "done", "installing"} {
		resp = doBearer("POST", "/nodes/"+mac+"/ota-ack", otaAckRequest{Version: "2.0", AssignmentToken: assignment, Status: status}, token)
		assertStatus(t, resp, 200)
		resp.Body.Close()
	}
	if scalar(t, "SELECT COUNT(*) FROM ota_assignments WHERE status='rolled_back'") != 1 {
		t.Fatal("terminal rollback overwritten")
	}
	resp = doBearer("GET", "/nodes/"+mac+"/ota-version", nil, token)
	if parseJSON(resp)["version"] != "" {
		t.Fatal("rolled back bundle offered again")
	}
	resp = doJSON("GET", "/admin/ota/rollouts", nil, adminCookie())
	items := parseJSONArray(resp)
	if len(items) != 1 || items[0]["rolled_back"] != float64(1) {
		t.Fatal("rollback not visible to operator")
	}
}

func TestOTAChunkUploadRetriesAndCompletion(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	data := otaTestBundle(t)
	resp := doJSON("POST", "/admin/ota/uploads", otaUploadRequest{Size: int64(len(data))}, adminCookie())
	assertStatus(t, resp, 200)
	var session otaUploadSession
	decodeBody(t, resp, &session)
	base := "/admin/ota/uploads/" + session.ID
	resp = doJSON("POST", base+"/complete", nil, adminCookie())
	assertStatus(t, resp, 409)
	resp.Body.Close()
	put := func(part string, content []byte) *http.Response {
		req, _ := http.NewRequest("PUT", testServer.URL+base+"/"+part, bytes.NewReader(content))
		req.AddCookie(adminCookie())
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	resp = put("0", data[:len(data)-1])
	assertStatus(t, resp, 400)
	resp.Body.Close()
	resp = put("1", data)
	assertStatus(t, resp, 400)
	resp.Body.Close()
	for range 2 {
		resp = put("0", data)
		assertStatus(t, resp, 200)
		resp.Body.Close()
	}
	resp = put("0", bytes.Repeat([]byte("x"), len(data)))
	assertStatus(t, resp, 409)
	resp.Body.Close()
	for range 2 {
		resp = doJSON("POST", base+"/complete", nil, adminCookie())
		assertStatus(t, resp, 200)
		var artifact otaArtifactResponse
		decodeBody(t, resp, &artifact)
		if artifact.SHA256 != fmt.Sprintf("%x", sha256.Sum256(data)) {
			t.Fatal("chunked upload corrupted")
		}
	}
	resp = put("0", data)
	assertStatus(t, resp, 409)
	resp.Body.Close()
	// A stale receipt must not report success for a package that is gone.
	if err := os.Remove(testH.otaArtifactPath(fmt.Sprintf("%x", sha256.Sum256(data)))); err != nil {
		t.Fatal(err)
	}
	resp = doJSON("POST", base+"/complete", nil, adminCookie())
	assertStatus(t, resp, 409)
	resp.Body.Close()
}

func TestOTAFirmwareBoardMetadata(t *testing.T) {
	resetDB(t)
	otaStorage(t)
	for _, board := range []string{"nanopi-zero2", "nanopi-r28s", "nanopi-r3s"} {
		data := otaManifestBundle(t, fmt.Sprintf(`{"version":"2.0","kind":"firmware","board":%q,"files":[]}`, board))
		resp := uploadTestOTA(t, data, true)
		if board == "nanopi-r3s" {
			assertStatus(t, resp, 400)
			resp.Body.Close()
		} else {
			assertStatus(t, resp, 200)
			var meta otaArtifactResponse
			decodeBody(t, resp, &meta)
			if meta.Board != board {
				t.Fatalf("lost board metadata: %+v", meta)
			}
		}
	}
}

func TestOTACommandRequiresReleasePermission(t *testing.T) {
	resetDB(t)
	mac := "aabbccddeeff"
	insertTestNode(t, mac)
	cid := insertTestCustomer(t, "ota-owner@example.com")
	mustExec(t, "UPDATE nodes SET owner_customer_id=? WHERE mac=?", cid, mac)
	uid := createTestUser(t, "node-operator", "password123", "admin")
	command := enqueueCommandRequest{Action: "ota-update", Params: `{"url":"https://example.com/bundle.tar.gz","sha256":"` + strings.Repeat("a", 64) + `"}`}
	resp := doJSON("POST", "/portal/devices/"+mac+"/commands", command, customerCookie(cid))
	assertStatus(t, resp, 403)
	resp.Body.Close()
	resp = doJSON("POST", "/admin/nodes/"+mac+"/commands", command, userCookieWithRole("node-operator", "admin"))
	assertStatus(t, resp, 403)
	resp.Body.Close()
	if scalar(t, "SELECT COUNT(*) FROM node_commands") != 0 {
		t.Fatal("unauthorized OTA command enqueued")
	}
	mustExec(t, "INSERT INTO user_permissions (user_id,permission_id) SELECT ?,id FROM permissions WHERE slug='ota:write'", uid)
	resp = doJSON("POST", "/admin/nodes/"+mac+"/commands", command, userCookieWithRole("node-operator", "admin"))
	assertStatus(t, resp, 200)
	resp.Body.Close()
}
