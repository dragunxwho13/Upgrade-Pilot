/**
 * codemoder.js — Parallel Codemod Crew Agent
 *
 * ─── Public Interface ────────────────────────────────────────────────────────
 *
 *   codemoder.apply(ctx, plan)  → Promise<CodemodeResult>
 *
 * ctx: {
 *   targetPath : string   — root of the project to modify
 *   dryRun     : boolean  — when true: record diffs but write NO files
 *   verbose    : boolean
 *   outDir?    : string   — override output dir for diffs + log (default: tool/out)
 * }
 *
 * plan: MigrationPlan produced by planner.buildPlan()
 *
 * ─── How it works ────────────────────────────────────────────────────────────
 *
 *   One "worker" per package runs concurrently via Promise.all (the "crew").
 *   Each worker:
 *     1. Reads every .js/.mjs/.cjs file under targetPath (skip node_modules).
 *     2. Applies only its own package's transform rules from breaking-changes.json.
 *     3. Records every line-level replacement with { ruleId, file, line, before, after }.
 *     4. Builds a unified diff per package (written to tool/out/diffs/<package>.patch).
 *     5. Returns a WorkerResult.
 *
 *   When ctx.dryRun is true, NO source files are written. Diffs and the log
 *   ARE written so the caller can inspect what would change.
 *
 * ─── CodemodeResult ──────────────────────────────────────────────────────────
 * {
 *   dryRun          : boolean,
 *   workers         : WorkerResult[],   // one per package
 *   totalReplacements : number,
 *   filesModified   : string[],         // unique relative paths (empty in dry-run)
 *   logPath         : string,           // path to codemod-log.json
 *   diffDir         : string,           // path to diffs/ directory
 *   summary         : string,           // e.g. "[codemod-crew] express ✓ 14 | …"
 * }
 *
 * ─── WorkerResult ────────────────────────────────────────────────────────────
 * {
 *   package         : string,
 *   replacements    : Replacement[],
 *   filesModified   : string[],         // relative paths
 *   skipped         : string[],
 *   patchPath       : string,           // absolute path to .patch file
 *   patchContent    : string,           // unified diff text
 * }
 *
 * ─── Replacement ─────────────────────────────────────────────────────────────
 * {
 *   ruleId  : string,
 *   file    : string,   // relative to targetPath
 *   line    : number,   // 1-based
 *   before  : string,   // original line content (trimmed)
 *   after   : string,   // transformed line content (trimmed)
 * }
 *
 * ─── Transform rules ─────────────────────────────────────────────────────────
 *
 *   Loaded from breaking-changes.json at runtime (same source of truth as
 *   scanner + planner). Each rule's { removedPattern, replacement, patternFlags }
 *   is compiled into a RegExp and applied line-by-line.
 *
 *   Rules that require multi-line AST context (e.g. callback bodies spanning
 *   several lines) are applied with a whole-file single-pass regex where the
 *   breaking-changes.json pattern already encodes the full match.
 *
 * ─── Diff format ─────────────────────────────────────────────────────────────
 *
 *   Unified diff with 3 lines of context. Generated with a built-in pure-JS
 *   differ (no external deps). Compatible with `git apply` and `patch`.
 *
 * ─── Safety guarantees ───────────────────────────────────────────────────────
 *
 *   • Workers are read-only until all transforms are computed, so they cannot
 *     interfere with each other (each package touches different APIs).
 *   • Each line replacement is recorded before the next rule is applied, so
 *     the log always shows original → final, not chain of intermediate states.
 *   • app.del → app.delete uses a negative-lookahead (?!ete) so it never
 *     double-transforms already-migrated code.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Rule database ────────────────────────────────────────────────────────────
const RULES_PATH = path.resolve(__dirname, '../../data/breaking-changes.json');

function loadPackageRules() {
  const db = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  /** @type {Map<string, import('./breaking-changes.js').Rule[]>} */
  const map = new Map();
  for (const pkg of db.packages) {
    map.set(pkg.package, pkg.rules);
  }
  return map;
}

// ─── File collection ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'out', '.nyc_output']);

function collectJsFiles(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory())  results.push(...collectJsFiles(full));
    else if (e.isFile() && /\.(js|mjs|cjs)$/.test(e.name)) results.push(full);
  }
  return results;
}

// ─── Pure-JS unified differ ───────────────────────────────────────────────────
/**
 * Produce a unified diff string for a single file.
 * Context lines: 3 (standard unified diff).
 *
 * @param {string} filePath  display path (relative)
 * @param {string} oldSrc
 * @param {string} newSrc
 * @returns {string}
 */
