from worker.main import fetch_stock


class FakeResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return [{"id": "p1", "qty": "3"}]


class FakeSession:
    def get(self, url, timeout):
        return FakeResponse()


def test_fetch_stock_maps_rows():
    assert fetch_stock(FakeSession()) == {"p1": 3}
