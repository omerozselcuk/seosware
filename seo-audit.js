const { chromium } = require("playwright");
const fs = require("fs");

// =====================================================
// AYARLAR
// =====================================================
const URLS = [
  "https://expeditioncapetown.com/",
  "https://expeditioncapetown.com/turlar",
  "https://expeditioncapetown.com/vip",
  "https://expeditioncapetown.com/hakkimizda",
  "https://expeditioncapetown.com/iletisim",
  "https://expeditioncapetown.com/blog",
  "https://expeditioncapetown.com/hizmetlerimiz",
  "https://expeditioncapetown.com/blog/camps-bay-gezi-rehberi",
  "https://expeditioncapetown.com/blog/babylonstoren-ciftlik-ve-sarap-deneyimi",
  "https://expeditioncapetown.com/blog/bo-kaap-evleri-ve-renkli-sokaklar",
  "https://expeditioncapetown.com/blog/boulders-beach-penguenleri",
  "https://expeditioncapetown.com/blog/cape-point-ucurumlar-ve-vahsi-doga",
  "https://expeditioncapetown.com/blog/cape-of-good-hope-dalgalar-ve-ucsuz-manzara",
  "https://expeditioncapetown.com/blog/cheetah-outreach-vahsi-yasam-deneyimi",
  "https://expeditioncapetown.com/blog/kirstenbosch-bahceleri-ve-doga-yuruyusu",
  "https://expeditioncapetown.com/blog/muizenberg-rengarenk-kabinler-ve-sahil-ruhu",
  "https://expeditioncapetown.com/blog/clifton-plajlari-rehberi",
  "https://expeditioncapetown.com/blog/gold-restaurant-deneyimi",
  "https://expeditioncapetown.com/blog/arnolds-restaurant-deneyimi",
  "https://expeditioncapetown.com/blog/lourensford-baglar-gastronomi-ve-sanat",
  "https://expeditioncapetown.com/blog/safari-vahsi-yasam-deneyimi",
  "https://expeditioncapetown.com/blog/signal-hill-gun-batimi-ve-seyir-noktalari",
  "https://expeditioncapetown.com/blog/stellenbosch-gezi-ve-bag-kasabasi-rehberi",
  "https://expeditioncapetown.com/blog/table-mountain-zirve-ve-teleferik-rehberi",
  "https://expeditioncapetown.com/blog/the-companys-garden-sehir-icinde-doga-rehberi",
  "https://expeditioncapetown.com/blog/two-oceans-aquarium-deneyim-rehberi",
  "https://expeditioncapetown.com/blog/waterfront-marina-ve-liman-atmosferi-rehberi",
  "https://expeditioncapetown.com/blog/chapmans-peak-drive-manzarali-sahil-yolu-rehberi",
  "https://expeditioncapetown.com/blog/alpaka-coffee-ve-lama-ciftligi-deneyimi",
];

// Sitemap veya txt dosyasından okumak istersen:
// const URLS = fs.readFileSync("urls.txt", "utf-8").trim().split("\n");

const TIMEOUT = 20000;
const WAIT_AFTER_LOAD = 3000;

// =====================================================
// SEO TEST FONKSİYONLARI
// =====================================================

