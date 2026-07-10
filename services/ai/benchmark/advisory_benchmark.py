"""Mini-PC benchmark for the Advisory Check under shared CPU load (DEV-83, ADR 0017/0018).

Runs faster-whisper small.en (int8) and the advisory SLM (Q4 GGUF) together under a fixed
concurrency, and reports per-stage latency plus CPU temperature and frequency so the run shows
whether the box thermally throttles. The production judgment is CPU latency on the mini-PC
(Ryzen 7 5825U), so run this there, not on a GPU workstation.

Each worker owns its own model instances, so `--concurrency N` produces N genuinely parallel
operations (the worst case for the shared pool). Per note the stages are sequential: transcribe
first, then advise (ADR 0018). If no audio sample is given, transcription is skipped and the
advisory is measured on the notes file alone.

Run (on the mini-PC, weights present locally):

    python advisory_benchmark.py \
        --advisory-model /models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
        --audio sample.wav --notes notes.txt \
        --concurrency 2 --iterations 20

Sweep concurrency with several runs (--concurrency 2, 3, 4) and compare against the ADR 0017
concurrency cap and resource reservation.
"""

from __future__ import annotations

import argparse
import glob
import os
import statistics
import threading
import time
from dataclasses import dataclass, field


# --- hardware sampling --------------------------------------------------------------


def _read_cpu_temps_c() -> list[float]:
    temps: list[float] = []
    for path in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
        try:
            with open(path) as fh:
                temps.append(int(fh.read().strip()) / 1000.0)
        except (OSError, ValueError):
            continue
    return temps


def _read_cpu_freqs_mhz() -> list[float]:
    freqs: list[float] = []
    for path in glob.glob("/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq"):
        try:
            with open(path) as fh:
                freqs.append(int(fh.read().strip()) / 1000.0)
        except (OSError, ValueError):
            continue
    return freqs


@dataclass
class HardwareSampler:
    """Samples CPU temperature and frequency in a background thread during the run."""

    interval_s: float = 0.5
    temps_c: list[float] = field(default_factory=list)
    freqs_mhz: list[float] = field(default_factory=list)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            temps = _read_cpu_temps_c()
            freqs = _read_cpu_freqs_mhz()
            if temps:
                self.temps_c.append(max(temps))
            if freqs:
                self.freqs_mhz.append(statistics.mean(freqs))
            self._stop.wait(self.interval_s)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)


# --- model wrappers -----------------------------------------------------------------


def _load_whisper(model_size: str, threads: int):
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_size, device="cpu", compute_type="int8", cpu_threads=threads
    )


def _load_advisory(model_path: str, threads: int):
    # Reuse the service prompt/parse so the benchmark measures the real advisory call.
    import sys

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from advisory_model import LlamaCppDefectModel

    return LlamaCppDefectModel(model_path, n_threads=threads)


def _transcribe(whisper, audio_path: str) -> str:
    segments, _ = whisper.transcribe(audio_path, language="en")
    return " ".join(segment.text for segment in segments).strip()


# --- worker -------------------------------------------------------------------------


@dataclass
class Timings:
    transcribe_s: list[float] = field(default_factory=list)
    advisory_s: list[float] = field(default_factory=list)
    combined_s: list[float] = field(default_factory=list)


def _worker(
    *,
    worker_id: int,
    iterations: int,
    args: argparse.Namespace,
    notes: list[str],
    threads_per_worker: int,
    out: Timings,
    lock: threading.Lock,
) -> None:
    whisper = None
    if args.audio and not args.skip_transcription:
        whisper = _load_whisper(args.whisper_model, threads_per_worker)
    advisory = _load_advisory(args.advisory_model, threads_per_worker)

    local = Timings()
    for i in range(iterations):
        start = time.perf_counter()
        if whisper is not None:
            t0 = time.perf_counter()
            note_text = _transcribe(whisper, args.audio)
            local.transcribe_s.append(time.perf_counter() - t0)
        else:
            note_text = notes[(worker_id + i) % len(notes)]

        t1 = time.perf_counter()
        advisory.signals_defect(note_text)
        local.advisory_s.append(time.perf_counter() - t1)
        local.combined_s.append(time.perf_counter() - start)

    with lock:
        out.transcribe_s.extend(local.transcribe_s)
        out.advisory_s.extend(local.advisory_s)
        out.combined_s.extend(local.combined_s)


