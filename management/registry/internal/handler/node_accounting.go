package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/middleware"
)

// Short leases bound access when the registry or the accounting agent fails.
const subscriptionLeaseSeconds = 45

type NodeTrafficCounter struct {
	Name  string `json:"name"`
	Value int64  `json:"value,string" swaggertype:"string" example:"0"`
}

type NodeAccountingRequest struct {
	Epoch    string               `json:"epoch"` // Xray systemd InvocationID
	Counters []NodeTrafficCounter `json:"counters"`
}

var counterName = regexp.MustCompile(`^user>>>sub-([1-9][0-9]*)>>>traffic>>>(uplink|downlink)$`)
var counterEpoch = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// HandleNodeAccounting accepts cumulative, non-resetting counters. Persisting the
// high-water marks in the same transaction as billing makes retries idempotent,
// including a lost HTTP response or a registry restart. Prometheus is observability
// only: it must not charge these same bytes a second time.
// @Summary Report trusted exit server traffic and renew subscription authorization
// @ID NodeAccounting
// @Tags servers
// @Security ServerBearerAuth
// @Accept json
// @Produce json
// @Param mac path string true "Node MAC"
// @Param body body NodeAccountingRequest true "Cumulative traffic counters"
// @Success 200 {object} NodeXrayUsersResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /servers/{mac}/accounting [post]
func (h *Handler) HandleNodeAccounting(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireServerAuth(w, r) {
		return
	}
	var report NodeAccountingRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	if err := dec.Decode(&report); err != nil || !counterEpoch.MatchString(report.Epoch) || report.Counters == nil || len(report.Counters) > 10000 {
		h.jsonErr(w, http.StatusBadRequest, "invalid traffic report")
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		h.jsonErr(w, 400, "invalid traffic report")
		return
	}
	seen := make(map[string]bool)
	for _, c := range report.Counters {
		if !counterName.MatchString(c.Name) || c.Value < 0 || seen[c.Name] {
			h.jsonErr(w, 400, "invalid or duplicate traffic counter")
			return
		}
		seen[c.Name] = true
	}
	sort.Slice(report.Counters, func(i, j int) bool { return report.Counters[i].Name < report.Counters[j].Name })
	mac := r.PathValue("mac")
	errUnauthorized := errors.New("server credential revoked")
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var node struct{ MAC string }
		if err := tx.Raw("SELECT mac FROM nodes WHERE mac = ? FOR UPDATE", mac).Scan(&node).Error; err != nil {
			return err
		}
		if node.MAC == "" {
			return gorm.ErrRecordNotFound
		}
		ok, err := middleware.ValidServerCredential(tx, r)
		if err != nil {
			return err
		}
		if !ok {
			return errUnauthorized
		}
		for _, c := range report.Counters {
			id, err := strconv.ParseUint(counterName.FindStringSubmatch(c.Name)[1], 10, 32)
			if err != nil {
				return err
			}
			var sub struct{ ID uint }
			// Never let a server charge a subscription outside its assigned lines.
			if err := tx.Raw("SELECT cs.id FROM customer_subscriptions cs WHERE cs.id = ? AND EXISTS (SELECT 1 FROM plan_lines pl JOIN line_nodes ln ON ln.line_id = pl.line_id WHERE pl.plan_id = cs.plan_id AND ln.node_mac = ?) FOR UPDATE", id, mac).Scan(&sub).Error; err != nil {
				return err
			}
			if sub.ID == 0 {
				continue
			} // deleted/reassigned subscription: acknowledge stale counters
			var previous struct{ Bytes int64 }
			if err := tx.Raw("SELECT bytes FROM node_traffic_counters WHERE node_mac = ? AND epoch = ? AND counter_name = ?", mac, report.Epoch, c.Name).Scan(&previous).Error; err != nil {
				return err
			}
			if c.Value <= previous.Bytes {
				continue
			} // repeated or out-of-order snapshot
			if err := tx.Exec("UPDATE customer_subscriptions SET traffic_used = traffic_used + ?, updated_at = ? WHERE id = ?", c.Value-previous.Bytes, time.Now().UTC(), id).Error; err != nil {
				return err
			}
			if err := tx.Exec("INSERT INTO node_traffic_counters (node_mac, epoch, counter_name, bytes) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)", mac, report.Epoch, c.Name, c.Value).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, errUnauthorized) {
		h.jsonErr(w, 401, err.Error())
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		h.jsonErr(w, 404, "node not found")
		return
	}
	if err != nil {
		h.jsonErr(w, 500, fmt.Sprintf("accounting: %v", err))
		return
	}
	h.HandleNodeXrayUsers(w, r)
}

// Legacy agents cannot renew authorization without metering.
func (h *Handler) HandleLegacyNodeXrayUsers(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	h.jsonErr(w, http.StatusUpgradeRequired, "device accounting removed: provision a trusted exit server and use /servers/{mac}/accounting")
}
