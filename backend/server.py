"""SuperBrains — forecast API + accounts + billing."""

import json
import os
import threading
import time
import urllib.request
from collections import defaultdict, deque

import numpy as np
import stripe
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import db

MODEL_ID = os.environ.get("TIMESFM_MODEL", "google/timesfm-3.0-pytorch")
MAX_CONTEXT = int(os.environ.get("TIMESFM_MAX_CONTEXT", "2048"))
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
APP_URL = os.environ.get("APP_URL", "https://superbrains.dev").rstrip("/")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_GROWTH = os.environ.get("STRIPE_PRICE_GROWTH", "")
STRIPE_PRICE_SCALE = os.environ.get("STRIPE_PRICE_SCALE", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM", "SuperBrains <login@superbrains.dev>")
FREE_FORECAST_LIMIT = int(os.environ.get("FREE_FORECAST_LIMIT", "5"))

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

db.init_db()

app = FastAPI(title="SuperBrains API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

_forecaster = None
_lock = threading.Lock()


def get_forecaster():
    global _forecaster
    if _forecaster is not None:
        return _forecaster
    with _lock:
        if _forecaster is not None:
            return _forecaster
        import torch  # noqa: F401
        from timesfm3 import TimesFM3Forecaster

        device = device_name()
        print(f"[superbrains] loading {MODEL_ID} on {device} ...", flush=True)
        _forecaster = TimesFM3Forecaster.from_pretrained(MODEL_ID, device=device)
        print("[superbrains] model ready", flush=True)
        return _forecaster


def device_name() -> str:
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


# ── rate limiting (in-memory sliding window) ─────────────────

_rl_hits: dict[str, deque] = defaultdict(deque)
_rl_lock = threading.Lock()


def rate_limit(request: Request, key: str, limit: int, window: int = 60):
    ip = request.client.host if request.client else "unknown"
    bucket_key = f"{key}:{ip}"
    now = time.time()
    with _rl_lock:
        q = _rl_hits[bucket_key]
        while q and q[0] < now - window:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, "rate limit exceeded — try again in a minute")
        q.append(now)


# ── auth helpers ─────────────────────────────────────────────

sqlite3_row = db.sqlite3.Row  # type alias for annotations


def current_user(authorization: str | None = Header(default=None)) -> sqlite3_row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "login required")
    user = db.get_session_user(authorization[7:].strip())
    if not user:
        raise HTTPException(401, "session expired — log in again")
    return user


def _send_magic_email(email: str, link: str) -> bool:
    if not RESEND_API_KEY:
        print(f"[superbrains] RESEND_API_KEY not set — magic link for {email}: {link}", flush=True)
        return False
    payload = json.dumps({
        "from": RESEND_FROM,
        "to": [email],
        "subject": "Your SuperBrains login link",
        "html": f"""<div style="font-family:system-ui;max-width:480px;margin:auto;padding:32px">
          <h2 style="margin:0 0 8px">Sign in to SuperBrains</h2>
          <p style="color:#555">Click below to log in. The link expires in 15 minutes.</p>
          <p><a href="{link}" style="display:inline-block;background:#2f5bff;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600">Log in to SuperBrains</a></p>
          <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
        </div>""",
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f"[superbrains] resend failed: {e}", flush=True)
        return False


# ── health / forecast ────────────────────────────────────────

class ForecastRequest(BaseModel):
    values: list[float] = Field(min_length=8, max_length=MAX_CONTEXT)
    horizon: int = Field(default=30, ge=1, le=512)


class ForecastResponse(BaseModel):
    forecast: list[float]
    quantiles: list[list[float]]
    context_len: int
    model: str


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _forecaster is not None}


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest, request: Request):
    rate_limit(request, "forecast", limit=30, window=60)
    values = np.asarray(req.values, dtype=np.float32)
    values = values[np.isfinite(values)]
    if len(values) < 8:
        raise HTTPException(400, "need at least 8 finite data points")
    if len(values) > MAX_CONTEXT:
        values = values[-MAX_CONTEXT:]

    try:
        forecaster = get_forecaster()
    except Exception as e:
        raise HTTPException(503, f"model unavailable: {e}")

    try:
        out = forecaster.predict(
            values,
            horizon=req.horizon,
            return_quantiles=True,
            make_positive=True,
            use_symmetric_averaging=True,
        )
    except Exception as e:
        raise HTTPException(500, f"forecast failed: {e}")

    return ForecastResponse(
        forecast=[float(x) for x in out.forecast],
        quantiles=[[float(v) for v in row] for row in out.quantiles],
        context_len=int(len(values)),
        model=MODEL_ID,
    )


# ── auth ─────────────────────────────────────────────────────

class EmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


@app.post("/auth/request")
def auth_request(req: EmailRequest, request: Request):
    rate_limit(request, "auth", limit=5, window=300)
    email = req.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "invalid email")
    user = db.get_or_create_user(email)
    token = db.create_magic_token(user["id"])
    link = f"{APP_URL}/app.html?token={token}"
    sent = _send_magic_email(email, link)
    resp = {"ok": True, "email_sent": sent}
    if not sent:
        resp["dev_link"] = link  # only when email provider isn't configured
    return resp


class VerifyRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


