require('dotenv').config();

const fs = require('fs');
const path = require('path');
const ProductHuntScraper = require('./ph-scraper');
const ProspectAnalyzer = require('./analyzer');
const SheetsExporter = require('./sheets-exporter');
const config = require('../config/config.json');

class ProspectionAgent {
  constructor() {
    this.scraper = new ProductHuntScraper();
    this.analyzer = new ProspectAnalyzer();
    this.exporter = new SheetsExporter();
  }

  async run() {
    const startTime = Date.now();

    console.log('');
    console.log('='.repeat(60));
    console.log('  Product Hunt Prospection Agent');
    console.log('  UX/UI & Product Design for SaaS');
    console.log('='.repeat(60));
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log(`  Period:  last ${config.search.period_days} days`);
    console.log(`  Topics:  ${config.topics.length}`);
    console.log(`  Min votes: ${config.search.min_votes}`);
    console.log('='.repeat(60));
    console.log('');

    // Validate config
    if (!process.env.PH_API_TOKEN) {
      console.error('[Error] PH_API_TOKEN not set. Copy .env.example to .env and add your token.');
      console.error('[Error] Get a token at: https://www.producthunt.com/v2/oauth/applications');
      process.exit(1);
    }

    // Step 1: Init scraper
    console.log('[Pipeline] Step 1/4: Initializing Product Hunt client...');
    this.scraper.init();

    // Step 2: Scan
    console.log('[Pipeline] Step 2/4: Scanning Product Hunt...');
    const posts = await this.scraper.scanAll();

    if (posts.length === 0) {
      console.log('[Pipeline] No posts found. Try increasing period_days in config.');
      return [];
    }

    // Step 3: Analyze
    console.log('[Pipeline] Step 3/4: Analyzing and qualifying prospects...');
    const prospects = this.analyzer.analyzeAll(posts);

    // Local backup
    if (config.output.local_backup) {
      this.saveBackup(prospects);
    }

    // Step 4: Export
    console.log('[Pipeline] Step 4/4: Exporting...');
    const sheetsOk = await this.exporter.init();
    let sheetsResult = { added: 0, skipped: 0 };
    if (sheetsOk) {
      if (this.resetSheets) {
        console.log('[Pipeline] Resetting Google Sheet (--reset flag)...');
        await this.exporter.resetSheet();
      }
      sheetsResult = await this.exporter.exportProspects(prospects);
    } else {
      console.log('[Pipeline] Google Sheets skipped (not configured)');
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.printSummary(posts, prospects, sheetsResult, elapsed);

    return prospects;
  }

  saveBackup(prospects) {
    const backupPath = path.resolve(__dirname, '..', config.output.backup_path);
    const backupDir = path.dirname(backupPath);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    let existing = [];
    if (fs.existsSync(backupPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      } catch {
        existing = [];
      }
    }

    const existingUrls = new Set(existing.map((p) => p.ph_url));
    const newProspects = prospects.filter((p) => !existingUrls.has(p.ph_url));
    const merged = [...existing, ...newProspects];

    merged.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.qualification_score - a.qualification_score;
    });

    fs.writeFileSync(backupPath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`[Backup] ${newProspects.length} new (${merged.length} total) -> ${backupPath}`);
  }

  printSummary(posts, prospects, sheetsResult, elapsed) {
    console.log('');
    console.log('='.repeat(60));
    console.log('  RESULTS');
    console.log('='.repeat(60));
    console.log(`  Posts scanned:        ${posts.length}`);
    console.log(`  Qualified prospects:  ${prospects.length}`);
    console.log(`  Sheets export:        ${sheetsResult.added} new, ${sheetsResult.skipped} dupes`);
    console.log(`  Time:                 ${elapsed}s`);
    console.log('='.repeat(60));

    if (config.output.console_summary && prospects.length > 0) {
      console.log('');
      console.log('  TOP PROSPECTS:');
      console.log('-'.repeat(60));

      const top = prospects.slice(0, 15);
      for (const p of top) {
        console.log(`  [Q:${p.qualification_score}/10 U:${p.urgency_score}/10] ${p.product_name}`);
        console.log(`    "${p.tagline}"`);
        console.log(`    Maker: ${p.maker_name} (${p.maker_username})${p.maker_twitter ? ' | ' + p.maker_twitter : ''}`);
        console.log(`    ${p.votes} votes | ${p.ph_url}`);
        console.log(`    Raison: ${p.reason}`);
        if (p.email) console.log(`    Email: ${p.email}`);
        if (p.product_website) console.log(`    Site: ${p.product_website}`);
        console.log('');
      }
    }

    if (prospects.length === 0) {
      console.log('');
      console.log('  Aucun prospect qualifie pour cette periode.');
      console.log('  Essaie d\'augmenter period_days ou baisser min_votes dans config.json');
    }

    console.log('');
  }
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node src/main.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --period <days>     Override search period (default: 7)');
    console.log('  --min-votes <n>     Override minimum votes (default: 5)');
    console.log('  --reset             Reset Google Sheet (delete old data, fresh headers)');
    console.log('  -h, --help          Show help');
    return;
  }

  const periodIdx = args.indexOf('--period');
  if (periodIdx !== -1 && args[periodIdx + 1]) {
    const days = parseInt(args[periodIdx + 1], 10);
    if (!isNaN(days) && days > 0) {
      config.search.period_days = days;
      console.log(`[CLI] Period: ${days} days`);
    }
  }

  const votesIdx = args.indexOf('--min-votes');
  if (votesIdx !== -1 && args[votesIdx + 1]) {
    const votes = parseInt(args[votesIdx + 1], 10);
    if (!isNaN(votes) && votes >= 0) {
      config.search.min_votes = votes;
      console.log(`[CLI] Min votes: ${votes}`);
    }
  }

  const agent = new ProspectionAgent();
  agent.resetSheets = args.includes('--reset');

  try {
    await agent.run();
  } catch (err) {
    console.error('[Fatal]', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
