# Runbook: provision the AI Service model weights

Applies to any box that runs the `ai` container: the team mini-PC today, a SAIT-hosted or Azure
deployment after handover. Run this once per box, before the first `docker compose up`. Feeds the
deployment runbook (DEV-89).

Related: ADR 0017 (transcription scaling), ADR 0018 (advisory check),
`services/ai/benchmark/RESULTS.md` (the numbers these exact weights produced).

---

## What gets installed

| Model                                   | Purpose                                  | Size    | Source                            |
| --------------------------------------- | ---------------------------------------- | ------- | --------------------------------- |
| faster-whisper `small.en` (CTranslate2) | voice note transcription (`/transcribe`) | 461 MB  | `Systran/faster-whisper-small.en` |
| Qwen2.5-1.5B-Instruct Q4_K_M (GGUF)     | advisory defect signal (`/advisory`)     | 1066 MB | `Qwen/Qwen2.5-1.5B-Instruct-GGUF` |

The llama.cpp runtime itself (`llama-cpp-python`) is **in the image**, not here. Only the weights
are provisioned per box.

## Why the weights are mounted, not baked into the image

The two are about 1.5 GB together. The choice was between baking them into the `ai` image and
fetching them once onto the host.

Mounted, because:

- The deploy pulls the image on every push to `main` (`.github/workflows/deploy-staging.yml`).
  Baked weights would move 1.5 GB over the wire on every deploy and store a 1.5 GB layer per tag in
  GHCR, to deliver files that change roughly never.
- The weights are third-party and license-bound. Baking them republishes someone else's artifact
  inside an image we publish.
- An operator has to be able to see, verify and replace the weights without entering a container.

The cost of this choice is a provisioning step that is easy to forget. That failure is soft, not
silent: with `/models` empty the service still boots, `/transcribe` answers 503 and `/advisory`
answers `UNAVAILABLE`, and inspection submit is never blocked (ADR 0017, ADR 0018). The way you
notice is that no transcript ever arrives. Verify with the checks at the bottom of this page.

## Provision

On the box, from the repo checkout:

```bash
./scripts/fetch-ai-models.sh
```

This writes to `./models`, which `docker-compose.yml` bind-mounts read-only at `/models`. The
script is idempotent: files already present with the right digest are left alone, so it is safe to
re-run.

To keep the weights outside the checkout (a separate disk, a shared path), pass a target directory
and point Compose at the same place:

```bash
./scripts/fetch-ai-models.sh /srv/mat-inspect/models
# then, in .env on the box:
AI_MODELS_DIR=/srv/mat-inspect/models
```

Both Hugging Face repositories are pinned to a revision in the script, and the two large files are
checked against a pinned SHA-256. The ADR 0017 latency numbers only mean something if the weights
deployed are the weights that were benchmarked, so do not switch the pins to `main`.

The box needs outbound HTTPS to `huggingface.co` for this step only. The `ai` container itself never
reaches Hugging Face: Compose sets `HF_HUB_OFFLINE=1` and points both models at local paths under
`/models`, so a wrong path fails the model load instead of quietly downloading half a gigabyte on
the service's boot path. Audio and note text never leave the box at any point (FOIP).

## Layout the container expects

```
models/
├── qwen2.5-1.5b-instruct-q4_k_m.gguf     <- ADVISORY_MODEL_PATH
└── faster-whisper-small.en/              <- AI_TRANSCRIPTION_MODEL
    ├── config.json
    ├── model.bin
    ├── tokenizer.json
    └── vocabulary.txt
```

`AI_TRANSCRIPTION_MODEL` must be this directory, not the bare name `small.en`. The bare name makes
faster-whisper resolve the model through the Hugging Face cache and download it on a miss.

## Verify

The AI Service is not reachable from the browser (ADR 0019), so drive it from inside the Docker
network or from the box itself.

```bash
docker compose up -d ai
docker compose logs ai | grep -i "advisory model loaded"      # advisory weights loaded
docker compose exec ai python -c "import llama_cpp; print(llama_cpp.__version__)"   # runtime present
```

Then exercise both endpoints from a container on the same network:

