/**
 * codemoder.js — Codemod Application Agent
 *
 * Interface:
 *   codemoder.apply(ctx, plan) → Promise<CodemodeResult>
 *
 * CodemodeResult: {
 *   appliedCodemods: AppliedCM[],
 *   filesModified: string[],
 *   skipped: string[],             // files skipped due to parse errors
 *   dryRun: boolean,
 *   summary: string,
 * }
 *
 * AppliedCM: {
 *   package: string,
 *   file: string,
 *   rule: string,                  // human-readable rule name
 *   before: string,                // code snippet before
 *   after: string,                 // code snippet after
 * }
 *
 * ctx:  { targetPath, dryRun, verbose }
 * plan: UpgradePlan from planner.buildPlan()
 *
 * Design notes:
 * - This agent uses regex-based transforms (not a full AST) to keep the
 *   hackathon demo dependency-free. A production version should use
 *   jscodeshift or ts-morph for safe AST-level rewrites.
 * - Each transform is a { name, pattern, replacement, flag } descriptor.
 * - When ctx.dryRun is true, files are NOT written; only the diff is logged.
 */

import fs   from 'fs';
import path from 'path';

// ─── Transform rules per package ─────────────────────────────────────────────
const TRANSFORM_RULES = {
  express: [
    {
      name:        'app.del → app.delete',
      pattern:     /\bapp\.del\s*\(/g,
      replacement: 'app.delete(',
    },
    {
      name:        'res.send(number) → res.sendStatus(number)',
      pattern:     /\bres\.send\s*\(\s*(\d{3})\s*\)/g,
      replacement: 'res.sendStatus($1)',
    },
    {
      name:        'req.param( → req.params.  [manual review needed]',
      pattern:     /\breq\.param\s*\(\s*['"](\w+)['"]\s*\)/g,
      replacement: 'req.params.$1 /* TODO: verify source (params|query|body) */',
    },
    {
      name:        'app.get("*") wildcard → app.get("/{*splat}")',
      pattern:     /\bapp\.(get|use|post|put|delete)\s*\(\s*['"]\*['"]/g,
      replacement: 'app.$1("/{*splat}"',
    },
  ],
  mongoose: [
    {
      name:        'Model.update( → Model.updateOne(',
      pattern:     /\b(\w+)\.update\s*\(/g,
      replacement: '$1.updateOne(',
    },
    {
      name:        'Model.count( → Model.countDocuments(',
      pattern:     /\b(\w+)\.count\s*\(/g,
      replacement: '$1.countDocuments(',
    },
  ],
};

function findJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(full));
    } else if (entry.isFile() && /\.(js|mjs|cjs|ts)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

async function apply(ctx, plan) {
  const appliedCodemods = [];
  const filesModified   = new Set();
  const skipped         = [];

  for (const step of plan.steps) {
    const rules = TRANSFORM_RULES[step.package];
    if (!rules) continue;

    const files = findJsFiles(ctx.targetPath);
    for (const file of files) {
      let src;
      try {
        src = fs.readFileSync(file, 'utf8');
      } catch {
        skipped.push(file);
        continue;
      }

      let modified = src;
      for (const rule of rules) {
        const before = modified;
        modified = modified.replace(rule.pattern, rule.replacement);
        if (modified !== before) {
          appliedCodemods.push({
            package: step.package,
            file:    path.relative(ctx.targetPath, file),
            rule:    rule.name,
            before:  before.slice(0, 200),
            after:   modified.slice(0, 200),
          });
        }
      }

      if (modified !== src) {
        filesModified.add(file);
        if (!ctx.dryRun) {
          fs.writeFileSync(file, modified, 'utf8');
        }
      }
    }
  }

  const count = filesModified.size;
  return {
    appliedCodemods,
    filesModified: [...filesModified].map(f => path.relative(ctx.targetPath, f)),
    skipped,
    dryRun:   ctx.dryRun,
    summary:  ctx.dryRun
      ? `[dry-run] Would modify ${count} file(s) with ${appliedCodemods.length} codemod(s).`
      : `Modified ${count} file(s) with ${appliedCodemods.length} codemod(s).`,
  };
}

export const codemoder = { apply };
