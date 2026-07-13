#!/usr/bin/env bash
#
# Provision the AI Service model weights onto a host (DEV-95).
#
# The weights are not baked into the ai image: they are about 1.5 GB, they are third-party and
# license-bound, and the deploy pulls the image on every push to main. Baking them would move 1.5 GB
# over the wire on each deploy and put someone else's weights inside an image we publish. Instead
# they are fetched once per box into a directory that docker-compose.yml bind-mounts read-only at
# /models. Redeploys reuse them. See docs/runbooks/ai-model-weights.md.
#
# Idempotent: a file that is already present with the right digest is left alone, so this is safe
# to re-run and safe to run on a box that is already provisioned.
#
# Usage:  ./scripts/fetch-ai-models.sh [target-dir]     (default: ./models)

set -euo pipefail

TARGET_DIR="${1:-./models}"

# Both repositories are pinned to a revision, not to main. An unpinned fetch would let the upstream
# repo change the weights under a box that has already been benchmarked, and the ADR 0017 latency
# numbers only mean something if the weights they were measured against are the weights deployed.
ADVISORY_REPO="Qwen/Qwen2.5-1.5B-Instruct-GGUF"
ADVISORY_REV="91cad51170dc346986eccefdc2dd33a9da36ead9"
ADVISORY_FILE="qwen2.5-1.5b-instruct-q4_k_m.gguf"
ADVISORY_SHA256="6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"

WHISPER_REPO="Systran/faster-whisper-small.en"
WHISPER_REV="d1d751a5f8271d482d14ca55d9e2deeebbae577f"
WHISPER_DIR="faster-whisper-small.en"
# The CTranslate2 model directory faster-whisper loads. All four files are required; model.bin is
# the only large one, so it is the only one with a pinned digest.
WHISPER_FILES=(config.json model.bin tokenizer.json vocabulary.txt)
WHISPER_MODEL_BIN_SHA256="62b2a45b05ee59acb4a5341b33ee35e041395d378d418a18acfe4c9e768ee37a"

log() { printf '%s\n' "$*" >&2; }

# Verifies an expected digest when one is given, and reports the actual digest when it does not
# match, so a corrupt or truncated download is distinguishable from a changed upstream file.
verify_sha256() {
  local path="$1" expected="$2"
  local actual
  actual="$(sha256sum "$path" | cut -d' ' -f1)"
  if [ "$actual" != "$expected" ]; then
    log "ERROR: digest mismatch for $path"
    log "  expected $expected"
    log "  actual   $actual"
    return 1
  fi
}

# Downloads to a temporary name and renames only after the digest checks out, so an interrupted run
# never leaves a half-written file that looks provisioned. A model loader given a truncated GGUF
# does not fail cleanly.
fetch() {
  local url="$1" dest="$2" expected_sha="${3:-}"

  if [ -f "$dest" ]; then
    if [ -n "$expected_sha" ]; then
      if verify_sha256 "$dest" "$expected_sha" 2>/dev/null; then
        log "ok (present)   $dest"
        return 0
      fi
      log "re-fetching    $dest (digest does not match)"
    else
      log "ok (present)   $dest"
      return 0
    fi
  fi

  log "downloading    $dest"
  curl --fail --location --progress-bar --output "$dest.part" "$url"
  if [ -n "$expected_sha" ]; then
    verify_sha256 "$dest.part" "$expected_sha" || { rm -f "$dest.part"; return 1; }
  fi
  mv "$dest.part" "$dest"
}

mkdir -p "$TARGET_DIR/$WHISPER_DIR"

log "==> advisory model (llama.cpp GGUF, ADR 0018)"
fetch "https://huggingface.co/$ADVISORY_REPO/resolve/$ADVISORY_REV/$ADVISORY_FILE" \
  "$TARGET_DIR/$ADVISORY_FILE" "$ADVISORY_SHA256"

log "==> transcription model (faster-whisper small.en int8, ADR 0017)"
for f in "${WHISPER_FILES[@]}"; do
  sha=""
  [ "$f" = "model.bin" ] && sha="$WHISPER_MODEL_BIN_SHA256"
  fetch "https://huggingface.co/$WHISPER_REPO/resolve/$WHISPER_REV/$f" \
    "$TARGET_DIR/$WHISPER_DIR/$f" "$sha"
done

log ""
log "Weights provisioned in $TARGET_DIR:"
du -sh "$TARGET_DIR/$ADVISORY_FILE" "$TARGET_DIR/$WHISPER_DIR" >&2
log ""
log "docker-compose.yml mounts this directory at /models. Override the host location with"
log "AI_MODELS_DIR if the weights live outside the repo checkout."
