package handler

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"hive/registry/internal/store"
)

const otaUploadLimit = int64(2 << 30)
const otaArtifactPrefix = "registry://"

var otaVersionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
var otaSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type otaArtifactResponse struct {
	Version string `json:"version"`
	Kind    string `json:"kind"`
	Board   string `json:"board,omitempty"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
}

func (h *Handler) otaArtifactPath(sha string) string {
	return filepath.Join(h.Config.OTAArtifactDir, sha+".tar.gz")
}

// Read only metadata; never extract an uploaded archive on the management host.
// The device verifies the trusted signature and all payload hashes before use.
func readOTAMetadata(f *os.File) (otaArtifactResponse, error) {
	var meta otaArtifactResponse
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return meta, err
	}
	gz, err := gzip.NewReader(f)
	if err != nil {
		return meta, err
	}
	defer gz.Close()
	tr := tar.NewReader(io.LimitReader(gz, 16<<30))
	for {
		header, err := tr.Next()
		if err != nil {
			return meta, errors.New("bundle must contain manifest.json")
		}
		if path.Base(header.Name) != "manifest.json" {
			continue
		}
		if header.Typeflag != tar.TypeReg || header.Size > 1<<20 {
			return meta, errors.New("invalid manifest")
		}
		if err := json.NewDecoder(io.LimitReader(tr, 1<<20)).Decode(&meta); err != nil {
			return meta, err
		}
		if !otaVersionPattern.MatchString(meta.Version) {
			return meta, errors.New("invalid manifest version")
		}
		if meta.Kind == "" {
			meta.Kind = "application"
		}
		if meta.Kind != "application" && meta.Kind != "firmware" {
			return meta, errors.New("unsupported bundle kind")
		}
		if meta.Kind == "firmware" && meta.Board != "nanopi-zero2" && meta.Board != "nanopi-r28s" {
			return meta, errors.New("unsupported firmware board")
		}
		return meta, nil
	}
}

// HandleAdminUploadOTA godoc
// @Summary Upload a signed OTA bundle (maximum 2 GiB)
// @ID AdminUploadOtaBundle
// @Tags admin
// @Security AdminSessionCookie
// @Accept application/gzip
// @Produce json
// @Success 200 {object} otaArtifactResponse
// @Failure 400 {object} ErrorResponse
// @Failure 413 {object} ErrorResponse
// @Router /admin/ota/bundles [post]
func (h *Handler) HandleAdminUploadOTA(w http.ResponseWriter, r *http.Request) {
	if h.Config.OTAArtifactDir == "" {
		h.jsonErr(w, 503, "OTA storage not configured")
		return
	}
	if err := os.MkdirAll(h.Config.OTAArtifactDir, 0700); err != nil {
		h.jsonErr(w, 500, "OTA storage unavailable")
		return
	}
	f, err := os.CreateTemp(h.Config.OTAArtifactDir, ".upload-*")
	if err != nil {
		h.jsonErr(w, 500, "cannot create upload")
		return
	}
	defer os.Remove(f.Name())
	defer f.Close()
	r.Body = http.MaxBytesReader(w, r.Body, otaUploadLimit)
	digest := sha256.New()
	size, err := io.Copy(io.MultiWriter(f, digest), r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			h.jsonErr(w, 413, "bundle exceeds 2 GiB")
		} else {
			h.jsonErr(w, 400, "incomplete upload")
		}
		return
	}
	meta, err := readOTAMetadata(f)
	if err != nil {
		h.jsonErr(w, 400, "invalid OTA bundle: "+err.Error())
		return
	}
	meta.SHA256 = hex.EncodeToString(digest.Sum(nil))
	meta.Size = size
	meta.URL = otaArtifactPrefix + meta.SHA256
	if err := f.Sync(); err != nil {
		h.jsonErr(w, 500, "cannot persist upload")
		return
	}
	if err := f.Close(); err != nil {
		h.jsonErr(w, 500, "cannot close upload")
		return
	}
	// An existing content-addressed artifact has identical bytes. Link publishes
	// atomically without replacing a file being downloaded by another device.
	if err := os.Link(f.Name(), h.otaArtifactPath(meta.SHA256)); err != nil && !os.IsExist(err) {
		h.jsonErr(w, 500, "cannot publish upload")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	store.WriteAuditLog(h.DB, actor, "ota_upload", meta.Version+" "+meta.SHA256, getClientIP(r))
	h.jsonOK(w, meta)
}

func (h *Handler) validateOTASource(version, source, sha string) error {
	if !otaVersionPattern.MatchString(version) {
		return errors.New("invalid version")
	}
	if strings.HasPrefix(source, otaArtifactPrefix) {
		if strings.TrimPrefix(source, otaArtifactPrefix) != sha {
			return errors.New("artifact SHA256 mismatch")
		}
		f, err := os.Open(h.otaArtifactPath(sha))
		if err != nil {
			return errors.New("uploaded bundle not found")
		}
		defer f.Close()
		meta, err := readOTAMetadata(f)
		if err != nil || meta.Version != version {
			return errors.New("bundle version mismatch")
		}
		return nil
	}
	u, err := url.Parse(source)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.Fragment != "" {
		return errors.New("url must be an HTTP(S) URL or an uploaded bundle")
	}
	return nil
}

// HandleNodeOTABundle godoc
// @Summary Download the OTA bundle assigned to this device
// @ID NodeOtaBundle
// @Tags nodes
// @Security BearerAuth
// @Param mac path string true "node MAC"
// @Param sha path string true "bundle SHA256"
// @Success 200 {file} file
// @Failure 404 {object} ErrorResponse
// @Router /nodes/{mac}/ota-bundle/{sha} [get]
func (h *Handler) HandleNodeOTABundle(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	sha := r.PathValue("sha")
	if !otaSHA256Pattern.MatchString(sha) {
		h.jsonErr(w, 404, "bundle not found")
		return
	}
	var count int64
	err := h.DB.Raw(`SELECT COUNT(*) FROM ota_assignments a JOIN ota_rollouts r ON r.id = a.rollout_id
		WHERE a.node_mac = ? AND r.sha256 = ? AND r.url = ?`, normalizeOtaMAC(r.PathValue("mac")), sha, otaArtifactPrefix+sha).Scan(&count).Error
	if err != nil {
		h.jsonErr(w, 500, "cannot read assignment")
		return
	}
	if count == 0 {
		h.jsonErr(w, 404, "bundle not assigned")
		return
	}
	f, err := os.Open(h.otaArtifactPath(sha))
	if err != nil {
		h.jsonErr(w, 404, "bundle not found")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		h.jsonErr(w, 404, "bundle not found")
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("ETag", `"`+sha+`"`)
	http.ServeContent(w, r, sha+".tar.gz", info.ModTime(), f)
}
