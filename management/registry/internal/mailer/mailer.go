package mailer

import (
	"context"
	"fmt"
	"log"
	"net/smtp"
	"strings"
	"time"

	"gorm.io/gorm"

	"hive/registry/internal/config"
	"hive/registry/internal/model"
)

// Mailer handles email sending and expiry notifications.
type Mailer struct {
	Config *config.Config
	DB     *gorm.DB
}

// ── sendMail ─────────────────────────────────────────────────────────────────

// SendMail sends an HTML email. When MailEnabled is false it only logs.
func (m *Mailer) SendMail(to, subject, htmlBody string) error {
	if !m.Config.MailEnabled {
		log.Printf("[mail] disabled, would send to=%s subject=%q", to, subject)
		return nil
	}

	addr := m.Config.SMTPHost + ":" + m.Config.SMTPPort
	auth := smtp.PlainAuth("", m.Config.SMTPUser, m.Config.SMTPPass, m.Config.SMTPHost)

	msg := "From: " + m.Config.SMTPFrom + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n" +
		"\r\n" +
		htmlBody

	if err := smtp.SendMail(addr, auth, m.Config.SMTPFrom, []string{to}, []byte(msg)); err != nil {
		log.Printf("[mail] send failed to=%s subject=%q: %v", to, subject, err)
		return err
	}
	log.Printf("[mail] sent to=%s subject=%q", to, subject)
	return nil
}

// ── templates ────────────────────────────────────────────────────────────────

var templates = map[string]string{
	"welcome": `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px">
  <h2 style="margin:0 0 16px;color:#1a1a1a">欢迎加入 Hive</h2>
  <p style="color:#555;line-height:1.6">您的账号已创建成功。</p>
  <p style="color:#555;line-height:1.6">您的邀请码: <strong style="color:#0066ff">{{invite_code}}</strong></p>
  <p style="color:#999;font-size:13px;margin-top:24px">如非本人操作，请忽略此邮件。</p>
</div></body></html>`,

	"order_paid": `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px">
  <h2 style="margin:0 0 16px;color:#1a1a1a">订单支付成功</h2>
  <p style="color:#555;line-height:1.6">您已成功订购 <strong>{{plan_name}}</strong>。</p>
  <p style="color:#555;line-height:1.6">到期时间: <strong>{{expires_at}}</strong></p>
  <p style="margin-top:20px"><a href="{{sub_url}}" style="display:inline-block;padding:10px 24px;background:#0066ff;color:#fff;text-decoration:none;border-radius:6px">查看订阅</a></p>
  <p style="color:#999;font-size:13px;margin-top:24px">感谢您的支持！</p>
</div></body></html>`,

	"subscription_expiring": `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px">
  <h2 style="margin:0 0 16px;color:#e67e22">订阅即将到期</h2>
  <p style="color:#555;line-height:1.6">您的订阅将于 <strong>{{expires_at}}</strong> 到期，请及时续费以免服务中断。</p>
  <p style="color:#999;font-size:13px;margin-top:24px">如已续费，请忽略此邮件。</p>
</div></body></html>`,

	"subscription_expired": `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px">
  <h2 style="margin:0 0 16px;color:#e74c3c">订阅已过期</h2>
  <p style="color:#555;line-height:1.6">您的订阅已于 <strong>{{expires_at}}</strong> 过期，服务已暂停。</p>
  <p style="color:#555;line-height:1.6">请续费以恢复服务。</p>
</div></body></html>`,

	"ticket_replied": `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px">
  <h2 style="margin:0 0 16px;color:#1a1a1a">工单有新回复</h2>
  <p style="color:#555;line-height:1.6">您的工单 <strong>#{{ticket_id}}</strong> 收到了新的回复，请登录查看。</p>
</div></body></html>`,

	"password_reset": `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px">
  <h2 style="margin:0 0 16px;color:#1a1a1a">密码重置验证码</h2>
  <p style="color:#555;line-height:1.6">您的验证码为:</p>
  <p style="text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#0066ff;margin:24px 0">{{code}}</p>
  <p style="color:#555;line-height:1.6">验证码 15 分钟内有效，请勿泄露给他人。</p>
  <p style="color:#999;font-size:13px;margin-top:24px">如非本人操作，请忽略此邮件。</p>
</div></body></html>`,
}

