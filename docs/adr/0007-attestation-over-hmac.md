# ADR 0007: Operator Attestation Replaces Per-Record HMAC Signature

Date: 2026-06-09
Status: Accepted

## Context

The data model required a `signature_hmac` field on every Inspection, described as the
operator's cryptographic signature and treated as a non-negotiable compliance control.
The documents disagreed on where it was computed: one user flow specified a client-side
HMAC, the threat model specified server-side validation with short-lived session keys.

An HMAC needs a shared secret key, and the location of that key determines what the HMAC
proves.

- If the client holds the key, the client can compute a valid HMAC over any payload,
  including a tampered one. It proves nothing. It is security theater.
- If the server holds the key, the server is signing, not the operator. It is a
  server-side integrity stamp, not an operator signature, and the append-only audit
  chain already provides tamper-evidence over the record.

In neither case does the HMAC add anything over the authenticated identity already
present in the validated Entra ID token plus the tamper-evidence already provided by the
audit chain (ADR 0008). The legal requirement from OHS Part 6 is to identify the person
doing the work, which is a question of authenticated identity and recorded intent, not
of cryptography.

## Decision

Drop the per-record HMAC signature. Remove `signature_hmac` from the Inspection entity
and from the submit payload.

Replace it with operator attestation, recorded as data:

1. The operator's authenticated identity, taken from the validated token `oid` claim.
2. An explicit confirm action taken after the operator reviews a summary of their
   answers ("You answered 12 items. 1 failed. Submitting as Jane Doe. Confirm."). This
   step is both the legal attestation and a deliberate safety check before commit.
3. A server-recorded timestamp.

Tamper-evidence over the record comes from the append-only audit chain (ADR 0008), not
from a per-record signature. Inspections remain immutable; corrections are new linked
records.

## Consequences

Positive: removes a control that proved nothing in its client-side form and was
redundant in its server-side form. The attestation model is honest about what it
guarantees and is strictly stronger for identity than a client-computed HMAC, because
identity comes from a server-validated token. The confirm-after-review step adds a real
safety check.

Negative: attestation trusts the server. An actor with direct database write access
could, in principle, fabricate an Inspection under an operator's identity. A real
per-operator cryptographic signature would prevent this. That residual risk is accepted
for the capstone because per-user key provisioning and secure key storage on individually
assigned operator devices is out of scope for a thirteen-week build. This limitation is
stated rather than hidden.

Several documents reference the old HMAC and must be updated to match: CLAUDE.md
(sections 2 and 6), ARCHITECTURE.md (sections 3, 6, 7.1, 8.8), and the inspections
schema when it is created.

## Alternatives Considered

Server-side integrity stamp: the server HMACs the canonical record at persist time with
a server-held key. Rejected as the primary mechanism because the audit chain content
digest (ADR 0008) already provides this, making a second per-row stamp redundant.

Per-operator cryptographic signatures: each operator holds a private key and signs;
the server verifies with the public key. This is the only design where "operator forges
a signature" is a meaningful defended threat. Rejected for the capstone: it requires key
provisioning, storage, and recovery per operator device, none of which the plan
provisions in thirteen weeks.
