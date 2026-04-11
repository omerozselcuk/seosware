const { chromium } = require("playwright");
const fs = require("fs");

// =====================================================
// AYARLAR
// =====================================================
const URLS = [
  "https://www.tvplus.com.tr",
  "https://www.tvplus.com.tr/paketler",
  // Test etmek istediğin URL'leri ekle
];

// Sitemap veya txt dosyasından okumak istersen:
// const URLS = fs.readFileSync("urls.txt", "utf-8").trim().split("\n");

const SITEMAP_URL = null; // Sitemap karşılaştırması için: "https://www.tvplus.com.tr/sitemap.xml"
const ROBOTS_TXT_URL = null; // robots.txt kontrolü için: "https://www.tvplus.com.tr/robots.txt"

const TIMEOUT = 25000;
const WAIT_AFTER_LOAD = 3000;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// =====================================================
// YARDIMCI FONKSİYONLAR
// =====================================================

function cosineSimilarity(textA, textB) {
  const wordsA = textA.toLowerCase().split(/\s+/).filter(Boolean);
  const wordsB = textB.toLowerCase().split(/\s+/).filter(Boolean);
  const vocab = new Set([...wordsA, ...wordsB]);
  const vecA = {};
  const vecB = {};
  vocab.forEach((w) => {
    vecA[w] = 0;
    vecB[w] = 0;
  });
  wordsA.forEach((w) => vecA[w]++);
  wordsB.forEach((w) => vecB[w]++);
  let dot = 0, magA = 0, magB = 0;
  vocab.forEach((w) => {
    dot += vecA[w] * vecB[w];
    magA += vecA[w] * vecA[w];
    magB += vecB[w] * vecB[w];
  });
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function fetchSitemap(page, sitemapUrl) {
  try {
    const response = await page.goto(sitemapUrl, { timeout: 15000 });
    const content = await response.text();
    const urls = [];
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = locRegex.exec(content)) !== null) {
      urls.push(match[1].trim());
    }
    return urls;
  } catch (e) {
    return [];
  }
}

async function fetchRobotsTxt(page, robotsUrl) {
  try {
    const response = await page.goto(robotsUrl, { timeout: 10000 });
    const content = await response.text();
    const rules = { disallow: [], allow: [], sitemaps: [] };
    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().startsWith("disallow:")) {
        rules.disallow.push(trimmed.split(":").slice(1).join(":").trim());
      } else if (trimmed.toLowerCase().startsWith("allow:")) {
        rules.allow.push(trimmed.split(":").slice(1).join(":").trim());
      } else if (trimmed.toLowerCase().startsWith("sitemap:")) {
        rules.sitemaps.push(trimmed.split(":").slice(1).join(":").trim());
      }
    });
    return rules;
  } catch (e) {
    return null;
  }
}

