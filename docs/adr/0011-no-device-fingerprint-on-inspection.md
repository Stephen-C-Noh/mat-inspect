# ADR 0011: No Device Fingerprint on the Inspection Record

Date: 2026-06-09
Status: Accepted

## Context

The Inspection entity carried an optional `device_fingerprint` field, and the threat model
listed "device fingerprint logged" as a mitigation for a stolen JWT used from another device.
Three problems.

The control is weak. The fingerprint was logged, not enforced, so it never prevented a stolen
token from being used. Device fingerprints are also spoofable (the client sends the value) and
unstable (they change across browser updates), so even their forensic value is low. The real
controls for that threat already exist: identity is taken from the validated token (ADR 0007)
and token lifetime is short.

The privacy cost is high. A device fingerprint is PII that links a device to a person, and it
was not in the FOIP inventory. Worse, the Inspection record is immutable (ADR 0008) and its
content is sealed into the audit chain and retained seven years. Putting a fingerprint there
would bake an un-deletable device identifier into a legal safety record, which is the opposite
of FOIP data minimization.

The location is wrong. Forensic signals for stolen-token detection belong in short-lived
access logs, not in a permanent inspection record.

## Decision

Remove `device_fingerprint` from the Inspection entity. Remove "device fingerprint logged"
from the threat model; the stolen-token threat is covered by short token lifetime and
token-derived identity (ADR 0007).

If forensic visibility is wanted later, capture request IP and User-Agent at token validation
in ephemeral Azure Monitor access logs (ADR 0003), with short retention, never on the immutable
Inspection record. This is a follow-up, not part of this decision's required work.

## Consequences

Positive: no un-needed PII on the immutable, seven-year, audit-sealed record; the FOIP
inventory stays accurate; nothing relies on a control that did not work.

Negative: no per-inspection device trail. This is acceptable: the trail was forensic-only,
spoofable, and the access-log follow-up covers the real need without the privacy liability.

A future engineer may propose adding device fingerprinting "for security". This ADR records
why it was removed so it is not re-introduced onto the inspection record. Device or session
forensics, if needed, go to ephemeral access logs.