async function auditPage(page, url) {
  const result = {
    url,
    timestamp: new Date().toISOString(),
    status: null,
    redirected: false,
    finalUrl: null,
    loadTime: null,
    errors: [],
    warnings: [],
    passed: [],

    // Meta
    title: null,
    titleLength: null,
    metaDescription: null,
    metaDescriptionLength: null,
    canonical: null,
    canonicalMatch: false,
    robots: null,
    viewport: null,
    charset: null,
    language: null,

    // Headings
    h1: [],
    h2Count: 0,
    headingOrder: [],

    // Open Graph
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogUrl: null,
    ogType: null,

    // Twitter Card
    twitterCard: null,
    twitterTitle: null,
    twitterDescription: null,
    twitterImage: null,

    // Structured Data
    jsonLdSchemas: [],
    jsonLdErrors: [],

    // Images
    totalImages: 0,
    imagesWithoutAlt: 0,
    imagesWithoutDimensions: 0,
    lazyLoadedImages: 0,

    // Links
    totalInternalLinks: 0,
    totalExternalLinks: 0,
    linksWithoutHref: 0,
    linksWithTargetBlank: 0,
    linksWithoutRel: 0,
    orphanAnchors: 0,

    // Performance
    resourceCount: 0,
    totalTransferSize: 0,
    renderBlockingResources: [],
    largeResources: [],

    // Security & Headers
    https: false,
    hsts: null,
    xFrameOptions: null,
    contentSecurityPolicy: null,

    // Core Web Vitals (basic)
    lcp: null,
    cls: null,
    domContentLoaded: null,
    fullyLoaded: null,

    // Misc
    iframeCount: 0,
    inlineStyles: 0,
    consoleLogs: [],
    jsErrors: [],
    brokenResourceUrls: [],
    hreflangTags: [],
    wordCount: 0,
  };

  try {
    // JS hatalarını dinle
    page.on("pageerror", (err) => {
      result.jsErrors.push(err.message);
    });

    // Konsol mesajlarını dinle
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        result.consoleLogs.push({ type: msg.type(), text: msg.text() });
      }
    });

    // Broken resource'ları yakala
    page.on("requestfailed", (req) => {
      result.brokenResourceUrls.push({
        url: req.url(),
        error: req.failure()?.errorText || "unknown",
      });
    });

    // Network metrikleri
    let resourceCount = 0;
    let totalSize = 0;
    const renderBlocking = [];
    const largeResources = [];

    page.on("response", async (response) => {
      resourceCount++;
      const headers = response.headers();
      const size = parseInt(headers["content-length"] || "0", 10);
      totalSize += size;

      if (size > 500000) {
        largeResources.push({ url: response.url(), size: Math.round(size / 1024) + "KB" });
      }
    });

    // Sayfaya git ve süreyi ölç
    const startTime = Date.now();

    const response = await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });

    await page.waitForTimeout(WAIT_AFTER_LOAD);

    const loadTime = Date.now() - startTime;

    // Temel bilgiler
    result.status = response?.status();
    result.finalUrl = page.url();
    result.redirected = url.replace(/\/$/, "") !== result.finalUrl.replace(/\/$/, "");
    result.loadTime = loadTime;
    result.https = page.url().startsWith("https");
    result.resourceCount = resourceCount;
    result.totalTransferSize = Math.round(totalSize / 1024) + "KB";
    result.largeResources = largeResources;

    // Response headers
    const respHeaders = response?.headers() || {};
    result.hsts = respHeaders["strict-transport-security"] || null;
    result.xFrameOptions = respHeaders["x-frame-options"] || null;
    result.contentSecurityPolicy = respHeaders["content-security-policy"] ? "present" : null;

    // ==================== DOM ANALİZİ ====================
    const seoData = await page.evaluate(() => {
      const getMeta = (name) => {
        const el =
          document.querySelector(`meta[name="${name}"]`) ||
          document.querySelector(`meta[property="${name}"]`) ||
          document.querySelector(`meta[http-equiv="${name}"]`);
        return el ? el.getAttribute("content") : null;
      };

      // Title
      const title = document.title || null;

      // Meta
      const metaDescription = getMeta("description");
      const robots = getMeta("robots");
      const viewport = getMeta("viewport");
      const charset =
        document.querySelector("meta[charset]")?.getAttribute("charset") ||
        getMeta("Content-Type");
      const language = document.documentElement.lang || null;

      // Canonical
      const canonicalEl = document.querySelector('link[rel="canonical"]');
      const canonical = canonicalEl ? canonicalEl.href : null;

      // Headings
      const h1Elements = Array.from(document.querySelectorAll("h1")).map((el) => el.innerText.trim());
      const h2Count = document.querySelectorAll("h2").length;
      const headingOrder = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(
        (el) => el.tagName
      );

      // Open Graph
      const ogTitle = getMeta("og:title");
      const ogDescription = getMeta("og:description");
      const ogImage = getMeta("og:image");
      const ogUrl = getMeta("og:url");
      const ogType = getMeta("og:type");

      // Twitter Card
      const twitterCard = getMeta("twitter:card");
      const twitterTitle = getMeta("twitter:title");
      const twitterDescription = getMeta("twitter:description");
      const twitterImage = getMeta("twitter:image");

      // Structured Data (JSON-LD)
      const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const jsonLdSchemas = [];
      const jsonLdErrors = [];

      jsonLdScripts.forEach((script, i) => {
        try {
          const parsed = JSON.parse(script.textContent);
          jsonLdSchemas.push({
            index: i,
            type: parsed["@type"] || (parsed["@graph"] ? "Graph" : "unknown"),
            hasContext: !!parsed["@context"],
          });
        } catch (e) {
          jsonLdErrors.push({ index: i, error: e.message });
        }
      });

      // Images
      const images = Array.from(document.querySelectorAll("img"));
      const totalImages = images.length;
      const imagesWithoutAlt = images.filter(
        (img) => !img.hasAttribute("alt") || img.alt.trim() === ""
      ).length;
      const imagesWithoutDimensions = images.filter(
        (img) => !img.hasAttribute("width") && !img.hasAttribute("height")
      ).length;
      const lazyLoadedImages = images.filter((img) => img.loading === "lazy").length;

      // Links
      const links = Array.from(document.querySelectorAll("a"));
      const currentHost = window.location.hostname;
      let internalLinks = 0;
      let externalLinks = 0;
      let linksWithoutHref = 0;
      let orphanAnchors = 0;
      let linksWithTargetBlank = 0;
      let linksWithoutRel = 0;

      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (!href || href === "#" || href === "javascript:void(0)") {
          linksWithoutHref++;
          return;
        }
        if (href.startsWith("#")) {
          orphanAnchors++;
          return;
        }
        try {
          const linkUrl = new URL(href, window.location.origin);
          if (linkUrl.hostname === currentHost || linkUrl.hostname.endsWith("." + currentHost)) {
            internalLinks++;
          } else {
            externalLinks++;
            if (link.target === "_blank" && !link.getAttribute("rel")?.includes("noopener")) {
              linksWithoutRel++;
            }
          }
        } catch { }
        if (link.target === "_blank") linksWithTargetBlank++;
      });

      // Hreflang
      const hreflangTags = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
        (el) => ({ lang: el.hreflang, href: el.href })
      );

      // Misc
      const iframeCount = document.querySelectorAll("iframe").length;
      const inlineStyles = document.querySelectorAll("[style]").length;
      const wordCount = document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0;

      return {
        title,
        metaDescription,
        robots,
        viewport,
        charset,
        language,
        canonical,
        h1Elements,
        h2Count,
        headingOrder,
        ogTitle,
        ogDescription,
        ogImage,
        ogUrl,
        ogType,
        twitterCard,
        twitterTitle,
        twitterDescription,
        twitterImage,
        jsonLdSchemas,
        jsonLdErrors,
        totalImages,
        imagesWithoutAlt,
        imagesWithoutDimensions,
        lazyLoadedImages,
        totalInternalLinks: internalLinks,
        totalExternalLinks: externalLinks,
        linksWithoutHref,
        orphanAnchors,
        linksWithTargetBlank,
        linksWithoutRel,
        hreflangTags,
        iframeCount,
        inlineStyles,
        wordCount,
      };
    });

    // seoData'yı result'a aktar
    Object.assign(result, seoData);
    result.h1 = seoData.h1Elements;
    result.titleLength = seoData.title ? seoData.title.length : 0;
    result.metaDescriptionLength = seoData.metaDescription ? seoData.metaDescription.length : 0;
    result.canonicalMatch = seoData.canonical === result.finalUrl;

    // ==================== CWV (Basit) ====================
    const cwv = await page.evaluate(() => {
      const timing = performance.timing;
      return {
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        fullyLoaded: timing.loadEventEnd - timing.navigationStart,
      };
    });

    result.domContentLoaded = cwv.domContentLoaded;
    result.fullyLoaded = cwv.fullyLoaded;

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
    } catch { }

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
    } catch { }

    // ==================== SEO KURALLARI ====================
    validateSeo(result);

  } catch (err) {
    result.errors.push("PAGE_LOAD_FAILED: " + err.message);
  }

  return result;
}

