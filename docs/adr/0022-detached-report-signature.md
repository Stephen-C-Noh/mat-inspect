# ADR 0022: Detached Hash Signature for PDF Exports, Not Embedded PAdES

Date: 2026-07-23
Status: Accepted

## Context

ARCHITECTURE.md Section 7.4 says the exported PDF "is digitally signed (PDF signature
with the system's signing key)." Nothing in the codebase implements any signing
mechanism, and no prior ADR covers one. Two readings of "digitally signed" are both
plausible from that one sentence, and they are very different amounts of work:

1. An embedded PAdES-style signature, the kind Adobe Reader shows as "Signed and all
   signatures are valid," verified against a certificate chain.
2. A detached signature over the file's hash: sign `sha256(file bytes)` with a private
   key the service holds, and publish the signature alongside the hash for independent
   verification.

Option 1 needs a certificate, not just a keypair. A self-signed certificate with no
trusted root gives a _worse_ result than no signature at all: Adobe Reader shows "Signer's
identity is unknown" or "invalid," which reads to a non-technical auditor as "something
is wrong with this document," not "this is attested." Getting a certificate with a real
trust chain means either paying for one or standing up an internal CA the recipient's
Adobe installation is configured to trust — the same class of cost this project already
carries once, for `tls internal` in Caddy (ADR 0020's device-setup runbook), and doubling
it for PDFs is a second CA-trust story for a five-person, thirteen-week team to own.
PDFKit, the library the roadmap already commits to, has no native signing support either;
Option 1 would force a library swap (to `pdf-lib` plus an incremental-signing overlay)
this late is real technical risk against the sprint plan, not a drop-in addition.

## Decision

Sign the SHA-256 digest of the finished PDF (or CSV) bytes with an RSA private key the
Audit Service holds (`REPORT_SIGNING_PRIVATE_KEY`, PEM, via Node's built-in `crypto` —
no new dependency). The signature and a public-key fingerprint are:

- Returned in the `GET /api/v1/reports/:jobId` response alongside `sha256`, which
  API_REFERENCE.md already documented before this ADR existed.
- Noted on the last page of the PDF itself, pointing at that endpoint, rather than
  attempting to embed a signature of the file inside the file it signs (a chicken-and-egg
  problem: the bytes are not final until the signature would need to already be known).

Verification is: fetch the file, recompute its SHA-256, verify the signature against the
recorded public key. This is a real cryptographic attestation — it proves the Audit
Service, and specifically the holder of that private key, produced these exact bytes —
just not one a PDF viewer renders a checkmark for natively.

## Consequences

Positive: no new dependency, no certificate to obtain or rotate, no second CA-trust
story for stakeholders' devices. It is a direct continuation of ADR 0007's own reasoning
(the project already chose "the hash chain is the tamper-evidence mechanism" over a
per-record signature, for the same cost-versus-benefit reasons) applied to exports.

Negative: it does not produce the "Signed and all signatures are valid" panel a
recipient might expect from the phrase "digitally signed PDF" if they assume the Adobe
Acrobat meaning. This is stated plainly here rather than left to be discovered during a
demo. If the project later obtains a real trusted certificate (for example if SAIT's own
Entra/PKI infrastructure becomes available post-handover), embedded PAdES signing is a
compatible upgrade — the detached signature does not need to be removed, only
supplemented.

The private key is a new secret the team must generate once and store like every other
one already in `.env` (`AUDIT_INGEST_TOKEN`'s convention): never committed, rotated if
compromised. Key custody is an operational note for the runbook, not a cryptographic
gap in this design.

## Alternatives Considered

Embedded PAdES signature via a self-signed certificate. Rejected: as argued above, a
self-signed cert with no trusted root is worse UX than no signature, not better, for the
exact audience (a non-technical auditor in Adobe Reader) the feature is meant to
reassure.

No signature at all, relying solely on the audit hash chain for tamper-evidence.
Rejected: the hash chain proves the underlying Inspection records were not altered
after the fact, but says nothing about whether the specific PDF file a reader has in
hand is the one the system actually generated (a tampered-in-transit or
tampered-at-rest copy of the export itself). The detached signature is what closes that
specific gap; it is a different property than the chain, not a duplicate of it.
