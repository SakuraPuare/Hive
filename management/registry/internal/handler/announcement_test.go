package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"hive/registry/internal/model"
)

// insertTestAnnouncement inserts a test announcement and returns its ID.
func insertTestAnnouncement(t *testing.T, title, level string, pinned, published bool) uint {
	t.Helper()
	now := time.Now().UTC().Format(model.TimeLayout)
	result := testDB.Exec(
		`INSERT INTO announcements (title, content, level, pinned, published, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		title, "Test content for "+title, level, pinned, published, now, now,
	)
	if result.Error != nil {
		t.Fatalf("insert test announcement: %v", result.Error)
	}
	var id uint
	testDB.Raw("SELECT LAST_INSERT_ID()").Scan(&id)
	return id
}

// ── List (admin) ────────────────────────────────────────────────────────────

func TestListAnnouncements_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/announcements", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 0 {
		t.Fatalf("expected total=0, got %v", total)
	}
	items := body["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

func TestListAnnouncements_WithData(t *testing.T) {
	resetDB(t)
	insertTestAnnouncement(t, "First", "info", false, true)
	insertTestAnnouncement(t, "Second", "warning", true, false)

	resp := doJSON("GET", "/admin/announcements", nil, adminCookie())
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
	// pinned item should come first
	first := items[0].(map[string]any)
	if first["title"] != "Second" {
		t.Fatalf("expected pinned item first, got %v", first["title"])
	}
}

func TestListAnnouncements_Pagination(t *testing.T) {
	resetDB(t)
	for i := 0; i < 5; i++ {
		insertTestAnnouncement(t, fmt.Sprintf("Ann %d", i), "info", false, true)
	}

	resp := doJSON("GET", "/admin/announcements?page=1&limit=2", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	total := body["total"].(float64)
	if total != 5 {
		t.Fatalf("expected total=5, got %v", total)
	}
	items := body["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 items on page 1, got %d", len(items))
	}

	// page 3 should have 1 item
	resp = doJSON("GET", "/admin/announcements?page=3&limit=2", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body = parseJSON(resp)
	items = body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 item on page 3, got %d", len(items))
	}
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestCreateAnnouncement(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title":     "Maintenance Notice",
		"content":   "Server will be down at 3am.",
		"level":     "warning",
		"pinned":    true,
		"published": true,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["title"] != "Maintenance Notice" {
		t.Fatalf("expected title=Maintenance Notice, got %v", body["title"])
	}
	if body["level"] != "warning" {
		t.Fatalf("expected level=warning, got %v", body["level"])
	}
	if body["pinned"] != true {
		t.Fatalf("expected pinned=true, got %v", body["pinned"])
	}
	if body["published"] != true {
		t.Fatalf("expected published=true, got %v", body["published"])
	}
	if body["id"] == nil || body["id"].(float64) == 0 {
		t.Fatal("expected non-zero id")
	}
}

func TestCreateAnnouncement_DefaultLevel(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title":   "No Level",
		"content": "test",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body := parseJSON(resp)
	if body["level"] != "info" {
		t.Fatalf("expected default level=info, got %v", body["level"])
	}
}

func TestCreateAnnouncement_MissingTitle(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"content": "no title",
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestCreateAnnouncement_InvalidLevel(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title": "Bad Level",
		"level": "emergency",
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestCreateAnnouncement_InvalidJSON(t *testing.T) {
	resetDB(t)

	req, _ := http.NewRequest("POST", testServer.URL+"/admin/announcements", nil)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(adminCookie())
	resp, _ := http.DefaultClient.Do(req)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestCreateAnnouncement_AuditLog(t *testing.T) {
	resetDB(t)

	doJSON("POST", "/admin/announcements", map[string]any{
		"title":   "Audit Test",
		"content": "check audit",
	}, adminCookie())

	var count int64
	testDB.Raw("SELECT COUNT(*) FROM audit_logs WHERE action = 'announcement_create'").Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 audit log for announcement_create, got %d", count)
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

func TestUpdateAnnouncement(t *testing.T) {
	resetDB(t)

	// create
	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title":   "Original",
		"content": "original content",
		"level":   "info",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	id := body["id"]

	// update
	resp = doJSON("PATCH", fmt.Sprintf("/admin/announcements/%v", id), map[string]any{
		"title":     "Updated Title",
		"level":     "critical",
		"pinned":    true,
		"published": true,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	if body["title"] != "Updated Title" {
		t.Fatalf("expected title=Updated Title, got %v", body["title"])
	}
	if body["level"] != "critical" {
		t.Fatalf("expected level=critical, got %v", body["level"])
	}
	if body["pinned"] != true {
		t.Fatalf("expected pinned=true, got %v", body["pinned"])
	}
	if body["published"] != true {
		t.Fatalf("expected published=true, got %v", body["published"])
	}
}

func TestUpdateAnnouncement_PartialUpdate(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title":   "Partial",
		"content": "original",
		"level":   "info",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	id := body["id"]

	// only update pinned
	resp = doJSON("PATCH", fmt.Sprintf("/admin/announcements/%v", id), map[string]any{
		"pinned": true,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	body = parseJSON(resp)
	if body["title"] != "Partial" {
		t.Fatalf("title should remain unchanged, got %v", body["title"])
	}
	if body["level"] != "info" {
		t.Fatalf("level should remain unchanged, got %v", body["level"])
	}
	if body["pinned"] != true {
		t.Fatalf("expected pinned=true, got %v", body["pinned"])
	}
}

func TestUpdateAnnouncement_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("PATCH", "/admin/announcements/99999", map[string]any{
		"title": "Ghost",
	}, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestUpdateAnnouncement_InvalidLevel(t *testing.T) {
	resetDB(t)

	id := insertTestAnnouncement(t, "LevelTest", "info", false, false)

	resp := doJSON("PATCH", fmt.Sprintf("/admin/announcements/%d", id), map[string]any{
		"level": "disaster",
	}, adminCookie())
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestUpdateAnnouncement_AuditLog(t *testing.T) {
	resetDB(t)

	id := insertTestAnnouncement(t, "AuditUpdate", "info", false, false)

	doJSON("PATCH", fmt.Sprintf("/admin/announcements/%d", id), map[string]any{
		"title": "Changed",
	}, adminCookie())

	var count int64
	testDB.Raw("SELECT COUNT(*) FROM audit_logs WHERE action = 'announcement_update'").Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 audit log for announcement_update, got %d", count)
	}
}

// ── Delete ──────────────────────────────────────────────────────────────────

func TestDeleteAnnouncement(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title":   "ToDelete",
		"content": "bye",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	id := body["id"]

	resp = doJSON("DELETE", fmt.Sprintf("/admin/announcements/%v", id), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// verify deleted
	resp = doJSON("GET", "/admin/announcements", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body = parseJSON(resp)
	if body["total"].(float64) != 0 {
		t.Fatalf("expected total=0 after delete, got %v", body["total"])
	}
}

func TestDeleteAnnouncement_NotFound(t *testing.T) {
	resetDB(t)

	resp := doJSON("DELETE", "/admin/announcements/99999", nil, adminCookie())
	assertStatus(t, resp, http.StatusNotFound)
}

func TestDeleteAnnouncement_AuditLog(t *testing.T) {
	resetDB(t)

	id := insertTestAnnouncement(t, "AuditDelete", "info", false, false)

	doJSON("DELETE", fmt.Sprintf("/admin/announcements/%d", id), nil, adminCookie())

	var count int64
	testDB.Raw("SELECT COUNT(*) FROM audit_logs WHERE action = 'announcement_delete'").Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 audit log for announcement_delete, got %d", count)
	}
}

// ── Portal (public) ─────────────────────────────────────────────────────────

func TestPortalAnnouncements_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

func TestPortalAnnouncements_OnlyPublished(t *testing.T) {
	resetDB(t)
	insertTestAnnouncement(t, "Published", "info", false, true)
	insertTestAnnouncement(t, "Draft", "warning", false, false)

	resp := doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 1 {
		t.Fatalf("expected 1 published item, got %d", len(items))
	}
	if items[0]["title"] != "Published" {
		t.Fatalf("expected Published, got %v", items[0]["title"])
	}
}

func TestPortalAnnouncements_PinnedFirst(t *testing.T) {
	resetDB(t)
	insertTestAnnouncement(t, "Normal", "info", false, true)
	// sleep briefly so created_at differs
	time.Sleep(10 * time.Millisecond)
	insertTestAnnouncement(t, "Pinned", "critical", true, true)

	resp := doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if items[0]["title"] != "Pinned" {
		t.Fatalf("expected pinned item first, got %v", items[0]["title"])
	}
}

func TestPortalAnnouncements_NoAuthRequired(t *testing.T) {
	resetDB(t)

	// no cookie at all — should still work
	resp := doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)
}

func TestPortalAnnouncements_FieldsPresent(t *testing.T) {
	resetDB(t)
	insertTestAnnouncement(t, "FieldCheck", "warning", true, true)

	resp := doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)

	items := parseJSONArray(resp)
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	ann := items[0]
	for _, field := range []string{"id", "title", "content", "level", "pinned", "published", "created_at", "updated_at"} {
		if _, ok := ann[field]; !ok {
			t.Errorf("missing field %q in portal response", field)
		}
	}
}

// ── Permission checks ───────────────────────────────────────────────────────

func TestAnnouncements_PermissionDenied_Viewer(t *testing.T) {
	resetDB(t)
	createTestUser(t, "viewer_ann", "pass", "viewer")
	cookie := userCookieWithRole("viewer_ann", "viewer")

	// list
	resp := doJSON("GET", "/admin/announcements", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// create
	resp = doJSON("POST", "/admin/announcements", map[string]any{
		"title": "Nope",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// update
	resp = doJSON("PATCH", "/admin/announcements/1", map[string]any{
		"title": "Nope",
	}, cookie)
	assertStatus(t, resp, http.StatusForbidden)

	// delete
	resp = doJSON("DELETE", "/admin/announcements/1", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestAnnouncements_PermissionDenied_Admin(t *testing.T) {
	resetDB(t)
	createTestUser(t, "admin_ann", "pass", "admin")
	cookie := userCookieWithRole("admin_ann", "admin")

	// admin role doesn't have announcement:write by default
	resp := doJSON("GET", "/admin/announcements", nil, cookie)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestAnnouncements_NoAuth(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/announcements", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)

	resp = doJSON("POST", "/admin/announcements", map[string]any{
		"title": "Nope",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)

	resp = doJSON("PATCH", "/admin/announcements/1", map[string]any{
		"title": "Nope",
	}, nil)
	assertStatus(t, resp, http.StatusUnauthorized)

	resp = doJSON("DELETE", "/admin/announcements/1", nil, nil)
	assertStatus(t, resp, http.StatusUnauthorized)
}

// ── Full CRUD lifecycle ─────────────────────────────────────────────────────

func TestAnnouncement_FullLifecycle(t *testing.T) {
	resetDB(t)
	cookie := adminCookie()

	// 1. create
	resp := doJSON("POST", "/admin/announcements", map[string]any{
		"title":     "Lifecycle Test",
		"content":   "# Hello\nWorld",
		"level":     "info",
		"pinned":    false,
		"published": false,
	}, cookie)
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	id := body["id"]

	// 2. verify in list
	resp = doJSON("GET", "/admin/announcements", nil, cookie)
	assertStatus(t, resp, http.StatusOK)
	body = parseJSON(resp)
	if body["total"].(float64) != 1 {
		t.Fatalf("expected total=1, got %v", body["total"])
	}

	// 3. not visible in portal (unpublished)
	resp = doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)
	items := parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 portal items (unpublished), got %d", len(items))
	}

	// 4. publish it
	resp = doJSON("PATCH", fmt.Sprintf("/admin/announcements/%v", id), map[string]any{
		"published": true,
		"pinned":    true,
		"level":     "critical",
	}, cookie)
	assertStatus(t, resp, http.StatusOK)

	// 5. now visible in portal
	resp = doJSON("GET", "/portal/announcements", nil, nil)
	assertStatus(t, resp, http.StatusOK)
	items = parseJSONArray(resp)
	if len(items) != 1 {
		t.Fatalf("expected 1 portal item, got %d", len(items))
	}
	if items[0]["level"] != "critical" {
		t.Fatalf("expected level=critical, got %v", items[0]["level"])
	}
	if items[0]["pinned"] != true {
		t.Fatalf("expected pinned=true, got %v", items[0]["pinned"])
	}

	// 6. delete
	resp = doJSON("DELETE", fmt.Sprintf("/admin/announcements/%v", id), nil, cookie)
	assertStatus(t, resp, http.StatusOK)

	// 7. gone from both admin and portal
	resp = doJSON("GET", "/admin/announcements", nil, cookie)
	body = parseJSON(resp)
	if body["total"].(float64) != 0 {
		t.Fatalf("expected total=0 after delete, got %v", body["total"])
	}

	resp = doJSON("GET", "/portal/announcements", nil, nil)
	items = parseJSONArray(resp)
	if len(items) != 0 {
		t.Fatalf("expected 0 portal items after delete, got %d", len(items))
	}
}
