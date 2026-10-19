"""
Veloura backend API tests
Session token / user seeded via mongosh per /app/auth_testing.md
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vogue-market-30.preview.emergentagent.com").rstrip("/")
SESSION_TOKEN = os.environ.get("TEST_SESSION_TOKEN", "test_session_1784395346051")


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def auth_client(client):
    client.headers.update({"Authorization": f"Bearer {SESSION_TOKEN}"})
    return client


# -------- Products --------
class TestProducts:
    def test_list_all_products_returns_16(self, client):
        r = client.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 16
        # ensure no _id leak
        assert "_id" not in data[0]
        assert "id" in data[0] and "name" in data[0] and "price" in data[0]

    def test_filter_men(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"category": "men"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 8
        assert all(p["category"] == "men" for p in data)

    def test_filter_women(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"category": "women"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 8
        assert all(p["category"] == "women" for p in data)

    def test_get_product_by_id(self, client):
        r = client.get(f"{BASE_URL}/api/products/m-noir-turtleneck")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == "m-noir-turtleneck"
        assert data["price"] == 3499

    def test_get_product_404(self, client):
        r = client.get(f"{BASE_URL}/api/products/does-not-exist")
        assert r.status_code == 404


# -------- Auth --------
class TestAuth:
    def test_auth_session_invalid_returns_401(self, client):
        r = client.post(f"{BASE_URL}/api/auth/session", json={"session_id": "bogus-session-id-xyz"})
        assert r.status_code == 401

    def test_auth_me_without_token_returns_401(self, client):
        r = client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_auth_me_with_bearer_returns_user(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["email"].startswith("test.user.")
        assert data["name"] == "Test User"
        assert "user_id" in data


# -------- Orders --------
class TestOrders:
    _order_state = {}

    def test_orders_create_requires_auth(self, client):
        r = client.post(f"{BASE_URL}/api/orders/create", json={
            "items": [{"product_id": "m-noir-turtleneck", "size": "M", "qty": 1}],
            "address": {"name": "T", "phone": "9999999999", "line1": "L1", "city": "C", "state": "S", "pincode": "560001"},
        })
        assert r.status_code == 401

    def test_orders_create_success(self, auth_client):
        payload = {
            "items": [
                {"product_id": "m-noir-turtleneck", "size": "M", "qty": 1},
                {"product_id": "w-terra-top", "size": "S", "qty": 2},
            ],
            "address": {
                "name": "Test User", "phone": "9999999999",
                "line1": "221B Baker St", "city": "Bengaluru",
                "state": "KA", "pincode": "560001",
            },
        }
        r = auth_client.post(f"{BASE_URL}/api/orders/create", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        # 3499 + 2*2499 = 8497 => 849700 paise
        assert data["amount"] == 849700
        assert data["currency"] == "INR"
        assert data["razorpay_order_id"].startswith("order_")
        assert data["key_id"].startswith("rzp_")
        assert "order_id" in data
        TestOrders._order_state["razorpay_order_id"] = data["razorpay_order_id"]
        TestOrders._order_state["order_id"] = data["order_id"]

    def test_orders_create_empty_cart_400(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/orders/create", json={
            "items": [],
            "address": {"name": "T", "phone": "9999999999", "line1": "L1", "city": "C", "state": "S", "pincode": "560001"},
        })
        assert r.status_code == 400

    def test_orders_create_bad_product_400(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/orders/create", json={
            "items": [{"product_id": "nope-xyz", "size": "M", "qty": 1}],
            "address": {"name": "T", "phone": "9999999999", "line1": "L1", "city": "C", "state": "S", "pincode": "560001"},
        })
        assert r.status_code == 400

    def test_list_orders(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/orders")
        assert r.status_code == 200
        orders = r.json()
        assert isinstance(orders, list)
        assert len(orders) >= 1
        assert any(o.get("razorpay_order_id") == TestOrders._order_state.get("razorpay_order_id") for o in orders)
        # should include pending status
        assert any(o["status"] == "pending" for o in orders)

    def test_list_orders_no_auth_401(self, client):
        r = client.get(f"{BASE_URL}/api/orders")
        assert r.status_code == 401

    def test_verify_bad_signature_marks_failed(self, auth_client):
        rzp_order_id = TestOrders._order_state.get("razorpay_order_id")
        assert rzp_order_id, "Order was not created in prior test"
        r = auth_client.post(f"{BASE_URL}/api/orders/verify", json={
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": "pay_FakeXYZ",
            "razorpay_signature": "invalid_signature_abc",
        })
        assert r.status_code == 400
        # Ensure order marked failed
        r2 = auth_client.get(f"{BASE_URL}/api/orders")
        orders = r2.json()
        matched = [o for o in orders if o.get("razorpay_order_id") == rzp_order_id]
        assert matched and matched[0]["status"] == "failed"
