const { cosineSimilarity } = require("../utils/fetchers");

async function auditRendering(page, renderedContent, url, TIMEOUT) {
  const result = {
    renderDifference: false,
    similarityScore: 0,
    hasSSRvsCSRDiff: false
  };

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
  } catch (e) {}

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
