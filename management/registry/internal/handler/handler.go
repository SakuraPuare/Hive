package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"gorm.io/gorm"

	"hive/registry/internal/config"
	"hive/registry/internal/mailer"
	"hive/registry/internal/middleware"
	"hive/registry/internal/model"
)

// Handler holds shared dependencies for all HTTP handlers.
type Handler struct {
	DB     *gorm.DB
	Config *config.Config
	Auth   *middleware.Auth
	Mailer *mailer.Mailer

	// Rate limiters, populated by RegisterRoutes. Exposed so tests can reset
	// their shared state between cases.
	loginRL    *middleware.RateLimiter
	forgotPwRL *middleware.RateLimiter
}

// ResetRateLimiters clears the request windows of all rate limiters. Intended
// for tests where a single server instance is shared across many cases.
func (h *Handler) ResetRateLimiters() {
	if h.loginRL != nil {
		h.loginRL.Reset()
	}
	if h.forgotPwRL != nil {
		h.forgotPwRL.Reset()
	}
}

func (h *Handler) jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("jsonOK: encode error: %v", err)
	}
}

func (h *Handler) jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, "{\"error\":%q}\n", msg)
}

// queryAllNodes returns all nodes with probe status via LEFT JOIN.
func (h *Handler) queryAllNodes() ([]model.Node, error) {
	var nodes []model.Node
	err := h.DB.Raw("SELECT " + model.NodeCols + " FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac ORDER BY n.hostname").Scan(&nodes).Error
	return nodes, err
}

// queryNodesByMACs queries nodes by MAC list.
func (h *Handler) queryNodesByMACs(macs []string) ([]model.Node, error) {
	if len(macs) == 0 {
		return nil, nil
	}
	var nodes []model.Node
	if err := h.DB.Raw("SELECT "+model.NodeCols+" FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac WHERE n.mac IN ? ORDER BY n.hostname", macs).Scan(&nodes).Error; err != nil {
		return nil, err
	}
	return nodes, nil
}
