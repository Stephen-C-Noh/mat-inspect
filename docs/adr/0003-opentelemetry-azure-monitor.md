# ADR 0003: Azure Monitor OpenTelemetry Distro for Observability

Date: 2026-05-29
Status: Accepted

## Context

The original architecture specified a self-hosted observability stack: Prometheus and
Grafana for metrics, Loki and Promtail for log aggregation, and Uptime Kuma for uptime
checks. These run as Docker Compose services alongside the application.

The primary goal of MAT-Inspect is to hand the system over to SAIT IT at the end of the
capstone. SAIT IT already operates an Azure tenant. Handing over a system that requires
them to operate Prometheus, Grafana, Loki, Promtail, and Uptime Kuma containers adds
maintenance burden for tools they did not choose and may not be familiar with. This
reduces the likelihood of adoption.

Azure Monitor (with Log Analytics Workspace) is an Azure-native service that SAIT IT
already manages as part of their tenant. It covers metrics, logs, and availability
checks without any additional containers to operate.

Both dev and prod use Azure Monitor: dev points at a workspace provisioned under the
team's Azure subscription; prod points at the SAIT IT workspace. The only difference
between environments is the connection string.

## Decision

Replace the self-hosted observability stack with the Azure Monitor OpenTelemetry Distro,
instrumented directly in each service. No OTel Collector container is used.

Microsoft ships an official OTel-based distro for both languages in this stack:

- Node.js: `@azure/monitor-opentelemetry`
- Python: `azure-monitor-opentelemetry`

These packages use the OpenTelemetry SDK internally (vendor-neutral instrumentation) and
export directly to Azure Monitor via the `APPLICATIONINSIGHTS_CONNECTION_STRING`
environment variable. No intermediate Collector container is required.

At handover, SAIT IT changes one environment variable to point at their own workspace.
No application code changes, no container config changes.

No Prometheus, Grafana, Loki, Promtail, or Uptime Kuma containers are included in any
environment. Azure Monitor Availability Tests replace Uptime Kuma for HTTP ping checks.

OpenTelemetry graduated as a CNCF project in May 2026 and passed an independent
third-party security audit as part of that graduation. The SDKs are actively maintained
with releases current as of the capstone start date.

## Consequences

Positive: SAIT IT inherits a system already running in Azure Monitor; handover requires
changing one environment variable; no extra containers to operate or migrate; removes
approximately 1.0 GB of container RAM from the memory budget; instrumentation uses
OTel-standard APIs so it is not locked to Azure Monitor if SAIT IT later changes
backends; Azure Monitor is the telemetry standard Microsoft recommends for containerized
Azure workloads.

Negative: dev environment requires an Azure Monitor workspace and connection string from
day one; Azure Monitor Log Analytics is billed per GB ingested (negligible at this
app's log volume but not zero); Grafana dashboards must be rebuilt as Azure Monitor
workbooks.

## Alternatives Considered

Self-hosted stack (Prometheus, Grafana, Loki, Promtail, Uptime Kuma): original
architecture. Rejected because SAIT IT would inherit containers outside their existing
Azure-native tooling, reducing adoption likelihood.

OTel Collector as middleware (Collector routes to dev workspace or SAIT IT workspace):
rejected because both environments use Azure Monitor and the only change between them is
the connection string. A Collector adds an extra container and config surface with no
benefit when the backend is the same type in both environments.
