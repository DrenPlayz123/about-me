const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const rootIndexPath = path.join(__dirname, 'index.html');

let nextAnonymousNumber = 1;
const clients = new Set();
const identities = new Map();

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const client of clients) {
    sendEvent(client, event, data);
  }
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end();
    } else {
      serveFile(res, rootIndexPath, 'text/html; charset=utf-8');
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const username = `Anonymous${nextAnonymousNumber++}`;
    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    clients.add(res);
    identities.set(clientId, username);

    sendEvent(res, 'identity', { username, clientId });
    broadcast('system', { message: `${username} joined the chat.` });

    req.on('close', () => {
      clients.delete(res);
      identities.delete(clientId);
      broadcast('system', { message: `${username} left the chat.` });
    });

    return;
  }

  if (req.method === 'POST' && url.pathname === '/message') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        req.socket.destroy();
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const clientId = (parsed.clientId || '').trim();
        const message = (parsed.message || '').trim();
        const username = identities.get(clientId);

        if (!username || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Valid client session and message are required.' }));
          return;
        }

        broadcast('chat', { username, message });
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid JSON.' }));
      }
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Anonymous global chatroom listening on http://localhost:${PORT}`);
});
