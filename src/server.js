const express = require('express');
const path = require('path');
const { runAudit } = require('./index');
const { runSiteAudit } = require('./crawler');
const storage = require('./utils/storage');
const { compareRuns } = require('./utils/delta');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

let auditState = {
  running: false,
  cancelled: false,
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
  auditState.cancelled = false;
  auditState.results = [];
  auditState.progress = { current: 0, total: urls.length, url: '', phase: 'starting' };

  res.json({ status: 'started', total: urls.length });

  // Run audits asynchronously
  (async () => {
    for (let i = 0; i < urls.length; i++) {
      if (auditState.cancelled) {
        broadcast('log', { message: '[\u26A0\ufe0f] Audit kullanıcı tarafından iptal edildi.', url: 'İptal Edildi' });
        break;
      }
      
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

// Start site-wide audit
app.post('/api/site-audit', async (req, res) => {
  const { url, maxPages, maxDepth } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL gerekli' });
  }

  if (auditState.running) {
    return res.status(409).json({ error: 'Bir audit zaten çalışıyor' });
  }

  auditState.running = true;
  auditState.cancelled = false;
  auditState.results = [];
  auditState.progress = { current: 0, total: 1, url, phase: 'starting' };

  res.json({ status: 'started' });

  // Run async
  (async () => {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const origLog = console.log;
      console.log = (...args) => {
        origLog(...args);
        const msg = args.join(' ');
        broadcast('log', { message: msg, url: cleanUrl });
      };

      const result = await runSiteAudit(cleanUrl, maxPages || 20, maxDepth || 3, { 
        isCancelled: () => auditState.cancelled 
      });
      auditState.results = [{
        url: cleanUrl,
        type: 'site-audit',
        timestamp: new Date().toISOString(),
        siteAudit: result
      }];
      broadcast('result', { index: 0, result: auditState.results[0] });

      console.log = origLog;
    } catch (err) {
      auditState.results = [{ url: cleanUrl, type: 'site-audit', error: err.message }];
      broadcast('result', { index: 0, result: auditState.results[0] });
    }

    auditState.running = false;
    auditState.progress.phase = 'completed';
    broadcast('completed', { total: 1 });
  })();
});

// ======== PROJECT & HISTORY APIs ========

app.get('/api/projects', async (req, res) => {
  const projects = await storage.getProjects();
  res.json(projects);
});

app.post('/api/projects', async (req, res) => {
  const p = await storage.saveProject(req.body);
  res.json(p);
});

app.delete('/api/projects/:id', async (req, res) => {
  const success = await storage.deleteProject(req.params.id);
  res.json({ success });
});

app.get('/api/projects/:id/history', async (req, res) => {
  const list = await storage.getHistoryList(req.params.id);
  res.json(list);
});

app.get('/api/projects/:id/delta', async (req, res) => {
  const { runA, runB } = req.query; // IDs matching history filename
  if(!runA || !runB) return res.status(400).json({error: "runA and runB params needed"});
  
  const hA = await storage.getHistoryItem(req.params.id, runA);
  const hB = await storage.getHistoryItem(req.params.id, runB);
  
  if(!hA || !hB) return res.status(404).json({error: "History items not found"});
  
  const deltas = compareRuns(hA.results, hB.results);
  res.json(deltas);
});

app.post('/api/projects/:id/run', async (req, res) => {
  const pId = req.params.id;
  const project = await storage.getProject(pId);
  if (!project) return res.status(404).json({ error: 'Proje bulunamadı' });
  if (auditState.running) return res.status(409).json({ error: 'Sistem meşgul' });

  const urls = project.urls;
  if (!urls || urls.length === 0) return res.status(400).json({ error: 'Projede URL yok' });

  auditState.running = true;
  auditState.cancelled = false;
  auditState.results = [];
  auditState.progress = { current: 0, total: urls.length, url: '', phase: 'starting' };

  res.json({ status: 'started', total: urls.length });

  (async () => {
    for (let i = 0; i < urls.length; i++) {
      if (auditState.cancelled) {
        broadcast('log', { message: '[\u26A0\ufe0f] Proje taraması iptal edildi.', url: 'İptal' });
        break;
      }
      let url = urls[i].trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
      
      auditState.progress = { current: i + 1, total: urls.length, url, phase: 'auditing' };
      broadcast('progress', auditState.progress);

      try {
        const origLog = console.log;
        console.log = (...args) => {
          origLog(...args);
          broadcast('log', { message: args.join(' '), url });
        };
        const result = await runAudit(url, { timeout: 30000 });
        auditState.results.push(result);
        broadcast('result', { index: i, result });
        console.log = origLog;
      } catch (err) {
        const errResult = { url, error: err.message };
        auditState.results.push(errResult);
        broadcast('result', { index: i, result: errResult });
      }
    }
    
    // Save to history only if we completed or partially completed
    if (auditState.results.length > 0) {
      await storage.saveHistory(pId, auditState.results);
      broadcast('log', { message: '[\u2714\ufe0f] Proje geçmişi başarıyla kaydedildi.', url: 'Kayıt' });
    }

    auditState.running = false;
    auditState.progress.phase = 'completed';
    broadcast('completed', { total: auditState.results.length });
  })();
});

// Cancel active audit
app.post('/api/cancel', (req, res) => {
  if (auditState.running) {
    auditState.cancelled = true;
    res.json({ status: 'cancelling' });
  } else {
    res.json({ status: 'not_running' });
  }
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