function isBlockedByRobots(url, robotsRules) {
  if (!robotsRules) return false;
  const urlPath = new URL(url).pathname;
  for (const rule of robotsRules.disallow) {
    if (rule && urlPath.startsWith(rule)) {
      let allowed = false;
      for (const allowRule of robotsRules.allow) {
        if (allowRule && urlPath.startsWith(allowRule)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) return true;
    }
  }
  return false;
}

// =====================================================
// TEMEL SEO AUDIT
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
    internalLinkUrls: [],

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
    mixedContent: [],

    // Core Web Vitals
    lcp: null,
    cls: null,
    inp: null,
    domContentLoaded: null,
    fullyLoaded: null,
    longTasks: [],
    unusedCssPercent: null,
    unusedJsPercent: null,

    // Rendering
    rawHtml: null,
    renderedHtml: null,
    renderDifference: false,
    hydrationErrors: [],

    // Lazy Load
    lazyLoadVerified: [],

    // Pagination
    relNext: null,
    relPrev: null,
    hasInfiniteScroll: false,

    // Hreflang
    hreflangTags: [],
    hreflangSelfRef: false,
    hreflangReturnLinks: [],

    // Accessibility
    missingAriaLabels: 0,
    lowContrastElements: 0,
    smallTapTargets: 0,
    tabOrderIssues: 0,
    fontSizeIssues: 0,

    // Misc
    iframeCount: 0,
    inlineStyles: 0,
    consoleLogs: [],
    jsErrors: [],
    brokenResourceUrls: [],
    wordCount: 0,
    bodyText: "",

    // Robots.txt
    blockedByRobots: false,
  };

  try {
    // JS hatalarını dinle
    page.on("pageerror", (err) => {
      result.jsErrors.push(err.message);
      // Hydration hataları
      if (
        err.message.includes("Hydration") ||
        err.message.includes("hydrat") ||
        err.message.includes("mismatch") ||
        err.message.includes("did not match") ||
        err.message.includes("server-rendered")
      ) {
        result.hydrationErrors.push(err.message);
      }
    });

    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error" || msg.type() === "warning") {
        result.consoleLogs.push({ type: msg.type(), text });
      }
      if (
        text.includes("Hydration") ||
        text.includes("hydrat") ||
        text.includes("did not match") ||
        text.includes("server-rendered")
      ) {
        result.hydrationErrors.push(text);
      }
    });

    page.on("requestfailed", (req) => {
      result.brokenResourceUrls.push({
        url: req.url(),
        error: req.failure()?.errorText || "unknown",
      });
    });

    // Mixed content kontrolü
    page.on("response", async (response) => {
      const reqUrl = response.url();
      if (url.startsWith("https") && reqUrl.startsWith("http://")) {
        result.mixedContent.push(reqUrl);
      }
    });

    // Network metrikleri
    let resourceCount = 0;
    let totalSize = 0;
    const largeResources = [];
    const renderBlocking = [];

    page.on("response", async (response) => {
      resourceCount++;
      const headers = response.headers();
      const size = parseInt(headers["content-length"] || "0", 10);
      totalSize += size;

      if (size > 500000) {
        largeResources.push({ url: response.url(), size: Math.round(size / 1024) + "KB" });
      }
    });

    // ========== RAW HTML (JS öncesi) ==========
    let rawHtmlContent = "";
    try {
      const rawResponse = await page.context().newPage().then(async (rawPage) => {
        await rawPage.route("**/*", (route) => {
          const resourceType = route.request().resourceType();
          if (resourceType === "script") {
            route.abort();
          } else {
            route.continue();
          }
        });
        try {
          await rawPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
          rawHtmlContent = await rawPage.content();
        } catch {}
        await rawPage.close();
        return rawHtmlContent;
      });
    } catch {}

    // ========== RENDERED PAGE ==========
    const startTime = Date.now();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);
    const loadTime = Date.now() - startTime;
    const renderedHtmlContent = await page.content();

    // Rendering karşılaştırması
    if (rawHtmlContent) {
      const rawBody = rawHtmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
      const renderedBody = renderedHtmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
      const rawText = rawBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const renderedText = renderedBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      if (rawText.length > 0 && renderedText.length > 0) {
        const similarity = cosineSimilarity(rawText, renderedText);
        result.renderDifference = similarity < 0.85;
        if (result.renderDifference) {
          result.warnings.push(
            `SSR vs CSR farkı tespit edildi (benzerlik: ${Math.round(similarity * 100)}%). Googlebot farklı içerik görebilir.`
          );
        } else {
          result.passed.push(`SSR vs CSR içerik tutarlı (benzerlik: ${Math.round(similarity * 100)}%)`);
        }
      }
    }

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

      const title = document.title || null;
      const metaDescription = getMeta("description");
      const robots = getMeta("robots");
      const viewport = getMeta("viewport");
      const charset =
        document.querySelector("meta[charset]")?.getAttribute("charset") ||
        getMeta("Content-Type");
      const language = document.documentElement.lang || null;
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

      // JSON-LD
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
      const internalLinkUrls = [];

      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (!href || href === "#" || href === "javascript:void(0)") {
          linksWithoutHref++;
          return;
        }
        if (href.startsWith("#") && href.length > 1) {
          orphanAnchors++;
          return;
        }
        try {
          const linkUrl = new URL(href, window.location.origin);
          if (linkUrl.hostname === currentHost || linkUrl.hostname.endsWith("." + currentHost)) {
            internalLinks++;
            internalLinkUrls.push(linkUrl.href);
          } else {
            externalLinks++;
            if (link.target === "_blank" && !link.getAttribute("rel")?.includes("noopener")) {
              linksWithoutRel++;
            }
          }
        } catch {}
        if (link.target === "_blank") linksWithTargetBlank++;
      });

      // Hreflang
      const hreflangTags = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
        (el) => ({ lang: el.hreflang, href: el.href })
      );
      const hreflangSelfRef = hreflangTags.some((t) => t.href === window.location.href);

      // Pagination
      const relNextEl = document.querySelector('link[rel="next"]');
      const relPrevEl = document.querySelector('link[rel="prev"]');

      // Accessibility
      const interactiveElements = document.querySelectorAll("button, a, input, select, textarea");
      let missingAriaLabels = 0;
      let smallTapTargets = 0;

      interactiveElements.forEach((el) => {
        const hasLabel =
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.getAttribute("title") ||
          el.innerText?.trim();
        if (!hasLabel) missingAriaLabels++;

        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          smallTapTargets++;
        }
      });

      // Tab order kontrolü
      const tabbables = Array.from(document.querySelectorAll("[tabindex]"));
      let tabOrderIssues = 0;
      tabbables.forEach((el) => {
        const idx = parseInt(el.getAttribute("tabindex"));
        if (idx > 0) tabOrderIssues++;
      });

      // Font boyutu kontrolü
      let fontSizeIssues = 0;
      const textElements = document.querySelectorAll("p, span, li, td, th, a, label");
      textElements.forEach((el) => {
        const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
        if (fontSize < 12 && el.innerText?.trim().length > 0) fontSizeIssues++;
      });

      // Kontrast kontrolü (basit)
      let lowContrastElements = 0;
      const sampleElements = document.querySelectorAll("p, h1, h2, h3, a, span, li");
      sampleElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bgColor = style.backgroundColor;
        if (color && bgColor && color === bgColor && el.innerText?.trim().length > 0) {
          lowContrastElements++;
        }
      });

      // Infinite scroll kontrolü
      const hasInfiniteScroll = !!(
        document.querySelector("[data-infinite-scroll]") ||
        document.querySelector(".infinite-scroll") ||
        document.querySelector("[infinite-scroll]")
      );

      // Misc
      const iframeCount = document.querySelectorAll("iframe").length;
      const inlineStyles = document.querySelectorAll("[style]").length;
      const bodyText = document.body?.innerText || "";
      const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

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
        internalLinkUrls,
        hreflangTags,
        hreflangSelfRef,
        relNext: relNextEl ? relNextEl.href : null,
        relPrev: relPrevEl ? relPrevEl.href : null,
        hasInfiniteScroll,
        missingAriaLabels,
        smallTapTargets,
        tabOrderIssues,
        fontSizeIssues,
        lowContrastElements,
        iframeCount,
        inlineStyles,
        wordCount,
        bodyText: bodyText.substring(0, 5000),
      };
    });

    Object.assign(result, seoData);
    result.h1 = seoData.h1Elements;
    result.titleLength = seoData.title ? seoData.title.length : 0;
    result.metaDescriptionLength = seoData.metaDescription ? seoData.metaDescription.length : 0;
    result.canonicalMatch = seoData.canonical === result.finalUrl;

    // ==================== CWV ====================
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
    } catch {}

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
    } catch {}

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
    } catch {}

    // Render-blocking resources
    try {
      result.renderBlockingResources = await page.evaluate(() => {
        const entries = performance.getEntriesByType("resource");
        return entries
          .filter((e) => e.renderBlockingStatus === "blocking")
          .map((e) => ({ url: e.name, duration: Math.round(e.duration) }));
      });
    } catch {}

    // Unused CSS/JS (Coverage API)
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");

      // CSS coverage
      await cdp.send("CSS.startRuleUsageTracking");
      await page.waitForTimeout(1000);
      const cssCoverage = await cdp.send("CSS.stopRuleUsageTracking");
      if (cssCoverage.ruleUsage && cssCoverage.ruleUsage.length > 0) {
        const usedRules = cssCoverage.ruleUsage.filter((r) => r.used).length;
        const totalRules = cssCoverage.ruleUsage.length;
        result.unusedCssPercent = Math.round(((totalRules - usedRules) / totalRules) * 100);
      }

      await cdp.detach();
    } catch {}

    // ==================== LAZY LOAD KONTROLÜ ====================
    try {
      const lazyImages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img[loading="lazy"]'))
          .slice(0, 5)
          .map((img) => ({
            src: img.src || img.dataset.src || img.getAttribute("data-lazy") || "",
            loaded: img.complete && img.naturalWidth > 0,
            inViewport: img.getBoundingClientRect().top < window.innerHeight,
          }));
      });

      // Scroll aşağı ve tekrar kontrol et
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      const lazyImagesAfterScroll = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img[loading="lazy"]'))
          .slice(0, 5)
          .map((img) => ({
            src: img.src || img.dataset.src || "",
            loaded: img.complete && img.naturalWidth > 0,
          }));
      });

      result.lazyLoadVerified = lazyImages.map((img, i) => ({
        src: img.src.substring(0, 80),
        wasInViewport: img.inViewport,
        loadedBefore: img.loaded,
        loadedAfterScroll: lazyImagesAfterScroll[i]?.loaded || false,
      }));

      // Scroll'u sıfırla
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch {}

    // ==================== DOĞRULAMA ====================
    validateSeo(result);

  } catch (err) {
    result.errors.push("PAGE_LOAD_FAILED: " + err.message);
  }

  return result;
}

