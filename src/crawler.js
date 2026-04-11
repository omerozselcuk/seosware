const { chromium } = require("playwright");
const { fetchSitemap, cosineSimilarity } = require("./utils/fetchers");

async function runSiteAudit(startUrl, maxPages = 20, maxDepth = 3, options = {}) {
  const parsedStart = new URL(startUrl);
  const startOrigin = parsedStart.origin;

  const state = {
    visited: new Set(),
    queue: [{ url: startUrl, depth: 0 }],
    pages: [], // Store extracted data for all crawled pages
    sitemapUrls: new Set(),
    graph: {}, // url -> { in: [], out: [] }
    stats: {
      totalCrawled: 0,
      brokenLinks: 0,
      duplicates: []
    }
  };

  // 1. Fetch Sitemap URLs to find Orphans later
  try {
    const sitemapArr = await fetchSitemap(`${startOrigin}/sitemap.xml`);
    sitemapArr.forEach(u => state.sitemapUrls.add(u));
  } catch (e) {
    // try robots.txt logic or fallback, ignoring for brevity
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    while (state.queue.length > 0 && state.visited.size < maxPages) {
      if (options.isCancelled && options.isCancelled()) {
        console.log(`[\u26A0\ufe0f] Crawl iptal edildi! (${state.visited.size} sayfa tarandı)`);
        break;
      }
      
      const { url, depth } = state.queue.shift();
      
      // Clean URL (remove hash)
      const cleanUrl = url.split('#')[0].replace(/\/$/, "");

      if (state.visited.has(cleanUrl)) continue;
      state.visited.add(cleanUrl);

      if (!state.graph[cleanUrl]) {
        state.graph[cleanUrl] = { in: [], out: [] };
      }

      console.log(`[Crawler] Visiting (${depth}): ${cleanUrl}`);

      const page = await context.newPage();
      // Block resources for fast crawling
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "stylesheet", "font", "media"].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      try {
        const response = await page.goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        const status = response?.status() || 400;

        if (status >= 400) {
          state.stats.brokenLinks++;
          await page.close();
          continue;
        }

        const data = await page.evaluate(() => {
          const title = document.title;
          const desc = document.querySelector('meta[name="description"]')?.content || "";
          
          const links = Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href.startsWith('http'));
            
          const rawText = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : "";
          
          return { title, desc, links, rawText };
        });

        // Store page data for duplicate detection
        state.pages.push({
          url: cleanUrl,
          depth,
          title: data.title,
          desc: data.desc,
          textPreview: data.rawText.substring(0, 1500) // Keep preview for similarity
        });

        // Process Links
        const uniqueOutLinks = [...new Set(data.links)];
        uniqueOutLinks.forEach(link => {
          const cleanLink = link.split('#')[0].replace(/\/$/, "");
          state.graph[cleanUrl].out.push(cleanLink);

          if (!state.graph[cleanLink]) {
            state.graph[cleanLink] = { in: [], out: [] };
          }
          if (!state.graph[cleanLink].in.includes(cleanUrl)) {
            state.graph[cleanLink].in.push(cleanUrl);
          }

          // Enqueue internal links if depth matches
          if (cleanLink.startsWith(startOrigin) && depth < maxDepth) {
            if (!state.visited.has(cleanLink)) {
              state.queue.push({ url: cleanLink, depth: depth + 1 });
            }
          }
        });

      } catch (err) {
        console.error(`[Crawler Error] ${cleanUrl}: ${err.message}`);
      }

      await page.close();
      state.stats.totalCrawled++;
    }

  } finally {
    await context.close();
    await browser.close();
  }

  // POST PROCESS DATA

  // 1. Find Near-Duplicates
  for (let i = 0; i < state.pages.length; i++) {
    for (let j = i + 1; j < state.pages.length; j++) {
      const p1 = state.pages[i];
      const p2 = state.pages[j];

      // Exact Title/Desc match
      const exactMeta = p1.title === p2.title && p1.desc === p2.desc && p1.title !== "";
      
      // Content Similarity
      let textSim = 0;
      if (p1.textPreview && p2.textPreview) {
        textSim = cosineSimilarity(p1.textPreview, p2.textPreview);
      }

      if (exactMeta || textSim > 0.85) {
        state.stats.duplicates.push({
          url1: p1.url,
          url2: p2.url,
          exactMeta,
          similarity: Math.round(textSim * 100)
        });
      }
    }
  }

  // 2. Orphan Pages (In sitemap but 0 internal links pointing to them)
  const crawledUrls = Array.from(state.visited);
  const orphans = [];
  
  if (state.sitemapUrls.size > 0) {
    state.sitemapUrls.forEach(sitemapUrl => {
      const cleanSitemapUrl = sitemapUrl.replace(/\/$/, "");
      // If it has 0 incoming links in our graph, it's an orphan
      if (state.graph[cleanSitemapUrl] && state.graph[cleanSitemapUrl].in.length === 0) {
        orphans.push(cleanSitemapUrl);
      } else if (!state.graph[cleanSitemapUrl]) {
        // We didn't even see it in the crawl graph
        orphans.push(cleanSitemapUrl);
      }
    });
  }

  return {
    crawledCount: state.stats.totalCrawled,
    maxDepthReached: maxDepth,
    brokenLinks: state.stats.brokenLinks,
    duplicates: state.stats.duplicates,
    orphans: orphans,
    sitemapUrlCount: state.sitemapUrls.size,
    graph: state.graph
  };
}

module.exports = { runSiteAudit };
