require('dotenv').config();

async function generateInsight(historyData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY bulunamadı. Lütfen .env dosyanıza ekleyin.');
  }

  // Optimize payload to save tokens while providing holistic context
  const optimizedData = historyData.results.map(r => {
    const fe = r.frontend || {};
    const cats = fe.categories || {};
    
    // Extract category summaries from frontend analyzer
    const feCategories = {};
    for (const [key, cat] of Object.entries(cats)) {
      if (cat) {
        feCategories[key] = {
          grade: cat.grade,
          score: cat.score,
          metrics: cat.metrics || {}
        };
      }
    }

    return {
      url: r.url,
      status: r.status,
      redirected: r.redirected,
      meta: {
        title: r.meta?.title,
        titleLen: r.meta?.titleLength,
        descLen: r.meta?.metaDescriptionLength,
        canonicalMatch: r.meta?.canonicalMatch,
        robots: r.meta?.robots,
        social: { og: !!r.meta?.ogImage, twitter: !!r.meta?.twitterCard }
      },
      content: {
        h1: r.content?.h1,
        wordCount: r.content?.wordCount,
        h2Count: r.content?.h2Count,
        jsonLd: (r.content?.jsonLdSchemas || []).map(s => s.type),
        jsonLdErrors: (r.content?.jsonLdErrors || []).length,
        lowContrastElements: r.content?.lowContrastElements,
        inlineStyles: r.content?.inlineStyles,
        soft404: r.status === 200 && r.content?.wordCount < 100 && (r.content?.h1 || []).some(h=>h.includes('404'))
      },
      links: {
        internal: r.links?.totalInternalLinks,
        external: r.links?.totalExternalLinks,
        broken: (r.network?.brokenResourceUrls || []).length,
        ariaMissing: r.links?.missingAriaLabels,
        linksWithoutHref: r.links?.linksWithoutHref,
        orphanAnchors: r.links?.orphanAnchors,
        tabOrderIssues: r.links?.tabOrderIssues,
        pagination: { next: !!r.links?.relNext, prev: !!r.links?.relPrev },
        infiniteScroll: r.links?.hasInfiniteScroll,
        hreflangCount: (r.links?.hreflangTags || []).length
      },
      performance: {
        lcp: r.performance?.lcp,
        cls: r.performance?.cls,
        inp: r.performance?.inp,
        domContentLoaded: r.performance?.domContentLoaded,
        fullyLoaded: r.performance?.fullyLoaded,
        unusedCss: r.performance?.unusedCssPercent,
        unusedJs: r.performance?.unusedJsPercent,
        renderBlocking: (r.performance?.renderBlockingResources || []).length,
        longTasks: (r.performance?.longTasks || []).length
      },
      frontend: {
        globalGrade: fe.globalGrade,
        globalScore: fe.globalScore,
        categories: feCategories
      },
      mobile: {
        viewportOverflow: r.mobile?.viewportOverflow,
        horizontalScroll: r.mobile?.horizontalScroll,
        smallTapTargets: r.mobile?.smallTapTargets,
        fontSizeIssues: r.mobile?.fontSizeIssues
      },
      images: {
        total: r.images?.totalImages,
        withoutAlt: r.images?.imagesWithoutAlt,
        withoutDimensions: r.images?.imagesWithoutDimensions,
        lazyLoaded: r.images?.lazyLoadedImages
      },
      quality: {
        jsErrors: (r.network?.jsErrors || []).length,
        consoleErrors: (r.network?.consoleLogs || []).filter(l=>l.type==='error').length,
        hydrationErrors: (r.network?.hydrationErrors || []).length,
        similarity: r.rendering?.similarityScore
      },
      aiReadiness: {
        totalScore: r.aiSearch?.totalScore,
        grade: r.aiSearch?.grade,
        overallPercentage: r.aiSearch?.overallPercentage,
        llmsTxt: !!r.aiSearch?.llmsTxt?.exists,
        botBlocking: r.aiSearch?.botBlocking?.isBlocked
      },
      security: {
        https: r.security?.isHttps,
        hsts: r.security?.hsts,
        mixedContent: (r.security?.mixedContent || []).length,
        xFrameOptions: r.security?.xFrameOptions
      }
    };
  });

  const prompt = `
You are an expert Senior SEO, Frontend Performance & UX Consultant.
Analyze the following deep audit dataset for a website and generate a COMPREHENSIVE Technical Audit Report IN TURKISH.

The report must cover ALL aspects: Meta, Content, Links, Frontend Quality, Mobile UX, Images, Performance, Security, and AI Search Readiness.

Return the exact response as formatted HTML (without \`\`\`html tags, just raw HTML elements). Do NOT include html/head/body tags.
Use a modern executive style with inline CSS for padding, border-collapse, and subtle colors.

Section 1: <h2>1. Yönetici Özeti</h2> (Executive Summary)
Summary of the site's overall state. Mention how many pages were scanned, the general "health score", frontend grade, and key problem areas.

Section 2: <h2>2. Teknik Donanım ve Meta Analizi</h2> (Technical & Meta)
Analyze Title/Description lengths, Canonical mismatches, Robots.txt blockers, and Social tag coverage (OG, Twitter).

Section 3: <h2>3. İçerik ve Semantik Yapı</h2> (Content & Semantic)
Audit H1 usage, word counts, heading hierarchy, JSON-LD structured data types/errors, inline styles, and low-contrast elements. Identify any "Soft 404" risks.

Section 4: <h2>4. Frontend Kalite Analizi</h2> (Frontend Quality)
Analyze the frontend audit categories in detail:
- Page Weight (total KB, JS/CSS/Image/Font sizes, oversized images, uncompressed resources)
- Requests (total requests, 3rd party domains, 404 errors, below-fold/hidden images)
- DOM Complexity (total elements, max depth, iframes, duplicated IDs)
- JS Complexity (execution time, DOM access count, scroll listeners, global variables)
- Bad JS (JS errors, console warnings, document.write, sync XHR)
- CSS Complexity (total rules, complex selectors, unique/similar colors, breakpoints)
- Bad CSS (syntax errors, @import usage, duplicated selectors/properties, !important usage, old prefixes)
- Server Config (HTTP/1.1 resources, caching issues)
- Web Fonts (font count, total KB, non-WOFF2 formats, overweight fonts)
For each category, provide the grade, score, and specific recommendations.

Section 5: <h2>5. Sayfa Hızı ve Core Web Vitals</h2> (Core Web Vitals & Performance)
Analyze LCP, CLS, INP metrics, DOM Content Loaded and Fully Loaded times, render-blocking resources, long tasks, and unused CSS/JS percentages.

Section 6: <h2>6. Mobil Uyumluluk ve Görsel Optimizasyon</h2> (Mobile & Images)
Analyze mobile compatibility (viewport overflow, horizontal scroll, small tap targets, font size issues) and image optimization (total images, missing alt tags, missing dimensions, lazy loading usage).

Section 7: <h2>7. Güvenlik Analizi</h2> (Security)
Analyze HTTPS, HSTS, mixed content issues, and X-Frame-Options headers.

Section 8: <h2>8. AI Search Readiness</h2> (AI & LLM Readiness)
Analyze the site's readiness for AI Search (llms.txt, bot blocking, overall AI readiness grade and score).

Section 9: <h2>9. Tam Öncelikli Aksiyon Planı</h2> (Holistic Action Plan)
Provide a prioritized HTML table (P0 Acil, P1 Yüksek, P2 Orta, P3 Düşük).
Columns: #, Kategori (Category), Sorun (Issue), Aksiyon (Action), Etki (Impact).
Include at least 15-20 action items covering all audit areas.

Raw Audit Data:
${JSON.stringify(optimizedData, null, 2)}
  `;

  const _fetch = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash'  // Fallback model
  ];

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
    }
  });

  let lastError = null;

  for (const model of models) {
    // Retry up to 3 times per model with exponential backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[AI] ${model} modeline istek gönderiliyor (deneme ${attempt}/3)...`);
        
        const response = await _fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        });

        if (response.ok) {
          const data = await response.json();
          let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          
          // Clean markdown backticks if Gemini still forces them
          text = text.replace(/^\s*```html/gm, '').replace(/```\s*$/gm, '');
          
          console.log(`[AI] ✅ ${model} başarılı (deneme ${attempt})`);
          return text;
        }

        const errText = await response.text();
        lastError = `${model}: ${errText}`;

        // Only retry on 429 (rate limit) or 503 (unavailable)
        if (response.status === 429 || response.status === 503) {
          const waitSec = 3 * Math.pow(2, attempt - 1); // 3s, 6s, 12s
          console.log(`[AI] ⚠️ ${model} ${response.status} hatası, ${waitSec}s sonra tekrar denenecek...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          continue;
        }

        // Non-retryable error for this model, try next model
        console.log(`[AI] ❌ ${model} ${response.status} hatası, sonraki model deneniyor...`);
        break;

      } catch (fetchErr) {
        lastError = `${model}: ${fetchErr.message}`;
        console.log(`[AI] ❌ ${model} bağlantı hatası: ${fetchErr.message}`);
        break;
      }
    }
  }

  throw new Error(`Tüm modeller başarısız oldu. Son hata: ${lastError}`);
}

module.exports = { generateInsight };

