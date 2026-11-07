FROM python:3.12-slim

WORKDIR /app

# CPU-only torch keeps the image small (~200MB vs ~2.5GB with CUDA deps).
# Remove this line if deploying on a GPU host.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py db.py .

ENV PORT=8000 \
    HF_HOME=/data/hf

EXPOSE 8000

# Model weights (~1GB) download once into HF_HOME — mount a volume there
# to avoid re-downloading on every restart.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
