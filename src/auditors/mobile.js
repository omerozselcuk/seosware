const { launchMobileBrowser, WAIT_AFTER_LOAD } = require("../utils/browser");

async function auditMobile(url, TIMEOUT) {
  const mobileResult = {
    smallTapTargets: 0,
    fontSizeIssues: 0,
    horizontalScroll: false,
    viewportOverflow: false,
    mobileTitle: null,
    mobileH1: [],
    error: null
  };

  try {
    const { browser, context, page } = await launchMobileBrowser();
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);

    const mobileData = await page.evaluate(() => {
      const title = document.title || null;
      const h1 = Array.from(document.querySelectorAll("h1")).map((el) => el.innerText.trim());

      let smallTapTargets = 0;
      const interactiveElements = document.querySelectorAll("button, a, input, select, textarea");
      interactiveElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          smallTapTargets++;
        }
      });

      let fontSizeIssues = 0;
      const textElements = document.querySelectorAll("p, span, li, td, th, a");
      textElements.forEach((el) => {
        const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
        if (fontSize < 12 && el.innerText?.trim().length > 0) fontSizeIssues++;
      });

      const horizontalScroll = document.documentElement.scrollWidth > window.innerWidth;
      const viewportOverflow = document.body.scrollWidth > window.innerWidth;

      return { title, h1, smallTapTargets, fontSizeIssues, horizontalScroll, viewportOverflow };
    });

    Object.assign(mobileResult, mobileData);

    await page.close();
    await context.close();
    await browser.close();
  } catch (e) {
    mobileResult.error = "Mobil test hatası: " + e.message;
  }

  return mobileResult;
}

module.exports = { auditMobile };
