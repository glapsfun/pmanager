import os

import requests

SUPPLIER_URL = os.environ.get("SUPPLIER_URL", "https://suppliers.example.invalid/stock")


def fetch_stock(session: requests.Session | None = None) -> dict[str, int]:
    """Stock levels by product id, from the supplier feed."""
    s = session or requests.Session()
    r = s.get(SUPPLIER_URL, timeout=10)
    r.raise_for_status()
    return {row["id"]: int(row["qty"]) for row in r.json()}


if __name__ == "__main__":
    print(fetch_stock())
