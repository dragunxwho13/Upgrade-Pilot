#!/usr/bin/env node
/**
 * cli.js — UpgradePilot entry point
 *
 * Usage:
 *   upgradepilot <subcommand> [options]
 *
 * Subcommands:
 *   scan    Detect outdated / breaking dependencies in a project
 *   plan    Generate an AI upgrade plan with risk scores
 *   run     Apply codemods and bump package versions
 *   report  Emit a Markdown or JSON upgrade report
 *   demo    Run the full pipeline against the built-in sample-app
 *
 * Options:
 *   --path <dir>         Target project directory (default: cwd)
 *   --format <fmt>       Output format: markdown | json  (default: markdown)
 *   --json               Alias for --format json (scan subcommand)
 *   --pretty             Pretty-print JSON output (scan subcommand)
 *   --out <file>         Save scan output to this file (default: tool/out/usage-map.json)
 *   --dry-run            Simulate changes without writing files
 *   --verbose            Print detailed agent logs
 *   --help, -h           Show this help message
 *   --version, -v        Print version
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs   from 'fs';
import { scanner }  from './src/agents/scanner.js';
import { librarian } from './src/agents/librarian.js';
import { planner }  from './src/agents/planner.js';
import { codemoder } from './src/agents/codemoder.js';
import { verifier } from './src/agents/verifier.js';
import { scribe }   from './src/agents/scribe.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = require('./package.json');

// ─── Minimal argument parser (no heavy framework needed) ────────────────────
const args = process.argv.slice(2);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      opts[a.slice(1)] = true;
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

const opts = parseArgs(args);
const subcommand = opts._[0];

// ─── Help ────────────────────────────────────────────────────────────────────
const HELP = `
UpgradePilot v${pkg.version}
AI-powered dependency upgrade co-pilot for Node.js projects.

Usage:
  upgradepilot <subcommand> [options]

Subcommands:
  scan    Detect outdated / breaking dependencies + source usage map
  plan    Generate an upgrade plan with risk scores
  run     Apply codemods and bump versions
  report  Emit a Markdown or JSON upgrade report
  demo    Run the full pipeline on the built-in sample-app

Options:
  --path <dir>     Target project directory (default: current directory)
  --format <fmt>   Output format: markdown | json  (default: markdown)
  --json           Emit scan result as JSON (alias for --format json)
  --pretty         Pretty-print JSON (adds indentation)
  --out <file>     Write scan output to file (scan subcommand)
  --dry-run        Simulate without writing files
  --verbose        Verbose agent logging
  -h, --help       Show this help
  -v, --version    Print version

Examples:
  upgradepilot scan   --path ./my-app
  upgradepilot scan   --path ./my-app --json --pretty
  upgradepilot scan   --path ./my-app --out ./my-app/usage-map.json
  upgradepilot plan   --path ./my-app
  upgradepilot run    --path ./my-app --dry-run
  upgradepilot report --path ./my-app --format json
  upgradepilot demo
`.trim();

if (opts.help || opts.h || !subcommand) {
  console.log(HELP);
  process.exit(0);
}

if (opts.version || opts.v) {
  console.log(`upgradepilot v${pkg.version}`);
  process.exit(0);
}

// ─── Shared context passed through agents ────────────────────────────────────
const ctx = {
  targetPath: path.resolve(opts.path || process.cwd()),
  format:     opts.format  || 'markdown',
  dryRun:     Boolean(opts['dry-run']),
  verbose:    Boolean(opts.verbose),
  jsonOut:    Boolean(opts.json),
  pretty:     Boolean(opts.pretty),
  outFile:    opts.out || null,
};

function log(...msg) {
  if (ctx.verbose) console.log('[upgradepilot]', ...msg);
}

/**
 * Serialise a scan result as JSON and optionally save to disk.
 * @param {object} result
 * @param {object} scanCtx
 */
function emitScanResult(result, scanCtx) {
  const indent  = scanCtx.pretty ? 2 : 0;
  const output  = JSON.stringify(result, null, indent);

  if (scanCtx.outFile) {
    const dest = path.resolve(scanCtx.outFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(result, null, 2), 'utf8');
    console.error(`[scan] Saved → ${dest}`);
  }

  console.log(output);
}

