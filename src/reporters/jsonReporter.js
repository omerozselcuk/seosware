const fs = require('fs');

function reportJSON(data, outputPath = 'seo-audit-report.json') {
  try {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\n[\u2713] JSON report successfully written to ${outputPath}`);
  } catch (e) {
    console.error(`\n[\u2717] Failed to write JSON report: ${e.message}`);
  }
}

module.exports = { reportJSON };
