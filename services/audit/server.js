'use strict';

// Validate the telemetry connection string before initializing Azure Monitor. A real
// connection string always contains "InstrumentationKey="; a value copied from .env.example
// (REPLACE_ME) is truthy but makes useAzureMonitor throw an opaque "No instrumentation key"
// error that crashes the service on boot. Fail fast with a clear, var-named message instead.
// See ADR 0015 (core-api carries the full Zod version of this check).
const conn = (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? '').trim();
const abort = (msg) => {
  process.stderr.write(`[${process.env.OTEL_SERVICE_NAME ?? 'service'}] boot aborted: ${msg}\n`);
  process.exit(1);
};
if (conn && !conn.includes('InstrumentationKey=')) {
  abort(
    'APPLICATIONINSIGHTS_CONNECTION_STRING is set but is not a valid connection string ' +
      '(must contain "InstrumentationKey="); fix it or leave it blank',
  );
}
if (!conn && process.env.NODE_ENV !== 'test') {
  abort('APPLICATIONINSIGHTS_CONNECTION_STRING is required (only NODE_ENV=test may omit it)');
}
if (conn) {
  const { useAzureMonitor } = require('@azure/monitor-opentelemetry');
  useAzureMonitor();
}

const http = require('http');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const SERVICE = process.env.OTEL_SERVICE_NAME ?? 'service';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: SERVICE }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  process.stdout.write(`${SERVICE} listening on port ${PORT}\n`);
});
