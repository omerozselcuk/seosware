async function auditLinks(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const currentHost = window.location.hostname;
    let totalInternalLinks = 0;
    let totalExternalLinks = 0;
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
          totalInternalLinks++;
          internalLinkUrls.push(linkUrl.href); // Might be huge, but keeping for compatibility
        } else {
          totalExternalLinks++;
          if (link.target === "_blank" && !link.getAttribute("rel")?.includes("noopener")) {
            linksWithoutRel++;
          }
        }
      } catch {}
      if (link.target === "_blank") linksWithTargetBlank++;
    });

    // Sub-set of links: Pagination and Accessibility
    const relNextEl = document.querySelector('link[rel="next"]');
    const relPrevEl = document.querySelector('link[rel="prev"]');
    const relNext = relNextEl ? relNextEl.href : null;
    const relPrev = relPrevEl ? relPrevEl.href : null;
    
    const hasInfiniteScroll = !!(
      document.querySelector("[data-infinite-scroll]") ||
      document.querySelector(".infinite-scroll") ||
      document.querySelector("[infinite-scroll]")
    );

    // Hreflang
    const hreflangTags = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
      (el) => ({ lang: el.hreflang, href: el.href })
    );
    const hreflangSelfRef = hreflangTags.some((t) => t.href === window.location.href);

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

    const tabbables = Array.from(document.querySelectorAll("[tabindex]"));
    let tabOrderIssues = 0;
    tabbables.forEach((el) => {
      const idx = parseInt(el.getAttribute("tabindex"));
      if (idx > 0) tabOrderIssues++;
    });

    return {
      totalInternalLinks,
      totalExternalLinks,
      linksWithoutHref,
      orphanAnchors,
      linksWithTargetBlank,
      linksWithoutRel,
      internalLinkUrls,
      relNext,
      relPrev,
      hasInfiniteScroll,
      hreflangTags,
      hreflangSelfRef,
      missingAriaLabels,
      smallTapTargets,
      tabOrderIssues
    };
  });
}

module.exports = { auditLinks };