// =====================================================
// MOBİL AUDIT
// =====================================================

async function auditMobile(context, url) {
  const mobileResult = {
    url,
    mobileDifferences: [],
    smallTapTargets: 0,
    fontSizeIssues: 0,
    horizontalScroll: false,
    viewportOverflow: false,
    mobileTitle: null,
    mobileH1: [],
  };

  try {
    const mobileBrowser = await chromium.launch({ headless: true });
    const mobileContext = await mobileBrowser.newContext({
      viewport: MOBILE_VIEWPORT,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
      isMobile: true,
      hasTouch: true,
    });

    const page = await mobileContext.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);

    const mobileData = await page.evaluate((mobileViewport) => {
      const title = document.title;
      const h1 = Array.from(document.querySelectorAll("h1")).map((el) => el.innerText.trim());

      // Tap target kontrolü
      let smallTapTargets = 0;
      const interactiveElements = document.querySelectorAll("button, a, input, select, textarea");
      interactiveElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          smallTapTargets++;
        }
      });

      // Font boyutu
      let fontSizeIssues = 0;
      const textElements = document.querySelectorAll("p, span, li, td, th, a");
      textElements.forEach((el) => {
        const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
        if (fontSize < 12 && el.innerText?.trim().length > 0) fontSizeIssues++;
      });

      // Horizontal scroll
      const horizontalScroll = document.documentElement.scrollWidth > mobileViewport.width;

      // Viewport overflow
      const viewportOverflow = document.body.scrollWidth > mobileViewport.width;

      return { title, h1, smallTapTargets, fontSizeIssues, horizontalScroll, viewportOverflow };
    }, MOBILE_VIEWPORT);

    Object.assign(mobileResult, mobileData);

    await page.close();
    await mobileContext.close();
    await mobileBrowser.close();
  } catch (e) {
    mobileResult.mobileDifferences.push("Mobil test hatası: " + e.message);
  }

  return mobileResult;
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

  if (r.imagesWithoutDimensions > 0) r.warnings.push(`${r.imagesWithoutDimensions} resimde width/height eksik (CLS riski)`);

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

  // Mixed content
  if (r.mixedContent.length > 0) r.errors.push(`${r.mixedContent.length} adet mixed content (HTTP kaynak HTTPS sayfada)`);
  else r.passed.push("Mixed content yok");

  // Performance
  if (r.loadTime > 5000) r.warnings.push(`Yavaş yükleme: ${r.loadTime}ms`);
  if (r.lcp && r.lcp > 2500) r.warnings.push(`LCP yüksek: ${Math.round(r.lcp)}ms`);
  if (r.cls && r.cls > 0.1) r.warnings.push(`CLS yüksek: ${r.cls}`);

  // Long tasks
  if (r.longTasks.length > 0) {
    const longest = Math.max(...r.longTasks.map((t) => t.duration));
    r.warnings.push(`${r.longTasks.length} adet long task (en uzun: ${longest}ms)`);
  } else {
    r.passed.push("Long task yok (50ms+ JS blokları)");
  }

  // Render-blocking
  if (r.renderBlockingResources.length > 0) {
    r.warnings.push(`${r.renderBlockingResources.length} adet render-blocking kaynak`);
  }

  // Unused CSS
  if (r.unusedCssPercent && r.unusedCssPercent > 50) {
    r.warnings.push(`Kullanılmayan CSS oranı yüksek: %${r.unusedCssPercent}`);
  }

  // Hydration
  if (r.hydrationErrors.length > 0) {
    r.errors.push(`${r.hydrationErrors.length} adet hydration hatası`);
  } else {
    r.passed.push("Hydration hatası yok");
  }

  // Content
  if (r.wordCount < 300) r.warnings.push(`Düşük kelime sayısı: ${r.wordCount}`);

  // Hreflang
  if (r.hreflangTags.length > 0) {
    if (!r.hreflangSelfRef) r.warnings.push("Hreflang self-reference eksik");
    else r.passed.push("Hreflang self-reference mevcut");
  }

  // Pagination
  if (r.relNext || r.relPrev) r.passed.push("Pagination linkleri mevcut");
  if (r.hasInfiniteScroll) r.warnings.push("Infinite scroll tespit edildi - SEO dostu pagination kontrol et");

  // Accessibility
  if (r.missingAriaLabels > 0) r.warnings.push(`${r.missingAriaLabels} etkileşimli elementte aria-label eksik`);
  if (r.smallTapTargets > 0) r.warnings.push(`${r.smallTapTargets} element 44x44px minimum tap target boyutunun altında`);
  if (r.tabOrderIssues > 0) r.warnings.push(`${r.tabOrderIssues} element pozitif tabindex kullanıyor (anti-pattern)`);
  if (r.fontSizeIssues > 0) r.warnings.push(`${r.fontSizeIssues} metin elementi 12px altında font boyutuna sahip`);
  if (r.lowContrastElements > 0) r.warnings.push(`${r.lowContrastElements} element düşük kontrasta sahip`);

  // JS Errors
  if (r.jsErrors.length > 0) r.warnings.push(`${r.jsErrors.length} adet JS hatası`);

  // Broken Resources
  if (r.brokenResourceUrls.length > 0) r.errors.push(`${r.brokenResourceUrls.length} adet kırık kaynak`);

  // Redirect
  if (r.redirected) r.warnings.push(`Client-side redirect: ${r.url} → ${r.finalUrl}`);
}

