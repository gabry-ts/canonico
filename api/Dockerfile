# Build from the repository root: docker build -f api/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CANONICO_DATA_DIR=/app/data \
    CANONICO_STATE_FILE=/var/lib/canonico/state.json \
    CANONICO_CACHE_DIR=/var/lib/canonico/cache

WORKDIR /app
COPY api/pyproject.toml api/pyproject.toml
COPY api/app api/app
RUN pip install ./api
COPY data data

RUN useradd --system --uid 10001 --home-dir /app canonico \
    && mkdir -p /var/lib/canonico/cache \
    && chown -R canonico:canonico /var/lib/canonico
USER canonico
WORKDIR /app/api

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"

# One process only: memory lives in the process and is persisted to the volume.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
