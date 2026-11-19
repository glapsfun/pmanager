package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHistory(t *testing.T) {
	orders := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/orders" || r.URL.Query().Get("customer") != "c1" {
			http.NotFound(w, r)
			return
		}
		if _, err := w.Write([]byte(`[{"id":"o1","total_cents":1250}]`)); err != nil {
			t.Errorf("write: %v", err)
		}
	}))
	defer orders.Close()
	t.Setenv("ORDERS_URL", orders.URL)
	t.Setenv("ASSETS_BUCKET", "test-assets")

	rec := httptest.NewRecorder()
	history(rec, httptest.NewRequest("GET", "/account/orders?customer=c1", nil))

	if !strings.Contains(rec.Body.String(), "o1: 12.50 EUR") {
		t.Fatalf("unexpected body %q", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "/test-assets/o1.jpg") {
		t.Fatalf("no thumbnail in %q", rec.Body.String())
	}
}