// =====================================================
// CROSS-PAGE ANALİZLER
// =====================================================

function crossPageAnalysis(results) {
  const analysis = {
    duplicateTitles: [],
    duplicateDescriptions: [],
    nearDuplicateContent: [],
    orphanPages: [],
    crawlDepth: {},
    internalLinkGraph: {},
  };

  // Duplicate title/description kontrolü
  const titleMap = {};
  const descMap = {};

  results.forEach((r) => {
    if (r.title) {
      if (!titleMap[r.title]) titleMap[r.title] = [];
      titleMap[r.title].push(r.url);
    }
    if (r.metaDescription) {
      if (!descMap[r.metaDescription]) descMap[r.metaDescription] = [];
      descMap[r.metaDescription].push(r.url);
    }
  });

  Object.entries(titleMap).forEach(([title, urls]) => {
    if (urls.length > 1) analysis.duplicateTitles.push({ title, urls });
  });

  Object.entries(descMap).forEach(([desc, urls]) => {
    if (urls.length > 1) analysis.duplicateDescriptions.push({ description: desc.substring(0, 80), urls });
  });

  // Near-duplicate content kontrolü
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const textA = results[i].bodyText || "";
      const textB = results[j].bodyText || "";
      if (textA.length > 200 && textB.length > 200) {
        const similarity = cosineSimilarity(textA, textB);
        if (similarity > 0.85) {
          analysis.nearDuplicateContent.push({
            urlA: results[i].url,
            urlB: results[j].url,
            similarity: Math.round(similarity * 100) + "%",
          });
        }
      }
    }
  }

  // Internal link graph & orphan page tespiti
  const allUrls = new Set(results.map((r) => r.finalUrl || r.url));
  const linkedUrls = new Set();

  results.forEach((r) => {
    const sourceUrl = r.finalUrl || r.url;
    analysis.internalLinkGraph[sourceUrl] = r.internalLinkUrls || [];
    (r.internalLinkUrls || []).forEach((link) => linkedUrls.add(link.replace(/\/$/, "")));
  });

  allUrls.forEach((url) => {
    const normalized = url.replace(/\/$/, "");
    if (!linkedUrls.has(normalized)) {
      // İlk sayfa (anasayfa) hariç
      const isHomepage = new URL(url).pathname === "/";
      if (!isHomepage) {
        analysis.orphanPages.push(url);
      }
    }
  });

  // Crawl depth hesaplama
  results.forEach((r) => {
    const path = new URL(r.finalUrl || r.url).pathname;
    const depth = path.split("/").filter(Boolean).length;
    analysis.crawlDepth[r.url] = depth;
  });

  return analysis;
}

