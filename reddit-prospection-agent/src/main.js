require('dotenv').config();

const fs = require('fs');
const path = require('path');
const RedditScraper = require('./reddit-scraper');
const ProspectAnalyzer = require('./analyzer');
const SheetsExporter = require('./sheets-exporter');
const config = require('../config/config.json');

class ProspectionAgent {
  constructor() {
    this.scraper = new RedditScraper();
    this.analyzer = new ProspectAnalyzer();
    this.exporter = new SheetsExporter();
  }

  /**
   * Run the full prospection pipeline.
   */
  async run() {
    const startTime = Date.now();
    console.log('');
    console.log('='.repeat(60));
    console.log('  Reddit Prospection Agent - UX/UI Design Services');
    console.log('='.repeat(60));
    console.log(`  Started at: ${new Date().toISOString()}`);
    console.log(`  Period: last ${config.search.period_hours} hours`);
    console.log(`  Subreddits: ${config.subreddits.length}`);
    console.log(`  European filter: ${config.search.filter_european_only ? 'ON' : 'OFF'}`);
    console.log('='.repeat(60));
    console.log('');

    // --- Step 1: Validate configuration ---
    this.validateConfig();

    // --- Step 2: Initialize Reddit client ---
    console.log('[Pipeline] Step 1/5: Initializing Reddit client...');
    this.scraper.init();

    // --- Step 3: Scan subreddits ---
    console.log('[Pipeline] Step 2/5: Scanning subreddits for prospects...');
    const rawPosts = await this.scraper.scanAll();

    if (rawPosts.length === 0) {
      console.log('[Pipeline] No matching posts found. Try adjusting keywords or period.');
      return;
    }

    // --- Step 4: Fetch author info for top candidates ---
    console.log('[Pipeline] Step 3/5: Fetching author information...');
    const authorInfoMap = {};
    const postsToCheck = rawPosts.slice(0, 100); // Limit API calls

    for (const post of postsToCheck) {
      if (post.author && post.author !== '[deleted]' && !authorInfoMap[post.author]) {
        const info = await this.scraper.getAuthorInfo(post.author);
        if (info) {
          authorInfoMap[post.author] = info;
        }
      }
    }

    console.log(`[Pipeline] Fetched info for ${Object.keys(authorInfoMap).length} authors`);

    // --- Step 5: Analyze and qualify ---
    console.log('[Pipeline] Step 4/5: Analyzing and qualifying prospects...');
    const prospects = this.analyzer.analyzeAll(rawPosts, authorInfoMap);

    // --- Step 6: Save local backup ---
    if (config.output.local_backup) {
      this.saveLocalBackup(prospects);
    }

    // --- Step 7: Export to Google Sheets ---
    console.log('[Pipeline] Step 5/5: Exporting to Google Sheets...');
    const sheetsInitialized = await this.exporter.init();
    let sheetsResult = { added: 0, skipped: 0 };

    if (sheetsInitialized) {
      sheetsResult = await this.exporter.exportProspects(prospects);
    } else {
      console.log('[Pipeline] Google Sheets export skipped (not configured)');
    }

    // --- Summary ---
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.printSummary(rawPosts, prospects, sheetsResult, elapsed);

    return prospects;
  }

  /**
   * Validate that required environment variables are set.
   */
  validateConfig() {
    const required = [
      'REDDIT_CLIENT_ID',
      'REDDIT_CLIENT_SECRET',
      'REDDIT_USERNAME',
      'REDDIT_PASSWORD',
      'REDDIT_USER_AGENT',
    ];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error('[Config] Missing required environment variables:');
      missing.forEach((key) => console.error(`  - ${key}`));
      console.error('[Config] Copy .env.example to .env and fill in your credentials.');
      process.exit(1);
    }
  }

  /**
   * Save prospects to a local JSON file as backup.
   */
  saveLocalBackup(prospects) {
    const backupPath = path.resolve(__dirname, '..', config.output.backup_path);
    const backupDir = path.dirname(backupPath);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Load existing data and merge
    let existing = [];
    if (fs.existsSync(backupPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      } catch {
        existing = [];
      }
    }

    // Merge, avoiding duplicates by URL
    const existingUrls = new Set(existing.map((p) => p.url));
    const newProspects = prospects.filter((p) => !existingUrls.has(p.url));
    const merged = [...existing, ...newProspects];

    // Sort by date descending, then qualification score descending
    merged.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.qualification_score - a.qualification_score;
    });

    fs.writeFileSync(backupPath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`[Backup] Saved ${newProspects.length} new prospects (${merged.length} total) to ${backupPath}`);
  }

  /**
   * Print a formatted summary to the console.
   */
  printSummary(rawPosts, prospects, sheetsResult, elapsed) {
    console.log('');
    console.log('='.repeat(60));
    console.log('  SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Raw posts found:         ${rawPosts.length}`);
    console.log(`  Qualified prospects:      ${prospects.length}`);
    console.log(`  Exported to Sheets:       ${sheetsResult.added} new, ${sheetsResult.skipped} duplicates`);
    console.log(`  Execution time:           ${elapsed}s`);
    console.log('='.repeat(60));

    if (config.output.console_summary && prospects.length > 0) {
      console.log('');
      console.log('  TOP PROSPECTS:');
      console.log('-'.repeat(60));

      const top = prospects.slice(0, 10);
      for (const p of top) {
        console.log(`  [Q:${p.qualification_score}/10 U:${p.urgency_score}/10] u/${p.username}`);
        console.log(`    ${p.summary}`);
        console.log(`    r/${p.subreddit} | ${p.score} upvotes | ${p.url}`);
        console.log(`    Raison: ${p.reason}`);
        if (p.email) console.log(`    Email: ${p.email}`);
        console.log('');
      }
    }

    if (prospects.length === 0) {
      console.log('');
      console.log('  No qualified prospects found for this period.');
      console.log('  Try:');
      console.log('    - Increasing the period (period_hours in config.json)');
      console.log('    - Adding more subreddits');
      console.log('    - Broadening keywords');
    }

    console.log('');
  }
}

// --- CLI Entry Point ---
async function main() {
  const agent = new ProspectionAgent();

  // Support CLI arguments for quick overrides
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node src/main.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --period <hours>    Override search period (default: 24)');
    console.log('  --eu-only           Only show European prospects');
    console.log('  --no-sheets         Skip Google Sheets export');
    console.log('  --dry-run           Scan and analyze without exporting');
    console.log('  -h, --help          Show this help message');
    return;
  }

  // Parse --period
  const periodIdx = args.indexOf('--period');
  if (periodIdx !== -1 && args[periodIdx + 1]) {
    const hours = parseInt(args[periodIdx + 1], 10);
    if (!isNaN(hours) && hours > 0) {
      config.search.period_hours = hours;
      console.log(`[CLI] Period overridden to ${hours} hours`);
    }
  }

  // Parse --eu-only
  if (args.includes('--eu-only')) {
    config.search.filter_european_only = true;
    console.log('[CLI] European filter enabled');
  }

  try {
    await agent.run();
  } catch (err) {
    console.error('[Fatal] Unhandled error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
