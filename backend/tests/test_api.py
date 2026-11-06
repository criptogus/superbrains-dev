"""Smoke tests — validate API wiring without loading the model.

The forecaster loads lazily on the first valid /forecast call, so these
tests never trigger the ~1GB download. Set FORECAST_SMOKE=1 to also run a
real forecast (requires model cache or network).
"""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402
from server import app  # noqa: E402

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_forecast_rejects_too_few_points():
    r = client.post("/forecast", json={"values": [1, 2, 3], "horizon": 10})
    assert r.status_code == 422


def test_forecast_rejects_bad_horizon():
    r = client.post("/forecast", json={"values": list(range(20)), "horizon": 0})
    assert r.status_code == 422


def test_forecast_rejects_empty_values():
    r = client.post("/forecast", json={"values": [], "horizon": 10})
    assert r.status_code == 422


@pytest.mark.skipif(os.environ.get("FORECAST_SMOKE") != "1", reason="set FORECAST_SMOKE=1 to run real forecast")
def test_real_forecast():
    import numpy as np

    rng = np.random.default_rng(0)
    vals = (100 + np.cumsum(rng.normal(0, 1, 60))).clip(min=1).tolist()
    r = client.post("/forecast", json={"values": vals, "horizon": 12})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["forecast"]) == 12
    assert len(body["quantiles"]) == 12
    assert len(body["quantiles"][0]) == 9
