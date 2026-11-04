package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShop(t *testing.T) {
	rec := httptest.NewRecorder()
	shop(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 200 {
		t.Fatalf("GET / returned %d", rec.Code)
	}
}

func TestHealthz(t *testing.T) {
	rec := httptest.NewRecorder()
	healthz(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "ok\n" {
		t.Fatalf("GET /healthz returned %d %q", rec.Code, rec.Body.String())
	}
}
