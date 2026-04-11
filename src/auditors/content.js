async function auditContent(page) {
  return await page.evaluate(() => {
    // Headings
    const h1Elements = Array.from(document.querySelectorAll("h1")).map((el) => el.innerText.trim());
    const h2Count = document.querySelectorAll("h2").length;
    const headingOrder = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) => el.tagName);

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

    // Content Text
    const bodyText = document.body?.innerText || "";
    const wordCount = bodyText.split(/\\s+/).filter(Boolean).length;
    
    // Accessibility: Contrast & Fonts
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

    let fontSizeIssues = 0;
    const textElements = document.querySelectorAll("p, span, li, td, th, a, label");
    textElements.forEach((el) => {
      const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
      if (fontSize < 12 && el.innerText?.trim().length > 0) fontSizeIssues++;
    });

    const iframeCount = document.querySelectorAll("iframe").length;
    const inlineStyles = document.querySelectorAll("[style]").length;

    return {
      h1: h1Elements,
      h2Count,
      headingOrder,
      jsonLdSchemas,
      jsonLdErrors,
      wordCount,
      lowContrastElements,
      fontSizeIssues,
      iframeCount,
      inlineStyles,
      // bodyText: bodyText.substring(0, 5000) // Could be huge, omitted or truncated
    };
  });
}

module.exports = { auditContent };
