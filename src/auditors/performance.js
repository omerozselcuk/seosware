async function auditPerformance(page) {
  const result = {
    lcp: null,
    cls: null,
    domContentLoaded: null,
    fullyLoaded: null,
    longTasks: [],
    renderBlockingResources: [],
    unusedCssPercent: null,
    unusedCssList: [],
    unusedJsPercent: null,
    unusedJsList: [],
    inp: 0
  };

  try {
    const metrics = await page.evaluate(async () => {
      const getNavigationDetails = () => {
        const [nav] = performance.getEntriesByType("navigation");
        return nav ? { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), fullyLoaded: Math.round(nav.loadEventEnd) } : {};
      };

      const getLCP = () => {
        return new Promise((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const lastEntry = entries[entries.length - 1];
            resolve(Math.round(lastEntry.startTime));
          }).observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => resolve(null), 5000);
        });
      };

      const getCLS = () => {
        let clsValue = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) clsValue += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        return clsValue;
      };

      const lcp = await getLCP();
      const cls = getCLS();
      const nav = getNavigationDetails();

      const longTasks = performance.getEntriesByType("longtask").map((entry) => ({
        duration: Math.round(entry.duration),
        startTime: Math.round(entry.startTime),
      }));

      const renderBlocking = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.renderBlockingStatus === "blocking")
        .map((entry) => ({
          url: entry.name,
          duration: Math.round(entry.duration),
        }));

      return { lcp, cls: parseFloat(cls.toFixed(3)), ...nav, longTasks, renderBlockingResources: renderBlocking };
    });

    Object.assign(result, metrics);

    // Unused CSS & JS Analysis
    try {
      await page.coverage.startJSCoverage();
      await page.coverage.startCSSCoverage();
      await page.reload({ waitUntil: "networkidle" });
      const jsCoverage = await page.coverage.stopJSCoverage();
      const cssCoverage = await page.coverage.stopCSSCoverage();

      let totalCss = 0, usedCss = 0;
      const unusedCssList = [];
      cssCoverage.forEach((entry) => {
        totalCss += entry.text.length;
        let used = 0;
        entry.ranges.forEach((range) => (used += range.end - range.start));
        usedCss += used;
        const entryUnusedPct = Math.round(((entry.text.length - used) / entry.text.length) * 100);
        if (entryUnusedPct > 50) {
          unusedCssList.push({ url: entry.url, unusedPct: entryUnusedPct });
        }
      });
      if (totalCss > 0) result.unusedCssPercent = Math.round(((totalCss - usedCss) / totalCss) * 100);
      result.unusedCssList = unusedCssList.sort((a, b) => b.unusedPct - a.unusedPct);

      let totalJs = 0, usedJs = 0;
      const unusedJsList = [];
      jsCoverage.forEach((entry) => {
        totalJs += entry.text.length;
        let used = 0;
        entry.ranges.forEach((range) => (used += range.end - range.start));
        usedJs += used;
        const entryUnusedPct = Math.round(((entry.text.length - used) / entry.text.length) * 100);
        if (entryUnusedPct > 50) {
          unusedJsList.push({ url: entry.url, unusedPct: entryUnusedPct });
        }
      });
      if (totalJs > 0) result.unusedJsPercent = Math.round(((totalJs - usedJs) / totalJs) * 100);
      result.unusedJsList = unusedJsList.sort((a, b) => b.unusedPct - a.unusedPct);

    } catch (e) {
      console.error("[Performance Auditor] Coverage failed:", e.message);
    }

  } catch (err) {
    console.error("[Performance Auditor] Failed:", err.message);
  }

  return result;
}

module.exports = { auditPerformance };
