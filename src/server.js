require('dotenv').config();
const express = require('express');
const path = require('path');
const { runAudit } = require('./index');
const { runSiteAudit } = require('./crawler');
const storage = require('./utils/storage');
const { compareRuns } = require('./utils/delta');
const { generateInsight } = require('./utils/ai-insights');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
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
        // Send result via SSE without heavy screenshot base64
        const { screenshot, ...resultLite } = result;
        broadcast('result', { index: i, result: { ...resultLite, hasScreenshot: !!screenshot } });

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

app.get('/api/projects/:id/history/:historyId', async (req, res) => {
  const data = await storage.getHistoryItem(req.params.id, req.params.historyId);
  if (!data) return res.status(404).json({ error: "History item not found" });
  res.json(data);
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
app.post('/api/projects/:id/history/:runId/insight', async (req, res) => {
  try {
    const historyData = await storage.getHistoryItem(req.params.id, req.params.runId);
    if (!historyData) return res.status(404).json({error: "History not found"});
    
    // Check if we already have a cached insight
    if (historyData.aiInsight) {
      return res.json({ html: historyData.aiInsight, cached: true });
    }
    
    // Check if API key is provided
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ error: "Missing API Key: Lütfen .env dosyasına GEMINI_API_KEY ekleyin." });
    }
    
    const htmlReport = await generateInsight(historyData);
    
    // Save to cache
    await storage.updateHistoryItem(req.params.id, req.params.runId, { aiInsight: htmlReport });
    
    res.json({ html: htmlReport, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AD-HOC AI INSIGHT ───
app.post('/api/adhoc/insight', async (req, res) => {
  try {
    const { results: adhocResults } = req.body;
    if (!adhocResults || !Array.isArray(adhocResults) || adhocResults.length === 0) {
      return res.status(400).json({ error: "Analiz için sonuç verisi gerekli." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ error: "Missing API Key: Lütfen .env dosyasına GEMINI_API_KEY ekleyin." });
    }

    const htmlReport = await generateInsight({ results: adhocResults });
    res.json({ html: htmlReport });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        // Send result via SSE without heavy screenshot base64
        const { screenshot, ...resultLite } = result;
        broadcast('result', { index: i, result: { ...resultLite, hasScreenshot: !!screenshot } });
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
  // Exclude heavy screenshot data from state endpoint
  const lite = {
    ...auditState,
    results: auditState.results.map(r => {
      const { screenshot, ...rest } = r;
      return { ...rest, hasScreenshot: !!screenshot };
    })
  };
  res.json(lite);
});

// Serve screenshot for a specific result by index
app.get('/api/screenshot/:index', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const result = auditState.results[idx];
  if (!result?.screenshot) return res.status(404).json({ error: 'Screenshot not found' });
  const buf = Buffer.from(result.screenshot, 'base64');
  res.set({ 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=300' });
  res.send(buf);
});

// Serve screenshot from project history
app.get('/api/projects/:pId/history/:runId/screenshot/:index', async (req, res) => {
  const { pId, runId, index } = req.params;
  const ssPath = path.join(__dirname, '..', 'data', 'history', pId, `${runId}_ss_${index}.jpg`);
  try {
    await require('fs').promises.access(ssPath);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' });
    require('fs').createReadStream(ssPath).pipe(res);
  } catch {
    res.status(404).json({ error: 'Screenshot not found' });
  }
});

// Get results
app.get('/api/results', (req, res) => {
  res.json(auditState.results);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Seosware Dashboard: http://localhost:${PORT}\n`);
});
