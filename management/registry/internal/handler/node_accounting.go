package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
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

// Online device reports are bounded so one node cannot turn a sync into an
// unbounded transaction. Device limits are small; 64 IPs per subscription is
// already far beyond any sane plan.
const (
	onlineDeviceTTL             = 2 * time.Minute
	maxOnlineSubscriptions      = 200
	maxOnlineIPsPerSubscription = 64
)

type NodeTrafficCounter struct {
	Name  string `json:"name"`
	Value int64  `json:"value,string" swaggertype:"string" example:"0"`
}

// NodeOnlineDevice is one subscription's currently online client IPs as seen
// by this exit node. Xray's online map is keyed by source IP, so one device
// with several connections appears once.
type NodeOnlineDevice struct {
	SubscriptionID uint     `json:"subscription_id"`
	IPs            []string `json:"ips"`
}

type NodeAccountingRequest struct {
	Generation int64                `json:"generation,omitempty,string" swaggertype:"string" example:"1"` // Monotonic per-node runtime, zero for legacy agents
	Epoch      string               `json:"epoch"`                                                        // Xray systemd InvocationID
	Counters   []NodeTrafficCounter `json:"counters"`
	Online     []NodeOnlineDevice   `json:"online,omitempty"`
	OwnerAccess bool               `json:"owner_access,omitempty"` // Agent understands owner-* users; legacy agents default to paid users only
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
// @Failure 409 {object} ErrorResponse
// @Failure 410 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /servers/{mac}/accounting [post]
func (h *Handler) HandleNodeAccounting(w http.ResponseWriter, r *http.Request) {
	h.handleAccounting(w, r, true)
}

// HandleLegacyNodeAccounting is the device-token path used by ordinary nodes.
// It preserves the pre-trusted-exit behaviour: any node that has a device
// credential may renew access and report the subscriptions assigned to it.
// @Summary Report device traffic and renew subscription authorization (legacy device mode)
// @ID NodeAccountingLegacy
// @Tags nodes
// @Security BearerAuth
// @Accept json
// @Produce json
// @Param mac path string true "Node MAC"
// @Param body body NodeAccountingRequest true "Cumulative traffic counters"
// @Success 200 {object} NodeXrayUsersResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 410 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /nodes/{mac}/xray-users [post]
func (h *Handler) HandleLegacyNodeAccounting(w http.ResponseWriter, r *http.Request) {
	h.handleAccounting(w, r, false)
}

func (h *Handler) handleAccounting(w http.ResponseWriter, r *http.Request, requireServer bool) {
	if requireServer {
		if !h.Auth.RequireServerAuth(w, r) {
			return
		}
	} else if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	var report NodeAccountingRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	if err := dec.Decode(&report); err != nil || report.Generation < 0 || !counterEpoch.MatchString(report.Epoch) || report.Counters == nil || len(report.Counters) > 10000 {
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
	if len(report.Online) > maxOnlineSubscriptions {
		h.jsonErr(w, 400, "too many online device reports")
		return
	}
	seenSubscriptions := make(map[uint]bool, len(report.Online))
	for _, dev := range report.Online {
		if dev.SubscriptionID == 0 || seenSubscriptions[dev.SubscriptionID] || len(dev.IPs) > maxOnlineIPsPerSubscription {
			h.jsonErr(w, 400, "invalid or duplicate online device report")
			return
		}
		seenSubscriptions[dev.SubscriptionID] = true
		seenIPs := make(map[string]bool, len(dev.IPs))
		for _, ip := range dev.IPs {
			if net.ParseIP(ip) == nil || seenIPs[ip] {
				h.jsonErr(w, 400, "invalid or duplicate online device IP")
				return
			}
			seenIPs[ip] = true
		}
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
		if requireServer {
			ok, err := middleware.ValidServerCredential(tx, r)
			if err != nil {
				return err
			}
			if !ok {
				return errUnauthorized
			}
		}
		if err := advanceAccountingGeneration(tx, mac, report); err != nil {
			return err
		}
		// Only the metering agent posts cumulative counters, and that same agent
		// pulls subscription users from /nodes/{mac}/xray-users. Promote the node
		// so an upgraded legacy node switches back to subscription UUIDs (billable)
		// on its first report, without an operator touching the flag.
		if err := tx.Exec("UPDATE nodes SET subscription_sync = 1 WHERE mac = ? AND subscription_sync = 0", mac).Error; err != nil {
			return err
		}
		for _, c := range report.Counters {
			id, err := strconv.ParseUint(counterName.FindStringSubmatch(c.Name)[1], 10, 32)
			if err != nil {
				return err
			}
			var sub struct{ ID uint }
			// Never let a reporter charge a subscription outside its assigned lines.
			if err := tx.Raw("SELECT cs.id FROM customer_subscriptions cs WHERE cs.id = ? AND EXISTS (SELECT 1 FROM plan_lines pl JOIN line_nodes ln ON ln.line_id = pl.line_id WHERE pl.plan_id = cs.plan_id AND ln.node_mac = ?) FOR UPDATE", id, mac).Scan(&sub).Error; err != nil {
				return err
			}
			if sub.ID == 0 {
				continue
			} // deleted/reassigned subscription: acknowledge stale counters
			var previous struct{ Bytes int64 }
			if err := tx.Raw("SELECT bytes FROM node_traffic_counters WHERE node_mac = ? AND generation = ? AND epoch = ? AND counter_name = ?", mac, report.Generation, report.Epoch, c.Name).Scan(&previous).Error; err != nil {
				return err
			}
			if c.Value <= previous.Bytes {
				continue
			} // repeated or out-of-order snapshot
			if err := tx.Exec("UPDATE customer_subscriptions SET traffic_used = traffic_used + ?, updated_at = ? WHERE id = ?", c.Value-previous.Bytes, time.Now().UTC(), id).Error; err != nil {
				return err
			}
			if err := tx.Exec("INSERT INTO node_traffic_counters (node_mac, generation, epoch, counter_name, bytes) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)", mac, report.Generation, report.Epoch, c.Name, c.Value).Error; err != nil {
				return err
			}
		}
		now := time.Now().UTC()
		for _, dev := range report.Online {
			var sub struct{ ID uint }
			// A stale report for a subscription this node no longer serves must
			// not consume another subscription's device slots.
			if err := tx.Raw(
				"SELECT cs.id FROM customer_subscriptions cs WHERE cs.id = ? AND EXISTS ("+
					"SELECT 1 FROM plan_lines pl JOIN line_nodes ln ON ln.line_id = pl.line_id "+
					"WHERE pl.plan_id = cs.plan_id AND ln.node_mac = ?)",
				dev.SubscriptionID, mac,
			).Scan(&sub).Error; err != nil {
				return err
			}
			if sub.ID == 0 {
				continue
			}
			for _, ip := range dev.IPs {
				if err := tx.Exec(
					"INSERT INTO subscription_online_devices (subscription_id, node_mac, ip, first_seen, last_seen) "+
						"VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)",
					dev.SubscriptionID, mac, ip, now, now,
				).Error; err != nil {
					return err
				}
			}
		}
		// Age out devices that stopped reporting. This also runs for nodes with
		// no online devices, so a dead node's rows cannot hold slots forever.
		if err := tx.Exec(
			"DELETE FROM subscription_online_devices WHERE last_seen < ? LIMIT 1000",
			now.Add(-onlineDeviceTTL),
		).Error; err != nil {
			return err
		}
		return nil
	})
	if errors.Is(err, errRetiredAccountingGeneration) {
		h.jsonErr(w, http.StatusGone, err.Error())
		return
	}
	if errors.Is(err, errAccountingGenerationConflict) {
		h.jsonErr(w, http.StatusConflict, err.Error())
		return
	}
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
	h.respondXrayUsers(w, r, requireServer, report.OwnerAccess)
}

// Legacy agents cannot renew authorization without metering.
func (h *Handler) HandleLegacyNodeXrayUsers(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	h.jsonErr(w, http.StatusUpgradeRequired, "upgrade node agent: POST cumulative counters to this endpoint")
}
