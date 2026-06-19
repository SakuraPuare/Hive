package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	"hive/registry/internal/model"
)

// gatewaySecret derives a deterministic external-controller API secret from the
// node MAC (same "everything derived from MAC" convention as the rest of Hive).
func gatewaySecret(mac string) string {
	sum := sha256.Sum256([]byte("hive-mihomo-secret:" + strings.ToLower(mac)))
	return hex.EncodeToString(sum[:])[:32]
}

// HandleNodeClashConfig godoc
// @Summary Gateway Mihomo config for a node
// @ID      NodeClashConfig
// @Description Returns the full Mihomo (Clash.Meta) YAML config for this node's
// @Description transparent-proxy gateway role. The upstream proxy pool is every
// @Description enabled exit node in the cluster EXCEPT this node itself (no
// @Description self-routing loop); the CN split-routing rule is flipped according
// @Description to the node's gateway_direction. Device-authenticated (Bearer API_SECRET).
// @Tags nodes
// @Security BearerAuth
// @Produce plain
// @Param mac path string true "node MAC"
// @Success 200 {string} string "Mihomo YAML"
// @Failure 401 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /nodes/{mac}/clash-config [get]
func (h *Handler) HandleNodeClashConfig(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}

	mac := strings.ToLower(r.PathValue("mac"))
	if mac == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac required")
		return
	}

	// Self: gateway settings (direction / upstream mode / selected upstreams).
	var self model.Node
	if err := h.DB.Raw(
		"SELECT "+model.NodeColsPlain+" FROM nodes WHERE mac = ?", mac,
	).Scan(&self).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}
	if self.MAC == "" {
		h.jsonErr(w, http.StatusNotFound, "node not found")
		return
	}

	direction := self.GatewayDirection
	if direction == "" {
		direction = "domestic"
	}
	upstreamMode := self.GatewayUpstreamMode
	if upstreamMode == "" {
		upstreamMode = "auto"
	}
	var upstreamMACs []string
	if self.GatewayUpstreamNodes != "" {
		upstreamMACs = strings.Split(self.GatewayUpstreamNodes, ",")
	}

	// Candidate upstreams: all enabled, active exit nodes (self excluded inside builder).
	var all []model.Node
	if err := h.DB.Raw(
		"SELECT " + model.NodeColsPlain + " FROM nodes " +
			"WHERE enabled = 1 AND status = 'active' AND cf_url <> '' AND xray_uuid <> '' " +
			"ORDER BY weight DESC, hostname",
	).Scan(&all).Error; err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	yaml := buildGatewayClashYAML(
		fmt.Sprintf("gateway %s", self.Hostname),
		h.Config.XrayPath,
		gatewaySecret(mac),
		"/var/www/metacubexd",
		mac, direction, upstreamMode, upstreamMACs, all,
	)

	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(yaml))
}
