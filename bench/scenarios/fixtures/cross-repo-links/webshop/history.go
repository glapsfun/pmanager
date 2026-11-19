package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
)

type order struct {
	ID         string `json:"id"`
	TotalCents int    `json:"total_cents"`
}

func history(w http.ResponseWriter, r *http.Request) {
	endpoint := os.Getenv("ORDERS_URL") + "/orders?customer=" + url.QueryEscape(r.URL.Query().Get("customer"))
	resp, err := http.Get(endpoint)
	if err != nil {
		http.Error(w, "orders unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	var orders []order
	if err := json.NewDecoder(resp.Body).Decode(&orders); err != nil {
		http.Error(w, "bad orders response", http.StatusBadGateway)
		return
	}
	for _, o := range orders {
		fmt.Fprintf(w, "%s: %.2f EUR\n", o.ID, float64(o.TotalCents)/100)
	}
}

// productImage builds a product image URL on the assets bucket.
func productImage(name string) string {
	return "https://" + os.Getenv("ASSETS_BUCKET") + ".objects.example.invalid/" + name
}