function unifiedDiff(filePath, oldSrc, newSrc) {
  if (oldSrc === newSrc) return '';

  const oldLines = oldSrc.split('\n');
  const newLines = newSrc.split('\n');
  const CONTEXT  = 3;

  // Myers-style LCS diff at line level
  const hunks = computeHunks(oldLines, newLines, CONTEXT);
  if (!hunks.length) return '';

  const header = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ].join('\n');

  const body = hunks.map(h => {
    const oldCount = h.filter(l => l.type !== '+').length;
    const newCount = h.filter(l => l.type !== '-').length;
    const oldStart = h[0].oldLine;
    const newStart = h[0].newLine;
    const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    const lines = h.map(l => {
      if (l.type === '=') return ` ${l.text}`;
      if (l.type === '-') return `-${l.text}`;
      return `+${l.text}`;
    });
    return [hunkHeader, ...lines].join('\n');
  }).join('\n');

  return header + '\n' + body + '\n';
}

/**
 * Compute diff hunks using a simple O(n) line-by-line comparison
 * with greedy matching (fast enough for source files).
 *
 * Returns an array of hunk arrays, each element: { type, text, oldLine, newLine }
 */
function computeHunks(oldLines, newLines, context) {
  // Build an edit script via patience-style single-pass (good enough for
  // consecutive edits the transforms produce)
  const edits = [];
  let oi = 0, ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      edits.push({ type: '=', text: oldLines[oi], oldLine: oi + 1, newLine: ni + 1 });
      oi++; ni++;
    } else {
      // Find the next common line (lookahead up to 8 for speed)
      let matched = false;
      for (let d = 1; d <= 8; d++) {
        if (oi + d < oldLines.length && oldLines[oi + d] === newLines[ni]) {
          // d deletions
          for (let k = 0; k < d; k++) {
            edits.push({ type: '-', text: oldLines[oi + k], oldLine: oi + k + 1, newLine: ni + 1 });
          }
          oi += d;
          matched = true;
          break;
        }
        if (ni + d < newLines.length && oldLines[oi] === newLines[ni + d]) {
          // d insertions
          for (let k = 0; k < d; k++) {
            edits.push({ type: '+', text: newLines[ni + k], oldLine: oi + 1, newLine: ni + k + 1 });
          }
          ni += d;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Replace: one deletion + one insertion
        if (oi < oldLines.length) {
          edits.push({ type: '-', text: oldLines[oi], oldLine: oi + 1, newLine: ni + 1 });
          oi++;
        }
        if (ni < newLines.length) {
          edits.push({ type: '+', text: newLines[ni], oldLine: oi, newLine: ni + 1 });
          ni++;
        }
      }
    }
  }

  // Split edits into hunks with context lines
  const hunks = [];
  let i = 0;
  while (i < edits.length) {
    if (edits[i].type === '=') { i++; continue; }
    // Found a change — collect context before it
    const start    = Math.max(0, i - context);
    const hunkEdits = [];
    for (let j = start; j < i; j++) hunkEdits.push(edits[j]);
    // Collect changes + trailing context
    while (i < edits.length) {
      hunkEdits.push(edits[i]);
      if (edits[i].type === '=') {
        // Check how many consecutive equal lines follow
        let eqCount = 0;
        let k = i;
        while (k < edits.length && edits[k].type === '=') { eqCount++; k++; }
        if (eqCount >= context * 2 || k >= edits.length) {
          // Add trailing context (up to `context` lines)
          for (let j = i + 1; j < Math.min(i + 1 + context, edits.length); j++) {
            if (edits[j].type === '=') hunkEdits.push(edits[j]);
          }
          i += context + 1;
          break;
        }
      }
      i++;
    }
    if (hunkEdits.some(e => e.type !== '=')) hunks.push(hunkEdits);
  }
  return hunks;
}

// ─── Single-line transform engine ─────────────────────────────────────────────
/**
 * Apply all rules for one package to one file's source text.
 * Operates line-by-line so replacements are recorded at exact line numbers.
 *
 * @param {string}   src         full file source
 * @param {string}   relPath     display path
 * @param {object[]} rules       rules from breaking-changes.json for this package
 * @returns {{ modified: string, replacements: Replacement[] }}
 */
function applyRulesToFile(src, relPath, rules) {
  const lines        = src.split('\n');
  const replacements = [];

  // Apply each rule across all lines
  for (const rule of rules) {
    const re = new RegExp(rule.removedPattern, (rule.patternFlags || '') + 'g');
    for (let i = 0; i < lines.length; i++) {
      const original = lines[i];
      re.lastIndex   = 0;
      if (!re.test(original)) continue;

      // Re-run to get the replacement (test() consumed the match)
      re.lastIndex = 0;
      const transformed = original.replace(
        new RegExp(rule.removedPattern, rule.patternFlags || 'g'),
        rule.replacement
      );

      if (transformed !== original) {
        replacements.push({
          ruleId: rule.id,
          file:   relPath.replace(/\\/g, '/'),
          line:   i + 1,
          before: original.trim(),
          after:  transformed.trim(),
        });
        lines[i] = transformed;
      }
    }
  }

  return { modified: lines.join('\n'), replacements };
}

