package main

import (
	"fmt"
	"log"
	"net/http"
)

func shop(w http.ResponseWriter, _ *http.Request) {
	fmt.Fprintln(w, "webshop")
}

func main() {
	http.HandleFunc("/", shop)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
