# superbrains.dev

Landing page + demo de previsão de demanda com IA (TimesFM 3.0).

## Rodar

```bash
# 1. Site estático
cd superbrains.dev
python3 -m http.server 8642

# 2. Backend de forecast (uma vez: uv venv + install)
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python "timesfm[torch]" fastapi "uvicorn[standard]" python-multipart numpy
.venv/bin/python server.py   # → http://localhost:8000
```

O modelo (~1GB) baixa do HuggingFace no primeiro forecast e fica em cache.

## Fluxo

- `index.html` / `styles.css` / `app.js` — landing page + demo interativo
- Upload de CSV (date + coluna numérica) → `POST /forecast` → gráfico com
  previsão + banda de confiança real (quantis 0.1–0.9)
- Sem backend, o demo usa datasets simulados
