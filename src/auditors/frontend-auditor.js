/**
 * frontend-auditor.js
 * YellowLab Tools benzeri kapsamlı frontend kalite analizi.
 * CDP (Chrome DevTools Protocol) ile derinlemesine ölçüm yapar.
 *
 * Kategoriler:
 *   1. Page Weight
 *   2. Requests
 *   3. DOM Complexity
 *   4. JS Complexity
 *   5. Bad JS
 *   6. CSS Complexity
 *   7. Bad CSS
 *   8. Server Config
 *   + Web Fonts (bonus)
 */

// ─── Thresholds ──────────────────────────────────────────────────────────────
const THRESHOLDS = {
  pageWeight: {
    totalKb: { good: 1000, bad: 3000 },         // KB
    totalRequests: { good: 50, bad: 150 },
    imageKb: { good: 500, bad: 2000 },
    jsKb: { good: 300, bad: 1000 },
    cssKb: { good: 100, bad: 500 },
  },
  requests: {
    total: { good: 50, bad: 150 },
    domains: { good: 5, bad: 15 },
    notFound: { good: 0, bad: 1 },
    empty: { good: 0, bad: 5 },
    belowFold: { good: 0, bad: 10 },
    hidden: { good: 0, bad: 3 },
    identical: { good: 0, bad: 3 },
  },
  dom: {
    elements: { good: 400, bad: 1500 },
    depth: { good: 10, bad: 25 },
    iframes: { good: 0, bad: 3 },
    dupIds: { good: 0, bad: 1 },
  },
  jsComplexity: {
    execTimeMs: { good: 500, bad: 3000 },
    domAccess: { good: 300, bad: 1500 },
    scrollListeners: { good: 2, bad: 10 },
    globals: { good: 30, bad: 100 },
  },
  badJs: {
    errors: { good: 0, bad: 2 },
    docWrite: { good: 0, bad: 1 },
    syncXhr: { good: 0, bad: 1 },
    consoleWarnings: { good: 0, bad: 5 },
  },
  cssComplexity: {
    rules: { good: 500, bad: 2000 },
    complexSelectors: { good: 50, bad: 500 },
    colors: { good: 30, bad: 100 },
    similarColors: { good: 0, bad: 10 },
    breakpoints: { good: 5, bad: 15 },
    notMobileFirst: { good: 0, bad: 50 },
  },
  badCss: {
    syntaxErrors: { good: 0, bad: 2 },
    atImport: { good: 0, bad: 1 },
    dupSelectors: { good: 5, bad: 30 },
    dupProperties: { good: 5, bad: 50 },
    emptyRules: { good: 0, bad: 10 },
    important: { good: 5, bad: 50 },
    oldPrefixes: { good: 0, bad: 20 },
    redundantBody: { good: 0, bad: 5 },
  },
  serverConfig: {
    http1Resources: { good: 0, bad: 10 },
    noCacheResources: { good: 0, bad: 5 },
    cachingDisabled: { good: 0, bad: 3 },
    cachingTooShort: { good: 0, bad: 20 },
  },
  webFonts: {
    count: { good: 2, bad: 6 },
    totalKb: { good: 100, bad: 500 },
    notWoff2: { good: 0, bad: 2 },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  if (score >= 20) return 'E';
  return 'F';
}

/**
 * Lineer interpolasyon ile 0-100 arası puan hesapla.
 * val <= good => 100, val >= bad => 0
 */
function scoreMetric(val, good, bad) {
  if (val <= good) return 100;
  if (val >= bad) return 0;
  return Math.round(100 - ((val - good) / (bad - good)) * 100);
}

function hexColorDistance(h1, h2) {
  const parse = (h) => {
    const hex = h.replace('#', '');
    if (hex.length === 3) {
      return [parseInt(hex[0]+hex[0],16), parseInt(hex[1]+hex[1],16), parseInt(hex[2]+hex[2],16)];
    }
    return [parseInt(hex.substr(0,2),16), parseInt(hex.substr(2,2),16), parseInt(hex.substr(4,2),16)];
  };
  try {
    const [r1,g1,b1] = parse(h1);
    const [r2,g2,b2] = parse(h2);
    return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
  } catch {
    return 999;
  }
}

function buildCategory(score, metrics, details = [], extra = {}) {
  return { score, grade: calcGrade(score), metrics, details, ...extra };
}

// CDP type (Script, Stylesheet, Image, Font, XHR, Fetch, Document, Other) -> internal type (js, css, image, font, other)
function inferTypeFromUrl(resourceUrl) {
  if (!resourceUrl || typeof resourceUrl !== 'string') return null;
  try {
    const pathname = new URL(resourceUrl).pathname.toLowerCase();
    if (/\.(mjs|cjs|js)$/.test(pathname)) return 'js';
    if (/\.css$/.test(pathname)) return 'css';
    if (/\.(avif|webp|png|jpe?g|gif|svg|ico|bmp|tiff?)$/.test(pathname)) return 'image';
    if (/\.(woff2?|ttf|otf|eot)$/.test(pathname)) return 'font';
  } catch {}
  return null;
}

function normalizeResourceType(cdpType, contentType, resourceUrl) {
  const t = (cdpType || '').toLowerCase();
  // CDP type first
  if (t === 'script') return 'js';
  if (t === 'stylesheet') return 'css';
  if (t === 'image' || t === 'media') return 'image';
  if (t === 'font') return 'font';
  if (t === 'document') return 'document';
  if (t === 'xhr' || t === 'fetch') return 'xhr';
  // Fallback: check content-type header
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('javascript') || ct.includes('ecmascript')) return 'js';
  if (ct.includes('css')) return 'css';
  if (ct.includes('image/')) return 'image';
  if (ct.includes('font') || ct.includes('woff')) return 'font';

  // Last resort: infer from URL extension.
  const inferred = inferTypeFromUrl(resourceUrl);
  if (inferred) return inferred;

  return 'other';
}

// ─── Category Auditors ────────────────────────────────────────────────────────

