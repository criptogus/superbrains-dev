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

## Upstream tracking

`scripts/check_upstream.py` (rodado via cron) monitora
[google-research/timesfm](https://github.com/google-research/timesfm) e o
checkpoint `google/timesfm-3.0-pytorch` no Hugging Face. Quando há nova
release, abre um PR automaticamente com o bump de versão.

```bash
python3 scripts/check_upstream.py            # check manual
python3 scripts/check_upstream.py --dry-run  # só reporta
```

## Licença

[Apache-2.0](LICENSE) — exceto o modelo TimesFM, que segue a licença original
do projeto Google Research.
