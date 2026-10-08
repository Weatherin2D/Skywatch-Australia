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
EXPOSE 43137

CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "43137"]
