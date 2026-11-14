package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/model"
	"hive/registry/internal/store"
)

// 设备自助上线（enrollment）。
//
// 共享镜像刻意不带任何凭证，所以"刷完第一次上电"的设备在旧流程里根本发不出
// 第一个请求：allocate-easytier / register 都挂在 RequireDeviceAuth 后面，没有
// device_credentials 行就一律 401，面板上也永远看不到这台设备。
//
// 这里给设备一个仅凭 MAC 的引导入口，规则刻意保守：
//   - 已被认领（owner_customer_id 非空）的设备拒绝再入网：防止别人拿 MAC 顶号；
//   - 已发过凭证（device_credentials 有行）的设备拒绝再入网：凭证丢失必须由管理员
//     在面板轮换，不能靠再刷一次固件把设备抢走；
//   - 第一次入网同时铸认领码（明文只回一次），设备写进 /etc/hive/claim-code 供
//     客户在门户认领；节点行同时落 registered_at/last_seen，管理面板立即能看到
//     "谁上线了"，不必等 provision 的 Cloudflare/Tailscale 步骤全部成功。
//
// 入口是公开的（设备还没有凭证），用 IP 限流 + 只允许创建 pending 节点行来限制滥用。
var enrollMACPattern = regexp.MustCompile(`^[0-9a-f]{12}$`)
var enrollMAC6Pattern = regexp.MustCompile(`^[0-9a-f]{6}$`)

// ErrDeviceClaimed / errDeviceEnrolled 是事务内的判定结果，不是数据库错误。
var (
	errDeviceClaimed  = errors.New("device already claimed")
	errDeviceEnrolled = errors.New("device already enrolled")
)

// EnrollResponse is returned once; the plaintext token and claim code never leave
// the device after this call (only the sha256 of the claim code is stored).
type EnrollResponse struct {
	MAC       string `json:"mac"`
	Token     string `json:"token"`
	ClaimCode string `json:"claim_code,omitempty"`
}

// HandleNodeEnroll godoc
// @Summary      Device self-enrollment (first boot)
// @ID           NodeEnroll
// @Description  Issues this device's MAC-scoped credential so a newly flashed node
// @Description  can authenticate. Creates the node row immediately (admin panel shows
// @Description  the device as soon as it boots) and mints the customer claim code once.
// @Description  Refuses claimed or already-enrolled devices: re-issuing needs an admin.
// @Tags         nodes
// @Accept       json
// @Produce      json
// @Param        body body object true "mac, mac6, hostname"
// @Success      200 {object} EnrollResponse
// @Failure      400 {object} ErrorResponse
// @Failure      409 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /nodes/enroll [post]
func (h *Handler) HandleNodeEnroll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MAC      string `json:"mac"`
		MAC6     string `json:"mac6"`
		Hostname string `json:"hostname"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		h.jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	mac := strings.ToLower(strings.NewReplacer(":", "", "-", "").Replace(strings.TrimSpace(body.MAC)))
	if !enrollMACPattern.MatchString(mac) {
		h.jsonErr(w, http.StatusBadRequest, "mac must be 12 hexadecimal characters")
		return
	}
	mac6 := strings.ToLower(strings.TrimSpace(body.MAC6))
	if !enrollMAC6Pattern.MatchString(mac6) {
		mac6 = mac[6:]
	}
	hostname := strings.TrimSpace(body.Hostname)
	if hostname == "" {
		hostname = "hive-" + mac6
	}
	if len(hostname) > 63 || strings.ContainsAny(hostname, " \t\r\n/") {
		h.jsonErr(w, http.StatusBadRequest, "invalid hostname")
		return
	}

	token, err := generateToken()
	if err != nil {
		h.jsonErr(w, http.StatusInternalServerError, "cannot generate credential")
		return
	}
	sum := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(sum[:])
	now := time.Now().UTC().Format(model.TimeLayout)
	claimCode := ""

	err = h.DB.Transaction(func(tx *gorm.DB) error {
		var existing model.Node
		if err := tx.Raw(
			"SELECT mac, mac6, hostname, registered_at, owner_customer_id, claim_code_hash FROM nodes WHERE mac = ? FOR UPDATE",
			mac,
		).Scan(&existing).Error; err != nil {
			return err
		}
		if existing.MAC == "" {
			code, err := generateClaimCode()
			if err != nil {
				return err
			}
			claimCode = code
			// cf_url / xray_uuid 是 NOT NULL 且无默认值：入网时设备还没建 tunnel、
			// 也没生成 UUID，先落空串，provision 的 register 会补上真实值。
			if err := tx.Exec(
				"INSERT INTO nodes (mac, mac6, hostname, cf_url, xray_uuid, claim_code_hash, registered_at, last_seen) "+
					"VALUES (?, ?, ?, '', '', ?, ?, ?)",
				mac, mac6, hostname, hashClaimCode(code), now, now,
			).Error; err != nil {
				return err
			}
			return tx.Exec("INSERT INTO device_credentials (mac, token_hash) VALUES (?, ?)", mac, tokenHash).Error
		}
		if existing.OwnerCustomerID != nil {
			return errDeviceClaimed
		}
		var credentials int64
		if err := tx.Raw("SELECT COUNT(*) FROM device_credentials WHERE mac = ?", mac).Scan(&credentials).Error; err != nil {
			return err
		}
		if credentials > 0 {
			return errDeviceEnrolled
		}
		if err := tx.Exec(
			"INSERT INTO device_credentials (mac, token_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash)",
			mac, tokenHash,
		).Error; err != nil {
			return err
		}
		updates := map[string]any{"hostname": hostname, "mac6": mac6, "last_seen": now}
		if existing.RegisteredAt == "" {
			updates["registered_at"] = now
		}
		if existing.ClaimCodeHash == "" {
			code, err := generateClaimCode()
			if err != nil {
				return err
			}
			claimCode = code
			updates["claim_code_hash"] = hashClaimCode(code)
		}
		return tx.Model(&model.Node{}).Where("mac = ?", mac).Updates(updates).Error
	})
	switch {
	case errors.Is(err, errDeviceClaimed):
		h.jsonErr(w, http.StatusConflict, "device already claimed; an administrator must re-issue its credential")
		return
	case errors.Is(err, errDeviceEnrolled):
		h.jsonErr(w, http.StatusConflict, "device already enrolled; use its existing /etc/hive/device-token or ask an administrator to rotate it")
		return
	case err != nil:
		h.jsonErr(w, http.StatusInternalServerError, "db: "+err.Error())
		return
	}

	store.WriteAuditLog(h.DB, "device:"+mac, "device_enroll", "hostname="+hostname, getClientIP(r))
	w.Header().Set("Cache-Control", "no-store")
	h.jsonOK(w, EnrollResponse{MAC: mac, Token: token, ClaimCode: claimCode})
}
