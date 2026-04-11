// Compares runA (older) with runB (newer)
function compareRuns(runA, runB) {
  const deltas = [];

  // Group by URL
  const bMap = new Map((runB || []).map(r => [r.url, r]));
  const aMap = new Map((runA || []).map(r => [r.url, r]));

  // Compare everything in B against A
  for (const [url, rB] of bMap.entries()) {
    const rA = aMap.get(url);
    if (!rA) {
      deltas.push({ url, status: 'new', changes: ['Yeni sayfa tarandı'] });
      continue;
    }

    const changes = [];
    
    // Status Code
    if (rB.status !== rA.status) {
      changes.push({ type: 'status', label: 'HTTP Status', from: rA.status, to: rB.status, danger: rB.status >= 400 });
    }

    // AI Grade
    const aGrade = rA.aiSearch ? calculateLetter(rA.aiSearch) : null;
    const bGrade = rB.aiSearch ? calculateLetter(rB.aiSearch) : null;
    if (aGrade !== bGrade) {
      const bScore = rB.aiSearch ? rB.aiSearch.totalScore : 0;
      const aScore = rA.aiSearch ? rA.aiSearch.totalScore : 0;
      changes.push({ 
        type: 'ai_grade', 
        label: 'AI Readiness', 
        from: aGrade || '-', 
        to: bGrade || '-', 
        danger: bScore < aScore 
      });
    }

    // Performance (LCP)
    const lcpA = rA.performance?.lcp || 0;
    const lcpB = rB.performance?.lcp || 0;
    if (Math.abs(lcpB - lcpA) > 100) { // Threshold: 100ms
      changes.push({
        type: 'perf_lcp',
        label: 'LCP (ms)',
        from: Math.round(lcpA),
        to: Math.round(lcpB),
        danger: lcpB > lcpA // slower is worse
      });
    }

    // Network Errors
    const errA = (rA.network?.jsErrors || []).length;
    const errB = (rB.network?.jsErrors || []).length;
    if (errA !== errB) {
      changes.push({
        type: 'js_errors',
        label: 'JS Hataları',
        from: errA,
        to: errB,
        danger: errB > errA
      });
    }

    // Broken Links
    const bLinksA = rA.network?.brokenResourceUrls?.length || 0;
    const bLinksB = rB.network?.brokenResourceUrls?.length || 0;
    if (bLinksA !== bLinksB) {
      changes.push({
        type: 'broken_resources',
        label: 'Kırık Kaynak',
        from: bLinksA,
        to: bLinksB,
        danger: bLinksB > bLinksA
      });
    }

    // Meta Title Change
    const titleA = rA.meta?.title || "";
    const titleB = rB.meta?.title || "";
    if (titleA !== titleB) {
      changes.push({
        type: 'meta_title',
        label: 'Title Değişimi',
        from: titleA,
        to: titleB,
        danger: false // Neutral info
      });
    }

    if (changes.length > 0) {
      // Summarize if it's generally an improvement or regression based on "danger" flags
      const regressions = changes.filter(c => c.danger).length;
      const severity = regressions > 0 ? (regressions > 2 ? 'critical' : 'warning') : 'info';
      
      deltas.push({ url, status: 'changed', severity, changes });
    } else {
      deltas.push({ url, status: 'unchanged', changes: [] });
    }
  }

  // Find dropped URLs
  for (const [url, rA] of aMap.entries()) {
    if (!bMap.has(url)) {
      deltas.push({ url, status: 'dropped', changes: ['Artık bu URL taranmıyor'] });
    }
  }

  return deltas;
}

function calculateLetter(aiResults) {
  const score = aiResults.totalScore || 0;
  if(score >= 90) return 'A+';
  if(score >= 80) return 'A';
  if(score >= 70) return 'B+';
  if(score >= 60) return 'B';
  if(score >= 50) return 'C';
  if(score >= 35) return 'D';
  return 'F';
}

module.exports = { compareRuns };
