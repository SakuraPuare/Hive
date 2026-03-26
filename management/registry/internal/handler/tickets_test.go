package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"hive/registry/internal/model"
)

// insertTestTicket 插入一条测试工单，返回工单 ID。
func insertTestTicket(t *testing.T, customerID uint) uint {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	result := testDB.Exec(`INSERT INTO tickets (customer_id, subject, status, created_at, updated_at)
		VALUES (?, ?, 'open', ?, ?)`, customerID, "Test Subject", now, now)
	if result.Error != nil {
		t.Fatalf("insert test ticket: %v", result.Error)
	}
	var ticketID uint
	testDB.Raw("SELECT LAST_INSERT_ID()").Scan(&ticketID)
	return ticketID
}

// ── List ─────────────────────────────────────────────────────────────────────

func TestListTickets_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/tickets", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 0 {
		t.Fatalf("expected total=0, got %v", total)
	}
}

func TestListTickets_WithData(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "ticket@example.com")
	insertTestTicket(t, cid)
	insertTestTicket(t, cid)

	resp := doJSON("GET", "/admin/tickets", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 2 {
		t.Fatalf("expected total=2, got %v", total)
	}
	items := body["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
}

func TestListTickets_FilterByStatus(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "filter@example.com")
	tid := insertTestTicket(t, cid)
	insertTestTicket(t, cid)

	// 关闭第一个工单
	testDB.Exec("UPDATE tickets SET status = 'closed' WHERE id = ?", tid)

	resp := doJSON("GET", "/admin/tickets?status=open", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 1 {
		t.Fatalf("expected total=1 for open tickets, got %v", total)
	}
}

func TestListTickets_FilterByCustomer(t *testing.T) {
	resetDB(t)
	cid1 := insertTestCustomer(t, "c1@example.com")
	cid2 := insertTestCustomer(t, "c2@example.com")
	insertTestTicket(t, cid1)
	insertTestTicket(t, cid2)
	insertTestTicket(t, cid2)

	resp := doJSON("GET", fmt.Sprintf("/admin/tickets?customer_id=%d", cid2), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 2 {
		t.Fatalf("expected total=2 for customer %d, got %v", cid2, total)
	}
}

func TestListTickets_Pagination(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "page@example.com")
	for i := 0; i < 5; i++ {
		insertTestTicket(t, cid)
	}

	resp := doJSON("GET", "/admin/tickets?page=1&limit=2", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	items := body["items"].([]any)
	if total != 5 {
		t.Fatalf("expected total=5, got %v", total)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items on page 1, got %d", len(items))
	}
}

// ── Detail ───────────────────────────────────────────────────────────────────

func TestGetTicket(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "detail@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("GET", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	ticket := body["ticket"].(map[string]any)
	if ticket["subject"] != "Test Subject" {
		t.Fatalf("expected subject=Test Subject, got %v", ticket["subject"])
	}
	if ticket["status"] != "open" {
		t.Fatalf("expected status=open, got %v", ticket["status"])
	}
}

func TestGetTicket_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/tickets/99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestGetTicket_WithReplies(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "replies@example.com")
	tid := insertTestTicket(t, cid)

	// 插入回复
	now := time.Now().UTC().Format(model.TimeLayout)
	testDB.Exec(`INSERT INTO ticket_replies (ticket_id, author, is_admin, content, created_at)
		VALUES (?, 'admin', 1, '管理员回复', ?)`, tid, now)

	resp := doJSON("GET", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	replies := body["replies"].([]any)
	if len(replies) != 1 {
		t.Fatalf("expected 1 reply, got %d", len(replies))
	}
	reply := replies[0].(map[string]any)
	if reply["content"] != "管理员回复" {
		t.Fatalf("expected content=管理员回复, got %v", reply["content"])
	}
}

// ── Reply ────────────────────────────────────────────────────────────────────

func TestReplyTicket(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "reply@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("POST", fmt.Sprintf("/admin/tickets/%d/replies", tid), map[string]string{
		"content": "这是管理员回复",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// 验证回复已写入
	resp = doJSON("GET", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	detail := parseJSON(resp)
	replies := detail["replies"].([]any)
	if len(replies) != 1 {
		t.Fatalf("expected 1 reply after posting, got %d", len(replies))
	}
}

func TestReplyTicket_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/tickets/99999/replies", map[string]string{
		"content": "回复不存在的工单",
	}, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestReplyTicket_EmptyContent(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "empty@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("POST", fmt.Sprintf("/admin/tickets/%d/replies", tid), map[string]string{
		"content": "",
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

// ── Close ────────────────────────────────────────────────────────────────────

func TestCloseTicket(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "close@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("POST", fmt.Sprintf("/admin/tickets/%d/close", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// 验证状态已变更
	resp = doJSON("GET", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	detail := parseJSON(resp)
	ticket := detail["ticket"].(map[string]any)
	if ticket["status"] != "closed" {
		t.Fatalf("expected status=closed, got %v", ticket["status"])
	}
}

func TestCloseTicket_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/tickets/99999/close", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

// ── Delete ───────────────────────────────────────────────────────────────────

func TestDeleteTicket(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "del@example.com")
	tid := insertTestTicket(t, cid)

	resp := doJSON("DELETE", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}

	// 验证已删除
	resp = doJSON("GET", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestDeleteTicket_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("DELETE", "/admin/tickets/99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestDeleteTicket_CascadeReplies(t *testing.T) {
	resetDB(t)
	cid := insertTestCustomer(t, "cascade@example.com")
	tid := insertTestTicket(t, cid)

	// 先添加回复
	now := time.Now().UTC().Format(model.TimeLayout)
	testDB.Exec(`INSERT INTO ticket_replies (ticket_id, author, is_admin, content, created_at)
		VALUES (?, 'admin', 1, '回复内容', ?)`, tid, now)

	resp := doJSON("DELETE", fmt.Sprintf("/admin/tickets/%d", tid), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证回复也被删除
	var count int64
	testDB.Raw("SELECT COUNT(*) FROM ticket_replies WHERE ticket_id = ?", tid).Scan(&count)
	if count != 0 {
		t.Fatalf("expected 0 replies after delete, got %d", count)
	}
}

// ── Permission denied ────────────────────────────────────────────────────────

func TestTickets_PermissionDenied_Read(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer1", "pass", "viewer")
	cookie := userCookieWithRole("viewer1", "viewer")

	resp := doJSON("GET", "/admin/tickets", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestTickets_PermissionDenied_Write(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer2", "pass", "viewer")
	cookie := userCookieWithRole("viewer2", "viewer")

	cid := insertTestCustomer(t, "perm@example.com")
	tid := insertTestTicket(t, cid)

	// 回复
	resp := doJSON("POST", fmt.Sprintf("/admin/tickets/%d/replies", tid), map[string]string{
		"content": "不应该成功",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// 关闭
	resp = doJSON("POST", fmt.Sprintf("/admin/tickets/%d/close", tid), nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// 删除
	resp = doJSON("DELETE", fmt.Sprintf("/admin/tickets/%d", tid), nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

// ── No auth ──────────────────────────────────────────────────────────────────

func TestTickets_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/tickets", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}