async function auditPageWeight(cdp, networkData, page) {
  const resources = networkData.resources;
  const typeStats = networkData.typeStats || {};

  const byType = {
    js:    { kb: 0, count: 0 },
    css:   { kb: 0, count: 0 },
    image: { kb: 0, count: 0 },
    font:  { kb: 0, count: 0 },
    other: { kb: 0, count: 0 },
  };

  let totalBytes = 0;
  let uncompressedJs = [];
  let uncompressedCss = [];
  let oversizedImages = [];
  let minificationSavings = 0;

  resources.forEach(r => {
    totalBytes += r.transferSize || 0;
    const kb = (r.transferSize || 0) / 1024;
    let key = r.type || 'other';
    // Keep page weight buckets stable even when upstream emits non-asset types.
    if (!['js', 'css', 'image', 'font', 'other'].includes(key)) key = 'other';
    if (byType[key]) { byType[key].kb += kb; byType[key].count++; }
    else { byType.other.kb += kb; byType.other.count++; }

    // Gzip/Brotli kontrolü
    const encoding = (r.headers?.['content-encoding'] || '').toLowerCase();
    const hasCompression = encoding.includes('gzip') || encoding.includes('br') || encoding.includes('deflate');
    if (!hasCompression && kb > 5) {
      if (r.type === 'js')  uncompressedJs.push({ url: r.url, sizeKb: Math.round(kb) });
      if (r.type === 'css') uncompressedCss.push({ url: r.url, sizeKb: Math.round(kb) });
    }

    // Oversized images (naturalWidth vs viewport width)
    if (r.type === 'image' && r.naturalWidth && r.displayWidth) {
      if (r.naturalWidth > r.displayWidth * 2 && r.transferSize > 20000) {
        oversizedImages.push({
          url: r.url,
          naturalWidth: r.naturalWidth,
          displayWidth: r.displayWidth,
          sizeKb: Math.round(kb),
        });
      }
    }

    // JS/CSS minification check (whitespace ratio – rough estimate via content)
    if ((r.type === 'js' || r.type === 'css') && r.responseBody) {
      const content = r.responseBody;
      const wsCount = (content.match(/\s+/g) || []).reduce((s,m) => s + m.length, 0);
      const wsRatio = wsCount / content.length;
      if (wsRatio > 0.3) {
        minificationSavings += Math.round((r.transferSize || 0) * wsRatio / 1024);
      }
    }
  });

  const totalKb = Math.round(totalBytes / 1024);

  const metrics = {
    totalKb,
    jsKb:    Math.round(byType.js.kb),
    cssKb:   Math.round(byType.css.kb),
    imageKb: Math.round(byType.image.kb),
    fontKb:  Math.round(byType.font.kb),
    otherKb: Math.round(byType.other.kb),
    otherCount: byType.other.count,
    jsCount:    byType.js.count,
    cssCount:   byType.css.count,
    imageCount: byType.image.count,
    fontCount:  byType.font.count,
    unknownTypeCount: typeStats.other || 0,
    unknownTypeRate: resources.length > 0 ? Math.round(((typeStats.other || 0) / resources.length) * 100) : 0,
    oversizedImages: oversizedImages.length,
    uncompressedCount: uncompressedJs.length + uncompressedCss.length,
    uncompressedKb: [...uncompressedJs, ...uncompressedCss].reduce((s,r) => s+r.sizeKb, 0),
    minificationSavingsKb: minificationSavings,
  };

  // Score
  const s1 = scoreMetric(totalKb, THRESHOLDS.pageWeight.totalKb.good, THRESHOLDS.pageWeight.totalKb.bad);
  const s2 = scoreMetric(metrics.imageKb, THRESHOLDS.pageWeight.imageKb.good, THRESHOLDS.pageWeight.imageKb.bad);
  const s3 = scoreMetric(oversizedImages.length, 0, 5) ;
  const s4 = scoreMetric(metrics.uncompressedKb, 0, 500);
  const s5 = scoreMetric(minificationSavings, 0, 200);
  const score = Math.round((s1*2 + s2 + s3 + s4 + s5) / 6);

  const scoreBreakdown = [
    { label: 'Toplam Ağırlık', value: totalKb, suffix: ' KB', good: THRESHOLDS.pageWeight.totalKb.good, bad: THRESHOLDS.pageWeight.totalKb.bad, score: s1, weight: 2 },
    { label: 'Görsel Ağırlığı', value: metrics.imageKb, suffix: ' KB', good: THRESHOLDS.pageWeight.imageKb.good, bad: THRESHOLDS.pageWeight.imageKb.bad, score: s2, weight: 1 },
    { label: 'Büyük Görseller', value: oversizedImages.length, suffix: '', good: 0, bad: 5, score: s3, weight: 1 },
    { label: 'Sıkıştırılmamış Kaynak', value: metrics.uncompressedKb, suffix: ' KB', good: 0, bad: 500, score: s4, weight: 1 },
    { label: 'Minification Tasarrufu', value: minificationSavings, suffix: ' KB', good: 0, bad: 200, score: s5, weight: 1 },
  ];

  const details = [
    ...oversizedImages.map(i => ({ type: 'oversized-image', ...i })),
    ...uncompressedJs.map(r => ({ type: 'uncompressed-js', ...r })),
    ...uncompressedCss.map(r => ({ type: 'uncompressed-css', ...r })),
  ];

  // Resource list grouped by type for frontend drill-down (top 50 per type, sorted by size desc)
  const resourceList = {};
  ['js', 'css', 'image', 'font', 'other'].forEach(t => {
    resourceList[t] = resources
      .filter(r => r.type === t && r.transferSize > 0)
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      .slice(0, 50)
      .map(r => ({ url: r.url, sizeKb: Math.round((r.transferSize || 0) / 1024) }));
  });

  return buildCategory(score, metrics, details, { resourceList, scoreBreakdown });
}

async function auditRequests(networkData) {
  const resources = networkData.resources;
  const originUrl = networkData.originUrl;
  const originHost = (() => { try { return new URL(originUrl).hostname; } catch { return null; } })();

  const totalRequests = resources.length;
  const domainSet = new Set();
  const thirdPartyDomains = new Set();
  const notFound = [];
  const emptyRequests = [];
  const identicalMap = new Map();

  resources.forEach(r => {
    try {
      const h = new URL(r.url).hostname;
      domainSet.add(h);
      if (originHost && !h.endsWith(originHost) && !originHost.endsWith(h)) {
        thirdPartyDomains.add(h);
      }
    } catch {}

    if (r.status === 404) notFound.push({ url: r.url });
    if ((r.transferSize || 0) === 0 && r.status !== 204) emptyRequests.push({ url: r.url, status: r.status });

    const key = r.bodyHash || null;
    if (key) {
      if (!identicalMap.has(key)) identicalMap.set(key, []);
      identicalMap.get(key).push(r.url);
    }
  });

  const identicalGroups = [...identicalMap.values()].filter(g => g.length > 1);

  // Below-the-fold images laziness
  const belowFold = resources.filter(r => r.type === 'image' && r.isBelowFold && !r.hasLazyLoad);
  const hiddenImages = resources.filter(r => r.type === 'image' && r.isHidden);

  const metrics = {
    totalRequests,
    domains: domainSet.size,
    thirdPartyDomains: thirdPartyDomains.size,
    thirdPartyList: [...thirdPartyDomains].slice(0, 20),
    notFound: notFound.length,
    emptyRequests: emptyRequests.length,
    identicalContent: identicalGroups.length,
    belowFoldImages: belowFold.length,
    hiddenImages: hiddenImages.length,
  };

  const scores = [
    scoreMetric(totalRequests, THRESHOLDS.requests.total.good, THRESHOLDS.requests.total.bad),
    scoreMetric(domainSet.size, THRESHOLDS.requests.domains.good, THRESHOLDS.requests.domains.bad),
    notFound.length > 0 ? 0 : 100,
    scoreMetric(emptyRequests.length, THRESHOLDS.requests.empty.good, THRESHOLDS.requests.empty.bad),
    scoreMetric(belowFold.length, THRESHOLDS.requests.belowFold.good, THRESHOLDS.requests.belowFold.bad),
    scoreMetric(hiddenImages.length, THRESHOLDS.requests.hidden.good, THRESHOLDS.requests.hidden.bad),
    scoreMetric(identicalGroups.length, THRESHOLDS.requests.identical.good, THRESHOLDS.requests.identical.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'Toplam İstek', value: totalRequests, suffix: '', good: THRESHOLDS.requests.total.good, bad: THRESHOLDS.requests.total.bad, score: scores[0], weight: 1 },
    { label: 'Farklı Domain', value: domainSet.size, suffix: '', good: THRESHOLDS.requests.domains.good, bad: THRESHOLDS.requests.domains.bad, score: scores[1], weight: 1 },
    { label: '404 Hata', value: notFound.length, suffix: '', good: 0, bad: 1, score: scores[2], weight: 1 },
    { label: 'Boş İstek', value: emptyRequests.length, suffix: '', good: THRESHOLDS.requests.empty.good, bad: THRESHOLDS.requests.empty.bad, score: scores[3], weight: 1 },
    { label: 'Fold Altı Görsel', value: belowFold.length, suffix: '', good: THRESHOLDS.requests.belowFold.good, bad: THRESHOLDS.requests.belowFold.bad, score: scores[4], weight: 1 },
    { label: 'Gizli Görsel', value: hiddenImages.length, suffix: '', good: THRESHOLDS.requests.hidden.good, bad: THRESHOLDS.requests.hidden.bad, score: scores[5], weight: 1 },
    { label: 'Aynı İçerik', value: identicalGroups.length, suffix: '', good: THRESHOLDS.requests.identical.good, bad: THRESHOLDS.requests.identical.bad, score: scores[6], weight: 1 },
  ];

  const details = [
    ...notFound.map(r => ({ type: '404', url: r.url })),
    ...emptyRequests.map(r => ({ type: 'empty-request', url: r.url, status: r.status })),
    ...identicalGroups.map(g => ({ type: 'identical-content', urls: g })),
    ...belowFold.map(r => ({ type: 'below-fold-image', url: r.url })),
    ...hiddenImages.map(r => ({ type: 'hidden-image', url: r.url })),
  ];

  return buildCategory(score, metrics, details, { scoreBreakdown });
}

