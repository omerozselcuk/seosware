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
    try {
      // Sadece düğmelere tıklıyoruz ki navigasyon olup sayfa kapanmasın, ama JS çalışsın
      const clickable = await page.$("button, [role='button']");
      if (clickable) {
        await clickable.click({ force: true, delay: 100, timeout: 2000 });
      } else {
        const viewport = page.viewportSize();
        if (viewport) {
          await page.mouse.click(viewport.width / 2, viewport.height / 2, { delay: 100 });
        } else {
          await page.mouse.click(100, 100, { delay: 100 });
        }
      }
      await page.waitForTimeout(500); 
    } catch(e) {}

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
        // addInitScript ile inject edilen observer'dan oku
        return typeof window.__clsValue !== 'undefined'
          ? parseFloat(window.__clsValue.toFixed(4))
          : 0;
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

      const inp = window.__inpValue || 0;

      return { lcp, cls: parseFloat(cls.toFixed(3)), ...nav, longTasks, renderBlockingResources: renderBlocking, inp };
    });

    Object.assign(result, metrics);

    // CLS'yi reload ONCESINDE tekrar oku (buffered entries ile)
    try {
      const clsBeforeReload = await page.evaluate(() => {
        let v = 0;
        try {
          performance.getEntriesByType('layout-shift').forEach(e => {
            if (!e.hadRecentInput) v += e.value;
          });
        } catch(e) {}
        return parseFloat(v.toFixed(4));
      });
      if (clsBeforeReload > 0) result.cls = clsBeforeReload;
    } catch(e) {}

    // Unused CSS & JS Analysis
    // Coverage: reload yaparak tüm kaynakları coverage ile yakala
    try {
      await page.coverage.startJSCoverage({ reportAnonymousScripts: true });
      await page.coverage.startCSSCoverage();
      await page.reload({ waitUntil: "networkidle" });
      // JS-rendered içerikler için ekstra bekleme (schema, CLS vb.)
      await page.waitForTimeout(2000);
      const [jsCoverage, cssCoverage] = await Promise.all([
        page.coverage.stopJSCoverage(),
        page.coverage.stopCSSCoverage()
      ]);
      console.log(`[DEBUG] jsCoverage entries: ${jsCoverage.length}, cssCoverage entries: ${cssCoverage.length}`);

      // CLS'yi reload SONRASI oku — sayfa yeniden render edildi, shift'ler birikti
      try {
        const clsAfterReload = await page.evaluate(() => {
          let v = 0;
          performance.getEntriesByType('layout-shift').forEach(e => {
            if (!e.hadRecentInput) v += e.value;
          });
          return parseFloat(v.toFixed(4));
        });
        if (clsAfterReload > 0) result.cls = clsAfterReload;
      } catch(e) {}

      let totalCss = 0, usedCss = 0;
      const unusedCssList = [];
      cssCoverage.forEach((entry) => {
        if (!entry || !entry.text) return;
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
        if (!entry || !entry.source) return;
        const srcLen = entry.source.length;
        totalJs += srcLen;

        if (!entry.functions || entry.functions.length === 0) return;

        // CDP blok coverage: her range bir [start, end, count] tuple'ı.
        // count>0 olan range'ler kullanılmış, count=0 olanlar kullanılmamış.
        // Alt range'ler önceliklidir (daha yüksek index = daha spesifik).
        // Byte-level bitmask ile hesaplama:
        const used = new Uint8Array(srcLen);
        entry.functions.forEach(fn => {
          // rangeler dardan genişe veya genişten dara gelebilir, count: 0 > count: 1 öncelikli
          // Önce count>0'ları işaretle, sonra count=0'ları geri al
          const positives = [];
          const negatives = [];
          fn.ranges.forEach(r => {
            const s = Math.max(0, r.startOffset);
            const e = Math.min(srcLen, r.endOffset);
            if (s >= e) return;
            if (r.count > 0) positives.push([s, e]);
            else negatives.push([s, e]);
          });
          positives.forEach(([s, e]) => { for (let i = s; i < e; i++) used[i] = 1; });
          negatives.forEach(([s, e]) => { for (let i = s; i < e; i++) used[i] = 0; });
        });

        let usedCount = 0;
        for (let i = 0; i < srcLen; i++) { if (used[i]) usedCount++; }
        usedJs += usedCount;

        const entryUnusedPct = Math.round(((srcLen - usedCount) / srcLen) * 100);
        if (entryUnusedPct > 30 && entry.url) {
          unusedJsList.push({ url: entry.url, unusedPct: entryUnusedPct });
        }
      });
      if (totalJs > 0) {
        result.unusedJsPercent = Math.round(((totalJs - usedJs) / totalJs) * 100);
      }
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
