package handler

import (
	"fmt"
	"net/http"
	"testing"
)

func TestListPlans_Empty(t *testing.T) {
	resetDB(t)

	resp := doJSON("GET", "/admin/plans", nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	plans := parseJSONArray(resp)
	if len(plans) != 0 {
		t.Fatalf("expected 0 plans, got %d", len(plans))
	}
}

func TestCreatePlan(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/plans", map[string]any{
		"name":          "Basic Plan",
		"traffic_limit": 107374182400,
		"speed_limit":   100,
		"device_limit":  3,
		"duration_days": 30,
		"price":         1000,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 验证
	resp = doJSON("GET", "/admin/plans", nil, adminCookie())
	plans := parseJSONArray(resp)
	if len(plans) != 1 {
		t.Fatalf("expected 1 plan, got %d", len(plans))
	}
}

func TestUpdatePlan(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/plans", map[string]any{
		"name":  "Old Name",
		"price": 500,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	planID := body["id"]

	resp = doJSON("PATCH", fmt.Sprintf("/admin/plans/%v", planID), map[string]any{
		"name":  "New Name",
		"price": 800,
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestDeletePlan(t *testing.T) {
	resetDB(t)

	resp := doJSON("POST", "/admin/plans", map[string]any{
		"name": "ToDelete",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	body := parseJSON(resp)
	planID := body["id"]

	resp = doJSON("DELETE", fmt.Sprintf("/admin/plans/%v", planID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}

func TestPlanLines(t *testing.T) {
	resetDB(t)

	// 创建线路
	resp := doJSON("POST", "/admin/lines", map[string]any{
		"name":   "JP Line",
		"region": "JP",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	lineBody := parseJSON(resp)
	lineID := lineBody["id"]

	// 创建套餐
	resp = doJSON("POST", "/admin/plans", map[string]any{
		"name": "Premium",
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)
	planBody := parseJSON(resp)
	planID := planBody["id"]

	// 设置套餐线路
	resp = doJSON("PUT", fmt.Sprintf("/admin/plans/%v/lines", planID), map[string]any{
		"lines": []any{lineID},
	}, adminCookie())
	assertStatus(t, resp, http.StatusOK)

	// 获取套餐线路
	resp = doJSON("GET", fmt.Sprintf("/admin/plans/%v/lines", planID), nil, adminCookie())
	assertStatus(t, resp, http.StatusOK)
}
