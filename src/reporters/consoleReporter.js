const util = require('util');

function reportConsole(result) {
  console.log(`\n======================================================`);
  console.log(` \ud83d\udd0e SEO Audit Summary for: ${result.url}`);
  console.log(`======================================================`);
  console.log(` Status: ${result.status} | Load Time: ${result.loadTime}ms | Final URL: ${result.finalUrl}`);
  
  if (result.meta) {
    console.log(`\n--- \ud83c\udff7\ufe0f Meta Tags ---`);
    console.log(` Title: ${result.meta.title || 'N/A'} (${result.meta.titleLength} chars)`);
    console.log(` Description: ${result.meta.metaDescription ? result.meta.metaDescription.substring(0, 50) + '...' : 'N/A'} (${result.meta.metaDescriptionLength} chars)`);
    console.log(` Canonical: ${result.meta.canonical || 'N/A'} (Match: ${result.meta.canonicalMatch})`);
  }

  if (result.content) {
    console.log(`\n--- \ud83d\udcc4 Content ---`);
    console.log(` Words: ${result.content.wordCount} | H1 Tags: ${result.content.h1.length} | H2 Tags: ${result.content.h2Count}`);
    console.log(` Contrast Issues: ${result.content.lowContrastElements} | Font Size Issues: ${result.content.fontSizeIssues}`);
  }

  if (result.images) {
    console.log(`\n--- \ud83d\uddbc\ufe0f Images ---`);
    console.log(` Total: ${result.images.totalImages} | Missing Alt: ${result.images.imagesWithoutAlt} | Lazy Loaded: ${result.images.lazyLoadedImages}`);
  }

  if (result.links) {
    console.log(`\n--- \ud83d\udd17 Links ---`);
    console.log(` Internal: ${result.links.totalInternalLinks} | External: ${result.links.totalExternalLinks} | Missing Href: ${result.links.linksWithoutHref}`);
  }

  if (result.performance) {
    console.log(`\n--- \u26a1 Performance ---`);
    console.log(` DOMContentLoaded: ${result.performance.domContentLoaded}ms | LCP: ${result.performance.lcp || 'N/A'} | CLS: ${result.performance.cls || 'N/A'}`);
  }

  if (result.mobile) {
    console.log(`\n--- \ud83d\udcf1 Mobile ---`);
    console.log(` Viewport Overflow: ${result.mobile.viewportOverflow} | Small Tap Targets: ${result.mobile.smallTapTargets}`);
  }

  if (result.aiSearch) {
    const ai = result.aiSearch;
    console.log(`\n--- \ud83e\udd16 AI Search Readiness (Grade: ${ai.grade} — ${ai.overallPercentage}/100) ---`);

    // llms.txt
    if (ai.llmsTxt && !ai.llmsTxt.error) {
      const llms = ai.llmsTxt['llms.txt'];
      const llmsFull = ai.llmsTxt['llms-full.txt'];
      console.log(` llms.txt: ${llms?.exists ? '\u2705 Mevcut' : '\u274c Yok'} | llms-full.txt: ${llmsFull?.exists ? '\u2705 Mevcut' : '\u274c Yok'}`);
      if (llms?.exists) {
        const spec = llms.spec;
        console.log(`   Spec: H1=${spec.hasH1 ? '\u2705' : '\u274c'} Blockquote=${spec.hasBlockquote ? '\u2705' : '\u274c'} Markdown=${spec.isMarkdown ? '\u2705' : '\u274c'}`);
      }
    }

    // Bot engelleme
    if (ai.aiBotBlocking && !ai.aiBotBlocking.error) {
      const blocked = ai.aiBotBlocking.blockedBots;
      const allowed = ai.aiBotBlocking.allowedBots;
      console.log(` AI Botlar: ${allowed.length} izinli, ${blocked.length} engellenmi\u015f`);
      if (blocked.length > 0) console.log(`   \u274c Engellenen: ${blocked.join(', ')}`);
      if (allowed.length > 0) console.log(`   \u2705 \u0130zinli: ${allowed.join(', ')}`);
    }

    // Citability
    if (ai.citability && !ai.citability.error) {
      console.log(` Al\u0131nt\u0131lanabilirlik: ${ai.citability.score}/${ai.citability.maxScore} (%${ai.citability.percentage})`);
    }

    // EEAT
    if (ai.eeat && !ai.eeat.error) {
      console.log(` E-E-A-T Sinyalleri: ${ai.eeat.score}/${ai.eeat.maxScore} (%${ai.eeat.percentage})`);
    }

    // Schema
    if (ai.schemaDepth && !ai.schemaDepth.error) {
      const sd = ai.schemaDepth;
      const found = Object.entries(sd.targetSchemas).filter(([,v]) => v.found).map(([k]) => k);
      console.log(` Schema Derinli\u011fi: %${sd.depthPercentage} | Bulunan: ${found.length > 0 ? found.join(', ') : 'Yok'}`);
    }
  }

  if (result.network?.jsErrors?.length > 0) {
    console.log(`\n--- \u26a0\ufe0f Network & JS Errors ---`);
    result.network.jsErrors.forEach(err => console.log(`   - ${err}`));
  }

  console.log(`======================================================\n`);
}

module.exports = { reportConsole };
