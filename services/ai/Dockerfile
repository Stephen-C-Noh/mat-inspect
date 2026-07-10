FROM python:3.12-slim AS build
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --target=/app/packages -r requirements.txt

FROM python:3.12-slim AS runtime
WORKDIR /app
RUN groupadd -r appgroup && useradd -r -g appgroup --home-dir /app appuser && chown -R appuser:appgroup /app
COPY --from=build /app/packages ./packages
COPY main.py advisory.py advisory_model.py transcription.py transcription_model.py ./
ENV PYTHONPATH=/app/packages
# Model weights are not baked into the image (large, license-bound). Mount them on the mini-PC:
# point ADVISORY_MODEL_PATH at the local GGUF file, and mount the faster-whisper small.en cache
# (or set AI_TRANSCRIPTION_MODEL to a local path). If weights are missing the advisory path is
# UNAVAILABLE and /transcribe returns 503; submit is unaffected (ADR 0017, ADR 0018).
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
