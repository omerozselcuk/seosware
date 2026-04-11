require('dotenv').config();

async function generateInsight(historyData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY bulunamadı. Lütfen .env dosyanıza ekleyin.');
  }

  // Optimize payload to save tokens while providing holistic context
  const optimizedData = historyData.results.map(r => ({
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
      jsonLd: (r.content?.jsonLdSchemas || []).length,
      jsonLdErrors: (r.content?.jsonLdErrors || []).length,
      soft404: r.status === 200 && r.content?.wordCount < 100 && (r.content?.h1 || []).some(h=>h.includes('404'))
    },
    links: {
      internal: r.links?.totalInternalLinks,
      external: r.links?.totalExternalLinks,
      broken: (r.network?.brokenResourceUrls || []).length,
      ariaMissing: r.links?.missingAriaLabels,
      pagination: { next: !!r.links?.relNext, prev: !!r.links?.relPrev },
      infiniteScroll: r.links?.hasInfiniteScroll
    },
    performance: {
      lcp: r.performance?.lcp,
      cls: r.performance?.cls,
      inp: r.performance?.inp,
      unusedCss: r.performance?.unusedCssPercent,
      unusedJs: r.performance?.unusedJsPercent,
      renderBlocking: (r.performance?.renderBlockingResources || []).length,
      longTasks: (r.performance?.longTasks || []).length
    },
    quality: {
      jsErrors: (r.network?.jsErrors || []).length,
      consoleErrors: (r.network?.consoleLogs || []).filter(l=>l.type==='error').length,
      hydrationErrors: (r.network?.hydrationErrors || []).length,
      similarity: r.rendering?.similarityScore
    },
    aiReadiness: {
      totalScore: r.aiSearch?.totalScore,
      llmsTxt: !!r.aiSearch?.llmsTxt?.exists,
      botBlocking: r.aiSearch?.botBlocking?.isBlocked
    },
    security: {
      https: r.security?.isHttps,
      hsts: r.security?.hsts,
      mixedContent: (r.security?.mixedContent || []).length
    }
  }));

  const prompt = `
You are an expert Senior SEO & Performance Consultant.
Analyze the following deep crawler dataset for multiple pages of a website and generate a HOLISTIC Technical SEO Audit IN TURKISH.

The report should NOT be limited to speed. It must cover Meta, Content, Links, Quality, Security, and AI Search Readiness.

Return the exact response as formatted HTML (without \`\`\`html tags, just raw HTML elements). Do NOT include html/head/body tags.
Use a modern executive style with inline CSS for padding, border-collapse, and subtle colors.

Section 1: <h2>1. Yönetici Özeti</h2> (Executive Summary)
Summary of the site's overall state. Mention how many pages were scanned and the general "health score".

Section 2: <h2>2. Teknik Donanım ve Meta Analizi</h2> (Technical & Meta)
Analyze Title/Description lengths, Canonical mismatches, Robots.txt blockers, and Social tag coverage.

Section 3: <h2>3. İçerik ve Semantik Yapı</h2> (Content & Semantic)
Audit H1 usage, word counts, and JSON-LD structured data presence/errors. Identify any "Soft 404" risks.

Section 4: <h2>4. Sayfa Hızı ve Core Web Vitals</h2> (Core Web Vitals)
Identify the slowest pages and provide specific insights on LCP, CLS, and INP metrics based on render-blocking and unused code data.

Section 5: <h2>5. Projeksiyon & AI Readiness</h2> (AI & LLM Readiness)
Analyze the site's readiness for AI Search (llms.txt, bot blocking, grades).

Section 6: <h2>6. Tam Öncelikli Aksiyon Planı</h2> (Holistic Action Plan)
Provide a prioritized HTML table (P0 Acil, P1 Yüksek, P2 Orta, P3 Düşük).
Columns: #, Kategori (Category), Sorun (Issue), Aksiyon (Action), Etki (Impact).

Raw Audit Data:
${JSON.stringify(optimizedData, null, 2)}
  `;

  const _fetch = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
  const response = await _fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error: ${errText}`);
  }

  const data = await response.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  // Clean markdown backticks if Gemini still forces them
  text = text.replace(/^\s*```html/gm, '').replace(/```\s*$/gm, '');
  
  return text;
}

module.exports = { generateInsight };
