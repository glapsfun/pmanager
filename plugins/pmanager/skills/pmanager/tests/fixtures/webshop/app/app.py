from flask import Flask, jsonify
import sqlite3

app = Flask(__name__)


def db():
    return sqlite3.connect("webshop.db")


@app.get("/orders")
def orders():
    conn = db()
    rows = conn.execute("SELECT id, user_id, total FROM orders ORDER BY id DESC").fetchall()
    result = []
    for order_id, user_id, total in rows:
        # N+1: one query per order for its items
        items = conn.execute("SELECT sku, qty FROM order_items WHERE order_id = ?", (order_id,)).fetchall()
        result.append({"id": order_id, "user": user_id, "total": total, "items": items})
    return jsonify(result)
