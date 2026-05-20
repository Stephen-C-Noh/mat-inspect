'use strict';

const http = require('http');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const APP = process.env.APP_NAME ?? 'app';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAT-Inspect</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem 3rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
    h1 { margin: 0 0 0.5rem; color: #1a1a1a; }
    p { margin: 0; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello, MAT-Inspect</h1>
    <p>${APP} stub -- replace with real app in Sprint 0</p>
  </div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  // nosemgrep: using-http-server
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

server.listen(PORT, () => {
  process.stdout.write(`${APP} listening on port ${PORT}\n`);
});
