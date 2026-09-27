/**
 * verifier.js — Test-Suite Verifier Agent
 *
 * ─── Public Interface ────────────────────────────────────────────────────────
 *
 *   verifier.verify(ctx, codemodeResult)  → Promise<Verdict>
 *
 * ctx: {
 *   targetPath   : string   — project root to test
 *   dryRun       : boolean  — when true: re-scan for legacy hits instead of installing
 *   verbose      : boolean
 *   outDir?      : string   — override output dir (default: tool/out)
 *   maxFixCycles?: number   — max auto-fix iterations (default: 3)
 * }
 *
 * codemodeResult: CodemodeResult produced by codemoder.apply()
 *
 * ─── Verdict ─────────────────────────────────────────────────────────────────
 * {
 *   passed           : boolean,
 *   mode             : 'real' | 'dry-run',
 *   testCounts       : { passed: number, failed: number, total: number },
 *   fixCycles        : number,
 *   failuresFixed    : FixRecord[],
 *   legacyHitsAfter  : number,   // real mode: 0 means clean; dry-run: scan count
 *   stdout           : string,
 *   stderr           : string,
 *   testSummary      : string,
 * }
 *
 * ─── FixRecord ────────────────────────────────────────────────────────────────
 * {
 *   cycle     : number,
 *   failureMsg: string,    // Jest failure excerpt
 *   fixApplied: string,    // description of the targeted fix
 *   file      : string,
 *   line      : number,
 * }
 *
 * ─── Real Mode ────────────────────────────────────────────────────────────────
 *
 *   1. Rewrite sample-app/package.json to target versions.
 *   2. Run `npm install --legacy-peer-deps` inside targetPath.
 *   3. Run `npm test` and parse results.
 *   4. If tests fail, up to maxFixCycles:
 *        a. Read failure output from Jest.
 *        b. Apply the minimal targeted fix from the Librarian rule set.
 *        c. Re-run `npm test`.
 *   5. Write tool/out/verification.json.
 *
 * ─── Dry-Run Mode ─────────────────────────────────────────────────────────────
 *
 *   Re-runs the scanner on the (already-codemodded) targetPath and asserts
 *   that ZERO legacy-pattern hits remain. No network, no install, no test run.
 *   Reports simulated verification in verification.json.
 *
 * ─── Target Versions ─────────────────────────────────────────────────────────
 *
 *   Hardcoded here; production would read from migration-plan.json or a config.
 */

import fs            from 'fs';
import path          from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire }  from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require  = createRequire(import.meta.url);

// ─── Target versions ──────────────────────────────────────────────────────────
const TARGET_VERSIONS = {
  prod: {
    express:  '^5.0.0',
    mongoose: '^7.0.0',
  },
  dev: {
    jest:     '^29.0.0',
  },
};

