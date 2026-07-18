package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// EasyTier static IP allocation pool.
//
// The mesh moved off 10.0.0.0/8 (which overlapped the K8S Pod/Service CIDRs) to
// 172.20.0.0/16. IPs are allocated per-MAC and idempotently by the registry —
// the authoritative allocator that replaces both the node-side MAC-derived IP
// and EasyTier's own (non-idempotent) DHCP. Same device (stable SoC-efuse MAC)
// always gets the same IP, even after re-imaging.
//
// Layout:
//   - 172.20.0.0/24  infra reserved (relays / aliyun / cluster pod / mac), seeded
//     manually, never handed out by the allocator.
//   - 172.20.1.0 .. 172.20.255.254  auto pool for Hive field devices.
const (
	easytierPoolBase  = "172.20.0.0"
	easytierPoolStart = "172.20.1.0"   // first auto-allocatable address
	easytierPoolEnd   = "172.20.255.254"
)

// HandleAllocateEasytier godoc
// @Summary      Allocate EasyTier IP for a MAC
// @Description  Idempotently allocates (or returns the existing) 172.20.0.0/16 EasyTier
// @Description  IP for the given MAC. Called by provision-node.sh as its first step so the
// @Description  device can start EasyTier with a stable, collision-free static IP.
// @Tags         nodes
// @Security     BearerAuth
// @Accept       json
// @Produce      json
// @Param        body body object true "MAC only"
// @Success      200 {object} map[string]string
// @Failure      400 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /nodes/allocate-easytier [post]
func (h *Handler) HandleAllocateEasytier(w http.ResponseWriter, r *http.Request) {
	if !h.Auth.RequireDeviceAuth(w, r) {
		return
	}
	var body struct {
		MAC string `json:"mac"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.MAC == "" {
		h.jsonErr(w, http.StatusBadRequest, "mac required")
		return
	}
	ip, err := h.allocateEasytierIP(body.MAC)
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "allocate: "+err.Error())
		return
	}
	h.jsonOK(w, map[string]string{"mac": body.MAC, "easytier_ip": ip})
}

// ipToUint converts a dotted IPv4 string to its 32-bit integer form.
func ipToUint(s string) (uint32, error) {
	ip := net.ParseIP(s).To4()
	if ip == nil {
		return 0, fmt.Errorf("not an IPv4 address: %q", s)
	}
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3]), nil
}

// uintToIP converts a 32-bit integer back to dotted IPv4.
func uintToIP(v uint32) string {
	return net.IPv4(byte(v>>24), byte(v>>16), byte(v>>8), byte(v)).String()
}

// allocateEasytierIP returns the EasyTier IP for a MAC, allocating one from the
// 172.20.1.0+ pool on first request. Idempotent: repeat calls for the same MAC
// return the already-assigned IP. Concurrency-safe without row locks — it relies
// on PRIMARY KEY(ip_int) + UNIQUE(mac) and retries on duplicate-key races, which
// matches the codebase's lock-free convention.
func (h *Handler) allocateEasytierIP(mac string) (string, error) {
	if mac == "" {
		return "", errors.New("mac required for easytier allocation")
	}

	// Fast path: already allocated → idempotent return.
	var existingIP uint32
	err := h.DB.Raw("SELECT ip_int FROM easytier_allocations WHERE mac = ?", mac).Scan(&existingIP).Error
	if err != nil {
		return "", err
	}
	if existingIP != 0 {
		return uintToIP(existingIP), nil
	}

	start, _ := ipToUint(easytierPoolStart)
	end, _ := ipToUint(easytierPoolEnd)

	// Allocate: find the smallest free ip_int in the pool and insert. On a
	// duplicate-key race (another registration grabbed the same slot, or the same
	// MAC registered concurrently), retry — a UNIQUE(mac) violation means the MAC
	// was just allocated elsewhere, so re-read and return that.
	const maxRetries = 8
	for attempt := 0; attempt < maxRetries; attempt++ {
		var used uint32
		if err := h.DB.Raw(
			"SELECT COALESCE(MAX(ip_int), ?) FROM easytier_allocations WHERE ip_int >= ? AND ip_int <= ?",
			start-1, start, end,
		).Scan(&used).Error; err != nil {
			return "", err
		}
		next := used + 1
		if next < start {
			next = start
		}
		if next > end {
			return "", errors.New("easytier pool exhausted (172.20.1.0/16)")
		}

		insErr := h.DB.Exec(
			"INSERT INTO easytier_allocations (ip_int, mac, reserved, allocated_at) VALUES (?, ?, 0, ?)",
			next, mac, time.Now().UTC().Format("2006-01-02 15:04:05"),
		).Error
		if insErr == nil {
			return uintToIP(next), nil
		}
		if !isDupKey(insErr) {
			return "", insErr
		}
		// Duplicate key: either the ip slot or the mac was taken concurrently.
		// If our MAC now exists, return its IP; otherwise loop to grab next slot.
		var raced uint32
		if e := h.DB.Raw("SELECT ip_int FROM easytier_allocations WHERE mac = ?", mac).Scan(&raced).Error; e == nil && raced != 0 {
			return uintToIP(raced), nil
		}
	}
	return "", errors.New("easytier allocation failed after retries")
}

// isDupKey reports whether err is a MySQL duplicate-entry (1062) error.
// Matched by message to avoid importing the driver; gorm wraps the driver error.
func isDupKey(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "1062") || strings.Contains(msg, "Duplicate entry")
}
