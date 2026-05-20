# ADR 0002: Azure AD / Entra ID for Authentication

Date: 2026-05-20
Status: Accepted

## Context

MAT-Inspect is used exclusively by SAIT staff: lab technicians, instructors, and
administrators. Every user already has a SAIT account backed by Azure AD / Entra ID.
SAIT IT is providing Azure resources for hosting.

The original architecture specified Keycloak 25.x as the identity provider. Keycloak
is a full identity broker that makes sense when the project owns its own user
directory or needs to federate multiple upstream providers. Neither condition applies
here: there is one upstream (SAIT Entra ID) and no external or anonymous users.

## Decision

Replace Keycloak with Azure AD / Entra ID as the sole identity provider.

Services validate JWTs by verifying the signature against the Entra ID JWKS endpoint
(`https://login.microsoftonline.com/{tenant-id}/discovery/v2.0/keys`). The shared
`verifyToken` middleware handles this. No service performs per-endpoint JWT parsing.

Roles (operator, lab-tech, manager, admin) are defined as App Roles on the Entra ID
app registration. The role claim arrives in the token; `requireRole` reads it from
`req.user.roles` as before. SAIT IT assigns roles to users or groups via the Azure
portal.

For local development, a lightweight JWT stub (a local JWKS server that signs tokens
with a dev key) replaces the Entra ID endpoint. The stub is dev-only and not shipped
to staging or production.

## Consequences

Positive: no Keycloak container to operate or patch; staff log in with the credentials
they already use for SAIT systems (no separate password); role assignment is delegated
to SAIT IT via the Azure portal, which is within their existing workflow; fewer
containers reduces hosting cost and operational surface.

Negative: local development requires a JWT stub or a real Entra ID dev tenant; role
changes must go through the Azure portal rather than a config file in the repo; the
team must coordinate with SAIT IT to configure the app registration and assign roles
before testing against a real tenant.

## Alternatives Considered

Keycloak federating to Entra ID: Keycloak acts as a broker, forwarding logins to
Entra ID via OIDC. Rejected because it adds an extra layer with no benefit when
there is only one upstream provider and no need for Keycloak-specific features
(custom flows, fine-grained authorization policies, etc.).

Keep Keycloak with local user store: rejected because it requires a parallel identity
system alongside SAIT Entra ID, creates password sync problems, and adds operational
burden that SAIT IT would inherit at handover.
