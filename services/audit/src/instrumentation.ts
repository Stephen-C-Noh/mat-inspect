import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { loadConfigOrExit } from './lib/config.js';

// First thing the process runs (server.ts imports this before any app module). Validate the
// whole environment and fail fast with a clear, var-named message before anything reads a
// half-configured value (ADR 0015, mirrors core-api's instrumentation.ts).
const cfg = loadConfigOrExit();
if (cfg.telemetryEnabled) {
  useAzureMonitor();
}
