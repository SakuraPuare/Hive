package handler

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

const otaKeepLatest = 3
const otaUploadTTL = 24 * time.Hour

var otaTemporaryName = regexp.MustCompile(`^\.upload-[0-9]+$`)

// Artifact publication, cleanup and rollout creation/assignment share this lock.
// Direct uploads additionally lock their temporary file during network I/O.
// flock also serializes Registry processes using the same local/shared volume;
// the volume must support advisory locks and all writers must use this version.
// Downloads retain their open file descriptor and need not hold the lock while
// serving potentially large files.
func (h *Handler) lockOTAStorage(ctx context.Context) (func(), error) {
	if h.Config.OTAArtifactDir == "" {
		return func() {}, nil
	}
	if err := os.MkdirAll(h.Config.OTAArtifactDir, 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(h.Config.OTAArtifactDir, ".storage.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for {
		if err := ctx.Err(); err != nil {
			f.Close()
			return nil, err
		}
		err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func (h *Handler) requireOTAStorageLock(w http.ResponseWriter, r *http.Request) (func(), bool) {
	unlock, err := h.lockOTAStorage(r.Context())
	if err != nil {
		h.jsonErr(w, 503, "OTA storage busy or unavailable")
		return nil, false
	}
	return unlock, true
}

type otaStorageReport struct {
	RetentionDays  int      `json:"retention_days"`
	KeepLatest     int      `json:"keep_latest"`
	ArtifactCount  int      `json:"artifact_count"`
	ArtifactBytes  int64    `json:"artifact_bytes"`
	ProtectedCount int      `json:"protected_count"`
	StagingBytes   int64    `json:"staging_bytes"`
	CandidateCount int      `json:"candidate_count"`
	CandidateBytes int64    `json:"candidate_bytes"`
	RemovedCount   int      `json:"removed_count"`
	RemovedBytes   int64    `json:"removed_bytes"`
	Errors         []string `json:"errors"`
}

type otaStoredFile struct {
	path      string
	size      int64
	sha       string
	version   string
	group     string
	lastUsed  time.Time
	protected bool
}

// Unknown files, symlinks and malformed bundles are never guessed to be garbage.
// Rollout rows remain as history even after their unreferenced artifact expires.
func (h *Handler) collectOTAStorage(ctx context.Context, remove bool, now time.Time) (otaStorageReport, error) {
	report := otaStorageReport{RetentionDays: h.Config.OTARetentionDays, KeepLatest: otaKeepLatest, Errors: []string{}}
	if h.Config.OTAArtifactDir == "" {
		return report, errors.New("OTA storage not configured")
	}
	unlock, err := h.lockOTAStorage(ctx)
	if err != nil {
		return report, err
	}
	defer unlock()
	// Read all references before any removal. A DB failure aborts the complete
	// sweep, including staging cleanup; uncertainty must never delete a bundle.
	var refs []struct {
		SHA256     string
		CreatedAt  time.Time
		Referenced int
	}
	err = h.DB.WithContext(ctx).Raw(`SELECT r.sha256, r.created_at,
		EXISTS(SELECT 1 FROM ota_assignments a WHERE a.rollout_id=r.id) AS referenced
		FROM ota_rollouts r WHERE r.url = CONCAT(?, r.sha256)`, otaArtifactPrefix).Scan(&refs).Error
	if err != nil {
		return report, err
	}
	inUse := make(map[string]bool)
	lastReference := make(map[string]time.Time)
	for _, ref := range refs {
		if ref.Referenced != 0 {
			inUse[ref.SHA256] = true
		}
		if ref.CreatedAt.After(lastReference[ref.SHA256]) {
			lastReference[ref.SHA256] = ref.CreatedAt
		}
	}
	entries, err := os.ReadDir(h.Config.OTAArtifactDir)
	if err != nil {
		return report, err
	}
	var artifacts, candidates []otaStoredFile
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		name := entry.Name()
		file := filepath.Join(h.Config.OTAArtifactDir, name)
		info, err := entry.Info()
		if err != nil {
			report.Errors = append(report.Errors, name+": cannot stat")
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		if otaTemporaryName.MatchString(name) {
			report.StagingBytes += info.Size()
			if now.Sub(info.ModTime()) > otaUploadTTL {
				// A live upload may be old or stalled. Never unlink its temporary file,
				// and do not let it block cleanup of unrelated expired packages.
				f, err := os.OpenFile(file, os.O_RDWR, 0)
				if err != nil {
					report.Errors = append(report.Errors, name+": cannot inspect temporary upload")
					continue
				}
				err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
				f.Close()
				if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
					continue
				}
				if err != nil {
					report.Errors = append(report.Errors, name+": cannot lock temporary upload")
					continue
				}
				candidates = append(candidates, otaStoredFile{path: file, size: info.Size()})
			}
			continue
		}
		sha := strings.TrimSuffix(name, ".tar.gz")
		if name == sha || !otaSHA256Pattern.MatchString(sha) {
			continue
		}
		report.ArtifactCount++
		report.ArtifactBytes += info.Size()
		lastUsed := info.ModTime()
		if lastReference[sha].After(lastUsed) {
			lastUsed = lastReference[sha]
		}
		f, err := os.Open(file)
		if err != nil {
			report.Errors = append(report.Errors, name+": cannot read")
			report.ProtectedCount++
			continue
		}
		meta, err := readOTAMetadata(f)
		f.Close()
		if err != nil {
			report.Errors = append(report.Errors, name+": invalid metadata; retained")
			report.ProtectedCount++
			continue
		}
		group := meta.Kind
		if meta.Kind == "firmware" {
			group += "/" + meta.Board
		}
		artifacts = append(artifacts, otaStoredFile{path: file, size: info.Size(), sha: sha, version: meta.Version, group: group, lastUsed: lastUsed, protected: inUse[sha]})
	}
	// Newest means last upload/use, not lexicographic version ordering. Keep
	// one package for each of the three newest distinct versions in each group;
	// duplicate builds of a version cannot evict all older rollback versions.
	sort.Slice(artifacts, func(i, j int) bool {
		if artifacts[i].lastUsed.Equal(artifacts[j].lastUsed) {
			return artifacts[i].sha < artifacts[j].sha
		}
		return artifacts[i].lastUsed.After(artifacts[j].lastUsed)
	})
	versions := make(map[string]map[string]bool)
	for _, artifact := range artifacts {
		if versions[artifact.group] == nil {
			versions[artifact.group] = make(map[string]bool)
		}
		keepVersion := false
		if !versions[artifact.group][artifact.version] {
			versions[artifact.group][artifact.version] = true
			keepVersion = len(versions[artifact.group]) <= otaKeepLatest
		}
		if artifact.protected || keepVersion || report.RetentionDays <= 0 || !artifact.lastUsed.Before(now.Add(-time.Duration(report.RetentionDays)*24*time.Hour)) {
			report.ProtectedCount++
			continue
		}
		candidates = append(candidates, artifact)
	}
	// Chunk sessions and completion receipts expire from their last activity,
	// even when nobody starts another upload. RemoveAll does not follow links.
	uploadRoot := filepath.Join(h.Config.OTAArtifactDir, ".uploads")
	uploads, err := os.ReadDir(uploadRoot)
	if err != nil && !os.IsNotExist(err) {
		return report, err
	}
	for _, entry := range uploads {
		if !otaSHA256Pattern.MatchString(entry.Name()) || !entry.IsDir() {
			continue
		}
		dir := filepath.Join(uploadRoot, entry.Name())
		info, err := entry.Info()
		if err != nil {
			report.Errors = append(report.Errors, entry.Name()+": cannot stat upload")
			continue
		}
		var size int64
		err = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if walkErr != nil {
				return walkErr
			}
			if entry.Type().IsRegular() {
				info, err := entry.Info()
				if err != nil {
					return err
				}
				size += info.Size()
			}
			return nil
		})
		if err != nil {
			if ctx.Err() != nil {
				return report, ctx.Err()
			}
			report.Errors = append(report.Errors, entry.Name()+": cannot scan upload")
			continue
		}
		report.StagingBytes += size
		if now.Sub(info.ModTime()) > otaUploadTTL {
			candidates = append(candidates, otaStoredFile{path: dir, size: size})
		}
	}
	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		report.CandidateCount++
		report.CandidateBytes += candidate.size
		if !remove {
			continue
		}
		if err := os.RemoveAll(candidate.path); err != nil {
			report.Errors = append(report.Errors, filepath.Base(candidate.path)+": removal failed")
			continue
		}
		report.RemovedCount++
		report.RemovedBytes += candidate.size
	}
	return report, nil
}

