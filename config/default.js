module.exports = {
  // Playwright default timeout (ms)
  timeout: 30000,
  
  // Default browser viewport
  viewport: {
    width: 1280,
    height: 720
  },

  // Audit thresholds config (0.0 to 1.0)
  thresholds: {
    performance: 0.8,
    accessibility: 0.9,
    bestPractices: 0.9,
    seo: 0.9
  },

  // Target URLs to audit
  urls: [
    'https://example.com'
  ]
};