async function auditDOMComplexity(page) {
  const dom = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const totalElements = all.length;

    // Max depth
    let maxDepth = 0;
    all.forEach(el => {
      let depth = 0, node = el;
      while (node.parentElement) { depth++; node = node.parentElement; }
      if (depth > maxDepth) maxDepth = depth;
    });

    // IFrames
    const iframes = document.querySelectorAll('iframe').length;

    // Duplicated IDs
    const idMap = {};
    all.forEach(el => {
      if (el.id) idMap[el.id] = (idMap[el.id] || 0) + 1;
    });
    const dupIds = Object.entries(idMap).filter(([,c]) => c > 1).map(([id, count]) => ({ id, count }));

    // Heaviest nodes (most children)
    const heavyNodes = all
      .map(el => ({ tag: el.tagName.toLowerCase(), id: el.id || '', cls: el.className?.toString()?.slice(0,40) || '', children: el.childElementCount }))
      .sort((a,b) => b.children - a.children)
      .slice(0, 5);

    return { totalElements, maxDepth, iframes, dupIds, heavyNodes };
  });

  const metrics = {
    totalElements: dom.totalElements,
    maxDepth: dom.maxDepth,
    iframes: dom.iframes,
    duplicatedIds: dom.dupIds.length,
  };

  const scores = [
    scoreMetric(dom.totalElements, THRESHOLDS.dom.elements.good, THRESHOLDS.dom.elements.bad),
    scoreMetric(dom.maxDepth, THRESHOLDS.dom.depth.good, THRESHOLDS.dom.depth.bad),
    scoreMetric(dom.iframes, THRESHOLDS.dom.iframes.good, THRESHOLDS.dom.iframes.bad),
    dom.dupIds.length === 0 ? 100 : scoreMetric(dom.dupIds.length, 0, 5),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'DOM Elementleri', value: dom.totalElements, suffix: '', good: THRESHOLDS.dom.elements.good, bad: THRESHOLDS.dom.elements.bad, score: scores[0], weight: 1 },
    { label: 'Maks. Derinlik', value: dom.maxDepth, suffix: '', good: THRESHOLDS.dom.depth.good, bad: THRESHOLDS.dom.depth.bad, score: scores[1], weight: 1 },
    { label: 'iframe Sayısı', value: dom.iframes, suffix: '', good: THRESHOLDS.dom.iframes.good, bad: THRESHOLDS.dom.iframes.bad, score: scores[2], weight: 1 },
    { label: 'Tekrarlanan ID', value: dom.dupIds.length, suffix: '', good: 0, bad: 5, score: scores[3], weight: 1 },
  ];

  const details = [
    ...dom.dupIds.map(d => ({ type: 'duplicate-id', id: d.id, count: d.count })),
    ...dom.heavyNodes.map(n => ({ type: 'heavy-node', ...n })),
  ];

  return buildCategory(score, metrics, details, { scoreBreakdown });
}

async function auditJSComplexity(page, cdp, jsErrors, consoleWarnings) {
  // Collect page.evaluate-based metrics FIRST, before any CDP Profiler attempt.
  // The Profiler can crash the Chromium renderer on PWA/Service Worker pages,
  // and once crashed, page.evaluate never works again. So we grab what we can first.

  const safeEval = async (label, fn, fallback) => {
    try {
      const val = await Promise.race([
        page.evaluate(fn),
        new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), 5000)),
      ]);
      console.log(`[Frontend Auditor] safeEval OK: ${label} →`, JSON.stringify(val));
      return val;
    } catch (err) {
      console.warn(`[Frontend Auditor] safeEval FAIL: ${label} — ${err.message}`);
      return fallback;
    }
  };

  // ── 1. DOM access count (patched by addInitScript before reload) ──
  const domAccessCount = await safeEval('domAccess', () => window.__domAccessCount || 0, 0);

  // ── 2. Scroll listeners — only available in DevTools context, usually 0 ──
  const scrollListeners = await safeEval('scrollListeners', () => {
    try {
      if (typeof getEventListeners !== 'undefined') {
        return (getEventListeners(window)?.scroll || []).length;
      }
    } catch {}
    return 0;
  }, 0);

  // ── 3. Global variable count ──
  const { globalCount, globalNames } = await safeEval('globals',
    () => {
      const dg = new Set(['window','document','location','history','navigator','screen',
        'alert','confirm','prompt','console','performance','setTimeout','setInterval','clearTimeout',
        'clearInterval','fetch','XMLHttpRequest','WebSocket','Worker','Blob','File','FileReader',
        'URL','URLSearchParams','Event','CustomEvent','EventTarget','Node','Element','HTMLElement',
        'localStorage','sessionStorage','indexedDB','crypto','Intl','Math','Date','JSON','Object',
        'Array','String','Number','Boolean','Function','Symbol','Map','Set','WeakMap','WeakSet',
        'Promise','Proxy','Reflect','RegExp','Error','TypeError','RangeError','undefined','null',
        'NaN','Infinity','isNaN','isFinite','parseInt','parseFloat','encodeURIComponent',
        'decodeURIComponent','encodeURI','decodeURI','escape','unescape','eval','postMessage',
        'requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','queueMicrotask',
        'structuredClone','gc','globalThis','self','top','parent','frames','opener',
        'devicePixelRatio','innerWidth','innerHeight','outerWidth','outerHeight','pageXOffset',
        'pageYOffset','scrollX','scrollY','screenX','screenY','scrollTo','scrollBy','scroll',
        'resizeTo','resizeBy','moveTo','moveBy','open','close','stop','focus','blur','print',
        'origin','name','status','closed','length','frameElement','onload','onerror','onunload',
        'onbeforeunload','onhashchange','onpopstate','onmessage','onabort','onfocus','onblur',
        'onresize','onscroll','onoffline','ononline']);
      const globals = Object.keys(window).filter(k => !dg.has(k) && !k.startsWith('__') && typeof window[k] !== 'function');
      return { globalCount: globals.length, globalNames: globals.slice(0, 20) };
    },
    { globalCount: 0, globalNames: [] }
  );

  // ── 4. JS Execution time via PerformanceLongTaskTiming + scripting entries ──
  // We avoid CDP Profiler entirely — it crashes the Chromium renderer on PWA/SW pages.
  // Instead, sum up script-processing time from the Resource Timing API.
  let execTimeMs = await safeEval('execTime', () => {
    try {
      // Sum all script evaluation / long task durations
      let total = 0;
      // longtask entries (if PerformanceObserver buffered them)
      const longTasks = performance.getEntriesByType?.('longtask') || [];
      total += longTasks.reduce((s, e) => s + e.duration, 0);
      // If no longtask entries, fallback: sum script resource durations
      if (total === 0) {
        const scripts = performance.getEntriesByType('resource').filter(e => e.initiatorType === 'script');
        total = scripts.reduce((s, e) => s + e.duration, 0);
      }
      return Math.round(total);
    } catch { return 0; }
  }, 0);

  const metrics = {
    execTimeMs,
    domAccess: domAccessCount,
    scrollListeners,
    globalVariables: globalCount,
  };

  const scores = [
    scoreMetric(execTimeMs, THRESHOLDS.jsComplexity.execTimeMs.good, THRESHOLDS.jsComplexity.execTimeMs.bad),
    scoreMetric(domAccessCount, THRESHOLDS.jsComplexity.domAccess.good, THRESHOLDS.jsComplexity.domAccess.bad),
    scoreMetric(scrollListeners, THRESHOLDS.jsComplexity.scrollListeners.good, THRESHOLDS.jsComplexity.scrollListeners.bad),
    scoreMetric(globalCount, THRESHOLDS.jsComplexity.globals.good, THRESHOLDS.jsComplexity.globals.bad),
  ];
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'JS Exec Süresi', value: execTimeMs, suffix: ' ms', good: THRESHOLDS.jsComplexity.execTimeMs.good, bad: THRESHOLDS.jsComplexity.execTimeMs.bad, score: scores[0], weight: 1 },
    { label: 'DOM Erişim Sayısı', value: domAccessCount, suffix: '', good: THRESHOLDS.jsComplexity.domAccess.good, bad: THRESHOLDS.jsComplexity.domAccess.bad, score: scores[1], weight: 1 },
    { label: 'Scroll Listener', value: scrollListeners, suffix: '', good: THRESHOLDS.jsComplexity.scrollListeners.good, bad: THRESHOLDS.jsComplexity.scrollListeners.bad, score: scores[2], weight: 1 },
    { label: 'Global Değişken', value: globalCount, suffix: '', good: THRESHOLDS.jsComplexity.globals.good, bad: THRESHOLDS.jsComplexity.globals.bad, score: scores[3], weight: 1 },
  ];
  const details = globalNames.map(g => ({ type: 'global-var', name: g }));

  return buildCategory(score, metrics, details, { scoreBreakdown });
}

