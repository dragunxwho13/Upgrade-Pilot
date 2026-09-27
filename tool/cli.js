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
 *   --dry-run            Simulate changes without writing files
 *   --verbose            Print detailed agent logs
 *   --help, -h           Show this help message
 *   --version, -v        Print version
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
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
  scan    Detect outdated / breaking dependencies
  plan    Generate an upgrade plan with risk scores
  run     Apply codemods and bump versions
  report  Emit a Markdown or JSON upgrade report
  demo    Run the full pipeline on the built-in sample-app

Options:
  --path <dir>     Target project directory (default: current directory)
  --format <fmt>   Output format: markdown | json  (default: markdown)
  --dry-run        Simulate without writing files
  --verbose        Verbose agent logging
  -h, --help       Show this help
  -v, --version    Print version

Examples:
  upgradepilot scan   --path ./my-app
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
};

function log(...msg) {
  if (ctx.verbose) console.log('[upgradepilot]', ...msg);
}

// ─── Subcommand dispatch ─────────────────────────────────────────────────────
async function main() {
  switch (subcommand) {
    case 'scan': {
      console.log(`🔍 Scanning ${ctx.targetPath} …`);
      const result = await scanner.scan(ctx);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'plan': {
      console.log(`📋 Building upgrade plan for ${ctx.targetPath} …`);
      const scanResult  = await scanner.scan(ctx);
      const notes       = await librarian.fetchNotes(ctx, scanResult);
      const plan        = await planner.buildPlan(ctx, scanResult, notes);
      console.log(JSON.stringify(plan, null, 2));
      break;
    }

    case 'run': {
      console.log(`⚙️  Running upgrade pipeline on ${ctx.targetPath} …`);
      const scanResult  = await scanner.scan(ctx);
      const notes       = await librarian.fetchNotes(ctx, scanResult);
      const plan        = await planner.buildPlan(ctx, scanResult, notes);
      const codemods    = await codemoder.apply(ctx, plan);
      const verdict     = await verifier.verify(ctx, codemods);
      console.log(ctx.dryRun ? '[dry-run] No files written.' : '✅ Done.');
      console.log(JSON.stringify(verdict, null, 2));
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
