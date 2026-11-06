# superbrains.dev

Demand forecasting for small and medium businesses. Landing page + live AI
demo powered by a time-series foundation model.

## Stack

- **Frontend**: static HTML/CSS/JS, canvas-rendered forecast charts
- **Backend**: FastAPI + [TimesFM 3.0](https://github.com/google-research/timesfm)
  (PyTorch, Apple Silicon MPS)

## Acknowledgements

This project builds on **TimesFM**, a time-series foundation model developed
by Google Research, used under the
[Apache License 2.0](https://github.com/google-research/timesfm/blob/main/LICENSE).
Model weights: `google/timesfm-3.0-pytorch` on Hugging Face.

Upstream repository: <https://github.com/google-research/timesfm>

## Rodar

```bash
# 1. Site estático
python3 -m http.server 8642

# 2. Backend de forecast (uma vez: uv venv + install)
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python server.py   # → http://localhost:8000
```

O modelo (~1GB) baixa do HuggingFace no primeiro forecast e fica em cache.

## Fluxo

- `index.html` / `styles.css` / `app.js` — landing page + demo interativo
- Upload de qualquer tabela (CSV, TSV, TXT, XLS, XLSX, ODS) → `POST /forecast`
  → gráfico com previsão + banda de confiança real (quantis 0.1–0.9)
- Sem backend, o demo usa datasets simulados

## Deploy (cloud)

Everything is cloud-ready — no localhost assumptions in production.

**Frontend (static):** any static host works (Vercel, Netlify, S3+CDN,
nginx). In production the app calls same-origin `/api/forecast`, so you
need either:

- **Vercel:** the `api/forecast.js` serverless function is already included.
  Set env `FORECAST_API_URL=https://<your-backend>` and deploy.
- **Self-hosted single VPS (Hetzner, etc.) — recommended:**

```bash
# on the server, from the repo root:
cd deploy
docker compose up -d --build
```

One `docker-compose.yml` runs both containers:

- `api` — FastAPI + TimesFM (Dockerfile in `backend/`, CPU torch, model
  weights cached in the `hf-cache` volume)
- `web` — Caddy serving the static site and proxying `/api/*` → `api:8000`,
  with automatic HTTPS

Before starting: point your domain's DNS A record to the server IP, then set
`SITE_ADDRESS`/`ALLOWED_ORIGINS` if the domain isn't `superbrains.dev`.

Hetzner sizing: **CX22 (2 vCPU / 4 GB)** handles the demo fine — inference is
~1–3s per forecast on CPU. Go **CX32/CCX13** if you expect concurrent users.

Manual Caddy alternative (without compose): `deploy/Caddyfile` works with any
Caddy install — just adjust the `reverse_proxy` target.

To point the frontend at a custom API URL instead, set
`window.SUPERBRAINS_API_URL` before `app.js` loads.

**Backend:**

```bash
cd backend
docker build -t superbrains-api .
docker run -p 8000:8000 -v hf-cache:/data/hf \
  -e ALLOWED_ORIGINS=https://superbrains.dev \
  -e TIMESFM_MODEL=google/timesfm-3.0-pytorch \
  superbrains-api
```

Env vars: `PORT` (default 8000), `ALLOWED_ORIGINS` (comma-separated, default
`*`), `TIMESFM_MODEL`, `TIMESFM_MAX_CONTEXT`, `HF_HOME` (model cache — mount
a volume, ~1GB download on first run).

Health check: `GET /health` → `{"status":"ok","model_loaded":bool}`.

## Upstream tracking

`scripts/check_upstream.py` monitora
[google-research/timesfm](https://github.com/google-research/timesfm) e o
checkpoint `google/timesfm-3.0-pytorch` no Hugging Face. Quando há nova
release, abre um PR automaticamente com o bump de versão.

Agendado via **launchd** (`dev.superbrains.upstream-sync`, diário 08:30).
O job roda num clone dedicado em `~/.local/share/superbrains-dev` porque
launchd/cron não têm permissão de acessar `~/Documents` (TCC). Wrapper:
`~/.local/bin/superbrains-upstream.sh`.

```bash
python3 scripts/check_upstream.py            # check manual
python3 scripts/check_upstream.py --dry-run  # só reporta
```

## Licença

[Apache-2.0](LICENSE) — exceto o modelo TimesFM, que segue a licença original
do projeto Google Research.