async function auditBadJS(page, jsErrors, consoleWarnings) {
  const badJs = await page.evaluate(() => {
    // document.write detection
    let docWriteCount = 0;
    try {
      const orig = document.write.toString();
      docWriteCount = window.__docWriteCount || 0;
    } catch {}

    // Synchronous XHR detection
    const syncXhrCount = window.__syncXhrCount || 0;

    return { docWriteCount, syncXhrCount };
  });

  const metrics = {
    jsErrors: jsErrors.length,
    documentWriteCalls: badJs.docWriteCount,
    syncXmlHttpRequests: badJs.syncXhrCount,
    consoleWarnings: consoleWarnings,
  };

  const scores = [
    scoreMetric(jsErrors.length, THRESHOLDS.badJs.errors.good, THRESHOLDS.badJs.errors.bad),
    badJs.docWriteCount > 0 ? 0 : 100,
    badJs.syncXhrCount > 0 ? 0 : 100,
    scoreMetric(consoleWarnings, THRESHOLDS.badJs.consoleWarnings.good, THRESHOLDS.badJs.consoleWarnings.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'JS Hataları', value: jsErrors.length, suffix: '', good: THRESHOLDS.badJs.errors.good, bad: THRESHOLDS.badJs.errors.bad, score: scores[0], weight: 1 },
    { label: 'document.write', value: badJs.docWriteCount, suffix: '', good: 0, bad: 1, score: scores[1], weight: 1 },
    { label: 'Sync XHR', value: badJs.syncXhrCount, suffix: '', good: 0, bad: 1, score: scores[2], weight: 1 },
    { label: 'Console Uyarısı', value: consoleWarnings, suffix: '', good: THRESHOLDS.badJs.consoleWarnings.good, bad: THRESHOLDS.badJs.consoleWarnings.bad, score: scores[3], weight: 1 },
  ];

  const details = [
    ...jsErrors.slice(0, 20).map(msg => ({ type: 'js-error', message: msg })),
    ...(badJs.docWriteCount > 0 ? [{ type: 'doc-write', count: badJs.docWriteCount }] : []),
    ...(badJs.syncXhrCount > 0 ? [{ type: 'sync-xhr', count: badJs.syncXhrCount }] : []),
  ];

  return buildCategory(score, metrics, details, { scoreBreakdown });
}