@app.post("/auth/verify")
def auth_verify(req: VerifyRequest, request: Request):
    rate_limit(request, "authverify", limit=10, window=300)
    row = db.consume_magic_token(req.token)
    if not row:
        raise HTTPException(400, "invalid or expired link — request a new one")
    session = db.create_session(row["user_id"])
    return {"session": session, "email": row["email"], "plan": row["plan"]}


@app.post("/auth/logout")
def auth_logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        db._conn().execute(
            "DELETE FROM sessions WHERE token_hash=?", (db._hash(authorization[7:].strip()),)
        )
        db._conn().commit()
    return {"ok": True}


@app.get("/me")
def me(user=Depends(current_user)):
    return {"email": user["email"], "plan": user["plan"], "created_at": user["created_at"]}


# ── saved forecasts ──────────────────────────────────────────

class SaveForecastRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    horizon: int
    values: list[float] = Field(min_length=8, max_length=MAX_CONTEXT)
    forecast: list[float]
    quantiles: list[list[float]]


@app.get("/forecasts")
def forecasts_list(user=Depends(current_user)):
    rows = db.list_forecasts(user["id"])
    return {"forecasts": [dict(r) for r in rows]}


@app.post("/forecasts")
def forecasts_save(req: SaveForecastRequest, user=Depends(current_user)):
    if user["plan"] == "free":
        existing = db.list_forecasts(user["id"], limit=FREE_FORECAST_LIMIT + 1)
        if len(existing) >= FREE_FORECAST_LIMIT:
            raise HTTPException(402, "free plan limit reached — upgrade to Growth")
    payload = json.dumps({
        "values": req.values[-MAX_CONTEXT:],
        "forecast": req.forecast,
        "quantiles": req.quantiles,
    })
    fid = db.save_forecast(user["id"], req.name.strip(), req.horizon, len(req.values), payload)
    return {"id": fid}


@app.get("/forecasts/{fid}")
def forecasts_get(fid: int, user=Depends(current_user)):
    row = db.get_forecast(user["id"], fid)
    if not row:
        raise HTTPException(404, "not found")
    out = dict(row)
    out["payload"] = json.loads(out["payload"])
    return out


# ── billing (Stripe) ─────────────────────────────────────────

PRICE_MAP = {"growth": STRIPE_PRICE_GROWTH, "scale": STRIPE_PRICE_SCALE}
PLAN_BY_PRICE = {v: k for k, v in PRICE_MAP.items() if v}


class CheckoutRequest(BaseModel):
    plan: str = Field(pattern="^(growth|scale)$")


@app.post("/billing/checkout")
def billing_checkout(req: CheckoutRequest, user=Depends(current_user)):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "billing not configured")
    price = PRICE_MAP.get(req.plan)
    if not price:
        raise HTTPException(503, f"price for {req.plan} not configured")
    if not user["stripe_id"]:
        cust = stripe.Customer.create(email=user["email"], metadata={"user_id": str(user["id"])})
        db.set_user_stripe(user["email"], cust.id)
    else:
        cust = user["stripe_id"]
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=cust,
        line_items=[{"price": price, "quantity": 1}],
        success_url=f"{APP_URL}/app.html?billing=success",
        cancel_url=f"{APP_URL}/app.html?billing=cancelled",
        client_reference_id=str(user["id"]),
        allow_promotion_codes=True,
    )
    return {"url": session.url}


@app.post("/billing/portal")
def billing_portal(user=Depends(current_user)):
    if not STRIPE_SECRET_KEY or not user["stripe_id"]:
        raise HTTPException(400, "no billing account yet")
    session = stripe.billing_portal.Session.create(
        customer=user["stripe_id"],
        return_url=f"{APP_URL}/app.html",
    )
    return {"url": session.url}


@app.post("/billing/webhook")
async def billing_webhook(request: Request):
    if not STRIPE_SECRET_KEY or not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "billing not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "invalid signature")

    etype = event["type"]
    obj = event["data"]["object"]

    if etype == "checkout.session.completed":
        # link the Stripe customer to the user; plan is set by subscription events
        cust = obj.get("customer")
        email = obj.get("customer_details", {}).get("email")
        if cust and email:
            db.set_user_stripe(email, cust)

    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        cust_id = obj.get("customer")
        status = obj.get("status")
        items = obj.get("items", {}).get("data", [])
        price_id = items[0]["price"]["id"] if items else ""
        plan = PLAN_BY_PRICE.get(price_id)
        user_row = db.get_user_by_stripe(cust_id)
        if user_row and plan:
            new_plan = plan if status in ("active", "trialing", "past_due") else "free"
            db.set_user_plan(user_row["email"], new_plan, cust_id)

    if etype == "customer.subscription.deleted":
        user_row = db.get_user_by_stripe(obj.get("customer"))
        if user_row:
            db.set_user_plan(user_row["email"], "free")

    return {"received": True}


# ── analytics beacon ─────────────────────────────────────────

class EventRequest(BaseModel):
    event: str = Field(min_length=1, max_length=60)
    path: str | None = Field(default=None, max_length=300)
    meta: str | None = Field(default=None, max_length=500)


@app.post("/events")
def events(req: EventRequest, request: Request):
    rate_limit(request, "events", limit=60, window=60)
    db.log_event(req.event, req.path, req.meta)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
