from fastapi import FastAPI, APIRouter, HTTPException, Request, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Cashfree Configuration
CASHFREE_APP_ID = os.environ.get('CASHFREE_APP_ID', '14230288c95604eea0f624e274b8203241')
CASHFREE_SECRET_KEY = os.environ.get('CASHFREE_SECRET_KEY', 'cfsk_ma_prod_91c964533da99cb33e652d468b62d49d_8e9459ae')
CASHFREE_ENV = os.environ.get('CASHFREE_ENV', 'PRODUCTION').upper()
CASHFREE_BASE_URL = (
    "https://sandbox.cashfree.com/pg" if CASHFREE_ENV == "SANDBOX"
    else "https://api.cashfree.com/pg"
)

app = FastAPI()
api_router = APIRouter(prefix="/api")

AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Cashfree helpers ----------
def cashfree_headers():
    return {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": "2023-08-01",
    }


# ---------- Models ----------
class SessionRequest(BaseModel):
    session_id: str

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None

class OrderItemIn(BaseModel):
    product_id: str
    size: str
    qty: int
    price: Optional[float] = None
    name: Optional[str] = None

class Address(BaseModel):
    name: str
    phone: str
    line1: str
    city: str
    state: str
    pincode: str
    email: Optional[str] = None

class CreateOrderRequest(BaseModel):
    items: List[OrderItemIn]
    address: Address
    amount: Optional[float] = None

class VerifyPaymentRequest(BaseModel):
    order_id: str
    cf_order_id: Optional[str] = None


from products_seed import SAMPLE_PRODUCTS


# ---------- Auth helpers ----------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_optional_user(request: Request) -> Optional[dict]:
    """Returns the authenticated user or None for guest checkout."""
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


# ---------- Auth routes ----------
@api_router.post("/auth/session")
async def create_session(body: SessionRequest, response: Response):
    async with httpx.AsyncClient() as hc:
        r = await hc.get(AUTH_SESSION_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session id")
    data = r.json()
    existing = await db.users.find_one({"email": data["email"]}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": data["name"], "picture": data.get("picture")}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": data["email"],
            "name": data["name"],
            "picture": data.get("picture"),
            "created_at": datetime.now(timezone.utc),
        })
    session_token = data["session_token"]
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    response.set_cookie(
        key="session_token", value=session_token, httponly=True,
        secure=True, samesite="none", path="/", max_age=7 * 24 * 3600,
    )
    return {"user_id": user_id, "email": data["email"], "name": data["name"], "picture": data.get("picture")}


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    return {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "picture": user.get("picture")}


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ---------- Product routes ----------
@api_router.get("/products")
async def list_products(category: Optional[str] = None):
    query = {"category": category} if category in ("men", "women") else {}
    return await db.products.find(query, {"_id": 0}).to_list(200)


@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