// ─── Subcommand dispatch ─────────────────────────────────────────────────────
async function main() {
  switch (subcommand) {
    case 'scan': {
      const useJson = ctx.jsonOut || ctx.format === 'json' || ctx.outFile;
      if (!useJson) console.error(`🔍 Scanning ${ctx.targetPath} …`);
      const result = await scanner.scan(ctx);

      if (useJson) {
        emitScanResult(result, ctx);
      } else {
        // --pretty human-readable table when not in JSON mode
        console.error(`\nSummary: ${result.summary}\n`);
        const hits = result.riskByRule.filter(r => r.occurrences > 0);
        if (hits.length) {
          console.log('Rule'.padEnd(40) + 'Pkg'.padEnd(12) + 'Hits'.padEnd(6) + 'Sev'.padEnd(5) + 'Risk');
          console.log('─'.repeat(70));
          for (const r of hits) {
            console.log(
              r.ruleId.padEnd(40) +
              r.package.padEnd(12) +
              String(r.occurrences).padEnd(6) +
              String(r.severity).padEnd(5) +
              r.riskScore
            );
          }
        }
        console.log('\nTop hits:');
        for (const [ruleId, hitList] of Object.entries(result.usageMap)) {
          for (const h of hitList) {
            console.log(`  [${ruleId}] ${h.file}:${h.line}  ${h.snippet.slice(0, 80)}`);
          }
        }

        // Always persist the usage-map to disk on every scan
        const defaultOut = path.resolve(__dirname, 'out/usage-map.json');
        fs.mkdirSync(path.dirname(defaultOut), { recursive: true });
        fs.writeFileSync(defaultOut, JSON.stringify(result, null, 2), 'utf8');
        console.error(`\n[scan] Saved → ${defaultOut}`);
      }
      break;
    }

    case 'plan': {
      const useJson = ctx.jsonOut || ctx.format === 'json';
      if (!useJson) console.error(`📋 Building upgrade plan for ${ctx.targetPath} …`);

      const scanResult = await scanner.scan(ctx);
      const notes      = await librarian.fetchNotes(ctx, scanResult);
      const plan       = await planner.buildPlan(ctx, scanResult, notes);
      const markdown   = planner.renderMarkdown(plan);

      // Always persist both artefacts inside tool/out/
      const outDir  = path.resolve(__dirname, 'out');
      const jsonDest = ctx.outFile
        ? path.resolve(ctx.outFile)
        : path.join(outDir, 'migration-plan.json');
      const mdDest  = path.join(outDir, 'MIGRATION_PLAN.md');

      if (!ctx.dryRun) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(jsonDest, JSON.stringify(plan, null, 2), 'utf8');
        fs.writeFileSync(mdDest,   markdown, 'utf8');
        console.error(`[plan] Saved JSON → ${jsonDest}`);
        console.error(`[plan] Saved MD   → ${mdDest}`);
      }

      if (useJson) {
        const indent = ctx.pretty ? 2 : 0;
        console.log(JSON.stringify(plan, null, indent));
      } else {
        console.log(markdown);
      }
      break;
    }

    case 'run': {
      const dryTag = ctx.dryRun ? ' [dry-run]' : '';
      console.error(`⚙️  Running upgrade pipeline on ${ctx.targetPath}${dryTag} …`);

      const scanResult = await scanner.scan(ctx);
      const notes      = await librarian.fetchNotes(ctx, scanResult);
      const plan       = await planner.buildPlan(ctx, scanResult, notes);

      // Pass outDir so diffs/log land in tool/out/
      const runCtx  = { ...ctx, outDir: path.resolve(__dirname, 'out') };
      const codemods = await codemoder.apply(runCtx, plan);

      console.error(`\n${codemods.summary}`);
      console.error(`Diffs  → ${codemods.diffDir}`);
      console.error(`Log    → ${codemods.logPath}`);

      if (!ctx.dryRun) {
        const verdict = await verifier.verify(ctx, codemods);
        console.error(verdict.passed ? '✅ Tests passed.' : '❌ Tests failed.');
        if (ctx.jsonOut || ctx.format === 'json') {
          console.log(JSON.stringify({ codemods, verdict }, null, ctx.pretty ? 2 : 0));
        }
      }
      break;
    }

    case 'report': {
      console.log(`📄 Generating ${ctx.format} report for ${ctx.targetPath} …`);
      const scanResult  = await scanner.scan(ctx);
      const notes       = await librarian.fetchNotes(ctx, scanResult);
      const plan        = await planner.buildPlan(ctx, scanResult, notes);
      const report      = await scribe.write(ctx, plan);
      console.log(report);
      break;
    }

    case 'demo': {
      console.log('🎬 Running full demo pipeline on built-in sample-app …');
      const demoCtx = { ...ctx, targetPath: path.resolve(__dirname, '../sample-app') };
      const scanResult = await scanner.scan(demoCtx);
      const notes      = await librarian.fetchNotes(demoCtx, scanResult);
      const plan       = await planner.buildPlan(demoCtx, scanResult, notes);
      const codemods   = await codemoder.apply({ ...demoCtx, dryRun: true }, plan);
      const verdict    = await verifier.verify(demoCtx, codemods);
      const report     = await scribe.write(demoCtx, plan);
      console.log('\n─── UPGRADE REPORT ────────────────────────────────────\n');
      console.log(report);
      break;
    }

    default:
      console.error(`Unknown subcommand: "${subcommand}"\nRun: upgradepilot --help`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  if (ctx.verbose) console.error(err.stack);
  process.exit(1);
});