async function auditCSSComplexity(page) {
  const cssData = await page.evaluate(() => {
    const results = {
      totalRules: 0,
      complexSelectors: 0,
      complexSelectorExamples: [],
      allColors: new Set(),
      breakpoints: new Set(),
      breakpointValues: [],
      notMobileFirstCount: 0,
      notMobileFirstExamples: [],
    };

    const COLOR_RE = /#([0-9a-fA-F]{3,8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g;

    [...document.styleSheets].forEach(sheet => {
      let rules;
      try { rules = [...sheet.cssRules || []]; } catch { return; }

      rules.forEach(rule => {
        results.totalRules++;

        if (rule.selectorText) {
          // Complex selector: 3+ levels deep
          const parts = rule.selectorText.split(',').map(s => s.trim());
          parts.forEach(selector => {
            const depth = selector.split(/[\s>+~]+/).length;
            if (depth >= 3) {
              results.complexSelectors++;
              if (results.complexSelectorExamples.length < 50) {
                results.complexSelectorExamples.push(selector.slice(0, 100));
              }
            }
          });
        }

        if (rule.style) {
          const cssText = rule.style.cssText;
          const colorMatches = cssText.match(COLOR_RE) || [];
          colorMatches.forEach(c => results.allColors.add(c.toLowerCase()));
        }

        if (rule.conditionText) {
          const bp = rule.conditionText.match(/\d+px/);
          if (bp) {
            results.breakpoints.add(bp[0]);
            if (results.breakpointValues.length < 30) {
              results.breakpointValues.push(bp[0]);
            }
          }
          if (/max-width/.test(rule.conditionText)) {
            results.notMobileFirstCount++;
            if (results.notMobileFirstExamples.length < 20) {
              results.notMobileFirstExamples.push(rule.conditionText.slice(0, 120));
            }
          }
        }
      });
    });

    return {
      totalRules: results.totalRules,
      complexSelectors: results.complexSelectors,
      complexSelectorExamples: results.complexSelectorExamples,
      uniqueColors: results.allColors.size,
      allColors: [...results.allColors],
      breakpoints: results.breakpoints.size,
      breakpointValues: [...new Set(results.breakpointValues)],
      notMobileFirstCount: results.notMobileFirstCount,
      notMobileFirstExamples: results.notMobileFirstExamples,
    };
  });

  // Similar colors (hex distance < 30)
  const hexColors = (cssData.allColors || []).filter(c => c.startsWith('#'));
  let similarColorPairs = [];
  for (let i = 0; i < hexColors.length; i++) {
    for (let j = i+1; j < hexColors.length; j++) {
      if (hexColorDistance(hexColors[i], hexColors[j]) < 30) {
        similarColorPairs.push({ a: hexColors[i], b: hexColors[j] });
        if (similarColorPairs.length >= 20) break;
      }
    }
    if (similarColorPairs.length >= 20) break;
  }

  const metrics = {
    totalRules: cssData.totalRules,
    complexSelectors: cssData.complexSelectors,
    uniqueColors: cssData.uniqueColors,
    similarColors: similarColorPairs.length,
    breakpoints: cssData.breakpoints,
    notMobileFirstQueries: cssData.notMobileFirstCount,
  };

  const scores = [
    scoreMetric(cssData.totalRules, THRESHOLDS.cssComplexity.rules.good, THRESHOLDS.cssComplexity.rules.bad),
    scoreMetric(cssData.complexSelectors, THRESHOLDS.cssComplexity.complexSelectors.good, THRESHOLDS.cssComplexity.complexSelectors.bad),
    scoreMetric(cssData.uniqueColors, THRESHOLDS.cssComplexity.colors.good, THRESHOLDS.cssComplexity.colors.bad),
    scoreMetric(similarColorPairs.length, THRESHOLDS.cssComplexity.similarColors.good, THRESHOLDS.cssComplexity.similarColors.bad),
    scoreMetric(cssData.breakpoints, THRESHOLDS.cssComplexity.breakpoints.good, THRESHOLDS.cssComplexity.breakpoints.bad),
    scoreMetric(cssData.notMobileFirstCount, THRESHOLDS.cssComplexity.notMobileFirst.good, THRESHOLDS.cssComplexity.notMobileFirst.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'Toplam Kural', value: cssData.totalRules, suffix: '', good: THRESHOLDS.cssComplexity.rules.good, bad: THRESHOLDS.cssComplexity.rules.bad, score: scores[0], weight: 1 },
    { label: 'Karmaşık Seçici', value: cssData.complexSelectors, suffix: '', good: THRESHOLDS.cssComplexity.complexSelectors.good, bad: THRESHOLDS.cssComplexity.complexSelectors.bad, score: scores[1], weight: 1 },
    { label: 'Renk Sayısı', value: cssData.uniqueColors, suffix: '', good: THRESHOLDS.cssComplexity.colors.good, bad: THRESHOLDS.cssComplexity.colors.bad, score: scores[2], weight: 1 },
    { label: 'Benzer Renkler', value: similarColorPairs.length, suffix: '', good: THRESHOLDS.cssComplexity.similarColors.good, bad: THRESHOLDS.cssComplexity.similarColors.bad, score: scores[3], weight: 1 },
    { label: 'Breakpoint', value: cssData.breakpoints, suffix: '', good: THRESHOLDS.cssComplexity.breakpoints.good, bad: THRESHOLDS.cssComplexity.breakpoints.bad, score: scores[4], weight: 1 },
    { label: 'Mobile-First Dışı', value: cssData.notMobileFirstCount, suffix: '', good: THRESHOLDS.cssComplexity.notMobileFirst.good, bad: THRESHOLDS.cssComplexity.notMobileFirst.bad, score: scores[5], weight: 1 },
  ];

  const details = [
    ...cssData.complexSelectorExamples.map(s => ({ type: 'complex-selector', selector: s })),
    ...similarColorPairs.slice(0,10).map(p => ({ type: 'similar-colors', ...p })),
  ];

  // Extra data for detailed view and JSON export
  const extras = {
    scoreBreakdown,
    allColors: cssData.allColors.slice(0, 200),
    breakpointValues: cssData.breakpointValues || [],
    notMobileFirstExamples: cssData.notMobileFirstExamples || [],
    complexSelectorExamples: cssData.complexSelectorExamples,
  };

  return buildCategory(score, metrics, details, extras);
}

async function auditBadCSS(page) {
  const cssData = await page.evaluate(() => {
    const results = {
      syntaxErrors: 0,
      atImports: 0,
      importUrls: [],
      dupSelectors: {},
      dupProperties: 0,
      emptyRules: 0,
      importantCount: 0,
      importantExamples: [],
      oldPrefixes: 0,
      oldPrefixExamples: [],
      redundantBody: 0,
      redundantBodyExamples: [],
    };

    const OLD_PREFIXES = ['-webkit-animation', '-webkit-transform', '-moz-transform', '-ms-transform', '-webkit-flex', '-ms-flexbox'];

    [...document.styleSheets].forEach(sheet => {
      let rules;
      try { rules = [...sheet.cssRules || []]; } catch { return; }

      rules.forEach(rule => {
        // @import
        if (rule.type === CSSRule.IMPORT_RULE) {
          results.atImports++;
          results.importUrls.push(rule.href || '');
        }

        if (!rule.selectorText) return;

        // Duplicated selectors
        const selKey = rule.selectorText;
        results.dupSelectors[selKey] = (results.dupSelectors[selKey] || 0) + 1;

        if (!rule.style) return;
        const cssText = rule.style.cssText;

        // Empty rules
        if (!cssText.trim()) results.emptyRules++;

        // !important
        const impMatches = (cssText.match(/!important/g) || []).length;
        results.importantCount += impMatches;
        if (impMatches > 0 && results.importantExamples.length < 20) {
          results.importantExamples.push(rule.selectorText.slice(0, 80));
        }

        // Old prefixes
        OLD_PREFIXES.forEach(prefix => {
          if (cssText.includes(prefix)) {
            results.oldPrefixes++;
            if (results.oldPrefixExamples.length < 20) {
              results.oldPrefixExamples.push(`${rule.selectorText} — ${prefix}`);
            }
          }
        });

        // Redundant body selectors
        if (/^body\s+\w/.test(rule.selectorText)) {
          results.redundantBody++;
          if (results.redundantBodyExamples.length < 20) {
            results.redundantBodyExamples.push(rule.selectorText.slice(0, 100));
          }
        }

        // Duplicated properties
        const props = {};
        const propStr = cssText.split(';').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);
        propStr.forEach(p => { props[p] = (props[p] || 0) + 1; });
        results.dupProperties += Object.values(props).filter(c => c > 1).length;
      });
    });

    const dupSelectorCount = Object.values(results.dupSelectors).filter(c => c > 1).length;
    const dupSelectorExamples = Object.entries(results.dupSelectors)
      .filter(([,c]) => c > 1).sort((a,b) => b[1]-a[1]).slice(0,20).map(([s,c]) => ({ selector: s, count: c }));

    return {
      syntaxErrors: results.syntaxErrors,
      atImports: results.atImports,
      importUrls: results.importUrls,
      dupSelectors: dupSelectorCount,
      dupSelectorExamples,
      dupProperties: results.dupProperties,
      emptyRules: results.emptyRules,
      importantCount: results.importantCount,
      importantExamples: results.importantExamples,
      oldPrefixes: results.oldPrefixes,
      oldPrefixExamples: results.oldPrefixExamples,
      redundantBody: results.redundantBody,
      redundantBodyExamples: results.redundantBodyExamples,
    };
  });

  const metrics = {
    syntaxErrors: cssData.syntaxErrors,
    atImport: cssData.atImports,
    duplicatedSelectors: cssData.dupSelectors,
    duplicatedProperties: cssData.dupProperties,
    emptyRules: cssData.emptyRules,
    importantUsage: cssData.importantCount,
    oldPrefixes: cssData.oldPrefixes,
    redundantBodySelectors: cssData.redundantBody,
  };

  const scores = [
    scoreMetric(cssData.syntaxErrors, THRESHOLDS.badCss.syntaxErrors.good, THRESHOLDS.badCss.syntaxErrors.bad),
    cssData.atImports > 0 ? 50 : 100,
    scoreMetric(cssData.dupSelectors, THRESHOLDS.badCss.dupSelectors.good, THRESHOLDS.badCss.dupSelectors.bad),
    scoreMetric(cssData.dupProperties, THRESHOLDS.badCss.dupProperties.good, THRESHOLDS.badCss.dupProperties.bad),
    scoreMetric(cssData.emptyRules, THRESHOLDS.badCss.emptyRules.good, THRESHOLDS.badCss.emptyRules.bad),
    scoreMetric(cssData.importantCount, THRESHOLDS.badCss.important.good, THRESHOLDS.badCss.important.bad),
    scoreMetric(cssData.oldPrefixes, THRESHOLDS.badCss.oldPrefixes.good, THRESHOLDS.badCss.oldPrefixes.bad),
    scoreMetric(cssData.redundantBody, THRESHOLDS.badCss.redundantBody.good, THRESHOLDS.badCss.redundantBody.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'Sözdizim Hatası', value: cssData.syntaxErrors, suffix: '', good: THRESHOLDS.badCss.syntaxErrors.good, bad: THRESHOLDS.badCss.syntaxErrors.bad, score: scores[0], weight: 1 },
    { label: '@import', value: cssData.atImports, suffix: '', good: 0, bad: 1, score: scores[1], weight: 1 },
    { label: 'Dup. Seçici', value: cssData.dupSelectors, suffix: '', good: THRESHOLDS.badCss.dupSelectors.good, bad: THRESHOLDS.badCss.dupSelectors.bad, score: scores[2], weight: 1 },
    { label: 'Dup. Özellik', value: cssData.dupProperties, suffix: '', good: THRESHOLDS.badCss.dupProperties.good, bad: THRESHOLDS.badCss.dupProperties.bad, score: scores[3], weight: 1 },
    { label: 'Boş Kural', value: cssData.emptyRules, suffix: '', good: THRESHOLDS.badCss.emptyRules.good, bad: THRESHOLDS.badCss.emptyRules.bad, score: scores[4], weight: 1 },
    { label: '!important', value: cssData.importantCount, suffix: '', good: THRESHOLDS.badCss.important.good, bad: THRESHOLDS.badCss.important.bad, score: scores[5], weight: 1 },
    { label: 'Eski Prefix', value: cssData.oldPrefixes, suffix: '', good: THRESHOLDS.badCss.oldPrefixes.good, bad: THRESHOLDS.badCss.oldPrefixes.bad, score: scores[6], weight: 1 },
    { label: 'Gereksiz body', value: cssData.redundantBody, suffix: '', good: THRESHOLDS.badCss.redundantBody.good, bad: THRESHOLDS.badCss.redundantBody.bad, score: scores[7], weight: 1 },
  ];

  const details = [
    ...cssData.importUrls.map(u => ({ type: 'css-import', url: u })),
    ...cssData.dupSelectorExamples.map(s => ({ type: 'duplicate-selector', selector: s.selector || s, count: s.count })),
    ...cssData.oldPrefixExamples.map(s => ({ type: 'old-prefix', text: s })),
    ...cssData.importantExamples.map(s => ({ type: 'important-usage', selector: s })),
    ...cssData.redundantBodyExamples.map(s => ({ type: 'redundant-body', selector: s })),
  ];

  // Extra data for detailed view and JSON export
  const extras = {
    scoreBreakdown,
    dupSelectorExamples: cssData.dupSelectorExamples,
    importantExamples: cssData.importantExamples,
    oldPrefixExamples: cssData.oldPrefixExamples,
    redundantBodyExamples: cssData.redundantBodyExamples,
  };

  return buildCategory(score, metrics, details, extras);
}

