import { useAzureMonitor } from '@azure/monitor-opentelemetry';

if (process.env['APPLICATIONINSIGHTS_CONNECTION_STRING']) {
  useAzureMonitor();
}