func (h *Handler) otaArtifactMissing(ro model.OtaRollout) bool {
	if !strings.HasPrefix(ro.URL, otaArtifactPrefix) {
		return false
	}
	if h.Config.OTAArtifactDir == "" || !otaSHA256Pattern.MatchString(ro.SHA256) {
		return true
	}
	info, err := os.Lstat(h.otaArtifactPath(ro.SHA256))
	return err != nil || !info.Mode().IsRegular()
}

// HandleAdminOTAStorage godoc
// @Summary Preview OTA storage and safe cleanup candidates
// @ID AdminOtaStorage
// @Tags admin
// @Security AdminSessionCookie
// @Success 200 {object} otaStorageReport
// @Router /admin/ota/storage [get]
func (h *Handler) HandleAdminOTAStorage(w http.ResponseWriter, r *http.Request) {
	report, err := h.collectOTAStorage(r.Context(), false, time.Now().UTC())
	if err != nil {
		h.jsonErr(w, 503, "cannot inspect OTA storage")
		return
	}
	h.jsonOK(w, report)
}

// HandleAdminCleanupOTA godoc
// @Summary Clean expired, unreferenced OTA files using the retention policy
// @ID AdminCleanupOtaStorage
// @Tags admin
// @Security AdminSessionCookie
// @Success 200 {object} otaStorageReport
// @Router /admin/ota/storage/cleanup [post]
func (h *Handler) HandleAdminCleanupOTA(w http.ResponseWriter, r *http.Request) {
	report, err := h.collectOTAStorage(r.Context(), true, time.Now().UTC())
	if err != nil {
		h.jsonErr(w, 503, "cannot clean OTA storage")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "ota_cleanup", fmt.Sprintf("files=%d bytes=%d errors=%d", report.RemovedCount, report.RemovedBytes, len(report.Errors)), getClientIP(r))
	h.jsonOK(w, report)
}

func (h *Handler) StartOTAStorageLoop(ctx context.Context) {
	if h.Config.OTAArtifactDir == "" {
		return
	}
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		report, err := h.collectOTAStorage(ctx, true, time.Now().UTC())
		if err != nil && ctx.Err() == nil {
			log.Printf("OTA cleanup: %v", err)
		}
		if report.RemovedCount > 0 {
			log.Printf("OTA cleanup: removed %d entries (%d bytes)", report.RemovedCount, report.RemovedBytes)
		}
		for _, err := range report.Errors {
			log.Printf("OTA cleanup: %s", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
