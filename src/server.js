const express = require('express');
const path = require('path');
const { runAudit } = require('./index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// Store active audit state
let auditState = {
  running: false,
  results: [],
  progress: { current: 0, total: 0, url: '', phase: '' }
};

// SSE clients
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Start audit
app.post('/api/audit', async (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URL listesi gerekli' });
  }

  if (auditState.running) {
    return res.status(409).json({ error: 'Bir audit zaten çalışıyor' });
  }

  auditState.running = true;
  auditState.results = [];
  auditState.progress = { current: 0, total: urls.length, url: '', phase: 'starting' };

  res.json({ status: 'started', total: urls.length });

  // Run audits asynchronously
  (async () => {
    for (let i = 0; i < urls.length; i++) {
      let url = urls[i].trim();
      if (!url) continue;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      auditState.progress = { current: i + 1, total: urls.length, url, phase: 'auditing' };
      broadcast('progress', auditState.progress);

      try {
        // Override console.log to capture progress
        const origLog = console.log;
        console.log = (...args) => {
          origLog(...args);
          const msg = args.join(' ');
          broadcast('log', { message: msg, url });
        };

        const result = await runAudit(url, { timeout: 30000 });
        auditState.results.push(result);
        broadcast('result', { index: i, result });

        console.log = origLog;
      } catch (err) {
        auditState.results.push({ url, error: err.message });
        broadcast('result', { index: i, result: { url, error: err.message } });
      }
    }

    auditState.running = false;
    auditState.progress.phase = 'completed';
    broadcast('completed', { total: auditState.results.length });
  })();
});

// Get current state
app.get('/api/state', (req, res) => {
  res.json(auditState);
});

// Get results
app.get('/api/results', (req, res) => {
  res.json(auditState.results);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Seosware Dashboard: http://localhost:${PORT}\n`);
});
