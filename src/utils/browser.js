const { chromium } = require("playwright");

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const WAIT_AFTER_LOAD = 3000;

async function launchDesktopBrowser(config = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: config.viewport || DESKTOP_VIEWPORT,
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function launchMobileBrowser(config = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  return { browser, context, page };
}

module.exports = {
  launchDesktopBrowser,
  launchMobileBrowser,
  WAIT_AFTER_LOAD,
};
