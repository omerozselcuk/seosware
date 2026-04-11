const fs = require('fs');

function reportCSV(dataArray, outputPath = 'seo-audit-report.csv') {
  try {
    if (!dataArray || dataArray.length === 0) return;

    // We will just create a flat CSV header from the top-level keys
    // of the first result object (and maybe some nested important ones).
    const sample = dataArray[0];
    
    const columns = [
      'url', 'timestamp', 'status', 'loadTime', 'titleLength', 'metaDescriptionLength',
      'h1Count', 'wordCount', 'totalInternalLinks', 'totalExternalLinks',
      'issuesCount'
    ];

    const lines = [columns.join(',')];

    dataArray.forEach(res => {
      const row = [
        `"${res.url}"`,
        `"${res.timestamp}"`,
        res.status || '',
        res.loadTime || '',
        res.meta?.titleLength || '',
        res.meta?.metaDescriptionLength || '',
        res.content?.h1 ? res.content.h1.length : 0,
        res.content?.wordCount || 0,
        res.links?.totalInternalLinks || 0,
        res.links?.totalExternalLinks || 0,
        (res.network?.jsErrors?.length || 0) + (res.network?.hydrationErrors?.length || 0)
      ];
      lines.push(row.join(','));
    });

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`[\u2713] CSV report successfully written to ${outputPath}`);
  } catch (e) {
    console.error(`[\u2717] Failed to write CSV report: ${e.message}`);
  }
}

module.exports = { reportCSV };
