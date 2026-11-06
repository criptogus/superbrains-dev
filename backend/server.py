"""SuperBrains forecast API — TimesFM 3.0 backend."""

import os
import threading

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("TIMESFM_MODEL", "google/timesfm-3.0-pytorch")
MAX_CONTEXT = int(os.environ.get("TIMESFM_MAX_CONTEXT", "2048"))
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

app = FastAPI(title="SuperBrains Forecast API")
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
        import torch  # noqa: F401 — ensures torch is importable before forecaster init
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


class ForecastRequest(BaseModel):
    values: list[float] = Field(min_length=8, max_length=MAX_CONTEXT)
    horizon: int = Field(default=30, ge=1, le=512)


class ForecastResponse(BaseModel):
    forecast: list[float]
    quantiles: list[list[float]]  # (horizon, 9) — 0.1 .. 0.9
    context_len: int
    model: str


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _forecaster is not None}


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    values = np.asarray(req.values, dtype=np.float32)
    values = values[np.isfinite(values)]
    if len(values) < 8:
        raise HTTPException(400, "need at least 8 finite data points")
    if len(values) > MAX_CONTEXT:
        values = values[-MAX_CONTEXT:]

    try:
        forecaster = get_forecaster()
    except Exception as e:  # model still downloading / failing
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
