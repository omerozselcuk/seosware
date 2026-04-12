# 🔍 Seosware

**Advanced Playwright-based SEO Auditor** with AI Search Readiness analysis and a local web dashboard.

Seosware crawls your pages with a real Chromium browser, extracts 100+ SEO signals, and scores your site's readiness for both traditional search engines and AI-powered search (ChatGPT, Perplexity, Claude, Google AI Overviews).

---

## ✨ Features

### 🕷️ Core SEO Audit
- **Site-wide Crawler** — Orphan pages detection, link graph, crawl depth, and near-duplicate content similarity checking
- **Meta Tags** — Title, Description, Canonical, Open Graph, Twitter Cards
- **Content** — Heading hierarchy (H1-H6), JSON-LD schema validation, word count
- **Images** — Alt attribute checks, lazy-load verification via scroll simulation
- **Links** — Internal/external, target blank rels, pagination (rel next/prev), infinite scroll, ARIA labels, tab order
- **Performance** — INP (Interaction to Next Paint) sim, Unused CSS/JS coverage, LCP, CLS, Long Tasks, render-blocking resources
- **Rendering** — SSR vs CSR comparison with cosine similarity scoring
- **Mobile** — Viewport overflow, tap target sizes, font size issues
- **Security** — HTTPS, HSTS, X-Frame-Options, mixed content, large files

### 🤖 AI Search Readiness
- **`/llms.txt`** — Existence and spec compliance (H1, blockquote, markdown format)
- **Bot Blocking Check** — Validates if ClaudeBot, GPTBot, or CCBot are blocked by `robots.txt` or headers
- **Readability Grade** — Overall letter grade (A+ to F) for AI accessibility

### 📈 History & Delta Engine
- **Project Batches** — Save named lists of URLs (Projects) and run them continuously.
- **History Tracking** — Saves all previous run snapshots locally to JSON.
- **Delta Analysis** — Compares any two historical snapshots to find regressions.

### ✨ Seosware Pro: Next-Gen AI Insight Engine (v2.7.1)
- **Deep Gemini Analysis** — Automated analysis covering Meta, Content, Links, Performance, Frontend Quality, Mobile UX, Image Optimization, Security, and AI Search Readiness.
- **Ad-Hoc AI Insights** — One-click AI interpretation of audit results directly from the search tab (no project required).
- **Smart Retry & Fallback** — Triple retry mechanism for transient API errors (503/429) with automatic fallback to **Gemini 2.0 Flash** if the primary model is unavailable.
- **Improved UI & Readability** — High-contrast CSS overrides for AI reports to ensure perfect legibility on dark theme dashboards.
- **PDF Export & Caching** — Professional PDF generation with local caching for instant report retrieval.
- **Comprehensive Action Plans** — Prioritized, multi-category task lists (P0-P3) synthesized from hundreds of technical signals.

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
│   │   ├── performance.js      # Core Web Vitals, Coverage, INP
│   │   ├── rendering.js        # SSR vs CSR audit
│   │   ├── mobile.js           # Mobile simulation audit
│   │   └── ai-search-auditor.js # AI Search Readiness audit
│   ├── crawler.js              # Site-wide spider & orphan pages
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
