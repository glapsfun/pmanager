package main

import (
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