// RenderMailTemplate renders a named template with placeholder substitution.
func RenderMailTemplate(templateName string, data map[string]string) string {
	tpl, ok := templates[templateName]
	if !ok {
		return ""
	}
	result := tpl
	for k, v := range data {
		result = strings.ReplaceAll(result, "{{"+k+"}}", v)
	}
	return result
}

// ── expiry notifier ──────────────────────────────────────────────────────────

// StartExpiryNotifier runs a daily loop that sends expiry reminders.
// Status changes are handled exclusively by the lifecycle loop.
func (m *Mailer) StartExpiryNotifier(ctx context.Context) {
	log.Println("[expiry-notifier] started")
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	// Run once on startup, then daily.
	m.RunExpiryCheck()
	for {
		select {
		case <-ctx.Done():
			log.Println("[expiry-notifier] shutting down")
			return
		case <-ticker.C:
			m.RunExpiryCheck()
		}
	}
}

type expiryRow struct {
	SubID     uint   `gorm:"column:sub_id"`
	Email     string `gorm:"column:email"`
	ExpiresAt string `gorm:"column:expires_at"`
}

func (m *Mailer) RunExpiryCheck() {
	now := time.Now().UTC()
	threeDays := now.Add(3 * 24 * time.Hour).Format(model.TimeLayout)
	nowStr := now.Format(model.TimeLayout)

	// ── expiring within 3 days, not yet notified ─────────────────────────
	var expiring []expiryRow
	m.DB.Raw(`
		SELECT cs.id AS sub_id, c.email, cs.expires_at
		FROM customer_subscriptions cs
		JOIN customers c ON c.id = cs.customer_id
		WHERE cs.status = 'active'
		  AND cs.expires_at <= ?
		  AND cs.expires_at > ?
		  AND cs.expiry_notified_at IS NULL
	`, threeDays, nowStr).Scan(&expiring)

	for _, row := range expiring {
		body := RenderMailTemplate("subscription_expiring", map[string]string{
			"expires_at": row.ExpiresAt,
		})
		if err := m.SendMail(row.Email, "订阅即将到期提醒", body); err == nil {
			m.DB.Exec(`UPDATE customer_subscriptions SET expiry_notified_at = ? WHERE id = ?`, nowStr, row.SubID)
		}
	}
	if len(expiring) > 0 {
		log.Printf("[expiry-notifier] sent %d expiring reminders", len(expiring))
	}

	// ── already expired (status set by lifecycle loop), not yet notified ─
	var expired []expiryRow
	m.DB.Raw(`
		SELECT cs.id AS sub_id, c.email, cs.expires_at
		FROM customer_subscriptions cs
		JOIN customers c ON c.id = cs.customer_id
		WHERE cs.status = 'expired'
		  AND cs.expiry_notified_at IS NULL
	`).Scan(&expired)

	for _, row := range expired {
		body := RenderMailTemplate("subscription_expired", map[string]string{
			"expires_at": row.ExpiresAt,
		})
		if err := m.SendMail(row.Email, "订阅已过期通知", body); err == nil {
			m.DB.Exec(`UPDATE customer_subscriptions SET expiry_notified_at = ? WHERE id = ?`, nowStr, row.SubID)
		}
	}
	if len(expired) > 0 {
		log.Printf("[expiry-notifier] notified %d expired subscriptions", len(expired))
	}
}

// ── convenience send helpers ─────────────────────────────────────────────────

func (m *Mailer) SendWelcome(to, inviteCode string) {
	body := RenderMailTemplate("welcome", map[string]string{"invite_code": inviteCode})
	go m.SendMail(to, "欢迎加入 Hive", body)
}

func (m *Mailer) SendOrderPaid(to, planName, expiresAt, subURL string) {
	body := RenderMailTemplate("order_paid", map[string]string{
		"plan_name":  planName,
		"expires_at": expiresAt,
		"sub_url":    subURL,
	})
	go m.SendMail(to, "订单支付成功", body)
}

func (m *Mailer) SendTicketReplied(to string, ticketID uint) {
	body := RenderMailTemplate("ticket_replied", map[string]string{
		"ticket_id": fmt.Sprintf("%d", ticketID),
	})
	go m.SendMail(to, "工单有新回复", body)
}

func (m *Mailer) SendPasswordReset(to, code string) {
	body := RenderMailTemplate("password_reset", map[string]string{"code": code})
	go m.SendMail(to, "密码重置验证码", body)
}
