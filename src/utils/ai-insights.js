require('dotenv').config();

async function generateInsight(historyData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY bulunamadı. Lütfen .env dosyanıza ekleyin.');
  }

  // Optimize payload to save tokens
  const optimizedData = historyData.results.map(r => ({
    url: r.url,
    status: r.status,
    titleLen: r.meta?.titleLength,
    descLen: r.meta?.metaDescriptionLength,
    canonicalMatch: r.meta?.canonicalMatch,
    ogImage: !!r.meta?.ogImage,
    h1: r.content?.h1,
    lcp: r.performance?.lcp,
    cls: r.performance?.cls,
    longTasks: (r.performance?.longTasks || []).length,
    unusedCss: r.performance?.unusedCssPercent,
    unusedJs: r.performance?.unusedJsPercent,
    inp: r.performance?.inp,
    renderBlocking: (r.performance?.renderBlockingResources || []).length,
    soft404: r.status === 200 && r.content?.wordCount < 100 && r.content?.h1?.some(h=>h.includes('404')),
    relNoopenerMissing: r.links?.linksWithoutRel,
    aiGrade: r.aiSearch?.totalScore
  }));

  const prompt = `
You are an expert Technical SEO and Performance Optimization Consultant.
Analyze the following raw crawler data from a website and generate a detailed report IN TURKISH.
Focus heavily on Page Speed improvements, Core Web Vitals (LCP, CLS, INP, unused JS/CSS, render blocking) and Technical SEO (Canonicals, Soft 404s, Meta tags).

Return the exact response as formatted HTML (without \`\`\`html tags, just raw HTML elements). Do NOT include html/head/body tags. Only the inner HTML markup.
Use minimalist and modern inline styles (e.g. styling tables with border-collapse and padding). Return visually appealing output.
Do NOT use markdown. Write pure HTML.

Section 1: <h2>1. Yönetici Özeti</h2> (Executive Summary)
Explain what was scanned, the major technical deficiencies, and the biggest risks.

Section 2: <h2>2. Kritik Bulgular</h2> (Critical Findings)
Discuss the biggest issues found in the data (e.g. Missing canonicals, broken H1s, soft 404s, slow pages).
Highlight the exact slow pages and their LCP / INP values.

Section 3: <h2>3. Page Speed Derin Analizi</h2> (Deep Speed Insight)
Provide a table or specific breakdown of the slowest pages. Correlate slow LCP with "Render Blocking Resources", "Unused JS" and "Unused CSS". Give specific actionable steps based on what you see.

Section 4: <h2>4. Aksiyon Planı</h2> (Action Plan)
Provide a prioritized HTML table (P0 Acil, P1 Yüksek, P2 Orta).
Columns: #, Sorun (Issue), Aksiyon (Action), Öncelik (Priority).

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
