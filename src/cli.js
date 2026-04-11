const { runAudit } = require('./index');
const { reportJSON } = require('./reporters/jsonReporter');
const { reportCSV } = require('./reporters/csvReporter');
const { reportConsole } = require('./reporters/consoleReporter');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
  \ud83d\ude80 Seosware - Advanced Playwright SEO Auditor

  Usage: node src/cli.js [options] <url>

  Options:
    --format <type>  Output format (json, csv, console). Default is console.
    --output <file>  Output filename for json/csv. Default is seo-audit-report.[format].
    -h, --help       Show this help message.

  Example:
    node src/cli.js https://example.com --format json --output report.json
    `);
    process.exit(0);
  }

  let url;
  let format = 'console';
  let output;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i+1]) {
      format = args[i+1];
      i++;
    } else if (args[i] === '--output' && args[i+1]) {
      output = args[i+1];
      i++;
    } else if (!args[i].startsWith('-')) {
      url = args[i];
    }
  }

  if (!url) {
    console.error("[\u2717] Please provide a valid URL to audit. Use --help for usage.");
    process.exit(1);
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const result = await runAudit(url, { timeout: 30000 });

  if (result.error && !result.meta) {
    console.error("[\u2717] Audit failed completely, skipping reporters.");
    process.exit(1);
  }

  switch(format.toLowerCase()) {
    case 'json':
      reportJSON(result, output || 'seo-audit-report.json');
      break;
    case 'csv':
      reportCSV([result], output || 'seo-audit-report.csv');
      break;
    case 'console':
    default:
      reportConsole(result);
      break;
  }

  process.exit(0);
}

main().catch(err => {
  console.error("[\u2717] Unexpected Error: ", err);
  process.exit(1);
});
