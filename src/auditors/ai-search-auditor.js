// =====================================================
// AI SEARCH AUDITOR
// LLM keşfedilebilirlik, alıntılanabilirlik ve
// yapılandırılmış veri derinliği analizi
// =====================================================

const AI_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "ChatGPT-User",
];

// ─── 1. /llms.txt & /llms-full.txt Kontrolü ────────────────────────

async function checkLlmsTxt(page, origin, timeout) {
  const files = ["llms.txt"];
  const results = {};

  for (const file of files) {
    const fileUrl = `${origin}/${file}`;
    const entry = {
      url: fileUrl,
      exists: false,
      statusCode: null,
      contentLength: 0,
      spec: {
        hasH1: false,
        hasBlockquote: false,
        isMarkdown: false,
        hasLinks: false,
        hasSections: false,
      },
      rawPreview: null,
      errors: [],
    };

    try {
      const tempPage = await page.context().newPage();
      const response = await tempPage.goto(fileUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeout || 15000,
      });

      entry.statusCode = response?.status();
      entry.exists = entry.statusCode === 200;

      if (entry.exists) {
        const content = await response.text();
        entry.contentLength = content.length;
        entry.rawPreview = content.substring(0, 500);

        // ── Spec uygunluk kontrolleri ──
        const lines = content.split("\n");

        // H1: Markdown'da # ile başlayan satır
        entry.spec.hasH1 = lines.some((l) => /^#\s+.+/.test(l.trim()));

        // Blockquote: > ile başlayan satır
        entry.spec.hasBlockquote = lines.some((l) => /^>\s+.+/.test(l.trim()));

        // Markdown formatı: başlık (#), kalın (**), link ([]()), liste (- veya *)
        const markdownSignals = [
          /^#{1,6}\s+/m, // headings
          /\*\*.+\*\*/,  // bold
          /\[.+\]\(.+\)/,// links
          /^[-*]\s+/m,   // lists
        ];
        const matchCount = markdownSignals.filter((rx) => rx.test(content)).length;
        entry.spec.isMarkdown = matchCount >= 2;

        // Link kontrolü
        entry.spec.hasLinks = /\[.+\]\(https?:\/\/.+\)/.test(content);

        // Bölüm kontrolü (birden fazla heading)
        const headingCount = (content.match(/^#{1,6}\s+/gm) || []).length;
        entry.spec.hasSections = headingCount >= 2;

        // Hata tespitleri
        if (!entry.spec.hasH1) entry.errors.push("H1 başlık eksik (# Başlık formatı)");
        if (!entry.spec.hasBlockquote) entry.errors.push("Blockquote açıklama eksik (> özet)");
        if (!entry.spec.isMarkdown) entry.errors.push("Markdown format yeterli değil");
      }

      await tempPage.close();
    } catch (e) {
      entry.errors.push("Erişim hatası: " + e.message);
    }

    results[file] = entry;
  }

  return results;
}

// ─── 2. robots.txt AI Bot Engelleme Kontrolü ────────────────────────

async function checkAiBotBlocking(page, origin, timeout) {
  const result = {
    robotsTxtExists: false,
    botStatus: {},
    blockedBots: [],
    allowedBots: [],
    rawRobotsTxt: null,
  };

  try {
    const tempPage = await page.context().newPage();
    const response = await tempPage.goto(`${origin}/robots.txt`, {
      waitUntil: "domcontentloaded",
      timeout: timeout || 10000,
    });

    if (response?.status() === 200) {
      result.robotsTxtExists = true;
      const content = await response.text();
      result.rawRobotsTxt = content.substring(0, 2000);

      // robots.txt'yi user-agent bloklarına ayır
      const blocks = parseRobotsTxtBlocks(content);

      for (const bot of AI_BOTS) {
        const status = {
          bot,
          mentioned: false,
          blocked: false,
          disallowRules: [],
          allowRules: [],
          appliedBlock: null,
        };

        // Bot'a özel blok var mı?
        const specificBlock = blocks.find(
          (b) => b.userAgent.toLowerCase() === bot.toLowerCase()
        );

        // Wildcard (*) bloğu
        const wildcardBlock = blocks.find((b) => b.userAgent === "*");

        if (specificBlock) {
          status.mentioned = true;
          status.appliedBlock = "specific";
          status.disallowRules = specificBlock.disallow;
          status.allowRules = specificBlock.allow;
          // Kök dizin (/) engellenmiş mi?
          status.blocked = specificBlock.disallow.some(
            (r) => r.trim() === "/" || r.trim() === "/*"
          );
        } else if (wildcardBlock) {
          status.appliedBlock = "wildcard";
          status.disallowRules = wildcardBlock.disallow;
          status.allowRules = wildcardBlock.allow;
          status.blocked = wildcardBlock.disallow.some(
            (r) => r.trim() === "/" || r.trim() === "/*"
          );
        }

        result.botStatus[bot] = status;

        if (status.blocked) {
          result.blockedBots.push(bot);
        } else {
          result.allowedBots.push(bot);
        }
      }
    }

    await tempPage.close();
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

function parseRobotsTxtBlocks(content) {
  const blocks = [];
  let currentBlock = null;

  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") return;

    const uaMatch = trimmed.match(/^user-agent:\s*(.+)/i);
    if (uaMatch) {
      currentBlock = {
        userAgent: uaMatch[1].trim(),
        disallow: [],
        allow: [],
      };
      blocks.push(currentBlock);
      return;
    }

    if (!currentBlock) return;

    const disallowMatch = trimmed.match(/^disallow:\s*(.*)/i);
    if (disallowMatch) {
      currentBlock.disallow.push(disallowMatch[1].trim());
      return;
    }

    const allowMatch = trimmed.match(/^allow:\s*(.*)/i);
    if (allowMatch) {
      currentBlock.allow.push(allowMatch[1].trim());
    }
  });

  return blocks;
}

// ─── 3. Alıntılanabilirlik Skoru ────────────────────────────────────

async function checkCitability(page) {
  return await page.evaluate(() => {
    const result = {
      score: 0,
      maxScore: 5,
      checks: {},
    };

    const bodyText = document.body?.innerText || "";

    // 3a. İlk paragrafta tanım cümlesi var mı?
    // "X, ... bir/olan/dir/dır/tır/tir" veya "X is ..." kalıpları
    const firstP = document.querySelector(
      "article p, main p, .content p, #content p, p"
    );
    const firstPText = firstP?.innerText?.trim() || "";
    const definitionPatterns = [
      /\b(?:bir|olan|olarak|dır|dir|tır|tir|tur|tür|dır|dur|dürdur)\b/i,
      /\bis\s+(?:a|an|the)\b/i,
      /\brefers?\s+to\b/i,
      /\bdefined?\s+as\b/i,
    ];
    const hasDefinition = definitionPatterns.some((rx) => rx.test(firstPText));
    result.checks.definitionSentence = {
      found: hasDefinition,
      preview: firstPText.substring(0, 120),
    };
    if (hasDefinition) result.score++;

    // 3b. Soru formatında heading var mı?
    const headings = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, h5, h6")
    );
    const questionHeadings = headings.filter((h) => {
      const text = h.innerText?.trim() || "";
      return (
        text.endsWith("?") ||
        /^(ne|nasıl|neden|nerede|kim|kaç|hangi|what|how|why|where|when|who|which|can|do|does|is|are)\b/i.test(
          text
        )
      );
    });
    result.checks.questionHeadings = {
      found: questionHeadings.length > 0,
      count: questionHeadings.length,
      examples: questionHeadings.slice(0, 3).map((h) => h.innerText.trim()),
    };
    if (questionHeadings.length > 0) result.score++;

    // 3c. İstatistik / veri var mı?
    // Yüzde, sayısal ifade, para birimi gibi kalıplar
    const statPatterns = [
      /%\d|\d+%/,                     // yüzde
      /\d{1,3}([.,]\d{3})+/,          // büyük sayılar
      /\$\d|\€\d|₺\d|\d\s*(TL|USD|EUR|GBP)/i, // para birimi
      /\b\d{4}\b.*\b(yıl|year|yılında)\b/i,     // yıl referansı
      /\b(araştırma|study|research|survey|rapor|report)\b/i, // kaynak referansı
    ];
    const statsFound = statPatterns.filter((rx) => rx.test(bodyText));
    result.checks.statistics = {
      found: statsFound.length > 0,
      matchedPatterns: statsFound.length,
    };
    if (statsFound.length > 0) result.score++;

    // 3d. Yayın / güncelleme tarihi var mı?
    // <time> etiketi, datePublished, dateModified, veya metin içi tarih
    const timeElements = document.querySelectorAll("time[datetime]");
    const metaDatePublished =
      document.querySelector('meta[property="article:published_time"]')?.content ||
      null;
    const metaDateModified =
      document.querySelector('meta[property="article:modified_time"]')?.content ||
      null;

    // JSON-LD'de datePublished kontrolü
    let jsonLdDate = false;
    const ldScripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    ldScripts.forEach((s) => {
      try {
        const data = JSON.parse(s.textContent);
        const checkObj = (obj) => {
          if (obj?.datePublished || obj?.dateModified) return true;
          if (obj?.["@graph"]) return obj["@graph"].some(checkObj);
          return false;
        };
        if (checkObj(data)) jsonLdDate = true;
      } catch {}
    });

    result.checks.publishDate = {
      found:
        timeElements.length > 0 ||
        !!metaDatePublished ||
        !!metaDateModified ||
        jsonLdDate,
      timeElements: timeElements.length,
      metaPublished: metaDatePublished,
      metaModified: metaDateModified,
      jsonLdDate,
    };
    if (result.checks.publishDate.found) result.score++;

    // 3e. Bonus: Listeleme ve tablo yapısı (LLM'ler yapısal veriyi sever)
    const lists = document.querySelectorAll("ol, ul");
    const tables = document.querySelectorAll("table");
    result.checks.structuredContent = {
      lists: lists.length,
      tables: tables.length,
      found: lists.length > 0 || tables.length > 0,
    };
    if (result.checks.structuredContent.found) result.score++;

    result.percentage = Math.round((result.score / result.maxScore) * 100);
    return result;
  });
}

// ─── 4. E-E-A-T Sinyalleri ──────────────────────────────────────────

async function checkEEAT(page) {
  return await page.evaluate(() => {
    const result = {
      score: 0,
      maxScore: 6,
      signals: {},
    };

    // 4a. Yazar bilgisi
    const authorSelectors = [
      '[rel="author"]',
      '[class*="author"]',
      '[itemprop="author"]',
      '[data-author]',
      ".byline",
      ".writer",
      ".post-author",
    ];
    let authorElement = null;
    for (const sel of authorSelectors) {
      authorElement = document.querySelector(sel);
      if (authorElement) break;
    }

    // JSON-LD'de author kontrolü
    let jsonLdAuthor = null;
    const ldScripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    ldScripts.forEach((s) => {
      try {
        const data = JSON.parse(s.textContent);
        const findAuthor = (obj) => {
          if (obj?.author) return obj.author;
          if (obj?.["@graph"]) {
            for (const item of obj["@graph"]) {
              const a = findAuthor(item);
              if (a) return a;
            }
          }
          return null;
        };
        const a = findAuthor(data);
        if (a) jsonLdAuthor = a;
      } catch {}
    });

    result.signals.author = {
      found: !!authorElement || !!jsonLdAuthor,
      domElement: authorElement?.innerText?.trim()?.substring(0, 100) || null,
      jsonLdAuthor: jsonLdAuthor
        ? typeof jsonLdAuthor === "string"
          ? jsonLdAuthor
          : jsonLdAuthor.name || JSON.stringify(jsonLdAuthor).substring(0, 150)
        : null,
    };
    if (result.signals.author.found) result.score++;

    // 4b. About sayfası linki
    const links = Array.from(document.querySelectorAll("a"));
    const aboutLink = links.find((a) => {
      const href = (a.getAttribute("href") || "").toLowerCase();
      const text = (a.innerText || "").toLowerCase();
      return (
        href.includes("/about") ||
        href.includes("/hakkimizda") ||
        href.includes("/hakkinda") ||
        href.includes("/biz-kimiz") ||
        text.includes("about") ||
        text.includes("hakkımızda") ||
        text.includes("hakkında")
      );
    });
    result.signals.aboutPage = {
      found: !!aboutLink,
      href: aboutLink?.getAttribute("href") || null,
    };
    if (result.signals.aboutPage.found) result.score++;

    // 4c. Contact / İletişim linki
    const contactLink = links.find((a) => {
      const href = (a.getAttribute("href") || "").toLowerCase();
      const text = (a.innerText || "").toLowerCase();
      return (
        href.includes("/contact") ||
        href.includes("/iletisim") ||
        href.includes("/bize-ulasin") ||
        text.includes("contact") ||
        text.includes("iletişim") ||
        text.includes("bize ulaşın")
      );
    });
    result.signals.contactPage = {
      found: !!contactLink,
      href: contactLink?.getAttribute("href") || null,
    };
    if (result.signals.contactPage.found) result.score++;

    // 4d. Organizasyon bilgisi (JSON-LD Organization schema)
    let hasOrganization = false;
    ldScripts.forEach((s) => {
      try {
        const data = JSON.parse(s.textContent);
        const check = (obj) => {
          if (obj?.["@type"] === "Organization" || obj?.["@type"] === "LocalBusiness")
            return true;
          if (obj?.publisher?.["@type"] === "Organization") return true;
          if (obj?.["@graph"]) return obj["@graph"].some(check);
          return false;
        };
        if (check(data)) hasOrganization = true;
      } catch {}
    });
    result.signals.organization = { found: hasOrganization };
    if (hasOrganization) result.score++;

    // 4e. Güvenlik sinyalleri (Privacy policy, Terms)
    const trustLinks = links.filter((a) => {
      const href = (a.getAttribute("href") || "").toLowerCase();
      const text = (a.innerText || "").toLowerCase();
      return (
        href.includes("privacy") ||
        href.includes("gizlilik") ||
        href.includes("terms") ||
        href.includes("kosullar") ||
        href.includes("kvkk") ||
        text.includes("privacy") ||
        text.includes("gizlilik") ||
        text.includes("terms") ||
        text.includes("koşullar") ||
        text.includes("kvkk")
      );
    });
    result.signals.trustPages = {
      found: trustLinks.length > 0,
      count: trustLinks.length,
    };
    if (trustLinks.length > 0) result.score++;

    // 4f. Sosyal medya linkleri
    const socialDomains = [
      "twitter.com",
      "x.com",
      "facebook.com",
      "linkedin.com",
      "instagram.com",
      "youtube.com",
    ];
    const socialLinks = links.filter((a) => {
      const href = a.getAttribute("href") || "";
      return socialDomains.some((d) => href.includes(d));
    });
    result.signals.socialProfiles = {
      found: socialLinks.length > 0,
      count: socialLinks.length,
      platforms: [
        ...new Set(
          socialLinks.map((a) => {
            const href = a.getAttribute("href") || "";
            return socialDomains.find((d) => href.includes(d)) || "other";
          })
        ),
      ],
    };
    if (socialLinks.length > 0) result.score++;

    result.percentage = Math.round((result.score / result.maxScore) * 100);
    return result;
  });
}

// ─── 5. Schema Derinliği ────────────────────────────────────────────

async function checkSchemaDepth(page) {
  return await page.evaluate(() => {
    const TARGET_TYPES = ["FAQPage", "HowTo", "Article", "Product"];
    const result = {
      totalSchemas: 0,
      targetSchemas: {},
      allTypes: [],
      depthScore: 0,
      maxDepthScore: 0,
    };

    const ldScripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    const allItems = [];

    ldScripts.forEach((s) => {
      try {
        const data = JSON.parse(s.textContent);
        // @graph destekli düzleştirme
        if (data["@graph"] && Array.isArray(data["@graph"])) {
          data["@graph"].forEach((item) => allItems.push(item));
        } else {
          allItems.push(data);
        }
      } catch {}
    });

    result.totalSchemas = allItems.length;
    result.allTypes = allItems
      .map((item) => item["@type"])
      .filter(Boolean)
      .flat();

    // Her hedef tip için detay analizi
    for (const targetType of TARGET_TYPES) {
      const matching = allItems.filter((item) => {
        const type = item["@type"];
        if (Array.isArray(type)) return type.includes(targetType);
        return type === targetType;
      });

      if (matching.length === 0) {
        result.targetSchemas[targetType] = { found: false, count: 0, depth: 0, details: null };
        continue;
      }

      const analysis = { found: true, count: matching.length, instances: [] };

      matching.forEach((schema) => {
        const instance = { fields: Object.keys(schema), fieldCount: Object.keys(schema).length, issues: [] };
        result.maxDepthScore += 3; // Her instance için max 3 puan

        // Tip-özel derinlik kontrolü
        switch (targetType) {
          case "FAQPage": {
            const questions = schema.mainEntity || [];
            instance.questionCount = Array.isArray(questions) ? questions.length : 0;
            instance.hasAcceptedAnswer = Array.isArray(questions)
              ? questions.every((q) => q.acceptedAnswer?.text)
              : false;
            if (instance.questionCount === 0) instance.issues.push("mainEntity boş veya eksik");
            if (instance.questionCount > 0 && !instance.hasAcceptedAnswer)
              instance.issues.push("Bazı sorularda acceptedAnswer eksik");
            // Skor
            let s = 0;
            if (instance.questionCount > 0) s++;
            if (instance.questionCount >= 3) s++;
            if (instance.hasAcceptedAnswer) s++;
            result.depthScore += s;
            break;
          }

          case "HowTo": {
            const steps = schema.step || [];
            instance.stepCount = Array.isArray(steps) ? steps.length : 0;
            instance.hasImages = Array.isArray(steps) ? steps.some((s) => s.image) : false;
            instance.hasTotalTime = !!schema.totalTime;
            instance.hasSupply = !!(schema.supply && schema.supply.length > 0);
            instance.hasTool = !!(schema.tool && schema.tool.length > 0);
            if (instance.stepCount === 0) instance.issues.push("step dizisi boş");
            let s = 0;
            if (instance.stepCount > 0) s++;
            if (instance.hasTotalTime || instance.hasImages) s++;
            if (instance.hasSupply || instance.hasTool) s++;
            result.depthScore += s;
            break;
          }

          case "Article": {
            instance.hasHeadline = !!schema.headline;
            instance.hasAuthor = !!schema.author;
            instance.hasDatePublished = !!schema.datePublished;
            instance.hasDateModified = !!schema.dateModified;
            instance.hasImage = !!schema.image;
            instance.hasPublisher = !!schema.publisher;
            instance.hasDescription = !!schema.description;
            instance.hasWordCount = !!schema.wordCount;
            if (!schema.headline) instance.issues.push("headline eksik");
            if (!schema.author) instance.issues.push("author eksik");
            if (!schema.datePublished) instance.issues.push("datePublished eksik");
            let s = 0;
            if (instance.hasHeadline && instance.hasAuthor) s++;
            if (instance.hasDatePublished && instance.hasPublisher) s++;
            if (instance.hasImage && instance.hasDescription) s++;
            result.depthScore += s;
            break;
          }

          case "Product": {
            instance.hasName = !!schema.name;
            instance.hasDescription = !!schema.description;
            instance.hasImage = !!schema.image;
            instance.hasOffers = !!schema.offers;
            instance.hasBrand = !!schema.brand;
            instance.hasReview = !!schema.review;
            instance.hasAggregateRating = !!schema.aggregateRating;
            instance.hasSku = !!schema.sku || !!schema.gtin13 || !!schema.gtin;
            if (!schema.name) instance.issues.push("name eksik");
            if (!schema.offers) instance.issues.push("offers eksik");
            let s = 0;
            if (instance.hasName && instance.hasDescription) s++;
            if (instance.hasOffers && instance.hasImage) s++;
            if (instance.hasAggregateRating || instance.hasReview) s++;
            result.depthScore += s;
            break;
          }
        }

        analysis.instances.push(instance);
      });

      result.targetSchemas[targetType] = analysis;
    }

    // Genel maxDepthScore en az TARGET_TYPES * 3 olsun (her biri için en az 1 instance varsayımı)
    if (result.maxDepthScore === 0) result.maxDepthScore = TARGET_TYPES.length * 3;
    result.depthPercentage = Math.round((result.depthScore / result.maxDepthScore) * 100);

    return result;
  });
}

// ─── ANA FONKSİYON ──────────────────────────────────────────────────

async function auditAISearch(page, url, timeout) {
  const parsedUrl = new URL(url);
  const origin = parsedUrl.origin;

  console.log(`[ℹ] AI Search Audit başlatılıyor: ${url}`);

  const result = {
    llmsTxt: null,
    aiBotBlocking: null,
    citability: null,
    eeat: null,
    schemaDepth: null,
    overallScore: 0,
    maxOverallScore: 0,
    overallPercentage: 0,
    grade: "",
  };

  // 1. llms.txt kontrolleri
  try {
    result.llmsTxt = await checkLlmsTxt(page, origin, timeout);
  } catch (e) {
    result.llmsTxt = { error: e.message };
  }

  // 2. AI Bot engelleme
  try {
    result.aiBotBlocking = await checkAiBotBlocking(page, origin, timeout);
  } catch (e) {
    result.aiBotBlocking = { error: e.message };
  }

  // 3. Alıntılanabilirlik
  try {
    result.citability = await checkCitability(page);
  } catch (e) {
    result.citability = { error: e.message };
  }

  // 4. E-E-A-T
  try {
    result.eeat = await checkEEAT(page);
  } catch (e) {
    result.eeat = { error: e.message };
  }

  // 5. Schema derinliği
  try {
    result.schemaDepth = await checkSchemaDepth(page);
  } catch (e) {
    result.schemaDepth = { error: e.message };
  }

  // ─── Genel Skor Hesaplama ─────────────────────────────────
  // llms.txt (max 10), bot blocking (max 10), citability (max 25),
  // EEAT (max 30), schema depth (max 25) = toplam 100

  let totalScore = 0;

  // llms.txt: her dosya varsa +3, spec uygunsa +2 = max 10
  if (result.llmsTxt && !result.llmsTxt.error) {
    for (const file of ["llms.txt"]) {
      const f = result.llmsTxt[file];
      if (f?.exists) {
        totalScore += 6;
        if (f.spec.hasH1 && f.spec.hasBlockquote && f.spec.isMarkdown) totalScore += 4;
      }
    }
  }

  // Bot blocking: engellenmemiş her bot +2 = max 10 (5 bot)
  if (result.aiBotBlocking && !result.aiBotBlocking.error) {
    totalScore += result.aiBotBlocking.allowedBots.length * 2;
  }

  // Citability: yüzde üzerinden max 25
  if (result.citability && !result.citability.error) {
    totalScore += Math.round((result.citability.percentage / 100) * 25);
  }

  // E-E-A-T: yüzde üzerinden max 30
  if (result.eeat && !result.eeat.error) {
    totalScore += Math.round((result.eeat.percentage / 100) * 30);
  }

  // Schema: yüzde üzerinden max 25
  if (result.schemaDepth && !result.schemaDepth.error) {
    totalScore += Math.round((result.schemaDepth.depthPercentage / 100) * 25);
  }

  result.overallScore = totalScore;
  result.maxOverallScore = 100;
  result.overallPercentage = totalScore;

  // Harf notu
  if (totalScore >= 90) result.grade = "A+";
  else if (totalScore >= 80) result.grade = "A";
  else if (totalScore >= 70) result.grade = "B+";
  else if (totalScore >= 60) result.grade = "B";
  else if (totalScore >= 50) result.grade = "C";
  else if (totalScore >= 35) result.grade = "D";
  else result.grade = "F";

  return result;
}

module.exports = { auditAISearch };