async function auditServerConfig(networkData) {
  const resources = networkData.resources;

  let http1Resources = [];
  let noCacheResources = [];
  let cachingDisabled = [];
  let cachingTooShort = [];
  let connectionsClosed = 0;

  resources.forEach(r => {
    const protocol = (r.protocol || '').toLowerCase();
    if (protocol && !protocol.includes('h2') && !protocol.includes('h3') && !protocol.includes('http/2')) {
      if (!protocol.includes('data') && r.url.startsWith('http')) {
        http1Resources.push({ url: r.url, protocol });
      }
    }

    const cc = (r.headers?.['cache-control'] || '').toLowerCase();
    if (!cc && r.status === 200 && (r.type === 'js' || r.type === 'css' || r.type === 'image' || r.type === 'font')) {
      noCacheResources.push({ url: r.url });
    }
    if (cc.includes('no-cache') || cc.includes('no-store')) {
      cachingDisabled.push({ url: r.url });
    }
    const maxAge = cc.match(/max-age=(\d+)/);
    if (maxAge && parseInt(maxAge[1]) < 3600 && parseInt(maxAge[1]) > 0) {
      cachingTooShort.push({ url: r.url, maxAge: parseInt(maxAge[1]) });
    }

    const conn = (r.headers?.['connection'] || '').toLowerCase();
    if (conn.includes('close')) connectionsClosed++;
  });

  const metrics = {
    http1Resources: http1Resources.length,
    noCacheResources: noCacheResources.length,
    cachingDisabled: cachingDisabled.length,
    cachingTooShort: cachingTooShort.length,
    connectionsClosed,
  };

  const scores = [
    scoreMetric(http1Resources.length, THRESHOLDS.serverConfig.http1Resources.good, THRESHOLDS.serverConfig.http1Resources.bad),
    scoreMetric(noCacheResources.length, THRESHOLDS.serverConfig.noCacheResources.good, THRESHOLDS.serverConfig.noCacheResources.bad),
    scoreMetric(cachingDisabled.length, THRESHOLDS.serverConfig.cachingDisabled.good, THRESHOLDS.serverConfig.cachingDisabled.bad),
    scoreMetric(cachingTooShort.length, THRESHOLDS.serverConfig.cachingTooShort.good, THRESHOLDS.serverConfig.cachingTooShort.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'HTTP/1.1 Kaynak', value: http1Resources.length, suffix: '', good: THRESHOLDS.serverConfig.http1Resources.good, bad: THRESHOLDS.serverConfig.http1Resources.bad, score: scores[0], weight: 1 },
    { label: 'Cachesiz Kaynak', value: noCacheResources.length, suffix: '', good: THRESHOLDS.serverConfig.noCacheResources.good, bad: THRESHOLDS.serverConfig.noCacheResources.bad, score: scores[1], weight: 1 },
    { label: 'Cache Devre Dışı', value: cachingDisabled.length, suffix: '', good: THRESHOLDS.serverConfig.cachingDisabled.good, bad: THRESHOLDS.serverConfig.cachingDisabled.bad, score: scores[2], weight: 1 },
    { label: 'Cache Çok Kısa', value: cachingTooShort.length, suffix: '', good: THRESHOLDS.serverConfig.cachingTooShort.good, bad: THRESHOLDS.serverConfig.cachingTooShort.bad, score: scores[3], weight: 1 },
  ];

  const details = [
    ...http1Resources.slice(0,50).map(r => ({ type: 'http1', ...r })),
    ...noCacheResources.slice(0,50).map(r => ({ type: 'no-cache', ...r })),
    ...cachingDisabled.slice(0,20).map(r => ({ type: 'caching-disabled', ...r })),
    ...cachingTooShort.slice(0,20).map(r => ({ type: 'caching-too-short', ...r })),
  ];

  return buildCategory(score, metrics, details, { scoreBreakdown });
}