// =====================================================
// HREFLANG RETURN LINK KONTROLÜ
// =====================================================

async function checkHreflangReturnLinks(context, results) {
  const hreflangIssues = [];

  for (const r of results) {
    if (r.hreflangTags && r.hreflangTags.length > 0) {
      for (const tag of r.hreflangTags.slice(0, 5)) {
        try {
          const page = await context.newPage();
          await page.goto(tag.href, { waitUntil: "domcontentloaded", timeout: 15000 });

          const returnLinks = await page.evaluate((sourceUrl) => {
            const hreflangs = Array.from(
              document.querySelectorAll('link[rel="alternate"][hreflang]')
            ).map((el) => ({ lang: el.hreflang, href: el.href }));
            return {
              hasReturnLink: hreflangs.some((h) => h.href === sourceUrl),
              hreflangs,
            };
          }, r.finalUrl || r.url);

          if (!returnLinks.hasReturnLink) {
            hreflangIssues.push({
              source: r.url,
              target: tag.href,
              targetLang: tag.lang,
              issue: "Return link eksik - hedef sayfada kaynak sayfaya geri link yok",
            });
          }

          await page.close();
        } catch (e) {
          hreflangIssues.push({
            source: r.url,
            target: tag.href,
            targetLang: tag.lang,
            issue: "Hedef sayfa erişilemedi: " + e.message,
          });
        }
      }
    }
  }

  return hreflangIssues;
}

// =====================================================
// RAPOR OLUŞTUR
// =====================================================

