package mailer

import (
	"strings"
	"testing"

	"hive/registry/internal/config"
)

// ── RenderMailTemplate ───────────────────────────────────────────────────────

func TestRenderMailTemplate_Welcome(t *testing.T) {
	html := RenderMailTemplate("welcome", map[string]string{"invite_code": "ABC123"})
	if html == "" {
		t.Fatal("expected non-empty html")
	}
	if !strings.Contains(html, "ABC123") {
		t.Fatal("expected invite_code placeholder to be replaced")
	}
	if !strings.Contains(html, "欢迎加入") {
		t.Fatal("expected welcome text")
	}
}

func TestRenderMailTemplate_OrderPaid(t *testing.T) {
	html := RenderMailTemplate("order_paid", map[string]string{
		"plan_name":  "月付套餐",
		"expires_at": "2026-04-26",
		"sub_url":    "https://example.com/sub/abc",
	})
	if !strings.Contains(html, "月付套餐") {
		t.Fatal("expected plan_name")
	}
	if !strings.Contains(html, "2026-04-26") {
		t.Fatal("expected expires_at")
	}
	if !strings.Contains(html, "https://example.com/sub/abc") {
		t.Fatal("expected sub_url")
	}
}

func TestRenderMailTemplate_SubscriptionExpiring(t *testing.T) {
	html := RenderMailTemplate("subscription_expiring", map[string]string{
		"expires_at": "2026-03-29",
	})
	if !strings.Contains(html, "2026-03-29") {
		t.Fatal("expected expires_at")
	}
	if !strings.Contains(html, "即将到期") {
		t.Fatal("expected expiring text")
	}
}

func TestRenderMailTemplate_SubscriptionExpired(t *testing.T) {
	html := RenderMailTemplate("subscription_expired", map[string]string{
		"expires_at": "2026-03-25",
	})
	if !strings.Contains(html, "2026-03-25") {
		t.Fatal("expected expires_at")
	}
	if !strings.Contains(html, "已过期") {
		t.Fatal("expected expired text")
	}
}

func TestRenderMailTemplate_TicketReplied(t *testing.T) {
	html := RenderMailTemplate("ticket_replied", map[string]string{
		"ticket_id": "42",
	})
	if !strings.Contains(html, "#42") {
		t.Fatal("expected ticket_id")
	}
	if !strings.Contains(html, "新回复") {
		t.Fatal("expected reply text")
	}
}

func TestRenderMailTemplate_PasswordReset(t *testing.T) {
	html := RenderMailTemplate("password_reset", map[string]string{
		"code": "123456",
	})
	if !strings.Contains(html, "123456") {
		t.Fatal("expected code")
	}
	if !strings.Contains(html, "验证码") {
		t.Fatal("expected reset text")
	}
}

func TestRenderMailTemplate_UnknownTemplate(t *testing.T) {
	html := RenderMailTemplate("nonexistent", nil)
	if html != "" {
		t.Fatalf("expected empty string for unknown template, got %q", html)
	}
}

func TestRenderMailTemplate_NoPlaceholders(t *testing.T) {
	html := RenderMailTemplate("welcome", nil)
	if !strings.Contains(html, "{{invite_code}}") {
		t.Fatal("expected unreplaced placeholder when no data provided")
	}
}

func TestRenderMailTemplate_ExtraPlaceholders(t *testing.T) {
	html := RenderMailTemplate("welcome", map[string]string{
		"invite_code": "XYZ",
		"unknown_key": "ignored",
	})
	if !strings.Contains(html, "XYZ") {
		t.Fatal("expected invite_code replaced")
	}
	if strings.Contains(html, "ignored") {
		t.Fatal("extra placeholder should not appear in template")
	}
}

// ── SendMail disabled mode ───────────────────────────────────────────────────

func TestSendMail_Disabled(t *testing.T) {
	m := &Mailer{
		Config: &config.Config{MailEnabled: false},
	}
	err := m.SendMail("test@example.com", "Test Subject", "<p>Hello</p>")
	if err != nil {
		t.Fatalf("expected no error when mail disabled, got %v", err)
	}
}

// ── All templates produce valid HTML ─────────────────────────────────────────

func TestAllTemplates_ContainHTMLStructure(t *testing.T) {
	for name := range templates {
		html := RenderMailTemplate(name, map[string]string{
			"invite_code": "CODE",
			"plan_name":   "Plan",
			"expires_at":  "2026-01-01",
			"sub_url":     "https://example.com",
			"ticket_id":   "1",
			"code":        "000000",
		})
		if !strings.Contains(html, "<!DOCTYPE html>") {
			t.Errorf("template %q missing DOCTYPE", name)
		}
		if !strings.Contains(html, "</html>") {
			t.Errorf("template %q missing closing html tag", name)
		}
		if !strings.Contains(html, "</body>") {
			t.Errorf("template %q missing closing body tag", name)
		}
	}
}
