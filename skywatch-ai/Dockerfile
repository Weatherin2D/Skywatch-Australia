FROM python:3.12-slim

WORKDIR /app

# Engine + V1 neural serve (CPU torch). Diagnostics still work if ckpt missing.
COPY requirements.txt requirements-train.txt ./
RUN pip install --no-cache-dir -r requirements-train.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

COPY skywatch ./skywatch
COPY serve.py .
COPY checkpoints ./checkpoints

ENV PYTHONUNBUFFERED=1
ENV SKYWATCH_AI_CHECKPOINT=/app/checkpoints/v1-etl.pt
# Render injects PORT; local/Docker Compose default 43137.
ENV PORT=43137
EXPOSE 43137

CMD ["sh", "-c", "uvicorn serve:app --host 0.0.0.0 --port ${PORT}"]
