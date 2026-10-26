package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const otaChunkSize = int64(16 << 20)

type otaUploadRequest struct {
	Size int64 `json:"size"`
}
type otaUploadSession struct {
	ID        string `json:"id"`
	Size      int64  `json:"size"`
	ChunkSize int64  `json:"chunk_size"`
	Actor     string `json:"-"`
}
type otaUploadMetadata struct {
	Size  int64  `json:"size"`
	Actor string `json:"actor"`
}

type otaUploadResult struct {
	bytes.Buffer
	header http.Header
	status int
}

func (r *otaUploadResult) Header() http.Header    { return r.header }
func (r *otaUploadResult) WriteHeader(status int) { r.status = status }

// HandleCreateOTAUpload godoc
// @Summary Start a chunked OTA upload (16 MiB chunks, 2 GiB total)
// @ID AdminCreateOtaUpload
// @Tags admin
// @Security AdminSessionCookie
// @Accept json
// @Param body body otaUploadRequest true "bundle size"
// @Success 200 {object} otaUploadSession
// @Router /admin/ota/uploads [post]
func (h *Handler) HandleCreateOTAUpload(w http.ResponseWriter, r *http.Request) {
	var body otaUploadRequest
	if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil || body.Size <= 0 || body.Size > otaUploadLimit {
		h.jsonErr(w, 400, "size must be between 1 byte and 2 GiB")
		return
	}
	if h.Config.OTAArtifactDir == "" {
		h.jsonErr(w, 503, "OTA storage not configured")
		return
	}
	unlock, ok := h.requireOTAStorageLock(w, r)
	if !ok {
		return
	}
	defer unlock()
	root := filepath.Join(h.Config.OTAArtifactDir, ".uploads")
	if err := os.MkdirAll(root, 0700); err != nil {
		h.jsonErr(w, 500, "OTA storage unavailable")
		return
	}
	id, err := generateToken()
	if err != nil {
		h.jsonErr(w, 500, "cannot create upload")
		return
	}
	dir := filepath.Join(root, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		h.jsonErr(w, 500, "cannot create upload")
		return
	}
	actor, _, _ := h.Auth.ParseSession(r)
	meta, _ := json.Marshal(otaUploadMetadata{Size: body.Size, Actor: actor})
	if err := os.WriteFile(filepath.Join(dir, "metadata.json"), meta, 0600); err != nil {
		os.RemoveAll(dir)
		h.jsonErr(w, 500, "cannot save upload")
		return
	}
	h.jsonOK(w, otaUploadSession{ID: id, Size: body.Size, ChunkSize: otaChunkSize})
}

func (h *Handler) otaUpload(r *http.Request) (string, otaUploadMetadata, bool) {
	var meta otaUploadMetadata
	if h.Config.OTAArtifactDir == "" {
		return "", meta, false
	}
	id := r.PathValue("id")
	if !otaSHA256Pattern.MatchString(id) {
		return "", meta, false
	}
	dir := filepath.Join(h.Config.OTAArtifactDir, ".uploads", id)
	data, err := os.ReadFile(filepath.Join(dir, "metadata.json"))
	actor, _, _ := h.Auth.ParseSession(r)
	if err != nil || json.Unmarshal(data, &meta) != nil || meta.Actor != actor {
		return "", meta, false
	}
	return dir, meta, true
}

