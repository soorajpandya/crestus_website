from fastapi import FastAPI, APIRouter, HTTPException, Request, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
import razorpay
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

rzp_client = razorpay.Client(auth=(os.environ['RAZORPAY_KEY_ID'], os.environ['RAZORPAY_KEY_SECRET']))

app = FastAPI()
api_router = APIRouter(prefix="/api")

AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


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

class Address(BaseModel):
    name: str
    phone: str
    line1: str
    city: str
    state: str
    pincode: str

class CreateOrderRequest(BaseModel):
    items: List[OrderItemIn]
    address: Address

class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


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


# ---------- Order / payment routes ----------
@api_router.post("/orders/create")
async def create_order(body: CreateOrderRequest, request: Request):
    user = await get_current_user(request)
    if not body.items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    items = []
    total = 0
    for it in body.items:
        product = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not product:
            raise HTTPException(status_code=400, detail=f"Product {it.product_id} not found")
        qty = max(1, it.qty)
        items.append({
            "product_id": product["id"], "name": product["name"], "image": product["image"],
            "price": product["price"], "size": it.size, "qty": qty,
        })
        total += product["price"] * qty
    order_id = f"ord_{uuid.uuid4().hex[:12]}"
    try:
        rzp_order = rzp_client.order.create({
            "amount": total * 100, "currency": "INR",
            "receipt": order_id[:40], "payment_capture": 1,
        })
    except Exception as e:
        logger.error(f"Razorpay order creation failed: {e}")
        raise HTTPException(status_code=502, detail="Payment gateway error. Please try again.")
    await db.orders.insert_one({
        "order_id": order_id,
        "user_id": user["user_id"],
        "items": items,
        "address": body.address.model_dump(),
        "amount": total,
        "currency": "INR",
        "razorpay_order_id": rzp_order["id"],
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {
        "order_id": order_id,
        "razorpay_order_id": rzp_order["id"],
        "amount": total * 100,
        "currency": "INR",
        "key_id": os.environ['RAZORPAY_KEY_ID'],
        "name": user["name"],
        "email": user["email"],
    }


@api_router.post("/orders/verify")
async def verify_payment(body: VerifyPaymentRequest, request: Request):
    user = await get_current_user(request)
    try:
        rzp_client.utility.verify_payment_signature({
            "razorpay_order_id": body.razorpay_order_id,
            "razorpay_payment_id": body.razorpay_payment_id,
            "razorpay_signature": body.razorpay_signature,
        })
    except Exception:
        await db.orders.update_one(
            {"razorpay_order_id": body.razorpay_order_id, "user_id": user["user_id"]},
            {"$set": {"status": "failed"}},
        )
        raise HTTPException(status_code=400, detail="Payment verification failed")
    await db.orders.update_one(
        {"razorpay_order_id": body.razorpay_order_id, "user_id": user["user_id"]},
        {"$set": {"status": "paid", "razorpay_payment_id": body.razorpay_payment_id, "paid_at": datetime.now(timezone.utc).isoformat()}},
    )
    order = await db.orders.find_one({"razorpay_order_id": body.razorpay_order_id, "user_id": user["user_id"]}, {"_id": 0})
    return order


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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def seed_products():
    if await db.products.count_documents({}) == 0:
        await db.products.insert_many([dict(p) for p in SAMPLE_PRODUCTS])
        logger.info("Seeded sample products")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
