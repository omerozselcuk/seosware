# 🔍 Seosware

**Advanced Playwright-based SEO Auditor** with AI Search Readiness analysis and a local web dashboard.

Seosware crawls your pages with a real Chromium browser, extracts 100+ SEO signals, and scores your site's readiness for both traditional search engines and AI-powered search (ChatGPT, Perplexity, Claude, Google AI Overviews).

---

## ✨ Features

### 🕷️ Core SEO Audit
- **Meta Tags** — Title, Description, Canonical, Open Graph, Twitter Cards
- **Content** — Heading hierarchy (H1-H6), JSON-LD schema validation, word count
- **Images** — Alt attribute checks, lazy-load verification via scroll simulation
- **Links** — Internal/external link analysis, broken hrefs, hreflang tags
- **Performance** — LCP, CLS, Long Tasks, render-blocking resources, unused CSS (via CDP)
- **Rendering** — SSR vs CSR comparison with cosine similarity scoring
- **Mobile** — Viewport overflow, tap target sizes, font size issues
- **Security** — HTTPS, mixed content, robots.txt compliance

### 🤖 AI Search Readiness
- **`/llms.txt` & `/llms-full.txt`** — Existence and spec compliance (H1, blockquote, markdown format)
- **AI Bot Blocking** — Checks robots.txt for GPTBot, ClaudeBot, PerplexityBot, Google-Extended, ChatGPT-User
- **Citability Score** — Definition sentences, question headings, statistics, publish dates, structured content
- **E-E-A-T Signals** — Author info, about/contact pages, organization schema, trust pages, social profiles
- **Schema Depth** — FAQPage, HowTo, Article, Product schema field completeness analysis
- **Overall Grade** — Weighted score (A+ to F) across all AI readiness categories

### 📊 Local Dashboard
- Dark-mode glassmorphism UI
- Real-time SSE progress streaming
- Score cards with color-coded grades
- Detail panels for every audit category

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Playwright Chromium browser

### Installation
```bash
git clone https://github.com/YOUR_USERNAME/seosware.git
cd seosware
npm install
npx playwright install chromium
```

### Dashboard (Web UI)
```bash
npm run dashboard
```
Open **http://localhost:3000** in your browser. Add URLs and click "Audit Başlat".

### CLI
```bash
# Console output
npm run audit -- "https://example.com"

# JSON export
npm run audit -- "https://example.com" --format json --output report.json

# CSV export
npm run audit -- "https://example.com" --format csv --output report.csv
```

---

## 📁 Project Structure

```
seosware/
├── dashboard/
│   └── index.html              # Web dashboard UI
├── src/
│   ├── server.js               # Express + SSE server
│   ├── cli.js                  # CLI entry point
│   ├── index.js                # Core orchestrator
│   ├── auditors/
│   │   ├── meta.js             # Meta tags audit
│   │   ├── content.js          # Content & headings audit
│   │   ├── images.js           # Image audit
│   │   ├── links.js            # Link & accessibility audit
│   │   ├── performance.js      # Core Web Vitals audit
│   │   ├── rendering.js        # SSR vs CSR audit
│   │   ├── mobile.js           # Mobile simulation audit
│   │   └── ai-search-auditor.js # AI Search Readiness audit
│   ├── reporters/
│   │   ├── consoleReporter.js  # Terminal output
│   │   ├── jsonReporter.js     # JSON file output
│   │   └── csvReporter.js      # CSV file output
│   └── utils/
│       ├── browser.js          # Playwright browser helpers
│       └── fetchers.js         # Sitemap, robots.txt, similarity
├── config/
│   └── default.js              # Default configuration
├── data/                       # Audit output directory
└── package.json
```

---

## 🤖 AI Search Scoring

| Category | Weight | Max Points |
|:---------|:-------|:-----------|
| llms.txt files | Existence + spec compliance | 10 |
| AI Bot access | Per allowed bot × 2 | 10 |
| Citability | Definition, questions, stats, dates, structure | 25 |
| E-E-A-T | Author, about, contact, org, trust, social | 30 |
| Schema depth | FAQ, HowTo, Article, Product completeness | 25 |
| **Total** | | **100** |

**Grades:** A+ (90+) · A (80+) · B+ (70+) · B (60+) · C (50+) · D (35+) · F (<35)

---

## 📋 License

ISC
