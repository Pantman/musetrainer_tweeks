import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';

const host = process.env.MUSE_DEBUG_RELAY_HOST || '127.0.0.1';
const port = Number(process.env.MUSE_DEBUG_RELAY_PORT || '4310');
const logPath = resolve(
  process.env.MUSE_DEBUG_RELAY_FILE || '/tmp/musetrainer-debug.ndjson'
);

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, '', 'utf8');

function writeJsonLine(entry) {
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  if (!req.url) {
    sendJson(res, 400, { ok: false, error: 'missing url' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, logPath, port, host });
    return;
  }

  if (req.method === 'POST' && req.url === '/clear') {
    writeFileSync(logPath, '', 'utf8');
    sendJson(res, 200, { ok: true, logPath });
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const payload = raw ? JSON.parse(raw) : {};
        writeJsonLine({
          receivedAt: new Date().toISOString(),
          ...payload,
        });
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(port, host, () => {
  console.log(
    `[muse-debug-relay] listening on http://${host}:${port} -> ${logPath}`
  );
});

const shutdown = () => {
  server.close(() => {
    console.log('[muse-debug-relay] stopped');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
