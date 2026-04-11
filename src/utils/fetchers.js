async function fetchSitemap(page, sitemapUrl) {
  if (!sitemapUrl) return [];
  try {
    const response = await page.goto(sitemapUrl, { timeout: 15000 });
    const content = await response.text();
    const urls = [];
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = locRegex.exec(content)) !== null) {
      urls.push(match[1].trim());
    }
    return urls;
  } catch (e) {
    return [];
  }
}

async function fetchRobotsTxt(page, robotsUrl) {
  if (!robotsUrl) return null;
  try {
    const response = await page.goto(robotsUrl, { timeout: 10000 });
    const content = await response.text();
    const rules = { disallow: [], allow: [], sitemaps: [] };
    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().startsWith("disallow:")) {
        rules.disallow.push(trimmed.split(":").slice(1).join(":").trim());
      } else if (trimmed.toLowerCase().startsWith("allow:")) {
        rules.allow.push(trimmed.split(":").slice(1).join(":").trim());
      } else if (trimmed.toLowerCase().startsWith("sitemap:")) {
        rules.sitemaps.push(trimmed.split(":").slice(1).join(":").trim());
      }
    });
    return rules;
  } catch (e) {
    return null;
  }
}

function isBlockedByRobots(url, robotsRules) {
  if (!robotsRules) return false;
  try {
    const urlPath = new URL(url).pathname;
    let isBlocked = false;
    for (const rule of robotsRules.disallow) {
      if (rule && urlPath.startsWith(rule)) {
        let allowed = false;
        for (const allowRule of robotsRules.allow) {
          if (allowRule && urlPath.startsWith(allowRule)) {
            allowed = true;
            break;
          }
        }
        if (!allowed) {
          isBlocked = true;
          break;
        }
      }
    }
    return isBlocked;
  } catch (e) {
    return false;
  }
}

function cosineSimilarity(textA, textB) {
  const wordsA = textA.toLowerCase().split(/\s+/).filter(Boolean);
  const wordsB = textB.toLowerCase().split(/\s+/).filter(Boolean);
  const vocab = new Set([...wordsA, ...wordsB]);
  const vecA = {};
  const vecB = {};
  vocab.forEach((w) => {
    vecA[w] = 0;
    vecB[w] = 0;
  });
  wordsA.forEach((w) => vecA[w]++);
  wordsB.forEach((w) => vecB[w]++);
  let dot = 0, magA = 0, magB = 0;
  vocab.forEach((w) => {
    dot += vecA[w] * vecB[w];
    magA += vecA[w] * vecA[w];
    magB += vecB[w] * vecB[w];
  });
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

module.exports = {
  fetchSitemap,
  fetchRobotsTxt,
  isBlockedByRobots,
  cosineSimilarity
};
