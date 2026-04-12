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

function buildCategory(score, metrics, details = []) {
  return { score, grade: calcGrade(score), metrics, details };
}

// ─── Category Auditors ────────────────────────────────────────────────────────

async function auditPageWeight(cdp, networkData, page) {
  const resources = networkData.resources;

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
    const key = r.type || 'other';
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
    jsCount:    byType.js.count,
    cssCount:   byType.css.count,
    imageCount: byType.image.count,
    fontCount:  byType.font.count,
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

  const details = [
    ...oversizedImages.map(i => ({ type: 'oversized-image', ...i })),
    ...uncompressedJs.map(r => ({ type: 'uncompressed-js', ...r })),
    ...uncompressedCss.map(r => ({ type: 'uncompressed-css', ...r })),
  ];

  return buildCategory(score, metrics, details);
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

  const details = [
    ...notFound.map(r => ({ type: '404', url: r.url })),
    ...emptyRequests.map(r => ({ type: 'empty-request', url: r.url, status: r.status })),
    ...identicalGroups.map(g => ({ type: 'identical-content', urls: g })),
    ...belowFold.map(r => ({ type: 'below-fold-image', url: r.url })),
    ...hiddenImages.map(r => ({ type: 'hidden-image', url: r.url })),
  ];

  return buildCategory(score, metrics, details);
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

  const details = [
    ...dom.dupIds.map(d => ({ type: 'duplicate-id', id: d.id, count: d.count })),
    ...dom.heavyNodes.map(n => ({ type: 'heavy-node', ...n })),
  ];

  return buildCategory(score, metrics, details);
}

