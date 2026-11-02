package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"hive/registry/internal/model"
)

// A nil slice must reach the wire as [] — every list endpoint is declared
// `{array}` in the OpenAPI spec, and the admin UI calls .filter() on the result
// (GET /admin/lines used to return null on a fresh install and crash the plans
// page).
func TestJSONOKNilSliceEncodesAsEmptyArray(t *testing.T) {
	var lines []model.Line
	rec := httptest.NewRecorder()

	(&Handler{}).jsonOK(rec, lines)

	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Fatalf("nil slice must encode as [], got %q", got)
	}
}

func TestJSONOKKeepsPopulatedSlice(t *testing.T) {
	rec := httptest.NewRecorder()

	(&Handler{}).jsonOK(rec, []model.Line{{Name: "Japan Line"}})

	if got := strings.TrimSpace(rec.Body.String()); !strings.HasPrefix(got, `[{"`) {
		t.Fatalf("populated slice must keep its elements, got %q", got)
	}
}

// Non-slice bodies (single objects, maps, scalars) must pass through untouched.
func TestJSONOKLeavesNonSlicesAlone(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   any
		want string
	}{
		{name: "map", in: map[string]any{"items": []any{}}, want: `{"items":[]}`},
		{name: "nil map", in: map[string]any(nil), want: `null`},
		{name: "scalar", in: 42, want: `42`},
		{name: "nil", in: nil, want: `null`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()

			(&Handler{}).jsonOK(rec, tc.in)

			if got := strings.TrimSpace(rec.Body.String()); got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
}
