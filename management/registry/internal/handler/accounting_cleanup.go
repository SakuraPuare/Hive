package handler

import (
	"context"
	"errors"
	"log"
	"math"
	"net/http"
	"time"

	"gorm.io/gorm"
)

var errRetiredAccountingGeneration = errors.New("accounting generation retired; discard this snapshot")
var errAccountingGenerationConflict = errors.New("accounting generation conflict; flush pending traffic before starting a fresh runtime")

type NodeAccountingState struct {
	Generation int64  `json:"generation,string" swaggertype:"string" example:"1"`
	Epoch      string `json:"epoch"`
}

// advanceAccountingGeneration runs under the node row lock, in the billing
// transaction. A committed larger generation permanently fences old snapshots,
// even after their counter rows are gone. Keep one fence per node, not tombstones
// per historical epoch. Credential rotation/revocation must not clear it.
func advanceAccountingGeneration(tx *gorm.DB, mac string, report NodeAccountingRequest) error {
	var state NodeAccountingState
	if err := tx.Raw("SELECT generation, epoch FROM node_accounting_state WHERE node_mac = ?", mac).Scan(&state).Error; err != nil {
		return err
	}
	if report.Generation < state.Generation {
		return errRetiredAccountingGeneration
	}
	if report.Generation == 0 {
		return nil // Legacy counters cannot be collected until this node upgrades.
	}
	if report.Generation == state.Generation {
		if report.Epoch != state.Epoch {
			return errAccountingGenerationConflict
		}
		return nil
	}
	if state.Generation == math.MaxInt64 || report.Generation != state.Generation+1 || report.Epoch == state.Epoch {
		return errAccountingGenerationConflict
	}
	return tx.Exec("INSERT INTO node_accounting_state (node_mac, generation, epoch) VALUES (?,?,?) ON DUPLICATE KEY UPDATE generation=VALUES(generation), epoch=VALUES(epoch)", mac, report.Generation, report.Epoch).Error
}

// HandleNodeAccountingState returns a cursor, never subscription authorization.
// @Summary Read the trusted exit server accounting generation
// @ID NodeAccountingState
// @Tags servers
// @Security ServerBearerAuth
// @Produce json
// @Param mac path string true "Node MAC"
// @Success 200 {object} NodeAccountingState
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /servers/{mac}/accounting/state [get]
func (h *Handler) HandleNodeAccountingState(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireServerAuth(w, r) {
		return
	}
	var state NodeAccountingState
	if err := h.DB.WithContext(r.Context()).Raw("SELECT generation, epoch FROM node_accounting_state WHERE node_mac = ?", r.PathValue("mac")).Scan(&state).Error; err != nil {
		h.jsonErr(w, 500, "cannot read accounting state")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	h.jsonOK(w, state)
}

// cleanupAccountingCounters uses small transactions and the same node lock as
// reports. Active counters and legacy-only nodes are never eligible. Advancing
// a generation, posting a retry and multiple cleanup workers serialize safely.
func (h *Handler) cleanupAccountingCounters(ctx context.Context) (int64, error) {
	var removed int64
	lastMAC := ""
	for {
		var nodes []string
		if err := h.DB.WithContext(ctx).Raw("SELECT node_mac FROM node_accounting_state WHERE generation > 0 AND node_mac > ? ORDER BY node_mac LIMIT 100", lastMAC).Scan(&nodes).Error; err != nil {
			return removed, err
		}
		if len(nodes) == 0 {
			return removed, nil
		}
		for _, mac := range nodes {
			for {
				var count int64
				err := h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
					var node struct{ MAC string }
					if err := tx.Raw("SELECT mac FROM nodes WHERE mac = ? FOR UPDATE", mac).Scan(&node).Error; err != nil {
						return err
					}
					if node.MAC == "" {
						return nil
					}
					var state NodeAccountingState
					if err := tx.Raw("SELECT generation FROM node_accounting_state WHERE node_mac = ?", mac).Scan(&state).Error; err != nil {
						return err
					}
					result := tx.Exec("DELETE FROM node_traffic_counters WHERE node_mac = ? AND generation < ? LIMIT 1000", mac, state.Generation)
					count = result.RowsAffected
					return result.Error
				})
				if err != nil {
					return removed, err
				}
				removed += count
				if count < 1000 {
					break
				}
			}
		}
		lastMAC = nodes[len(nodes)-1]
	}
}

func (h *Handler) StartAccountingCleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		count, err := h.cleanupAccountingCounters(ctx)
		if err != nil && ctx.Err() == nil {
			log.Printf("accounting cleanup: %v", err)
		} else if count > 0 {
			log.Printf("accounting cleanup: removed %d retired counters", count)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
