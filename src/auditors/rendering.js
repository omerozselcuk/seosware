const { cosineSimilarity } = require("../utils/fetchers");

async function auditRendering(page, renderedContent, url, TIMEOUT) {
  const result = {
    renderDifference: false,
    similarityScore: 0,
    hasSSRvsCSRDiff: false
  };

  let rawHtmlContent = "";
  try {
    const rawContext = await page.context().browser().newContext({ javaScriptEnabled: false });
    const rawPage = await rawContext.newPage();
    try {
      await rawPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      rawHtmlContent = await rawPage.content();
    } catch {}
    await rawPage.close();
    await rawContext.close();
  } catch (e) {
    console.error(`[Rendering Auditor] Error fetching raw HTML: ${e.message}`);
  }

  result.rawHtmlPresent = !!rawHtmlContent;

  if (rawHtmlContent && renderedContent) {
    const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>/i;
    const rawBody = rawHtmlContent.match(bodyRegex)?.[1] || "";
    const renderedBody = renderedContent.match(bodyRegex)?.[1] || "";
    const rawText = rawBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const renderedText = renderedBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    if (rawText.length > 0 && renderedText.length > 0) {
      const similarity = cosineSimilarity(rawText, renderedText);
      result.similarityScore = Math.round(similarity * 100);
      result.renderDifference = similarity < 0.85;
      result.hasSSRvsCSRDiff = result.renderDifference;
    }
  }

  return result;
}

module.exports = { auditRendering };
