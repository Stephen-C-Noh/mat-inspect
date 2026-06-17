import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { loadConfigOrExit } from './lib/config.js';

// First thing the process runs (server.ts imports this before any app module). Validate the
// whole environment and fail fast with a clear, var-named message before anything reads a
// half-configured value. Azure Monitor is initialized here, ahead of app modules, so its
// auto-instrumentation can patch them. A placeholder connection string no longer reaches
// useAzureMonitor: config rejects it at boot. See ADR 0015.
const cfg = loadConfigOrExit();
if (cfg.telemetryEnabled) {
  useAzureMonitor();
}
