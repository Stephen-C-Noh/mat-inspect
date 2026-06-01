'use strict';

if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
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