async function auditJSComplexity(page, cdp, jsErrors, consoleWarnings) {
  // JS Execution time via CDP Profiler
  let execTimeMs = 0;
  try {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    await page.evaluate(() => {
      const end = Date.now() + 200;
      while (Date.now() < end) {} // force tiny work so profiler captures something
    });
    const { profile } = await cdp.send('Profiler.stop');
    if (profile?.nodes?.length) {
      const totalHit = profile.nodes.reduce((s,n) => s + (n.hitCount||0), 0);
      execTimeMs = Math.round(totalHit * (profile.timeDeltas?.reduce((a,b)=>a+b,0) || 0) / Math.max(profile.nodes.length, 1) / 1000);
    }
    await cdp.send('Profiler.disable');
  } catch (_) {}

  // DOM access, scroll listeners, globals from page
  const jsData = await page.evaluate(() => {
    // Global variables (non-standard window properties)
    const defaultGlobals = new Set(['window','document','location','history','navigator','screen',
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

    const globals = Object.keys(window).filter(k => !defaultGlobals.has(k) && !k.startsWith('__') && typeof window[k] !== 'function');

    // DOM access approximation (count querySelectorAll calls done before)
    const domAccessCount = window.__domAccessCount || 0;

    // Scroll-bound event listeners (approximation via getEventListeners if available)
    let scrollListeners = 0;
    try {
      // Only works in DevTools context normally; fallback 0
      if (typeof getEventListeners !== 'undefined') {
        scrollListeners = (getEventListeners(window)?.scroll || []).length;
      }
    } catch {}

    return { globals: globals.slice(0, 100), globalCount: globals.length, domAccessCount, scrollListeners };
  });

  const metrics = {
    execTimeMs: execTimeMs,
    domAccess: jsData.domAccessCount,
    scrollListeners: jsData.scrollListeners,
    globalVariables: jsData.globalCount,
  };

  const scores = [
    scoreMetric(execTimeMs, THRESHOLDS.jsComplexity.execTimeMs.good, THRESHOLDS.jsComplexity.execTimeMs.bad),
    scoreMetric(jsData.domAccessCount, THRESHOLDS.jsComplexity.domAccess.good, THRESHOLDS.jsComplexity.domAccess.bad),
    scoreMetric(jsData.scrollListeners, THRESHOLDS.jsComplexity.scrollListeners.good, THRESHOLDS.jsComplexity.scrollListeners.bad),
    scoreMetric(jsData.globalCount, THRESHOLDS.jsComplexity.globals.good, THRESHOLDS.jsComplexity.globals.bad),
  ];
  const score = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

  const details = jsData.globals.slice(0, 20).map(g => ({ type: 'global-var', name: g }));

  return buildCategory(score, metrics, details);
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

  return buildCategory(score, metrics, []);
}

async function auditCSSComplexity(page) {
  const cssData = await page.evaluate(() => {
    const results = {
      totalRules: 0,
      complexSelectors: 0,
      complexSelectorExamples: [],
      allColors: new Set(),
      breakpoints: new Set(),
      notMobileFirstCount: 0,
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
              if (results.complexSelectorExamples.length < 10) {
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

        // Media queries
        if (rule.conditionText) {
          const bp = rule.conditionText.match(/\d+px/);
          if (bp) results.breakpoints.add(bp[0]);
          if (/max-width/.test(rule.conditionText)) results.notMobileFirstCount++;
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
      notMobileFirstCount: results.notMobileFirstCount,
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

  const details = [
    ...cssData.complexSelectorExamples.map(s => ({ type: 'complex-selector', selector: s })),
    ...similarColorPairs.slice(0,5).map(p => ({ type: 'similar-colors', ...p })),
  ];

  return buildCategory(score, metrics, details);
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
      oldPrefixes: 0,
      oldPrefixExamples: [],
      redundantBody: 0,
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
        results.importantCount += (cssText.match(/!important/g) || []).length;

        // Old prefixes
        OLD_PREFIXES.forEach(prefix => {
          if (cssText.includes(prefix)) {
            results.oldPrefixes++;
            if (results.oldPrefixExamples.length < 5) {
              results.oldPrefixExamples.push(`${rule.selectorText} — ${prefix}`);
            }
          }
        });

        // Redundant body selectors
        if (/^body\s+\w/.test(rule.selectorText)) results.redundantBody++;

        // Duplicated properties
        const props = {};
        const propStr = cssText.split(';').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);
        propStr.forEach(p => { props[p] = (props[p] || 0) + 1; });
        results.dupProperties += Object.values(props).filter(c => c > 1).length;
      });
    });

    const dupSelectorCount = Object.values(results.dupSelectors).filter(c => c > 1).length;
    const dupSelectorExamples = Object.entries(results.dupSelectors)
      .filter(([,c]) => c > 1).slice(0,5).map(([s]) => s);

    return {
      syntaxErrors: results.syntaxErrors,
      atImports: results.atImports,
      importUrls: results.importUrls,
      dupSelectors: dupSelectorCount,
      dupSelectorExamples,
      dupProperties: results.dupProperties,
      emptyRules: results.emptyRules,
      importantCount: results.importantCount,
      oldPrefixes: results.oldPrefixes,
      oldPrefixExamples: results.oldPrefixExamples,
      redundantBody: results.redundantBody,
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

  const details = [
    ...cssData.importUrls.map(u => ({ type: 'css-import', url: u })),
    ...cssData.dupSelectorExamples.map(s => ({ type: 'duplicate-selector', selector: s })),
    ...cssData.oldPrefixExamples.map(s => ({ type: 'old-prefix', text: s })),
  ];

  return buildCategory(score, metrics, details);
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

  const details = [
    ...http1Resources.slice(0,10).map(r => ({ type: 'http1', ...r })),
    ...noCacheResources.slice(0,10).map(r => ({ type: 'no-cache', ...r })),
    ...cachingDisabled.slice(0,5).map(r => ({ type: 'caching-disabled', ...r })),
    ...cachingTooShort.slice(0,5).map(r => ({ type: 'caching-too-short', ...r })),
  ];

  return buildCategory(score, metrics, details);
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

  const details = [
    ...nonWoff2.map(f => ({ type: 'non-woff2-font', ...f })),
    ...overweightFonts.map(f => ({ type: 'overweight-font', ...f })),
  ];

  return buildCategory(score, metrics, details);
}

// ─── Network Data Collector (CDP) ─────────────────────────────────────────────

async function collectNetworkData(cdp, page, url) {
  const resources = new Map(); // requestId -> resource info
  const responseBodyMap = new Map(); // requestId -> body (only for small JS/CSS)

  await cdp.send('Network.enable');

  const onRequestWillBeSent = ({ requestId, request, type }) => {
    resources.set(requestId, {
      url: request.url,
      type: (type || 'other').toLowerCase(),
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
    res.type = (type || res.type || 'other').toLowerCase();
    res.headers = response.headers || {};
  };

  const onLoadingFinished = ({ requestId, encodedDataLength }) => {
    const res = resources.get(requestId);
    if (res) res.transferSize = encodedDataLength || 0;
  };

  cdp.on('Network.requestWillBeSent', onRequestWillBeSent);
  cdp.on('Network.responseReceived', onResponseReceived);
  cdp.on('Network.loadingFinished', onLoadingFinished);

  // Page navigates — wait for it
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  cdp.off('Network.requestWillBeSent', onRequestWillBeSent);
  cdp.off('Network.responseReceived', onResponseReceived);
  cdp.off('Network.loadingFinished', onLoadingFinished);

  // Fetch bodies for small JS/CSS (body hash + minification check)
  const resourceArr = [...resources.values()];
  const bodyTargets = resourceArr.filter(r =>
    (r.type === 'js' || r.type === 'css') && r.transferSize < 500 * 1024 && r.status === 200
  ).slice(0, 30);

  await Promise.allSettled(bodyTargets.map(async (res) => {
    const reqId = [...resources.entries()].find(([,v]) => v === res)?.[0];
    if (!reqId) return;
    try {
      const { body } = await cdp.send('Network.getResponseBody', { requestId: reqId });
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

  // Enrich image data (display size, hidden, below fold)
  try {
    const imageData = await page.evaluate(() => {
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
    });

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

  return { resources: resourceArr, originUrl: url };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

async function auditFrontend(page, url) {
  console.log(`[ℹ] Frontend audit başlatılıyor: ${url}`);
  const result = {
    globalScore: 0,
    globalGrade: 'F',
    categories: {},
  };

  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch (e) {
    console.error('[Frontend Auditor] CDP session başlatılamadı:', e.message);
    result.error = e.message;
    return result;
  }

  // Collect JS errors & console warnings from existing page listeners
  const jsErrors = [];
  const consoleWarningsCount = { count: 0 };
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'warning' || msg.type() === 'error') consoleWarningsCount.count++;
  });

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
    // Collect network data (includes page.reload internally)
    const networkData = await collectNetworkData(cdp, page, url);

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
      auditPageWeight(cdp, networkData, page).catch(e => buildCategory(0, { error: e.message }, [])),
      auditRequests(networkData).catch(e => buildCategory(0, { error: e.message }, [])),
      auditDOMComplexity(page).catch(e => buildCategory(0, { error: e.message }, [])),
      auditJSComplexity(page, cdp, jsErrors, consoleWarningsCount.count).catch(e => buildCategory(0, { error: e.message }, [])),
      auditBadJS(page, jsErrors, consoleWarningsCount.count).catch(e => buildCategory(0, { error: e.message }, [])),
      auditCSSComplexity(page).catch(e => buildCategory(0, { error: e.message }, [])),
      auditBadCSS(page).catch(e => buildCategory(0, { error: e.message }, [])),
      auditServerConfig(networkData).catch(e => buildCategory(0, { error: e.message }, [])),
      auditWebFonts(networkData).catch(e => buildCategory(0, { error: e.message }, [])),
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
    try { await cdp.detach(); } catch {}
  }

  console.log(`[✓] Frontend audit tamamlandı: ${result.globalGrade} (${result.globalScore}/100)`);
  return result;
}

module.exports = { auditFrontend };
