FROM python:3.12-slim AS build
WORKDIR /app
# llama-cpp-python ships no wheel, so pip compiles llama.cpp here (DEV-95).
# Not version-pinned: Debian drops a package version from the archive as soon as a security
# update supersedes it, so a pinned apt version turns every base-image security bump into a
# broken build. These are build-stage-only compilers and are not in the runtime image; the
# things that actually reach production (pip packages, the base image tag) are pinned.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake \
    && rm -rf /var/lib/apt/lists/*
# GGML_NATIVE=ON is llama.cpp's default and compiles for the *build* machine. The image is built
# on a GitHub runner and run on the mini-PC (Ryzen 7 5825U, Zen3: AVX2/FMA/F16C, no AVX-512), so a
# native build on an AVX-512 runner would emit instructions the mini-PC cannot execute and the
# advisory model would die with SIGILL at load. Pin the instruction set to the Zen3 baseline
# instead, so the binary is portable to the box it actually runs on.
ENV CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"
COPY requirements.txt ./
RUN pip install --no-cache-dir --target=/app/packages -r requirements.txt

FROM python:3.12-slim AS runtime
WORKDIR /app
# libgomp1: llama.cpp is compiled against the system OpenMP runtime in the build stage above, and
# python:3.12-slim does not ship it. Without it `import llama_cpp` fails and the advisory silently
# stays UNAVAILABLE. (ctranslate2 bundles its own, so whisper does not need this.)
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appgroup && useradd -r -g appgroup --home-dir /app appuser && chown -R appuser:appgroup /app
COPY --from=build /app/packages ./packages
COPY main.py advisory.py advisory_model.py transcription.py transcription_model.py ./
ENV PYTHONPATH=/app/packages
# Model weights are not baked into the image (about 1.5 GB, license-bound). They are fetched once
# onto the host and bind-mounted at /models; Compose points ADVISORY_MODEL_PATH and
# AI_TRANSCRIPTION_MODEL into that mount. See docs/runbooks/ai-model-weights.md for the reasoning
# and the provisioning step. If the weights are absent the service still boots: the advisory path
# is UNAVAILABLE and /transcribe returns 503, and submit is unaffected (ADR 0017, ADR 0018).
# GIT_SHA (DEV-99): the commit this image was built from, reported in /health so a deployed
# stack can be asked from outside whether every service is on the same commit and whether that
# commit is the head of main. ci.yml passes it as a build arg; docker-compose.yml's local build
# falls back to "local" when unset. Unknown by default so a hand build never lies about its origin.
# Placed after the COPY layers, not before: this value changes on every commit, and putting it
# earlier would bust BuildKit's cache for every COPY that follows it on every single build.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
