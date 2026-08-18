# Source-Code Ownership, License, and Maintenance Responsibility

This document states who owns the MAT-Inspect source code, under what license it is released, what
third-party licenses a future owner inherits, and what is and is not maintained after the capstone
ends. SAIT ITS (reply 2026-06-24) named source-code ownership and maintenance responsibility as
prerequisites that must be clearly established before any production adoption (ADR 0016). This
document establishes them for the delivered artifact. It is part of the governance package and is
indexed by the governance adoption brief (DEV-79).

---

## 1. Ownership

The MAT-Inspect source code is the work of the capstone team: five students in SAIT's School of
Manufacturing and Automation Technology (MAT), produced over the May-to-August 2026 capstone. The
team members hold the copyright in the code they wrote.

At handover the team delivers a snapshot of the repository to the sponsoring school. Ownership of
the copyright stays with the team members; the school and any future adopter receive the right to
use, modify, and self-host the code under the MIT license in section 2. This is a license grant, not
a transfer of copyright. The team chose this over assigning copyright to the school so that the
students retain authorship of their capstone work while the school gets every practical right it
needs to adopt, run, and change the system without further permission.

If SAIT or the sponsoring school later requires a full copyright assignment (for example as a
condition of an ITS production adoption), that assignment is a separate agreement between the team
members and the institution. The MIT license already grants everything needed to self-host and
modify the code, so an assignment is not required to adopt the system; it is an option the
institution can pursue if its own policy calls for it.

Third-party components keep their own copyright and licenses; the team does not own and does not
relicense them. Those obligations are inventoried in section 3.

---

## 2. License

The repository is released under the **MIT license**. The full text is in the `LICENSE` file at the
repository root.

MIT was chosen because it is permissive and imposes the fewest conditions on a future owner: the
school or SAIT can use, modify, distribute, and self-host the code, including in a closed
production deployment, with one obligation, to keep the copyright and license notice. This is the
lowest-friction path to the adoption ITS described, and it is compatible with every third-party
license the project depends on (section 3).

The MIT grant applies to the source code in this repository. It does not grant rights over the
third-party dependencies (each carries its own license), the AI model weights (fetched separately,
section 3.2), or any SAIT trademarks, branding, or logo assets that may be added later.

---

## 3. Third-party dependency and license inventory

A future owner inherits the obligations of the components MAT-Inspect depends on. The inventory
below is a summary, produced from the installed dependency tree; it is not a substitute for a formal
software bill of materials, which the owner can generate at adoption if ITS requires one.

### 3.1 Node.js dependencies

The Node dependency tree (745 packages scanned across all workspaces) is almost entirely permissive:

| License                                    | Packages (approx.)                         | Obligation                                                                         |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| MIT                                        | 575                                        | Keep the notice                                                                    |
| Apache-2.0                                 | 90                                         | Keep the notice; patent grant included                                             |
| ISC                                        | 30                                         | Keep the notice                                                                    |
| BSD-2/3-Clause                             | 28                                         | Keep the notice                                                                    |
| BlueOak-1.0.0, MIT-0, 0BSD, Unlicense, CC0 | ~12                                        | Effectively no obligation                                                          |
| MPL-2.0                                    | 3 (`lightningcss` and its native binaries) | File-level copyleft; only the MPL files' source must stay available if modified    |
| LGPL-3.0-or-later                          | 2 (`@img/sharp-libvips` native binaries)   | Weak copyleft; satisfied by dynamic linking and the ability to replace the library |

No strong-copyleft licenses (GPL or AGPL) are present. The two weak-copyleft cases are well
understood:

- **`sharp` / libvips (LGPL-3.0-or-later):** `sharp` is the image library the Media Service uses. It
  links libvips as a shared native library. LGPL permits use inside MIT-licensed software as long as
  the LGPL component can be replaced by the user, which dynamic linking satisfies. The project does
  not modify libvips.
- **`lightningcss` (MPL-2.0):** a build-time CSS tool pulled in by the frontend toolchain. MPL is
  file-scoped copyleft: only modified MPL files must be shared, and the project does not modify them.

One package reported an `UNKNOWN` license field in the scan. An owner producing a formal SBOM should
resolve that one entry against its source; it is a single transitive package and not a project
dependency chosen directly.

### 3.2 Python dependencies and AI model weights

The AI Service's Python dependencies are permissive: FastAPI (MIT), Uvicorn (BSD-3-Clause),
`python-multipart` (Apache-2.0), `faster-whisper` (MIT), `requests` (Apache-2.0), `httpx`
(BSD-3-Clause), `azure-monitor-opentelemetry` (MIT), `cryptography` (Apache-2.0 / BSD), and
`llama-cpp-python` (MIT).

The AI model weights are not in the repository. They are fetched by `scripts/fetch-ai-models.sh`
(see `docs/runbooks/ai-model-weights.md`) and each carries its own upstream license:

| Model                                    | Source                                        | License (verify on the model card) |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------- |
| Transcription: `faster-whisper-small.en` | Systran conversion of OpenAI Whisper small.en | MIT                                |
| Advisory: `Qwen2.5-1.5B-Instruct-GGUF`   | Qwen (Alibaba)                                | Apache-2.0                         |

Both model licenses are permissive as of this writing. A future owner should re-check the model card
for the exact revision before redistribution, because model licenses can differ by version and by
model size within a family. The delivered system runs both models on-prem and sends no data to an
external model service (ADR 0017, ADR 0018), so the licenses govern redistribution of the weights,
not a data-processing relationship.

---

## 4. Maintenance responsibility

**After the capstone ends, the team provides no ongoing maintenance.** The handover is a snapshot of
the repository at a named commit, delivered as-is. The team disbands at the end of the capstone, and
there is no committed maintainer, no support channel, no service-level commitment, and no scheduled
security patching after handover.

What a future owner inherits and becomes responsible for:

- **Dependency and security updates.** The repository ships with CI gates (an npm-audit high-severity
  gate and Trivy scans) and Renovate configuration, documented in `docs/VULNERABILITY_MANAGEMENT.md`
  (DEV-78). These keep working, but only a future owner can act on their findings. Unpatched
  dependencies accumulate risk over time.
- **Deployment, backup, and operations.** Covered by `docs/DEPLOYMENT.md` and
  `docs/OPERATIONS_RUNBOOK.md` (DEV-44/DEV-89). A future owner runs and restores the stack; the
  restore drill evidence is in DEV-45 and DEV-49.
- **Change management.** The branch, PR, review, and CI process a future owner should follow to ship
  a change without breaking the compliance invariants is in `docs/CHANGE_MANAGEMENT.md` (DEV-78).
- **The compliance invariants themselves.** The append-only audit and inspection tables, the
  operator-attestation requirement, and the equipment-readiness state machine are load-bearing for
  the OHS and FOIP story (CLAUDE.md section 2, ADR 0006 to 0008). A future owner must not remove or
  weaken them; `OPERATIONS_RUNBOOK.md` section 1 states this as a hard boundary.

This maintenance posture is deliberate and is the honest position for a capstone: the artifact is
complete and documented so that a future owner can operate and evolve it, but the team does not
commit to work beyond the handover. If the sponsoring school pursues production adoption, a named
operational owner and a support model are among the prerequisites ITS listed (ADR 0016, DEV-79).

---

## 5. Review

This document and the license choice are to be reviewed with the project sponsor before handover, per
the DEV-77 acceptance criteria. Record the review outcome here or in the DEV-77 ticket. The copyright
line in `LICENSE` uses a collective team attribution; if the sponsor or SAIT requires the individual
team members named, add them to the `LICENSE` copyright line and to section 1 at that review.
