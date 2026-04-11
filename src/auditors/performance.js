async function auditPerformance(page) {
  const result = {
    lcp: null,
    cls: null,
    domContentLoaded: null,
    fullyLoaded: null,
    longTasks: [],
    renderBlockingResources: [],
    unusedCssPercent: null,
  };

  // CWV
  try {
    const cwv = await page.evaluate(() => {
      const timing = performance.timing;
      return {
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        fullyLoaded: timing.loadEventEnd - timing.navigationStart,
      };
    });
    result.domContentLoaded = cwv.domContentLoaded;
    result.fullyLoaded = cwv.fullyLoaded;
  } catch (e) {}

  // LCP
  try {
    result.lcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1]?.startTime || null);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(null), 3000);
      });
    });
  } catch (e) {}

  // CLS
  try {
    result.cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(Math.round(cls * 1000) / 1000), 2000);
      });
    });
  } catch (e) {}

  // Long Tasks
  try {
    result.longTasks = await page.evaluate(() => {
      return new Promise((resolve) => {
        const tasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            tasks.push({ duration: Math.round(entry.duration), startTime: Math.round(entry.startTime) });
          }
        }).observe({ type: "longtask", buffered: true });
        setTimeout(() => resolve(tasks), 2000);
      });
    });
  } catch (e) {}

  // Render-blocking resources
  try {
    result.renderBlockingResources = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource");
      return entries
        .filter((e) => e.renderBlockingStatus === "blocking")
        .map((e) => ({ url: e.name, duration: Math.round(e.duration) }));
    });
  } catch (e) {}

  // Unused CSS
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("CSS.startRuleUsageTracking");
    await page.waitForTimeout(500); // Wait a bit
    const cssCoverage = await cdp.send("CSS.stopRuleUsageTracking");
    if (cssCoverage.ruleUsage && cssCoverage.ruleUsage.length > 0) {
      const usedRules = cssCoverage.ruleUsage.filter((r) => r.used).length;
      const totalRules = cssCoverage.ruleUsage.length;
      result.unusedCssPercent = Math.round(((totalRules - usedRules) / totalRules) * 100);
    }
    await cdp.detach();
  } catch (e) {}

  return result;
}

module.exports = { auditPerformance };
