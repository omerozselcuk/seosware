async function auditPerformance(page) {
  const result = {
    lcp: null,
    cls: null,
    domContentLoaded: null,
    fullyLoaded: null,
    longTasks: [],
    renderBlockingResources: [],
    unusedCssPercent: null,
    unusedJsPercent: null,
    inp: null,
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
      await page.coverage.startCSSCoverage();
      await page.coverage.startJSCoverage();

      // Trigger a click to measure INP
      const observerPromise = page.evaluate(() => {
        return new Promise((resolve) => {
          let inp = 0;
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            for (const entry of entries) {
              if (entry.interactionId) {
                // INP is the max interaction duration
                inp = Math.max(inp, entry.duration);
              }
            }
          });
          observer.observe({ type: "event", durationThreshold: 16, buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(Math.round(inp));
          }, 1000);
        });
      });

      // Click center of the page
      await page.mouse.click(500, 500);
      result.inp = await observerPromise;

      const cssCoverage = await page.coverage.stopCSSCoverage();
      const jsCoverage = await page.coverage.stopJSCoverage();

      // Calc unused CSS
      let totalCss = 0, usedCss = 0;
      for (const entry of cssCoverage) {
        totalCss += entry.text.length;
        for (const range of entry.ranges) {
          usedCss += range.end - range.start;
        }
      }
      if (totalCss > 0) result.unusedCssPercent = Math.round(((totalCss - usedCss) / totalCss) * 100);

      // Calc unused JS
      let totalJs = 0, usedJs = 0;
      for (const entry of jsCoverage) {
        totalJs += entry.text.length;
        for (const range of entry.ranges) {
          usedJs += range.end - range.start;
        }
      }
      if (totalJs > 0) result.unusedJsPercent = Math.round(((totalJs - usedJs) / totalJs) * 100);

    } catch (e) {
      console.error("[Performance] Coverage/INP Error:", e.message);
    }

  return result;
}

module.exports = { auditPerformance };