function generateReport(results, crossPage, mobileResults, hreflangIssues, sitemapCheck, robotsRules) {
  let report = "";
  report += "╔══════════════════════════════════════════════════════════════════╗\n";
  report += "║        TVPLUS İLERİ TEKNİK SEO AUDIT RAPORU                    ║\n";
  report += "║        " + new Date().toLocaleString("tr-TR") + "                            ║\n";
  report += "╚══════════════════════════════════════════════════════════════════╝\n\n";

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalPassed = 0;

  // ==================== SAYFA BAZLI ====================
  results.forEach((r, i) => {
    report += `\n${"─".repeat(65)}\n`;
    report += `📄 [${i + 1}/${results.length}] ${r.url}\n`;
    if (r.redirected) report += `   🔀 → ${r.finalUrl}\n`;
    report += `   Status: ${r.status} | Load: ${r.loadTime}ms | Words: ${r.wordCount}\n`;
    if (r.blockedByRobots) report += `   🚫 robots.txt tarafından engellenmiş!\n`;
    report += `${"─".repeat(65)}\n`;

    // Meta
    report += `\n   📋 META\n`;
    report += `   Title: ${r.title || "YOK"} (${r.titleLength} kar.)\n`;
    report += `   Desc: ${r.metaDescription ? r.metaDescription.substring(0, 80) + "..." : "YOK"} (${r.metaDescriptionLength} kar.)\n`;
    report += `   Canonical: ${r.canonical || "YOK"} ${r.canonicalMatch ? "✅" : "⚠️"}\n`;
    report += `   Robots: ${r.robots || "belirtilmemiş"} | Lang: ${r.language || "YOK"}\n`;

    // Headings
    report += `\n   📑 HEADINGS\n`;
    report += `   H1: ${r.h1.length > 0 ? r.h1.join(" | ") : "YOK"}\n`;
    report += `   H2: ${r.h2Count} adet | Sıra: ${(r.headingOrder || []).slice(0, 10).join("→")}\n`;

    // Social
    report += `\n   🌐 SOCIAL\n`;
    report += `   OG: title=${r.ogTitle ? "✅" : "❌"} desc=${r.ogDescription ? "✅" : "❌"} img=${r.ogImage ? "✅" : "❌"}\n`;
    report += `   Twitter: card=${r.twitterCard ? "✅" : "❌"} title=${r.twitterTitle ? "✅" : "❌"}\n`;

    // Structured Data
    report += `\n   📊 STRUCTURED DATA\n`;
    if (r.jsonLdSchemas.length > 0) {
      r.jsonLdSchemas.forEach((s) => report += `   ✅ ${s.type}\n`);
    } else {
      report += `   ⚠️ JSON-LD bulunamadı\n`;
    }
    if (r.jsonLdErrors.length > 0) {
      r.jsonLdErrors.forEach((e) => report += `   ❌ Parse hatası #${e.index}: ${e.error}\n`);
    }

    // Images & Links
    report += `\n   🖼️ IMG: ${r.totalImages} toplam | ${r.imagesWithoutAlt} alt eksik | ${r.imagesWithoutDimensions} boyut eksik | ${r.lazyLoadedImages} lazy\n`;
    report += `   🔗 LINK: ${r.totalInternalLinks} internal | ${r.totalExternalLinks} external | ${r.linksWithoutHref} boş\n`;

    // Rendering
    report += `\n   🖥️ RENDERING\n`;
    report += `   SSR vs CSR farkı: ${r.renderDifference ? "⚠️ FARKLI" : "✅ TUTARLI"}\n`;
    if (r.hydrationErrors.length > 0) {
      report += `   ❌ ${r.hydrationErrors.length} hydration hatası\n`;
      r.hydrationErrors.slice(0, 3).forEach((h) => report += `      ${h.substring(0, 100)}\n`);
    }

    // Lazy Load
    if (r.lazyLoadVerified.length > 0) {
      report += `\n   📦 LAZY LOAD\n`;
      r.lazyLoadVerified.forEach((img) => {
        const status = img.loadedAfterScroll ? "✅ Scroll sonrası yüklendi" : "⚠️ Yüklenmedi";
        report += `   ${status}: ${img.src}\n`;
      });
    }

    // Performance
    report += `\n   ⚡ PERFORMANCE\n`;
    report += `   Load: ${r.loadTime}ms | DOM: ${r.domContentLoaded}ms | Full: ${r.fullyLoaded}ms\n`;
    report += `   LCP: ${r.lcp ? Math.round(r.lcp) + "ms" : "N/A"} | CLS: ${r.cls ?? "N/A"}\n`;
    report += `   Resources: ${r.resourceCount} | Transfer: ${r.totalTransferSize}\n`;
    if (r.longTasks.length > 0) {
      report += `   Long Tasks: ${r.longTasks.length} adet (en uzun: ${Math.max(...r.longTasks.map((t) => t.duration))}ms)\n`;
    }
    if (r.renderBlockingResources.length > 0) {
      report += `   Render-blocking: ${r.renderBlockingResources.length} kaynak\n`;
      r.renderBlockingResources.slice(0, 3).forEach((rb) => report += `      ${rb.duration}ms - ${rb.url.substring(0, 70)}\n`);
    }
    if (r.unusedCssPercent) report += `   Unused CSS: %${r.unusedCssPercent}\n`;

    if (r.largeResources.length > 0) {
      report += `   Büyük dosyalar:\n`;
      r.largeResources.forEach((lr) => report += `      ⚠️ ${lr.size} - ${lr.url.substring(0, 70)}\n`);
    }

    // Security
    report += `\n   🔒 GÜVENLİK\n`;
    report += `   HTTPS: ${r.https ? "✅" : "❌"} | HSTS: ${r.hsts ? "✅" : "❌"} | X-Frame: ${r.xFrameOptions || "❌"} | CSP: ${r.contentSecurityPolicy || "❌"}\n`;
    if (r.mixedContent.length > 0) {
      report += `   ❌ Mixed content: ${r.mixedContent.length} kaynak\n`;
      r.mixedContent.slice(0, 3).forEach((mc) => report += `      ${mc.substring(0, 80)}\n`);
    }

    // Accessibility
    report += `\n   ♿ ERİŞİLEBİLİRLİK\n`;
    report += `   Aria-label eksik: ${r.missingAriaLabels} | Küçük tap target: ${r.smallTapTargets}\n`;
    report += `   Font <12px: ${r.fontSizeIssues} | Düşük kontrast: ${r.lowContrastElements} | tabindex>0: ${r.tabOrderIssues}\n`;

    // Broken resources
    if (r.brokenResourceUrls.length > 0) {
      report += `\n   💔 KIRIK KAYNAKLAR\n`;
      r.brokenResourceUrls.slice(0, 5).forEach((br) => report += `   ❌ ${br.error} - ${br.url.substring(0, 70)}\n`);
    }

    // JS Errors
    if (r.jsErrors.length > 0) {
      report += `\n   🐛 JS HATALARI\n`;
      r.jsErrors.slice(0, 5).forEach((e) => report += `   ❌ ${e.substring(0, 100)}\n`);
    }

    // Sonuçlar
    report += `\n   ✅ PASSED (${r.passed.length}) | ⚠️ WARNINGS (${r.warnings.length}) | ❌ ERRORS (${r.errors.length})\n`;
    r.errors.forEach((e) => report += `      ❌ ${e}\n`);
    r.warnings.forEach((w) => report += `      ⚠️ ${w}\n`);
    r.passed.forEach((p) => report += `      ✅ ${p}\n`);

    totalErrors += r.errors.length;
    totalWarnings += r.warnings.length;
    totalPassed += r.passed.length;
  });

  // ==================== MOBİL KARŞILAŞTIRMA ====================
  if (mobileResults.length > 0) {
    report += `\n\n${"═".repeat(65)}\n`;
    report += `📱 MOBİL KARŞILAŞTIRMA\n`;
    report += `${"═".repeat(65)}\n`;

    mobileResults.forEach((m, i) => {
      const desktop = results[i];
      report += `\n   ${m.url}\n`;
      report += `   Mobil tap target <44px: ${m.smallTapTargets}\n`;
      report += `   Mobil font <12px: ${m.fontSizeIssues}\n`;
      report += `   Horizontal scroll: ${m.horizontalScroll ? "⚠️ VAR" : "✅ YOK"}\n`;
      report += `   Viewport overflow: ${m.viewportOverflow ? "⚠️ VAR" : "✅ YOK"}\n`;

      if (desktop && desktop.title !== m.mobileTitle) {
        report += `   ⚠️ Title farklı! Desktop: "${desktop.title}" vs Mobil: "${m.mobileTitle}"\n`;
      }
      if (desktop && JSON.stringify(desktop.h1) !== JSON.stringify(m.mobileH1)) {
        report += `   ⚠️ H1 farklı! Desktop: "${desktop.h1?.join(", ")}" vs Mobil: "${m.mobileH1?.join(", ")}"\n`;
      }
    });
  }

  // ==================== CROSS-PAGE ANALİZ ====================
  report += `\n\n${"═".repeat(65)}\n`;
  report += `🔄 CROSS-PAGE ANALİZ\n`;
  report += `${"═".repeat(65)}\n`;

  // Duplicate titles
  if (crossPage.duplicateTitles.length > 0) {
    report += `\n   ⚠️ DUPLICATE TITLE'LAR\n`;
    crossPage.duplicateTitles.forEach((d) => {
      report += `   "${d.title.substring(0, 60)}" → ${d.urls.length} sayfada kullanılıyor\n`;
      d.urls.forEach((u) => report += `      ${u}\n`);
    });
  } else {
    report += `\n   ✅ Duplicate title yok\n`;
  }

  // Duplicate descriptions
  if (crossPage.duplicateDescriptions.length > 0) {
    report += `\n   ⚠️ DUPLICATE DESCRIPTION'LAR\n`;
    crossPage.duplicateDescriptions.forEach((d) => {
      report += `   "${d.description}..." → ${d.urls.length} sayfada\n`;
      d.urls.forEach((u) => report += `      ${u}\n`);
    });
  } else {
    report += `\n   ✅ Duplicate description yok\n`;
  }

  // Near-duplicate content
  if (crossPage.nearDuplicateContent.length > 0) {
    report += `\n   ⚠️ NEAR-DUPLICATE İÇERİK\n`;
    crossPage.nearDuplicateContent.forEach((d) => {
      report += `   ${d.similarity} benzerlik:\n`;
      report += `      ${d.urlA}\n      ${d.urlB}\n`;
    });
  } else {
    report += `\n   ✅ Near-duplicate içerik yok\n`;
  }

  // Orphan pages
  if (crossPage.orphanPages.length > 0) {
    report += `\n   ⚠️ ORPHAN SAYFALAR (internal link almayan)\n`;
    crossPage.orphanPages.forEach((u) => report += `      ${u}\n`);
  } else {
    report += `\n   ✅ Orphan sayfa yok\n`;
  }

  // Crawl depth
  report += `\n   📏 CRAWL DEPTH\n`;
  Object.entries(crossPage.crawlDepth).forEach(([url, depth]) => {
    const indicator = depth > 3 ? "⚠️" : "✅";
    report += `   ${indicator} Depth ${depth}: ${url}\n`;
  });

  // ==================== HREFLANG RETURN LINKS ====================
  if (hreflangIssues.length > 0) {
    report += `\n\n${"═".repeat(65)}\n`;
    report += `🌍 HREFLANG RETURN LINK SORUNLARI\n`;
    report += `${"═".repeat(65)}\n`;
    hreflangIssues.forEach((issue) => {
      report += `\n   ⚠️ ${issue.issue}\n`;
      report += `      Kaynak: ${issue.source}\n`;
      report += `      Hedef: ${issue.target} (${issue.targetLang})\n`;
    });
  }

  // ==================== SİTEMAP KONTROLÜ ====================
  if (sitemapCheck) {
    report += `\n\n${"═".repeat(65)}\n`;
    report += `🗺️ SİTEMAP KONTROLÜ\n`;
    report += `${"═".repeat(65)}\n`;
    report += `   Sitemap'teki URL sayısı: ${sitemapCheck.sitemapUrls.length}\n`;
    report += `   Taranan URL sayısı: ${sitemapCheck.scannedUrls.length}\n`;

    if (sitemapCheck.inSitemapNotScanned.length > 0) {
      report += `\n   ⚠️ Sitemap'te var ama taranmamış (${sitemapCheck.inSitemapNotScanned.length}):\n`;
      sitemapCheck.inSitemapNotScanned.slice(0, 10).forEach((u) => report += `      ${u}\n`);
      if (sitemapCheck.inSitemapNotScanned.length > 10) {
        report += `      ... ve ${sitemapCheck.inSitemapNotScanned.length - 10} URL daha\n`;
      }
    }

    if (sitemapCheck.scannedNotInSitemap.length > 0) {
      report += `\n   ⚠️ Taranan ama sitemap'te olmayan (${sitemapCheck.scannedNotInSitemap.length}):\n`;
      sitemapCheck.scannedNotInSitemap.slice(0, 10).forEach((u) => report += `      ${u}\n`);
    }
  }

  // ==================== ROBOTS.TXT ====================
  if (robotsRules) {
    report += `\n\n${"═".repeat(65)}\n`;
    report += `🤖 ROBOTS.TXT\n`;
    report += `${"═".repeat(65)}\n`;
    report += `   Disallow kuralları: ${robotsRules.disallow.length}\n`;
    robotsRules.disallow.forEach((r) => report += `      Disallow: ${r}\n`);
    report += `   Sitemaps: ${robotsRules.sitemaps.length}\n`;
    robotsRules.sitemaps.forEach((s) => report += `      ${s}\n`);

    const blockedPages = results.filter((r) => r.blockedByRobots);
    if (blockedPages.length > 0) {
      report += `\n   🚫 robots.txt tarafından engellenen taranan sayfalar:\n`;
      blockedPages.forEach((r) => report += `      ${r.url}\n`);
    }
  }

  // ==================== GENEL ÖZET ====================
  report += `\n\n${"═".repeat(65)}\n`;
  report += `GENEL ÖZET\n`;
  report += `${"═".repeat(65)}\n`;
  report += `Taranan sayfa: ${results.length}\n`;
  report += `Toplam ✅ Passed: ${totalPassed}\n`;
  report += `Toplam ⚠️ Warning: ${totalWarnings}\n`;
  report += `Toplam ❌ Error: ${totalErrors}\n`;
  report += `${"═".repeat(65)}\n`;

  return report;
}

