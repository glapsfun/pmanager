package orders

import (
	"net/http/httptest"
	"testing"
)

func TestListFiltersByCustomer(t *testing.T) {
	s := &Store{orders: []Order{{ID: "o1", Customer: "c1"}, {ID: "o2", Customer: "c2"}}}
	rec := httptest.NewRecorder()
	s.List(rec, httptest.NewRequest("GET", "/orders?customer=c1", nil))
	want := `[{"id":"o1","customer":"c1","total_cents":0}]` + "\n"
	if got := rec.Body.String(); got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}