```bash
# advisory: expect {"flagged":true,"status":"OK"} — not UNAVAILABLE
docker compose exec core-api node -e '
  fetch("http://ai:8000/advisory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note_text: "hydraulic hose is leaking", item_marked_pass: true }),
  }).then((r) => r.text()).then(console.log);
'

# transcribe: expect a transcript — not 503
docker compose exec ai python -c "
import urllib.request, pathlib
clip = pathlib.Path('/models/sample.wav').read_bytes()
boundary = 'x'
body = (f'--{boundary}\r\nContent-Disposition: form-data; name=\"clip\"; filename=\"c.wav\"\r\n'
        'Content-Type: audio/wav\r\n\r\n').encode() + clip + f'\r\n--{boundary}--\r\n'.encode()
req = urllib.request.Request('http://127.0.0.1:8000/transcribe', data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
print(urllib.request.urlopen(req).read().decode())
"
```

A `sample.wav` is not shipped with the repo (voice clips are biometric PII under FOIP; no real clip
is committed). Record a short one on the box, or reuse the clip the DEV-83 benchmark used.

## Failure modes

| Symptom                                                      | Cause                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/transcribe` returns 503, `/advisory` returns `UNAVAILABLE` | `/models` is empty or not mounted. Run the provisioning script.                                                                                                                                                                        |
| `/advisory` returns `UNAVAILABLE`, `/transcribe` works       | GGUF missing or `ADVISORY_MODEL_PATH` wrong. Check the log line `advisory model failed to load`.                                                                                                                                       |
| The `ai` container dies at start with `Illegal instruction`  | The llama.cpp build used instructions the CPU lacks. The Dockerfile pins the Zen3 baseline (`GGML_NATIVE=OFF`, AVX2/FMA/F16C); a CPU older than that needs the flags relaxed.                                                          |
| The `ai` container is OOM-killed                             | Both models resident exceed `mem_limit`. Raise it and record the observed figure.                                                                                                                                                      |
| `/advisory` intermittently returns `UNAVAILABLE` under load  | Working as designed. One inference runs at a time; a note that arrives mid-inference is shed rather than queued, and a note that exceeds the 4-second budget is abandoned. Both show the operator no prompt and neither blocks submit. |

## Resource envelope, as measured

Both models are resident in one container. `docker-compose.yml` gives the `ai` service
`cpus: ${AI_CPUS:-2}`, `cpu_shares: 2048` and `mem_limit: 4g` (ADR 0017).

Measured on the mini-PC (Ryzen 7 5825U) on 2026-07-13, in the container, at the concurrency cap
of 2, both models resident, transcribing an 11-second clip and then assessing the note:

|                | in-container (`cpus: 2`) | ADR 0017 benchmark (bare box) | DEV-31 target          |
| -------------- | ------------------------ | ----------------------------- | ---------------------- |
| transcribe p95 | 10.5 s                   | 3.5 s                         | 5 s                    |
| advisory p95   | 3.6 s                    | 0.28 s                        | 4 s (fail-open budget) |
| combined p95   | about 14 s               | 3.7 s                         | 5 s                    |
| peak memory    | 722 MiB                  | not measured                  | 4 GiB limit            |

**Memory holds with room to spare.** Both models resident peak at well under a quarter of
`mem_limit: 4g`, under load, with no OOM kill. llama.cpp mmaps the GGUF, so most of the 1 GB of
advisory weights stays in page cache rather than the container's RSS.

**Latency does not hold, and the reason is a unit mismatch, not the models.** The ADR 0017
benchmark ran on the bare box: at concurrency 2 it gave each of its two workers 8 of the box's 16
hardware threads. The container is capped at `cpus: 2`, which is a CFS quota of two CPUs of total
CPU time, about an eighth of what the benchmark used. The concurrency cap counts concurrent
requests; `cpus` counts cores. ADR 0017 derives both from one variable (`AI_CPUS`), which is what
puts them out of step. The models are also given no explicit thread count, so each spawns threads
for every CPU it can see on the host (16) while the cgroup admits two.

The consequence today: transcription runs at about twice the 5-second target, and the advisory sits
within 0.4 s of its own 4-second fail-open timeout, so a little extra load will start returning
UNAVAILABLE at nominal usage. Neither failure blocks inspection submit (ADR 0017, ADR 0018): a slow
transcript arrives late, and a missing advisory shows no prompt. Tracked separately; do not "fix" it
by raising `AI_CPUS`, which would raise the concurrency cap in lockstep and make transcription
slower still.
