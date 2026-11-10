package main

import (
	"log"
	"net/http"
	"os"

	"github.com/pm-example/orders/internal/orders"
)

func main() {
	store := orders.NewStore(os.Getenv("ORDERS_BUCKET"))
	http.HandleFunc("/orders", store.List)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