# ---------- Order / payment routes (Cashfree) ----------
@api_router.post("/orders/create")
async def create_order(body: CreateOrderRequest, request: Request):
    user = await get_optional_user(request)
    user_id = user["user_id"] if user else f"guest_{uuid.uuid4().hex[:12]}"
    if not body.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    items = []
    total = 0
    for it in body.items:
        product = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        qty = max(1, it.qty)
        if product:
            price = product["price"]
            name = product["name"]
            image = product.get("image", "")
        else:
            price = float(it.price or 0)
            name = it.name or it.product_id
            image = ""
        items.append({
            "product_id": it.product_id, "name": name, "image": image,
            "price": price, "size": it.size, "qty": qty,
        })
        total += price * qty

    # Use amount from frontend if provided (for consistency)
    if body.amount and body.amount > 0:
        total = body.amount

    order_id = f"ord_{uuid.uuid4().hex[:12]}"
    clean_phone = ''.join(c for c in (body.address.phone or "9999999999") if c.isdigit())[-10:]

    # Create Cashfree order via REST API
    cashfree_payload = {
        "order_id": order_id,
        "order_amount": float(total),
        "order_currency": "INR",
        "customer_details": {
            "customer_id": clean_phone or f"cust_{uuid.uuid4().hex[:8]}",
            "customer_phone": clean_phone or "9999999999",
            "customer_name": body.address.name or (user.get("name", "Customer") if user else "Customer"),
            "customer_email": body.address.email or (user.get("email", "customer@crestus.in") if user else "customer@crestus.in"),
        },
        "order_meta": {
            "return_url": "https://crestus.in/orders?order_id={order_id}",
        },
    }

    try:
        async with httpx.AsyncClient() as hc:
            cf_response = await hc.post(
                f"{CASHFREE_BASE_URL}/orders",
                json=cashfree_payload,
                headers=cashfree_headers(),
                timeout=30.0,
            )
        cf_data = cf_response.json()

        if cf_response.status_code not in (200, 201):
            logger.error(f"Cashfree order creation failed: {cf_data}")
            raise HTTPException(
                status_code=502,
                detail=cf_data.get("message", "Payment gateway error. Please try again.")
            )
    except httpx.HTTPError as e:
        logger.error(f"Cashfree request error: {e}")
        raise HTTPException(status_code=502, detail="Payment gateway error. Please try again.")

    # Store order in MongoDB
    await db.orders.insert_one({
        "order_id": order_id,
        "user_id": user_id,
        "cf_order_id": cf_data.get("cf_order_id"),
        "items": items,
        "address": body.address.model_dump(),
        "amount": total,
        "currency": "INR",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return {
        "order_id": order_id,
        "cf_order_id": cf_data.get("cf_order_id"),
        "payment_session_id": cf_data.get("payment_session_id"),
        "amount": total,
        "environment": "sandbox" if CASHFREE_ENV == "SANDBOX" else "production",
    }


@api_router.post("/orders/verify")
async def verify_payment(body: VerifyPaymentRequest, request: Request):
    user = await get_optional_user(request)
    try:
        async with httpx.AsyncClient() as hc:
            cf_response = await hc.get(
                f"{CASHFREE_BASE_URL}/orders/{body.order_id}",
                headers=cashfree_headers(),
                timeout=30.0,
            )
        cf_data = cf_response.json()
    except Exception as e:
        logger.error(f"Cashfree verify error: {e}")
        raise HTTPException(status_code=502, detail="Could not verify payment")

    order_status = cf_data.get("order_status", "").upper()
    db_status = "paid" if order_status == "PAID" else order_status.lower()

    query = {"order_id": body.order_id}
    if user:
        query["user_id"] = user["user_id"]

    await db.orders.update_one(
        query,
        {"$set": {
            "status": db_status,
            "paid_at": datetime.now(timezone.utc).isoformat() if db_status == "paid" else None,
        }},
    )

    order = await db.orders.find_one(
        {"order_id": body.order_id}, {"_id": 0}
    )
    return {
        "order_id": body.order_id,
        "status": order_status,
        "paid": order_status == "PAID",
        "data": cf_data,
    }


@api_router.get("/orders/track/{order_id}")
async def track_order(order_id: str):
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return {
        "order_id": order["order_id"],
        "status": order["status"],
        "created_at": order["created_at"],
        "amount": order["amount"],
        "items": [{"name": i["name"], "size": i["size"], "qty": i["qty"]} for i in order["items"]],
    }


@api_router.get("/orders")
async def list_orders(request: Request):
    user = await get_current_user(request)
    return await db.orders.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


# ---------- Health & Root checks ----------
@app.get("/")
@app.head("/")
async def root():
    return {"status": "ok", "service": "crestus-api"}


@app.get("/health")
@api_router.get("/health")
async def health():
    return {
        "status": "ok",
        "gateway": "cashfree",
        "mode": "sandbox" if CASHFREE_ENV == "SANDBOX" else "production",
    }


app.include_router(api_router)

# CORS — allow production site, deploy previews, and local dev
cors_origins = os.environ.get('CORS_ORIGINS', '')
if cors_origins:
    allowed_origins = [o.strip() for o in cors_origins.split(',') if o.strip()]
else:
    allowed_origins = [
        "https://crestus.in",
        "https://www.crestus.in",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def seed_products():
    if await db.products.count_documents({}) == 0:
        await db.products.insert_many([dict(p) for p in SAMPLE_PRODUCTS])
        logger.info("Seeded sample products")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
