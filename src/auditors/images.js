async function auditImages(page) {
  const imagesMetrics = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll("img"));
    const totalImages = images.length;
    
    const imagesWithoutAltList = images
      .filter((img) => !img.hasAttribute("alt") || img.alt.trim() === "")
      .map((img) => img.src || img.dataset.src || "(no src)");
      
    const imagesWithoutDimensionsList = images
      .filter((img) => !img.hasAttribute("width") && !img.hasAttribute("height"))
      .map((img) => img.src || img.dataset.src || "(no src)");
      
    const lazyLoadedImages = images.filter((img) => img.loading === "lazy").length;

    const topLazyImages = Array.from(document.querySelectorAll('img[loading="lazy"]'))
      .slice(0, 5)
      .map((img) => ({
        src: img.src || img.dataset.src || img.getAttribute("data-lazy") || "",
        loaded: img.complete && img.naturalWidth > 0,
        inViewport: img.getBoundingClientRect().top < window.innerHeight,
      }));

    return {
      totalImages,
      imagesWithoutAlt: imagesWithoutAltList.length,
      imagesWithoutAltList,
      imagesWithoutDimensions: imagesWithoutDimensionsList.length,
      imagesWithoutDimensionsList,
      lazyLoadedImages,
      topLazyImages
    };
  });

  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const lazyImagesAfterScroll = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img[loading="lazy"]'))
        .slice(0, 5)
        .map((img) => ({
          loaded: img.complete && img.naturalWidth > 0,
        }));
    });

    imagesMetrics.lazyLoadVerified = imagesMetrics.topLazyImages.map((img, i) => ({
      src: (img.src || "").substring(0, 80),
      wasInViewport: img.inViewport,
      loadedBefore: img.loaded,
      loadedAfterScroll: lazyImagesAfterScroll[i]?.loaded || false,
    }));
    await page.evaluate(() => window.scrollTo(0, 0));
  } catch (e) {
    imagesMetrics.lazyLoadVerified = [];
  }

  delete imagesMetrics.topLazyImages;
  return imagesMetrics;
}

module.exports = { auditImages };