// =====================================================
// DOĞRULAMA KURALLARI
// =====================================================
function validateSeo(r) {
  // Title
  if (!r.title) r.errors.push("Title etiketi eksik");
  else if (r.titleLength < 30) r.warnings.push(`Title çok kısa (${r.titleLength} karakter)`);
  else if (r.titleLength > 60) r.warnings.push(`Title çok uzun (${r.titleLength} karakter)`);
  else r.passed.push("Title uzunluğu uygun");

  // Meta Description
  if (!r.metaDescription) r.errors.push("Meta description eksik");
  else if (r.metaDescriptionLength < 120) r.warnings.push(`Meta description kısa (${r.metaDescriptionLength} karakter)`);
  else if (r.metaDescriptionLength > 160) r.warnings.push(`Meta description uzun (${r.metaDescriptionLength} karakter)`);
  else r.passed.push("Meta description uzunluğu uygun");

  // Canonical
  if (!r.canonical) r.errors.push("Canonical etiketi eksik");
  else if (!r.canonicalMatch) r.warnings.push(`Canonical URL eşleşmiyor: ${r.canonical}`);
  else r.passed.push("Canonical doğru");

  // H1
  if (r.h1.length === 0) r.errors.push("H1 etiketi eksik");
  else if (r.h1.length > 1) r.warnings.push(`Birden fazla H1 (${r.h1.length} adet)`);
  else r.passed.push("Tek H1 mevcut");

  // Heading sıralaması
  const headings = r.headingOrder || [];
  if (headings.length > 0 && headings[0] !== "H1") {
    r.warnings.push("İlk heading H1 değil: " + headings[0]);
  }
  for (let i = 1; i < headings.length; i++) {
    const prev = parseInt(headings[i - 1].replace("H", ""));
    const curr = parseInt(headings[i].replace("H", ""));
    if (curr > prev + 1) {
      r.warnings.push(`Heading sırası atlanmış: ${headings[i - 1]} → ${headings[i]}`);
      break;
    }
  }

  // Open Graph
  if (!r.ogTitle) r.warnings.push("og:title eksik");
  if (!r.ogDescription) r.warnings.push("og:description eksik");
  if (!r.ogImage) r.warnings.push("og:image eksik");
  if (!r.ogUrl) r.warnings.push("og:url eksik");
  if (r.ogTitle && r.ogDescription && r.ogImage && r.ogUrl) r.passed.push("Open Graph etiketleri tam");

  // Twitter Card
  if (!r.twitterCard) r.warnings.push("twitter:card eksik");

  // JSON-LD
  if (r.jsonLdSchemas.length === 0) r.warnings.push("JSON-LD structured data bulunamadı");
  else r.passed.push(`${r.jsonLdSchemas.length} adet JSON-LD schema mevcut`);
  if (r.jsonLdErrors.length > 0) r.errors.push(`${r.jsonLdErrors.length} adet JSON-LD parse hatası`);

  // Images
  if (r.imagesWithoutAlt > 0) r.warnings.push(`${r.imagesWithoutAlt} resimde alt etiketi eksik`);
  else if (r.totalImages > 0) r.passed.push("Tüm resimlerde alt etiketi var");

  // Links
  if (r.linksWithoutHref > 0) r.warnings.push(`${r.linksWithoutHref} link href'siz veya boş`);
  if (r.linksWithoutRel > 0) r.warnings.push(`${r.linksWithoutRel} external target=_blank linkte rel=noopener eksik`);

  // Robots
  if (r.robots && (r.robots.includes("noindex") || r.robots.includes("nofollow"))) {
    r.warnings.push(`Robots meta: ${r.robots}`);
  }

  // Viewport
  if (!r.viewport) r.errors.push("Viewport meta etiketi eksik");
  else r.passed.push("Viewport mevcut");

  // Lang
  if (!r.language) r.warnings.push("HTML lang attribute eksik");
  else r.passed.push(`HTML lang: ${r.language}`);

  // HTTPS
  if (!r.https) r.errors.push("Sayfa HTTPS değil");
  else r.passed.push("HTTPS aktif");

  // Performance
  if (r.loadTime > 5000) r.warnings.push(`Yavaş yükleme: ${r.loadTime}ms`);
  if (r.lcp && r.lcp > 2500) r.warnings.push(`LCP yüksek: ${Math.round(r.lcp)}ms`);
  if (r.cls && r.cls > 0.1) r.warnings.push(`CLS yüksek: ${r.cls}`);

  // Content
  if (r.wordCount < 300) r.warnings.push(`Düşük kelime sayısı: ${r.wordCount}`);

  // JS Errors
  if (r.jsErrors.length > 0) r.warnings.push(`${r.jsErrors.length} adet JS hatası`);

  // Broken Resources
  if (r.brokenResourceUrls.length > 0) r.errors.push(`${r.brokenResourceUrls.length} adet kırık kaynak`);
}