# --- reporting ----------------------------------------------------------------------


def _pct(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    k = min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))
    return ordered[k]


def _report_stage(name: str, values: list[float]) -> None:
    if not values:
        print(f"  {name:12s}  (skipped)")
        return
    print(
        f"  {name:12s}  n={len(values):4d}  "
        f"p50={_pct(values, 0.50) * 1000:8.1f}ms  "
        f"p95={_pct(values, 0.95) * 1000:8.1f}ms  "
        f"max={max(values) * 1000:8.1f}ms"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--advisory-model", required=True, help="path to the Q4 GGUF model"
    )
    parser.add_argument("--whisper-model", default="small.en")
    parser.add_argument(
        "--audio", default=None, help="sample wav; omit to skip transcription"
    )
    parser.add_argument("--notes", default=None, help="notes file, one note per line")
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument(
        "--iterations", type=int, default=20, help="iterations per worker"
    )
    parser.add_argument("--skip-transcription", action="store_true")
    parser.add_argument(
        "--cpu-threads",
        type=int,
        default=os.cpu_count() or 8,
        help="total CPU threads to split across workers",
    )
    args = parser.parse_args()

    notes = ["left rear tire is worn to the cords"]
    if args.notes:
        with open(args.notes) as fh:
            notes = [line.strip() for line in fh if line.strip()] or notes

    threads_per_worker = max(1, args.cpu_threads // args.concurrency)
    print(
        f"concurrency={args.concurrency}  iterations/worker={args.iterations}  "
        f"threads/worker={threads_per_worker}  "
        f"transcription={'on' if args.audio and not args.skip_transcription else 'off'}"
    )

    out = Timings()
    lock = threading.Lock()
    sampler = HardwareSampler()
    sampler.start()

    wall_start = time.perf_counter()
    workers = [
        threading.Thread(
            target=_worker,
            kwargs=dict(
                worker_id=w,
                iterations=args.iterations,
                args=args,
                notes=notes,
                threads_per_worker=threads_per_worker,
                out=out,
                lock=lock,
            ),
        )
        for w in range(args.concurrency)
    ]
    for t in workers:
        t.start()
    for t in workers:
        t.join()
    wall_s = time.perf_counter() - wall_start
    sampler.stop()

    total_ops = args.concurrency * args.iterations
    print(
        f"\nlatency ({total_ops} ops, wall {wall_s:.1f}s, {total_ops / wall_s:.2f} ops/s):"
    )
    _report_stage("transcribe", out.transcribe_s)
    _report_stage("advisory", out.advisory_s)
    _report_stage("combined", out.combined_s)

    print("\nthermal / frequency:")
    if sampler.temps_c:
        print(
            f"  cpu temp     max={max(sampler.temps_c):5.1f}C  mean={statistics.mean(sampler.temps_c):5.1f}C"
        )
    else:
        print("  cpu temp     (no thermal_zone readings on this host)")
    if sampler.freqs_mhz:
        early = sampler.freqs_mhz[: max(1, len(sampler.freqs_mhz) // 4)]
        late = sampler.freqs_mhz[-max(1, len(sampler.freqs_mhz) // 4) :]
        drop = 1.0 - (statistics.mean(late) / statistics.mean(early))
        print(
            f"  cpu freq     start={statistics.mean(early):6.0f}MHz  "
            f"end={statistics.mean(late):6.0f}MHz  drop={drop * 100:4.1f}%"
            f"{'  <-- likely throttling' if drop > 0.15 else ''}"
        )
    else:
        print("  cpu freq     (no cpufreq readings on this host)")


if __name__ == "__main__":
    main()
