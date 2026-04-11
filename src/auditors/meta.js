async function auditMeta(page, finalUrl) {
  return await page.evaluate((url) => {
    const getMeta = (name) => {
      const el =
        document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[property="${name}"]`) ||
        document.querySelector(`meta[http-equiv="${name}"]`);
      return el ? el.getAttribute("content") : null;
    };

    const title = document.title || null;
    const titleLength = title ? title.length : 0;
    const metaDescription = getMeta("description");
    const metaDescriptionLength = metaDescription ? metaDescription.length : 0;
    
    const robots = getMeta("robots");
    const viewport = getMeta("viewport");
    const charset = document.querySelector("meta[charset]")?.getAttribute("charset") || getMeta("Content-Type");
    const language = document.documentElement.lang || null;
    
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? canonicalEl.href : null;
    const canonicalMatch = canonical === url;

    const ogTitle = getMeta("og:title");
    const ogDescription = getMeta("og:description");
    const ogImage = getMeta("og:image");
    const ogUrl = getMeta("og:url");
    const ogType = getMeta("og:type");

    const twitterCard = getMeta("twitter:card");
    const twitterTitle = getMeta("twitter:title");
    const twitterDescription = getMeta("twitter:description");
    const twitterImage = getMeta("twitter:image");

    return {
      title,
      titleLength,
      metaDescription,
      metaDescriptionLength,
      canonical,
      canonicalMatch,
      robots,
      viewport,
      charset,
      language,
      ogTitle,
      ogDescription,
      ogImage,
      ogUrl,
      ogType,
      twitterCard,
      twitterTitle,
      twitterDescription,
      twitterImage
    };
  }, finalUrl);
}

module.exports = { auditMeta };
