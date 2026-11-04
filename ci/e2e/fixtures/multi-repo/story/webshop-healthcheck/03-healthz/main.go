package main

import (
	"fmt"
	"log"
	"net/http"
)

func shop(w http.ResponseWriter, _ *http.Request) {
	fmt.Fprintln(w, "webshop")
}

// healthz checks nothing else on purpose: a failing dependency must not restart every pod.
func healthz(w http.ResponseWriter, _ *http.Request) {
	fmt.Fprintln(w, "ok")
}

func main() {
	http.HandleFunc("/", shop)
	http.HandleFunc("/healthz", healthz)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
