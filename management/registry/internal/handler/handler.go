package handler

import (
	"encoding/json"
	"fmt"
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
}

func (h *Handler) jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, "{\"error\":%q}\n", msg)
}

// queryAllNodes returns all nodes with probe status via LEFT JOIN.
func (h *Handler) queryAllNodes() ([]model.Node, error) {
	var nodes []model.Node
	err := h.DB.Raw("SELECT "+model.NodeCols+" FROM nodes n LEFT JOIN node_status_checks nsc ON n.mac = nsc.mac ORDER BY n.hostname").Scan(&nodes).Error
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
