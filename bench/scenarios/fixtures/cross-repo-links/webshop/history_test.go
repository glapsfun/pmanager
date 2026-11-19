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
		w.Write([]byte(`[{"id":"o1","total_cents":1250}]`))
	}))
	defer orders.Close()
	t.Setenv("ORDERS_URL", orders.URL)

	rec := httptest.NewRecorder()
	history(rec, httptest.NewRequest("GET", "/account/orders?customer=c1", nil))

	if !strings.Contains(rec.Body.String(), "o1: 12.50 EUR") {
		t.Fatalf("unexpected body %q", rec.Body.String())
	}
}