async function auditWebFonts(networkData) {
  const fonts = networkData.resources.filter(r => r.type === 'font');

  let totalFontBytes = 0;
  let nonWoff2 = [];
  let overweightFonts = [];

  fonts.forEach(f => {
    totalFontBytes += f.transferSize || 0;
    const isWoff2 = f.url.includes('.woff2') || (f.headers?.['content-type'] || '').includes('woff2');
    if (!isWoff2) nonWoff2.push({ url: f.url, sizeKb: Math.round((f.transferSize||0)/1024) });
    if ((f.transferSize||0) > 100*1024) {
      overweightFonts.push({ url: f.url, sizeKb: Math.round((f.transferSize||0)/1024) });
    }
  });

  const totalFontKb = Math.round(totalFontBytes / 1024);

  const metrics = {
    webfontCount: fonts.length,
    totalFontKb,
    nonWoff2Count: nonWoff2.length,
    overweightFonts: overweightFonts.length,
  };

  const scores = [
    scoreMetric(fonts.length, THRESHOLDS.webFonts.count.good, THRESHOLDS.webFonts.count.bad),
    scoreMetric(totalFontKb, THRESHOLDS.webFonts.totalKb.good, THRESHOLDS.webFonts.totalKb.bad),
    scoreMetric(nonWoff2.length, THRESHOLDS.webFonts.notWoff2.good, THRESHOLDS.webFonts.notWoff2.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const scoreBreakdown = [
    { label: 'Font Sayısı', value: fonts.length, suffix: '', good: THRESHOLDS.webFonts.count.good, bad: THRESHOLDS.webFonts.count.bad, score: scores[0], weight: 1 },
    { label: 'Toplam Font KB', value: totalFontKb, suffix: ' KB', good: THRESHOLDS.webFonts.totalKb.good, bad: THRESHOLDS.webFonts.totalKb.bad, score: scores[1], weight: 1 },
    { label: 'WOFF2 Dışı Format', value: nonWoff2.length, suffix: '', good: THRESHOLDS.webFonts.notWoff2.good, bad: THRESHOLDS.webFonts.notWoff2.bad, score: scores[2], weight: 1 },
  ];

  const details = [
    ...nonWoff2.map(f => ({ type: 'non-woff2-font', ...f })),
    ...overweightFonts.map(f => ({ type: 'overweight-font', ...f })),
  ];

  return buildCategory(score, metrics, details, { scoreBreakdown });
}

// ─── Network Data Collector (CDP) ─────────────────────────────────────────────

async function collectNetworkData(cdp, page, url, signal = { cancelled: false }) {
  const resources = new Map(); // requestId -> resource info
  const responseBodyMap = new Map(); // requestId -> body (only for small JS/CSS)

  await cdp.send('Network.enable');

  const onRequestWillBeSent = ({ requestId, request, type }) => {
    resources.set(requestId, {
      url: request.url,
      type: normalizeResourceType(type, '', request.url),
      status: null,
      transferSize: 0,
      protocol: null,
      headers: {},
      bodyHash: null,
      naturalWidth: null,
      displayWidth: null,
      isHidden: false,
      isBelowFold: false,
      hasLazyLoad: false,
      responseBody: null,
    });
  };

  const onResponseReceived = ({ requestId, response, type }) => {
    const res = resources.get(requestId);
    if (!res) return;
    res.status = response.status;
    res.protocol = response.protocol;
    // Normalize type: prefer responseReceived type, fallback to content-type header
    const ct = response.headers?.['content-type'] || response.headers?.['Content-Type'] || '';
    res.type = normalizeResourceType(type, ct, response.url || res.url);
    res.headers = response.headers || {};
  };

  const onLoadingFinished = ({ requestId, encodedDataLength }) => {
    const res = resources.get(requestId);
    if (res) res.transferSize = encodedDataLength || 0;
  };

  cdp.on('Network.requestWillBeSent', onRequestWillBeSent);
  cdp.on('Network.responseReceived', onResponseReceived);
  cdp.on('Network.loadingFinished', onLoadingFinished);

  // Page navigates — wait for it.
  // We use 'load' (not 'networkidle') because media-heavy sites with video players,
  // analytics heartbeats, and PWA polling NEVER reach networkidle.
  // After load we give the page a capped 5-second networkidle grace period, then move on.
  try {
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  } catch (e) {
    console.warn('[Frontend Auditor] Reload timeout/error, continuing anyway:', e.message);
  }

  cdp.off('Network.requestWillBeSent', onRequestWillBeSent);
  cdp.off('Network.responseReceived', onResponseReceived);
  cdp.off('Network.loadingFinished', onLoadingFinished);

  // Fetch bodies for small JS/CSS (body hash + minification check)
  const resourceArr = [...resources.values()];

  // If already cancelled by the outer timeout, skip all enrichment steps.
  if (signal.cancelled) return { resources: resourceArr, originUrl: url, typeStats: resourceArr.reduce((acc, r) => { acc[r.type || 'other'] = (acc[r.type || 'other'] || 0) + 1; return acc; }, {}) };

  const bodyTargets = resourceArr.filter(r =>
    (r.type === 'js' || r.type === 'css') && r.transferSize < 500 * 1024 && r.status === 200
  ).slice(0, 30);

  await Promise.allSettled(bodyTargets.map(async (res) => {
    const reqId = [...resources.entries()].find(([,v]) => v === res)?.[0];
    if (!reqId) return;
    try {
      // Use a timeout for body fetching to avoid hanging
      const response = await Promise.race([
        cdp.send('Network.getResponseBody', { requestId: reqId }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
      const body = response.body;
      res.responseBody = body;
      // Simple hash for deduplication (djb2)
      let hash = 5381;
      for (let i = 0; i < Math.min(body.length, 2000); i++) {
        hash = ((hash << 5) + hash) + body.charCodeAt(i);
        hash |= 0;
      }
      res.bodyHash = hash.toString();
    } catch {}
  }));

  // ── Enrich transferSize via PerformanceResourceTiming ────────────────────────
  // Service Workers (PWA) serve most resources from cache, so CDP's encodedDataLength
  // is 0 for those requests. PerformanceResourceTiming always exposes decodedBodySize
  // (actual body bytes) regardless of SW cache, making it a reliable size fallback.
  if (signal.cancelled) return { resources: resourceArr, originUrl: url, typeStats: resourceArr.reduce((acc, r) => { acc[r.type || 'other'] = (acc[r.type || 'other'] || 0) + 1; return acc; }, {}) };
  try {
    const perfEntries = await Promise.race([
      page.evaluate(() =>
        performance.getEntriesByType('resource').map(e => ({
          name: e.name,
          transferSize: e.transferSize,
          encodedBodySize: e.encodedBodySize,
          decodedBodySize: e.decodedBodySize,
        }))
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('perfEntries timeout')), 5000)),
    ]);
    const perfMap = new Map(perfEntries.map(e => [e.name, e]));
    resourceArr.forEach(r => {
      if ((r.transferSize || 0) === 0) {
        const p = perfMap.get(r.url);
        if (p && p.decodedBodySize > 0) {
          r.transferSize = p.decodedBodySize;
        }
      }
    });
  } catch {}

  // ── Enrich image data (display size, hidden, below fold) ─────────────────────
  if (signal.cancelled) return { resources: resourceArr, originUrl: url, typeStats: resourceArr.reduce((acc, r) => { acc[r.type || 'other'] = (acc[r.type || 'other'] || 0) + 1; return acc; }, {}) };
  try {
    const imageData = await Promise.race([
      page.evaluate(() => {
        const imgs = [...document.images];
        return imgs.map(img => {
          const rect = img.getBoundingClientRect();
          const style = window.getComputedStyle(img);
          return {
            src: img.src || img.currentSrc || '',
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            displayWidth: rect.width,
            displayHeight: rect.height,
            isHidden: style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0,
            isBelowFold: rect.top > window.innerHeight,
            hasLazyLoad: img.loading === 'lazy' || img.hasAttribute('data-src') || img.hasAttribute('data-lazy'),
          };
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('imageData timeout')), 5000)),
    ]);

    imageData.forEach(img => {
      // Find matching resource
      const res = resourceArr.find(r => r.type === 'image' && (r.url === img.src || r.url.includes(img.src.split('/').pop()?.split('?')[0] || '')));
      if (!res) return;
      res.naturalWidth = img.naturalWidth;
      res.displayWidth = img.displayWidth;
      res.isHidden = img.isHidden;
      res.isBelowFold = img.isBelowFold;
      res.hasLazyLoad = img.hasLazyLoad;
    });
  } catch {}

  const typeStats = resourceArr.reduce((acc, r) => {
    const key = r.type || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return { resources: resourceArr, originUrl: url, typeStats };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

async function auditFrontend(page, url) {
  console.log(`[ℹ] Frontend audit başlatılıyor: ${url}`);
  const result = {
    globalScore: 0,
    globalGrade: 'F',
    categories: {},
  };

  // Cap ALL Playwright page operations (navigate, evaluate, click…) to 20 s.
  // This prevents any single page.evaluate() from hanging indefinitely.
  const prevDefaultTimeout = page.context()._timeoutSettings?._defaultTimeout ?? null;
  page.setDefaultTimeout(20000);

  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch (e) {
    console.error('[Frontend Auditor] CDP session başlatılamadı:', e.message);
    result.error = e.message;
    page.setDefaultTimeout(prevDefaultTimeout ?? 30000);
    return result;
  }

  // Collect JS errors & console warnings from existing page listeners
  const jsErrors = [];
  const consoleWarningsCount = { count: 0 };
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'warning' || msg.type() === 'error') consoleWarningsCount.count++;
  });

  const runCategory = async (name, fn, timeoutMs = 20000) => {
    const startedAt = Date.now();
    console.log(`[Frontend Auditor] Category start: ${name}`);
    try {
      const value = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${name} timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
        ),
      ]);
      console.log(`[Frontend Auditor] Category done: ${name} (${Date.now() - startedAt}ms)`);
      return value;
    } catch (e) {
      console.warn(`[Frontend Auditor] Category failed: ${name} (${Date.now() - startedAt}ms) - ${e.message}`);
      return buildCategory(0, { error: e.message }, []);
    }
  };

  // Inject document.write and sync XHR counters before reload
  await page.addInitScript(() => {
    window.__docWriteCount = 0;
    window.__syncXhrCount = 0;
    window.__domAccessCount = 0;

    // Patch document.write
    const origWrite = document.write.bind(document);
    document.write = function(...args) { window.__docWriteCount++; return origWrite(...args); };

    // Patch XHR to detect sync
    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = class extends OrigXHR {
      open(method, url, async = true) {
        if (async === false) window.__syncXhrCount++;
        return super.open(method, url, async);
      }
    };

    // Patch DOM access
    const origQS = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function(...args) {
      window.__domAccessCount++;
      return origQS.apply(this, args);
    };
    const origGEBI = Document.prototype.getElementById;
    Document.prototype.getElementById = function(...args) {
      window.__domAccessCount++;
      return origGEBI.apply(this, args);
    };
  });

  try {
    // Collect network data (includes page.reload internally).
    // Hard-cap at 50 s: on PWA/staging pages the reload+CDP can run indefinitely.
    // If it times out, fall back to empty data so the DOM/JS/CSS categories still run.
    // The signal object lets us cancel the still-running collectNetworkData's page.evaluate
    // calls so they don't block the category audits' Playwright queue.
    const networkSignal = { cancelled: false };
    const networkData = await Promise.race([
      collectNetworkData(cdp, page, url, networkSignal),
      new Promise(resolve =>
        setTimeout(() => {
          console.warn('[Frontend Auditor] collectNetworkData timeout after 50s, proceeding with empty network data');
          networkSignal.cancelled = true;
          // Stop any pending navigation (page.reload inside collectNetworkData)
          // so the page target doesn't crash mid-category and cause "Target crashed" errors.
          page.evaluate(() => window.stop()).catch(() => {});
          resolve({ resources: [], originUrl: url, typeStats: {} });
        }, 50000)
      ),
    ]);

    // Give the page a moment to stabilise after stopping any pending navigation.
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

    // Run all category auditors in parallel where possible
    const [
      pageWeight,
      requests,
      domComplexity,
      jsComplexity,
      badJs,
      cssComplexity,
      badCss,
      serverConfig,
      webFonts,
    ] = await Promise.all([
      runCategory('pageWeight', () => auditPageWeight(cdp, networkData, page)),
      runCategory('requests', () => auditRequests(networkData)),
      runCategory('domComplexity', () => auditDOMComplexity(page)),
      runCategory('jsComplexity', () => auditJSComplexity(page, cdp, jsErrors, consoleWarningsCount.count)),
      runCategory('badJs', () => auditBadJS(page, jsErrors, consoleWarningsCount.count)),
      runCategory('cssComplexity', () => auditCSSComplexity(page)),
      runCategory('badCss', () => auditBadCSS(page)),
      runCategory('serverConfig', () => auditServerConfig(networkData)),
      runCategory('webFonts', () => auditWebFonts(networkData)),
    ]);

    result.categories = {
      pageWeight,
      requests,
      domComplexity,
      jsComplexity,
      badJs,
      cssComplexity,
      badCss,
      serverConfig,
      webFonts,
    };

    // Global score = weighted average
    const weights = {
      pageWeight: 2,
      requests: 2,
      domComplexity: 1,
      jsComplexity: 2,
      badJs: 1.5,
      cssComplexity: 1,
      badCss: 1.5,
      serverConfig: 2,
      webFonts: 0.5,
    };

    let totalWeight = 0, weightedSum = 0;
    Object.entries(result.categories).forEach(([key, cat]) => {
      const w = weights[key] || 1;
      weightedSum += (cat.score || 0) * w;
      totalWeight += w;
    });

    result.globalScore = Math.round(weightedSum / totalWeight);
    result.globalGrade = calcGrade(result.globalScore);

  } catch (err) {
    console.error('[Frontend Auditor] Hata:', err.message);
    result.error = err.message;
  } finally {
    // cdp.detach() can hang indefinitely when the CDP session has pending calls
    // (e.g. Profiler.takePreciseCoverage timed-out but not cancelled, or a
    // dangling page.reload). Cap it at 3 s so auditFrontend always returns fast.
    try {
      await Promise.race([
        cdp.detach(),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch {}
    // Restore original timeout so subsequent auditors aren't affected.
    try { page.setDefaultTimeout(prevDefaultTimeout ?? 30000); } catch {}
  }

  console.log(`[✓] Frontend audit tamamlandı: ${result.globalGrade} (${result.globalScore}/100)`);
  return result;
}

// Wrap auditFrontend with a hard deadline so a hanging page can never block the whole audit.
const FRONTEND_AUDIT_TIMEOUT_MS = 120000; // 120 seconds max

async function auditFrontendWithTimeout(page, url) {
  return Promise.race([
    auditFrontend(page, url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Frontend audit timeout after ${FRONTEND_AUDIT_TIMEOUT_MS / 1000}s`)), FRONTEND_AUDIT_TIMEOUT_MS)
    ),
  ]).catch(err => {
    console.error(`[Frontend Auditor] Timeout/Error: ${err.message}`);
    return { globalScore: 0, globalGrade: 'F', categories: {}, error: err.message };
  });
}

module.exports = { auditFrontend: auditFrontendWithTimeout };
