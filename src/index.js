const { launchDesktopBrowser, WAIT_AFTER_LOAD } = require('./utils/browser');
const { fetchSitemap, fetchRobotsTxt, isBlockedByRobots } = require('./utils/fetchers');
const { auditMeta } = require('./auditors/meta');
const { auditContent } = require('./auditors/content');
const { auditImages } = require('./auditors/images');
const { auditLinks } = require('./auditors/links');
const { auditPerformance } = require('./auditors/performance');
const { auditRendering } = require('./auditors/rendering');
const { auditMobile } = require('./auditors/mobile');
const { auditAISearch } = require('./auditors/ai-search-auditor');

async function runAudit(url, config = {}) {
  const TIMEOUT = config.timeout || 30000;
  console.log(`\n[\u2139] Starting audit for: ${url}`);
  
  const result = {
    url,
    timestamp: new Date().toISOString(),
    status: null,
    redirected: false,
    finalUrl: null,
    loadTime: null,
    network: {
      jsErrors: [],
      consoleLogs: [],
      brokenResourceUrls: [],
      hydrationErrors: [],
      largeFiles: []
    },
    security: {
      isHttps: false,
      hsts: false,
      xFrameOptions: null,
      mixedContent: []
    },
    meta: null,
    content: null,
    images: null,
    links: null,
    performance: null,
    rendering: null,
    mobile: null,
    aiSearch: null,
    robots: { blocked: false }
  };

  try {
    const { browser, context, page } = await launchDesktopBrowser(config);

    // Network & Error listeners
    page.on("pageerror", (err) => {
      result.network.jsErrors.push(err.message);
      if (err.message.toLowerCase().includes("hydrat") || err.message.toLowerCase().includes("mismatch")) {
        result.network.hydrationErrors.push(err.message);
      }
    });

    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        result.network.consoleLogs.push({ type: msg.type(), text: msg.text() });
      }
    });

    page.on("requestfailed", (req) => {
      result.network.brokenResourceUrls.push({ url: req.url(), error: req.failure()?.errorText });
    });

    page.on("response", async (response) => {
      const reqUrl = response.url();
      if (url.startsWith("https") && reqUrl.startsWith("http://")) {
        result.security.mixedContent.push(reqUrl);
      }
      
      try {
        const headers = response.headers();
        const contentLength = parseInt(headers['content-length'] || "0", 10);
        // Track files larger than 1MB
        if (contentLength > 1024 * 1024) {
          result.network.largeFiles.push({ url: reqUrl, size: contentLength });
        }
      } catch(e) {}
    });

    // 1. Robots.txt Check (Optional optimization: cache it if checking multiple URLs)
    try {
      const parsedUrl = new URL(url);
      const robotsTxtRules = await fetchRobotsTxt(page, `${parsedUrl.origin}/robots.txt`);
      result.robots.blocked = isBlockedByRobots(url, robotsTxtRules);
      result.robots.rules = robotsTxtRules;
    } catch(e) {}

    // 2. Load Page Setup
    const startTime = Date.now();
    await page.addInitScript(() => {
      // INP Observer
      if (typeof window.__inpValue === 'undefined') window.__inpValue = 0;
      if (!window.__inpObserverActive) {
        window.__inpObserverActive = true;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if ((entry.interactionId || entry.name === 'click' || entry.name.startsWith('mouse') || entry.name.startsWith('pointer')) && entry.duration > window.__inpValue) {
                window.__inpValue = Math.round(entry.duration);
              }
            }
          }).observe({ type: "event", durationThreshold: 0, buffered: true });
        } catch (e) {}
      }
      // CLS Observer
      if (typeof window.__clsValue === 'undefined') window.__clsValue = 0;
      if (!window.__clsObserverActive) {
        window.__clsObserverActive = true;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) window.__clsValue += entry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch (e) {}
      }
    });
    
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);
    result.loadTime = Date.now() - startTime;
    result.status = response?.status();
    result.finalUrl = page.url();
    result.redirected = url.replace(/\/$/, "") !== result.finalUrl.replace(/\/$/, "");

    // Extract security headers from the main response
    if (response) {
      const headers = response.headers();
      result.security.isHttps = result.finalUrl.startsWith("https://");
      result.security.hsts = !!headers['strict-transport-security'];
      result.security.xFrameOptions = headers['x-frame-options'] || null;
    }

    // 3. Auditors execution
    // Note: Rendering requires separate raw page, so we pass current rendered html
    const renderedHtml = await page.content();
    result.rendering = await auditRendering(page, renderedHtml, url, TIMEOUT);
    result.meta = await auditMeta(page, result.finalUrl);
    result.content = await auditContent(page);
    result.images = await auditImages(page);
    result.links = await auditLinks(page);
    result.performance = await auditPerformance(page);

    // 4. AI Search Audit
    console.log(`[\u2139] Running AI Search audit for: ${url}`);
    result.aiSearch = await auditAISearch(page, url, TIMEOUT);

    await page.close();
    await context.close();
    await browser.close();

    // 4. Mobile Execution
    console.log(`[\u2139] Running mobile simulation for: ${url}`);
    result.mobile = await auditMobile(url, TIMEOUT);

  } catch (err) {
    console.error(`[\u2717] Failed to audit ${url}: ${err.message}`);
    result.error = err.message;
  }

  return result;
}

module.exports = { runAudit };
