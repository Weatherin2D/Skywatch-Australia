FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY skywatch ./skywatch
COPY serve.py .

ENV PYTHONUNBUFFERED=1
EXPOSE 43137

CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "43137"]