// HandleOTAUploadPart godoc
// @Summary Upload one OTA chunk; identical retries are accepted
// @ID AdminUploadOtaPart
// @Tags admin
// @Security AdminSessionCookie
// @Accept application/octet-stream
// @Param id path string true "upload id"
// @Param part path int true "zero-based chunk index"
// @Success 200 {object} StatusResponse
// @Router /admin/ota/uploads/{id}/{part} [put]
func (h *Handler) HandleOTAUploadPart(w http.ResponseWriter, r *http.Request) {
	unlock, ok := h.requireOTAStorageLock(w, r)
	if !ok {
		return
	}
	defer unlock()
	dir, meta, ok := h.otaUpload(r)
	if !ok {
		h.jsonErr(w, 404, "upload not found")
		return
	}
	if _, err := os.Stat(filepath.Join(dir, "result.json")); err == nil {
		h.jsonErr(w, 409, "upload already completed")
		return
	} else if !os.IsNotExist(err) {
		h.jsonErr(w, 500, "cannot read upload state")
		return
	}
	part, err := strconv.ParseInt(r.PathValue("part"), 10, 64)
	if err != nil || part < 0 || part >= (meta.Size+otaChunkSize-1)/otaChunkSize {
		h.jsonErr(w, 400, "invalid chunk index")
		return
	}
	expected := min(otaChunkSize, meta.Size-part*otaChunkSize)
	f, err := os.CreateTemp(dir, ".part-*")
	if err != nil {
		h.jsonErr(w, 500, "cannot write chunk")
		return
	}
	defer os.Remove(f.Name())
	defer f.Close()
	digest := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, digest), http.MaxBytesReader(w, r.Body, expected))
	if err != nil || n != expected {
		h.jsonErr(w, 400, "chunk size mismatch")
		return
	}
	if f.Sync() != nil {
		h.jsonErr(w, 500, "cannot persist chunk")
		return
	}
	f.Close()
	dest := filepath.Join(dir, strconv.FormatInt(part, 10))
	if err := os.Link(f.Name(), dest); err != nil {
		if !os.IsExist(err) {
			h.jsonErr(w, 500, "cannot save chunk")
			return
		}
		existing, err := os.Open(dest)
		if err != nil {
			h.jsonErr(w, 500, "cannot read chunk")
			return
		}
		oldDigest := sha256.New()
		_, copyErr := io.Copy(oldDigest, existing)
		existing.Close()
		if copyErr != nil || hex.EncodeToString(oldDigest.Sum(nil)) != hex.EncodeToString(digest.Sum(nil)) {
			h.jsonErr(w, 409, "chunk already uploaded with different contents")
			return
		}
	}
	if err := os.Chtimes(dir, time.Now(), time.Now()); err != nil {
		h.jsonErr(w, 500, "cannot renew upload session")
		return
	}
	h.jsonOK(w, StatusResponse{Status: "ok"})
}

// HandleCompleteOTAUpload godoc
// @Summary Assemble uploaded chunks and publish an OTA bundle
// @ID AdminCompleteOtaUpload
// @Tags admin
// @Security AdminSessionCookie
// @Param id path string true "upload id"
// @Success 200 {object} otaArtifactResponse
// @Router /admin/ota/uploads/{id}/complete [post]
func (h *Handler) HandleCompleteOTAUpload(w http.ResponseWriter, r *http.Request) {
	unlock, ok := h.requireOTAStorageLock(w, r)
	if !ok {
		return
	}
	defer unlock()
	dir, meta, ok := h.otaUpload(r)
	if !ok {
		h.jsonErr(w, 404, "upload not found")
		return
	}
	if data, err := os.ReadFile(filepath.Join(dir, "result.json")); err == nil {
		var artifact otaArtifactResponse
		if json.Unmarshal(data, &artifact) != nil || h.validateOTASource(artifact.Version, artifact.URL, artifact.SHA256) != nil {
			h.jsonErr(w, 409, "completed bundle unavailable; start a new upload")
			return
		}
		now := time.Now().UTC()
		if os.Chtimes(h.otaArtifactPath(artifact.SHA256), now, now) != nil || os.Chtimes(dir, now, now) != nil {
			h.jsonErr(w, 500, "cannot renew completed upload")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
		return
	}
	var parts []io.Reader
	for i := int64(0); i < (meta.Size+otaChunkSize-1)/otaChunkSize; i++ {
		f, err := os.Open(filepath.Join(dir, strconv.FormatInt(i, 10)))
		if err != nil {
			h.jsonErr(w, 409, "upload is incomplete")
			return
		}
		defer f.Close()
		parts = append(parts, f)
	}
	r.Body = io.NopCloser(io.MultiReader(parts...))
	result := &otaUploadResult{header: make(http.Header), status: 200}
	h.uploadOTABundle(result, r, true)
	if result.status == 200 {
		// A lost completion response can be retried without uploading again.
		if err := os.WriteFile(filepath.Join(dir, "result.json"), result.Bytes(), 0600); err != nil {
			h.jsonErr(w, 500, "cannot save upload receipt")
			return
		}
		for i := range parts {
			os.Remove(filepath.Join(dir, strconv.Itoa(i)))
		}
	} else {
		os.RemoveAll(dir)
	}
	for key, values := range result.header {
		w.Header()[key] = values
	}
	w.WriteHeader(result.status)
	w.Write(result.Bytes())
}
