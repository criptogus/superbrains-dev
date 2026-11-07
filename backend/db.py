"""SQLite persistence for SuperBrains — users, sessions, forecasts, events."""

import hashlib
import os
import secrets
import sqlite3
import threading
import time

DB_PATH = os.path.join(os.environ.get("DATA_DIR", "./data"), "app.db")
TOKEN_TTL = 15 * 60          # magic-link tokens: 15 min
SESSION_TTL = 30 * 24 * 3600  # sessions: 30 days

_local = threading.local()


def _conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def init_db() -> None:
    c = _conn()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT NOT NULL UNIQUE,
            plan          TEXT NOT NULL DEFAULT 'free',
            stripe_id     TEXT,
            created_at    REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS magic_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at REAL NOT NULL,
            used       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS forecasts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            horizon     INTEGER NOT NULL,
            context_len INTEGER NOT NULL,
            payload     TEXT NOT NULL,          -- JSON {values, forecast, quantiles}
            created_at  REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_forecasts_user ON forecasts(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS events (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            event   TEXT NOT NULL,
            path    TEXT,
            meta    TEXT,
            created_at REAL NOT NULL
        );
        """
    )
    c.commit()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── users / auth ─────────────────────────────────────────────

def get_or_create_user(email: str) -> sqlite3.Row:
    email = email.strip().lower()
    c = _conn()
    row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if row:
        return row
    c.execute("INSERT INTO users (email, created_at) VALUES (?,?)", (email, time.time()))
    c.commit()
    return c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()


def create_magic_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    c = _conn()
    c.execute(
        "INSERT INTO magic_tokens (token_hash, user_id, expires_at) VALUES (?,?,?)",
        (_hash(token), user_id, time.time() + TOKEN_TTL),
    )
    c.commit()
    return token


def consume_magic_token(token: str) -> sqlite3.Row | None:
    c = _conn()
    row = c.execute(
        "SELECT mt.user_id, u.email, u.plan FROM magic_tokens mt JOIN users u ON u.id=mt.user_id WHERE mt.token_hash=?",
        (_hash(token),),
    ).fetchone()
    if not row:
        return None
    c.execute("UPDATE magic_tokens SET used=1 WHERE token_hash=?", (_hash(token),))
    c.commit()
    return row


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    c = _conn()
    c.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)",
        (_hash(token), user_id, time.time() + SESSION_TTL),
    )
    c.commit()
    return token


def get_session_user(token: str) -> sqlite3.Row | None:
    c = _conn()
    return c.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
        (_hash(token), time.time()),
    ).fetchone()


def set_user_plan(email: str, plan: str, stripe_id: str | None = None) -> None:
    c = _conn()
    c.execute(
        "UPDATE users SET plan=?, stripe_id=COALESCE(?, stripe_id) WHERE email=?",
        (plan, stripe_id, email.strip().lower()),
    )
    c.commit()


def set_user_stripe(email: str, stripe_id: str) -> None:
    c = _conn()
    c.execute("UPDATE users SET stripe_id=? WHERE email=?", (stripe_id, email.strip().lower()))
    c.commit()


def get_user_by_stripe(stripe_id: str) -> sqlite3.Row | None:
    return _conn().execute("SELECT * FROM users WHERE stripe_id=?", (stripe_id,)).fetchone()


# ── forecasts ────────────────────────────────────────────────

def save_forecast(user_id: int, name: str, horizon: int, context_len: int, payload: str) -> int:
    c = _conn()
    cur = c.execute(
        "INSERT INTO forecasts (user_id, name, horizon, context_len, payload, created_at) VALUES (?,?,?,?,?,?)",
        (user_id, name, horizon, context_len, payload, time.time()),
    )
    c.commit()
    return cur.lastrowid


def list_forecasts(user_id: int, limit: int = 100):
    return _conn().execute(
        "SELECT id, name, horizon, context_len, created_at, substr(payload,1,200) AS preview FROM forecasts WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()


def get_forecast(user_id: int, fid: int) -> sqlite3.Row | None:
    return _conn().execute(
        "SELECT * FROM forecasts WHERE id=? AND user_id=?", (fid, user_id)
    ).fetchone()


# ── analytics ────────────────────────────────────────────────

def log_event(event: str, path: str | None, meta: str | None) -> None:
    c = _conn()
    c.execute(
        "INSERT INTO events (event, path, meta, created_at) VALUES (?,?,?,?)",
        (event, path, meta, time.time()),
    )
    c.commit()
