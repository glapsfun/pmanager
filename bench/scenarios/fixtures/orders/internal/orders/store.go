// Package orders keeps customer orders as objects in the orders bucket.
package orders

import (
	"encoding/json"
	"net/http"
)

type Order struct {
	ID       string `json:"id"`
	Customer string `json:"customer"`
	Total    int    `json:"total_cents"`
}

type Store struct {
	Bucket string
	orders []Order
}

func NewStore(bucket string) *Store { return &Store{Bucket: bucket} }

// List writes the orders of the customer named in the query as JSON.
func (s *Store) List(w http.ResponseWriter, r *http.Request) {
	customer := r.URL.Query().Get("customer")
	out := []Order{}
	for _, o := range s.orders {
		if o.Customer == customer {
			out = append(out, o)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
