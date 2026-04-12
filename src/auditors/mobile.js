const { launchMobileBrowser, WAIT_AFTER_LOAD } = require("../utils/browser");

async function auditMobile(url, TIMEOUT) {
  const mobileResult = {
    smallTapTargets: 0,
    smallTapTargetsList: [],
    fontSizeIssues: 0,
    fontSizeIssuesList: [],
    horizontalScroll: false,
    viewportOverflow: false,
    title: null,
    h1: [],
    error: null
  };

  try {
    const { browser, context, page } = await launchMobileBrowser();
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);

    const mobileData = await page.evaluate(() => {
      const title = document.title || null;
      const h1 = Array.from(document.querySelectorAll("h1")).map((el) => el.innerText.trim());

      const smallTapTargetsList = [];
      const interactiveElements = document.querySelectorAll("button, a, input, select, textarea");
      interactiveElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          smallTapTargetsList.push({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.placeholder || "").trim().substring(0, 30) || "(no text)",
            selector: (el.id ? "#" + el.id : "") + (el.className ? "." + el.className.split(" ").join(".") : "")
          });
        }
      });

      const fontSizeIssuesList = [];
      const textElements = document.querySelectorAll("p, span, li, td, th, a");
      textElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize < 12 && el.innerText?.trim().length > 0) {
          fontSizeIssuesList.push({
            tag: el.tagName.toLowerCase(),
            text: el.innerText.trim().substring(0, 50),
            size: fontSize + "px"
          });
        }
      });

      const horizontalScroll = document.documentElement.scrollWidth > window.innerWidth;
      const viewportOverflow = document.body.scrollWidth > window.innerWidth;

      return { 
        title, 
        h1, 
        smallTapTargets: smallTapTargetsList.length, 
        smallTapTargetsList,
        fontSizeIssues: fontSizeIssuesList.length, 
        fontSizeIssuesList,
        horizontalScroll, 
        viewportOverflow 
      };
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