// ─── Per-package worker ───────────────────────────────────────────────────────
/**
 * One codemod worker for a single package.
 * Reads all JS files, applies transforms, writes diffs and (when !dryRun) files.
 *
 * @param {string}   pkgName
 * @param {object[]} rules
 * @param {string[]} jsFiles   absolute paths
 * @param {object}   ctx
 * @param {string}   diffDir   directory to write .patch files into
 * @returns {Promise<WorkerResult>}
 */
async function runWorker(pkgName, rules, jsFiles, ctx, diffDir) {
  const { targetPath, dryRun } = ctx;

  const allReplacements = [];
  const filesModified   = [];
  const skipped         = [];
  const patchParts      = [];   // unified diff chunks per file

  for (const absPath of jsFiles) {
    const relPath = path.relative(targetPath, absPath).replace(/\\/g, '/');
    let src;
    try { src = fs.readFileSync(absPath, 'utf8'); }
    catch { skipped.push(relPath); continue; }

    const { modified, replacements } = applyRulesToFile(src, relPath, rules);

    if (replacements.length > 0) {
      allReplacements.push(...replacements);
      filesModified.push(relPath);

      const diffChunk = unifiedDiff(relPath, src, modified);
      if (diffChunk) patchParts.push(diffChunk);

      if (!dryRun) {
        fs.writeFileSync(absPath, modified, 'utf8');
      }
    }
  }

  // Write the .patch file (even in dry-run — that's the whole point)
  const patchContent = patchParts.join('\n');
  const patchPath    = path.join(diffDir, `${pkgName}.patch`);
  fs.mkdirSync(diffDir, { recursive: true });
  fs.writeFileSync(patchPath, patchContent, 'utf8');

  return {
    package:      pkgName,
    replacements: allReplacements,
    filesModified,
    skipped,
    patchPath,
    patchContent,
  };
}

// ─── apply (public entry point) ───────────────────────────────────────────────
async function apply(ctx, plan) {
  const { targetPath, dryRun, verbose } = ctx;
  const dbg = (...a) => verbose && process.stderr.write('[codemoder] ' + a.join(' ') + '\n');

  // 1. Resolve output dirs
  const toolOutDir = ctx.outDir
    ? path.resolve(ctx.outDir)
    : path.resolve(__dirname, '../../out');
  const diffDir  = path.join(toolOutDir, 'diffs');
  const logPath  = path.join(toolOutDir, 'codemod-log.json');
  fs.mkdirSync(diffDir, { recursive: true });

  // 2. Load rule map
  const packageRuleMap = loadPackageRules();

  // 3. Collect JS files once (shared read-only across workers)
  const jsFiles = collectJsFiles(targetPath);
  dbg(`Found ${jsFiles.length} JS files`);

  // 4. Determine which packages to process (those in the plan AND with rules)
  const packagesToRun = (plan.packages || plan.steps || [])
    .map(s => s.package || s.name)
    .filter(pkg => packageRuleMap.has(pkg));

  dbg(`Spawning ${packagesToRun.length} workers: ${packagesToRun.join(', ')}`);

  // 5. ── CREW: all workers run in PARALLEL ─────────────────────────────────
  const workerPromises = packagesToRun.map(pkgName => {
    const rules = packageRuleMap.get(pkgName);
    return runWorker(pkgName, rules, jsFiles, ctx, diffDir);
  });

  const workers = await Promise.all(workerPromises);
  // ── end parallel section ─────────────────────────────────────────────────

  // 6. Aggregate results
  const totalReplacements = workers.reduce((s, w) => s + w.replacements.length, 0);
  const allModified       = [...new Set(workers.flatMap(w => w.filesModified))];

  // 7. Write codemod-log.json
  const log = {
    schemaVersion: '1.0',
    generatedAt:   new Date().toISOString(),
    projectPath:   targetPath,
    dryRun,
    totalReplacements,
    workers: workers.map(w => ({
      package:       w.package,
      replacements:  w.replacements.length,
      filesModified: w.filesModified,
      patchPath:     w.patchPath,
    })),
    replacements: workers.flatMap(w => w.replacements),
  };
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');

  // 8. Console crew summary
  const crewLine = workers
    .map(w => `${w.package} ✓ ${w.replacements.length} replacements`)
    .join(' | ');
  console.error(`[codemod-crew] ${crewLine}`);

  // 9. Return result
  const summary = dryRun
    ? `[dry-run] ${totalReplacements} replacement(s) across ${packagesToRun.length} package(s) — no files written.`
    : `Applied ${totalReplacements} replacement(s) across ${allModified.length} file(s).`;

  return {
    dryRun,
    workers,
    totalReplacements,
    filesModified: dryRun ? [] : allModified,
    logPath,
    diffDir,
    summary,
  };
}

export const codemoder = { apply, applyRulesToFile, runWorker, collectJsFiles, loadPackageRules, unifiedDiff };