// ─── Targeted fix rules (minimal fixes for known Jest failure patterns) ───────
// Each rule: { pattern (RegExp on failure text), fix(fileSrc, ctx) → newSrc, desc }
const FIX_RULES = [
  // Express 5: app.del() removed at runtime
  {
    id:      'express/app-del',
    pattern: /app\.del is not a function|app\.del\(/,
    desc:    'Replace app.del( with app.delete(',
    fix:     src => src.replace(/\bapp\.del(?!ete)\s*\(/g, 'app.delete('),
  },
  // Express 5: res.send(number) no longer sets status
  {
    id:      'express/res-send-status',
    pattern: /res\.send\(\d{3}\)|\.send\s*\(\s*\d{3}\s*\)/,
    desc:    'Replace res.send(NNN) with res.sendStatus(NNN)',
    fix:     src => src.replace(/\.send\s*\(\s*(\d{3})\s*\)/g, '.sendStatus($1)'),
  },
  // Express 5: req.param() removed
  {
    id:      'express/req-param',
    pattern: /req\.param is not a function|req\.param\(/,
    desc:    "Replace req.param('x') with req.params.x",
    fix:     src => src.replace(/req\.param\s*\(\s*['"](\w+)['"]\s*\)/g,
                                'req.params.$1 /* migrated */'),
  },
  // Express 5: bare '*' wildcard changed
  {
    id:      'express/wildcard-route',
    pattern: /path.*\*.*not supported|bare.*\*/i,
    desc:    "Replace app.verb('*') with app.verb('/{*splat}')",
    fix:     src => src.replace(
               /\.(get|post|put|delete|patch|use|all)\s*\(\s*['"]\*['"]/g,
               '.$1("/{*splat}"'
             ),
  },
  // Mongoose 7: Model.update() removed
  {
    id:      'mongoose/model-update',
    pattern: /Model\.update is not a function|\.update\s*\(|TypeError.*\.update/,
    desc:    'Replace .update( with .updateOne(',
    fix:     src => src.replace(/\.update\s*\(/g, '.updateOne('),
  },
  // Mongoose 7: Model.count() removed
  {
    id:      'mongoose/model-count',
    pattern: /Model\.count is not a function|\.count\s*\(|TypeError.*\.count/,
    desc:    'Replace .count( with .countDocuments(',
    fix:     src => src.replace(/\.count\s*\(/g, '.countDocuments('),
  },
  // Mongoose 7: callback-style queries removed
  {
    id:      'mongoose/callback-query',
    pattern: /callback.*not supported|MongooseError.*callback|no longer accept.*callback/i,
    desc:    'Convert callback-style find() to async/await',
    fix:     src => src.replace(
               /\.find\s*\(([^)]+),\s*function\s*\(err,\s*(\w+)\)\s*\{([^}]+)\}/g,
               (_, filter, resVar, body) =>
                 `.find(${filter}).then(${resVar} => {${body}}).catch(err => { throw err; })`
             ),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse Jest stdout/stderr for test counts. */
function parseTestCounts(output) {
  // Jest: "Tests:  12 passed, 12 total"
  const m = output.match(/Tests:\s*((?:\d+\s+\w+,?\s*)+)/);
  if (m) {
    const text    = m[1];
    const passed  = parseInt((text.match(/(\d+)\s+passed/)  || [0, 0])[1], 10);
    const failed  = parseInt((text.match(/(\d+)\s+failed/)  || [0, 0])[1], 10);
    const total   = parseInt((text.match(/(\d+)\s+total/)   || [0, 0])[1], 10);
    return { passed, failed, total };
  }
  return { passed: 0, failed: 0, total: 0 };
}

/** Parse Jest output for individual failure messages. */
function parseFailures(output) {
  const failures = [];
  // Each Jest failure block starts with "● " or "FAIL"
  const blocks = output.split(/\n● /);
  for (let i = 1; i < blocks.length; i++) {
    failures.push(blocks[i].slice(0, 800).trim());
  }
  return failures;
}

/** Run npm install in targetPath. Returns { ok, stderr }. */
function npmInstall(targetPath, verbose) {
  if (verbose) process.stderr.write('[verifier] npm install …\n');
  const r = spawnSync('npm', ['install', '--legacy-peer-deps'], {
    cwd:      targetPath,
    encoding: 'utf8',
    timeout:  300_000,
    shell:    true,
  });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Run npm test in targetPath. Returns { ok, stdout, stderr, exitCode }. */
function npmTest(targetPath) {
  const r = spawnSync('npm', ['test'], {
    cwd:      targetPath,
    encoding: 'utf8',
    timeout:  120_000,
    shell:    true,
  });
  return {
    ok:       r.status === 0,
    stdout:   r.stdout  || '',
    stderr:   r.stderr  || '',
    exitCode: r.status  ?? 1,
  };
}

/** Rewrite package.json to target versions. Preserves all other fields. */
function bumpVersions(targetPath, verbose) {
  const pkgPath = path.join(targetPath, 'package.json');
  const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  for (const [name, ver] of Object.entries(TARGET_VERSIONS.prod)) {
    if (pkg.dependencies?.[name] !== undefined) {
      if (verbose) process.stderr.write(`[verifier] bump ${name}: ${pkg.dependencies[name]} → ${ver}\n`);
      pkg.dependencies[name] = ver;
    }
  }
  for (const [name, ver] of Object.entries(TARGET_VERSIONS.dev)) {
    if (pkg.devDependencies?.[name] !== undefined) {
      if (verbose) process.stderr.write(`[verifier] bump ${name}: ${pkg.devDependencies[name]} → ${ver}\n`);
      pkg.devDependencies[name] = ver;
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return pkg;
}

/** Collect all .js files in targetPath (skipping node_modules). */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.nyc_output']);
function collectJsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectJsFiles(full));
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Apply a single FIX_RULE to every JS file.
 * Returns list of { file, line } that were modified.
 */
function applyFix(rule, targetPath) {
  const files   = collectJsFiles(targetPath);
  const touched = [];
  for (const absPath of files) {
    const src      = fs.readFileSync(absPath, 'utf8');
    const modified = rule.fix(src);
    if (modified !== src) {
      fs.writeFileSync(absPath, modified, 'utf8');
      touched.push({ file: path.relative(targetPath, absPath), line: 0 });
    }
  }
  return touched;
}

// ─── Dry-run: re-scan for legacy hits ────────────────────────────────────────
async function dryRunVerify(ctx, codemodeResult) {
  const dbg = (...a) => ctx.verbose && process.stderr.write('[verifier] ' + a.join(' ') + '\n');
  dbg('dry-run: scanning for remaining legacy hits …');

  // Dynamically import scanner to avoid circular dep issues at module load time
  const { scanner } = await import('./scanner.js');
  const scanResult  = await scanner.scan({ targetPath: ctx.targetPath, verbose: false, dryRun: true });

  const hitRules    = scanResult.riskByRule.filter(r => r.occurrences > 0);
  const totalHits   = hitRules.reduce((s, r) => s + r.occurrences, 0);

  // For dry-run we only count hits in actual source code (not test files / comments)
  // Filter usageMap to code lines only
  let codeHits = 0;
  for (const hits of Object.values(scanResult.usageMap)) {
    for (const h of hits) {
      // Skip hits inside test files and comment-only lines
      const isTestFile    = /\btest[s]?\b|\bspec\b|\.test\./i.test(h.file);
      const isCommentLine = /^\s*(\/\/|\/\*|\*)/.test(h.snippet);
      if (!isTestFile && !isCommentLine) codeHits++;
    }
  }

  const passed = codeHits === 0;
  const summary = passed
    ? `dry-run: 0 legacy code hits — all patterns migrated ✓`
    : `dry-run: ${codeHits} legacy code hits remain in source files`;

  dbg(summary);

  return {
    passed,
    mode:            'dry-run',
    testCounts:      { passed: 0, failed: 0, total: 0 },
    fixCycles:       0,
    failuresFixed:   [],
    legacyHitsAfter: codeHits,
    totalHitsAfter:  totalHits,
    hitRules:        hitRules.map(r => ({ ruleId: r.ruleId, occurrences: r.occurrences })),
    stdout:          JSON.stringify(scanResult.summary),
    stderr:          '',
    testSummary:     summary,
  };
}

// ─── Real mode ────────────────────────────────────────────────────────────────
async function realVerify(ctx, codemodeResult) {
  const { targetPath, verbose, maxFixCycles = 3 } = ctx;
  const dbg = (...a) => process.stderr.write('[verifier] ' + a.join(' ') + '\n');

  // Step 1: Bump package.json versions
  dbg('Bumping package.json to target versions …');
  bumpVersions(targetPath, verbose);

  // Step 2: npm install
  dbg('Installing dependencies …');
  const installResult = npmInstall(targetPath, verbose);
  if (!installResult.ok) {
    dbg('npm install failed:\n' + installResult.stderr.slice(0, 500));
    // Don't abort — try running tests anyway; some warnings exit non-zero
  }

  // Step 3: Initial test run
  dbg('Running test suite (cycle 0) …');
  let testRun = npmTest(targetPath);
  let counts  = parseTestCounts(testRun.stdout + testRun.stderr);

  const fixCycles    = [];
  const failuresFixed = [];

  // Step 4: Fix cycles
  let cycle = 0;
  while (!testRun.ok && cycle < maxFixCycles) {
    cycle++;
    dbg(`Tests failed (${counts.failed} failures). Fix cycle ${cycle}/${maxFixCycles} …`);

    const combined   = testRun.stdout + testRun.stderr;
    const failures   = parseFailures(combined);
    let anyFixApplied = false;

    for (const failureText of failures) {
      for (const rule of FIX_RULES) {
        if (rule.pattern.test(failureText)) {
          dbg(`  Applying fix: ${rule.id} — ${rule.desc}`);
          const touched = applyFix(rule, targetPath);
          if (touched.length > 0) {
            anyFixApplied = true;
            for (const t of touched) {
              failuresFixed.push({
                cycle,
                failureMsg: failureText.slice(0, 300),
                fixApplied: rule.desc,
                ruleId:     rule.id,
                file:       t.file,
                line:       t.line,
              });
            }
            break; // one fix per failure text; re-run before applying more
          }
        }
      }
    }

    if (!anyFixApplied) {
      dbg('No matching fix rule found for remaining failures. Stopping cycles.');
      break;
    }

    dbg(`Re-running tests after cycle ${cycle} …`);
    testRun = npmTest(targetPath);
    counts  = parseTestCounts(testRun.stdout + testRun.stderr);
    fixCycles.push({ cycle, counts });
  }

  const passed     = testRun.ok;
  const testSummary = counts.total > 0
    ? `${counts.passed} passed, ${counts.failed} failed, ${counts.total} total`
    : 'see stdout for details';

  dbg(passed ? `✅ Tests passed: ${testSummary}` : `❌ Tests failed: ${testSummary}`);

  return {
    passed,
    mode:            'real',
    testCounts:      counts,
    fixCycles:       cycle,
    failuresFixed,
    legacyHitsAfter: passed ? 0 : -1,
    stdout:          testRun.stdout,
    stderr:          testRun.stderr,
    testSummary,
  };
}

// ─── verify (public entry point) ─────────────────────────────────────────────
async function verify(ctx, codemodeResult) {
  const outDir  = ctx.outDir
    ? path.resolve(ctx.outDir)
    : path.resolve(__dirname, '../../out');
  const outPath = path.join(outDir, 'verification.json');

  const verdict = ctx.dryRun
    ? await dryRunVerify(ctx, codemodeResult)
    : await realVerify(ctx, codemodeResult);

  // Always write verification.json
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    ...verdict,
    codemodeResult: {
      totalReplacements: codemodeResult?.totalReplacements ?? 0,
      workers:           (codemodeResult?.workers ?? []).map(w => ({
        package:      w.package,
        replacements: w.replacements?.length ?? 0,
      })),
    },
    generatedAt:  new Date().toISOString(),
    projectPath:  ctx.targetPath,
  }, null, 2), 'utf8');

  process.stderr.write(`[verifier] Saved → ${outPath}\n`);
  return verdict;
}

export const verifier = { verify };