// =====================================================
// ANA FONKSİYON
// =====================================================

async function main() {
  console.log("🔍 İleri Teknik SEO Audit başlatılıyor...\n");
  const startTime = Date.now();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: DESKTOP_VIEWPORT,
  });

  // ========== ROBOTS.TXT ==========
  let robotsRules = null;
  if (ROBOTS_TXT_URL) {
    console.log("🤖 robots.txt okunuyor...");
    const robotsPage = await context.newPage();
    robotsRules = await fetchRobotsTxt(robotsPage, ROBOTS_TXT_URL);
    await robotsPage.close();
    if (robotsRules) console.log(`   → ${robotsRules.disallow.length} disallow kuralı bulundu\n`);
  }

  // ========== SITEMAP ==========
  let sitemapUrls = [];
  if (SITEMAP_URL) {
    console.log("🗺️ Sitemap okunuyor...");
    const sitemapPage = await context.newPage();
    sitemapUrls = await fetchSitemap(sitemapPage, SITEMAP_URL);
    await sitemapPage.close();
    console.log(`   → ${sitemapUrls.length} URL bulundu\n`);
  }

  // ========== SAYFA TARAMA ==========
  const results = [];

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i];
    console.log(`[${i + 1}/${URLS.length}] Taranıyor: ${url}`);

    const page = await context.newPage();
    const result = await auditPage(page, url);

    // Robots.txt kontrolü
    if (robotsRules) {
      result.blockedByRobots = isBlockedByRobots(url, robotsRules);
    }

    results.push(result);
    await page.close();

    console.log(`   → ✅ ${result.passed.length} | ⚠️ ${result.warnings.length} | ❌ ${result.errors.length}\n`);
  }

  // ========== MOBİL TEST ==========
  console.log("\n📱 Mobil testler başlatılıyor...");
  const mobileResults = [];
  for (let i = 0; i < URLS.length; i++) {
    console.log(`   [${i + 1}/${URLS.length}] Mobil: ${URLS[i]}`);
    const mResult = await auditMobile(context, URLS[i]);
    mobileResults.push(mResult);
  }

  // ========== HREFLANG RETURN LINK ===========
  console.log("\n🌍 Hreflang return link kontrolü...");
  const hreflangIssues = await checkHreflangReturnLinks(context, results);
  console.log(`   → ${hreflangIssues.length} sorun bulundu`);

  // ========== CROSS-PAGE ANALİZ ==========
  console.log("\n🔄 Cross-page analiz yapılıyor...");
  const crossPage = crossPageAnalysis(results);

  // ========== SİTEMAP KARŞILAŞTIRMA ==========
  let sitemapCheck = null;
  if (sitemapUrls.length > 0) {
    const scannedUrls = results.map((r) => (r.finalUrl || r.url).replace(/\/$/, ""));
    const sitemapNormalized = sitemapUrls.map((u) => u.replace(/\/$/, ""));

    sitemapCheck = {
      sitemapUrls: sitemapNormalized,
      scannedUrls,
      inSitemapNotScanned: sitemapNormalized.filter((u) => !scannedUrls.includes(u)),
      scannedNotInSitemap: scannedUrls.filter((u) => !sitemapNormalized.includes(u)),
    };
  }

  await browser.close();

  // ========== RAPORLAR ==========
  const textReport = generateReport(results, crossPage, mobileResults, hreflangIssues, sitemapCheck, robotsRules);
  fs.writeFileSync("seo-audit-report.txt", textReport);
  console.log(textReport);

  // JSON detay
  const detailData = {
    meta: { timestamp: new Date().toISOString(), duration: Math.round((Date.now() - startTime) / 1000) + "s", urlCount: URLS.length },
    pages: results.map((r) => { const { bodyText, rawHtml, renderedHtml, ...rest } = r; return rest; }),
    mobile: mobileResults,
    crossPage,
    hreflangIssues,
    sitemapCheck,
    robotsRules,
  };
  fs.writeFileSync("seo-audit-detail.json", JSON.stringify(detailData, null, 2));

  console.log("\n📁 Raporlar kaydedildi:");
  console.log("   → seo-audit-report.txt");
  console.log("   → seo-audit-detail.json");
  console.log(`\n⏱️ Toplam süre: ${Math.round((Date.now() - startTime) / 1000)} saniye`);
}

main();
