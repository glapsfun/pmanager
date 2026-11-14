package orders

import (
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024}

// LiveStatus streams an order's status changes to the customer's browser.
func LiveStatus(updates <-chan string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for u := range updates {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(u)); err != nil {
				return
			}
		}
	}
}