// =====================================================
// RAPOR OLUŞTUR
// =====================================================
function generateReport(results) {
  let report = "";
  report += "╔══════════════════════════════════════════════════════════════╗\n";
  report += "║          TVPLUS TEKNİK SEO AUDIT RAPORU                    ║\n";
  report += "║          " + new Date().toLocaleString("tr-TR") + "                       ║\n";
  report += "╚══════════════════════════════════════════════════════════════╝\n\n";

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalPassed = 0;

  results.forEach((r, i) => {
    report += `\n${"─".repeat(60)}\n`;
    report += `📄 ${r.url}\n`;
    if (r.redirected) report += `   🔀 → ${r.finalUrl}\n`;
    report += `   Status: ${r.status} | Load: ${r.loadTime}ms | Words: ${r.wordCount}\n`;
    report += `${"─".repeat(60)}\n`;

    // Meta bilgileri
    report += `\n   📋 META BİLGİLERİ\n`;
    report += `   Title: ${r.title || "YOK"} (${r.titleLength} kar.)\n`;
    report += `   Description: ${r.metaDescription ? r.metaDescription.substring(0, 80) + "..." : "YOK"} (${r.metaDescriptionLength} kar.)\n`;
    report += `   Canonical: ${r.canonical || "YOK"} ${r.canonicalMatch ? "✅" : "⚠️"}\n`;
    report += `   Robots: ${r.robots || "belirtilmemiş"}\n`;
    report += `   Lang: ${r.language || "YOK"} | Viewport: ${r.viewport ? "var" : "YOK"}\n`;

    // Headings
    report += `\n   📑 HEADINGS\n`;
    report += `   H1: ${r.h1.length > 0 ? r.h1.join(" | ") : "YOK"}\n`;
    report += `   H2 sayısı: ${r.h2Count}\n`;

    // OG & Twitter
    report += `\n   🌐 SOCIAL TAGS\n`;
    report += `   OG: title=${r.ogTitle ? "✅" : "❌"} desc=${r.ogDescription ? "✅" : "❌"} img=${r.ogImage ? "✅" : "❌"} url=${r.ogUrl ? "✅" : "❌"}\n`;
    report += `   Twitter: card=${r.twitterCard ? "✅" : "❌"} title=${r.twitterTitle ? "✅" : "❌"} img=${r.twitterImage ? "✅" : "❌"}\n`;

    // Structured Data
    report += `\n   📊 STRUCTURED DATA\n`;
    if (r.jsonLdSchemas.length > 0) {
      r.jsonLdSchemas.forEach((s) => {
        report += `   ✅ JSON-LD: ${s.type} (context: ${s.hasContext})\n`;
      });
    } else {
      report += `   ⚠️ JSON-LD bulunamadı\n`;
    }
    if (r.jsonLdErrors.length > 0) {
      r.jsonLdErrors.forEach((e) => {
        report += `   ❌ JSON-LD Parse Hatası #${e.index}: ${e.error}\n`;
      });
    }

    // Images & Links
    report += `\n   🖼️ IMAGES: ${r.totalImages} toplam | ${r.imagesWithoutAlt} alt eksik | ${r.lazyLoadedImages} lazy\n`;
    report += `   🔗 LINKS: ${r.totalInternalLinks} internal | ${r.totalExternalLinks} external | ${r.linksWithoutHref} href'siz\n`;

    // Performance
    report += `\n   ⚡ PERFORMANCE\n`;
    report += `   Load: ${r.loadTime}ms | DOM Ready: ${r.domContentLoaded}ms | Full: ${r.fullyLoaded}ms\n`;
    report += `   LCP: ${r.lcp ? Math.round(r.lcp) + "ms" : "N/A"} | CLS: ${r.cls ?? "N/A"}\n`;
    report += `   Resources: ${r.resourceCount} | Transfer: ${r.totalTransferSize}\n`;

    if (r.largeResources.length > 0) {
      report += `   Büyük dosyalar:\n`;
      r.largeResources.forEach((lr) => report += `     ⚠️ ${lr.size} - ${lr.url.substring(0, 80)}\n`);
    }

    // Broken resources
    if (r.brokenResourceUrls.length > 0) {
      report += `\n   💔 KIRIK KAYNAKLAR\n`;
      r.brokenResourceUrls.forEach((br) => {
        report += `   ❌ ${br.error} - ${br.url.substring(0, 80)}\n`;
      });
    }

    // JS Errors
    if (r.jsErrors.length > 0) {
      report += `\n   🐛 JS HATALARI\n`;
      r.jsErrors.slice(0, 5).forEach((e) => report += `   ❌ ${e.substring(0, 100)}\n`);
      if (r.jsErrors.length > 5) report += `   ... ve ${r.jsErrors.length - 5} hata daha\n`;
    }

    // Sonuçlar
    report += `\n   ✅ PASSED (${r.passed.length})\n`;
    r.passed.forEach((p) => (report += `      ✅ ${p}\n`));

    report += `\n   ⚠️ WARNINGS (${r.warnings.length})\n`;
    r.warnings.forEach((w) => (report += `      ⚠️ ${w}\n`));

    report += `\n   ❌ ERRORS (${r.errors.length})\n`;
    r.errors.forEach((e) => (report += `      ❌ ${e}\n`));

    totalErrors += r.errors.length;
    totalWarnings += r.warnings.length;
    totalPassed += r.passed.length;
  });

  // Genel özet
  report += `\n\n${"═".repeat(60)}\n`;
  report += `GENEL ÖZET\n`;
  report += `${"═".repeat(60)}\n`;
  report += `Taranan sayfa: ${results.length}\n`;
  report += `Toplam ✅ Passed: ${totalPassed}\n`;
  report += `Toplam ⚠️ Warning: ${totalWarnings}\n`;
  report += `Toplam ❌ Error: ${totalErrors}\n`;
  report += `${"═".repeat(60)}\n`;

  return report;
}

// =====================================================
// ANA FONKSİYON
// =====================================================
async function main() {
  console.log("🔍 Teknik SEO audit başlatılıyor...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });

  const results = [];

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i];
    console.log(`[${i + 1}/${URLS.length}] Taranıyor: ${url}`);

    const page = await context.newPage();
    const result = await auditPage(page, url);
    results.push(result);
    await page.close();

    const errCount = result.errors.length;
    const warnCount = result.warnings.length;
    console.log(`   → ✅ ${result.passed.length} passed | ⚠️ ${warnCount} warning | ❌ ${errCount} error\n`);
  }

  await browser.close();

  // Raporları kaydet
  const textReport = generateReport(results);
  fs.writeFileSync("seo-audit-report.txt", textReport);
  console.log(textReport);

  // JSON detay raporu
  fs.writeFileSync("seo-audit-detail.json", JSON.stringify(results, null, 2));

  console.log("\n📁 Raporlar kaydedildi:");
  console.log("   → seo-audit-report.txt (özet)");
  console.log("   → seo-audit-detail.json (detay)");
}

main();
