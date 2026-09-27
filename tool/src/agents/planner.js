/**
 * planner.js — Risk-Scored Migration Planner Agent
 *
 * ─── Public Interface ────────────────────────────────────────────────────────
 *
 *   planner.buildPlan(ctx, scanResult, noteMap)  → Promise<MigrationPlan>
 *   planner.renderMarkdown(plan)                  → string
 *
 * ctx: {
 *   targetPath : string   — root of the project being upgraded
 *   dryRun     : boolean
 *   verbose    : boolean
 * }
 *
 * scanResult : ScanResult produced by scanner.scan()
 * noteMap    : NoteMap produced by librarian.fetchNotes()
 *
 * ─── MigrationPlan ───────────────────────────────────────────────────────────
 * {
 *   schemaVersion      : "1.0",
 *   projectPath        : string,
 *   createdAt          : string,       // ISO-8601
 *   totalRiskScore     : number,       // weighted aggregate 0–100
 *   totalManualMinutes : number,
 *   totalPilotMinutes  : number,
 *   estimatedSaving    : number,       // totalManual – totalPilot
 *   packages           : PackageStep[],
 *   summary            : string,
 * }
 *
 * ─── PackageStep ─────────────────────────────────────────────────────────────
 * {
 *   order                : number,   // 1-based upgrade sequence
 *   package              : string,
 *   from                 : string,   // e.g. "4.18.2"
 *   to                   : string,   // e.g. "^5.0.0"
 *   type                 : 'prod' | 'dev' | 'peer',
 *   risk                 : 'low' | 'medium' | 'high',
 *   riskScore            : number,   // 0–100
 *   affectedFileCount    : number,
 *   affectedFiles        : string[], // unique relative paths that had hits
 *   steps                : RuleStep[],
 *   rollbackNote         : string,
 *   estimatedManualMinutes : number,
 *   estimatedPilotMinutes  : number,
 *   references           : string[],
 * }
 *
 * ─── RuleStep ────────────────────────────────────────────────────────────────
 * {
 *   ruleId          : string,
 *   description     : string,
 *   occurrences     : number,
 *   affectedFiles   : string[],
 *   severity        : number,       // 1 | 2 | 3
 *   category        : string,
 *   action          : string,       // imperative migration instruction
 *   replacement     : string,       // from breaking-changes.json
 *   proximity       : 'tested' | 'untested' | 'mixed',  // proximity to test code
 *   riskContribution: number,       // this rule's share of package riskScore
 *   manualMinutes   : number,       // per-rule manual effort estimate
 *   pilotMinutes    : number,       // per-rule UpgradePilot estimate
 *   docs            : string,
 * }
 *
 * ─── Risk Formula ────────────────────────────────────────────────────────────
 *
 *   perRuleRisk  = clamp(occurrences × severity × proximityWeight, 0, 30)
 *   packageRisk  = clamp(Σ perRuleRisk + baseComplexity, 0, 100)
 *   where:
 *     proximityWeight = 1.5 if 'tested', 1.0 if 'mixed', 0.7 if 'untested'
 *     baseComplexity  = 10 × (number of rules with occurrences > 0)
 *
 *   Risk label:  < 35 → low  |  35–64 → medium  |  ≥ 65 → high
 *
 * ─── Effort Estimate Formula ─────────────────────────────────────────────────
 *
 *   manualMinutes per rule = occurrences × severity × 8   (minutes per hit)
 *   pilotMinutes  per rule = occurrences × severity × 1.5 (minutes per hit)
 *
 * ─── Upgrade Order (safe dependency ordering) ────────────────────────────────
 *
 *   dev-only packages are upgraded first (lower risk, won't break prod)
 *   prod packages are ordered by ascending risk score
 *   ties are broken alphabetically
 *
 * ─── LLM Delegation Note ─────────────────────────────────────────────────────
 *
 *   The reasoning in synthesisePlan() is designed to be replaceable by an
 *   LLM call (e.g., IBM watsonx.ai Granite) without changing the exported
 *   interface. See docs/ARCHITECTURE.md for the full delegation design.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire }  from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require  = createRequire(import.meta.url);

// ─── Target version catalogue ─────────────────────────────────────────────────
// Specifies the upgrade target for each known package.
const TARGET_VERSIONS = {
  express:  '^5.0.0',
  mongoose: '^7.0.0',
  jest:     '^29.0.0',
};

// Per-package rollback notes
const ROLLBACK_NOTES = {
  express:  'Pin express back to "4.18.2" in package.json and run `npm install`. Revert any codemod changes via git.',
  mongoose: 'Pin mongoose back to "6.12.3" in package.json and run `npm install`. Restore callback-style queries if async refactor was partial.',
  jest:     'Pin jest back to "27.5.1" in package.json. Restore testRunner config if changed.',
};

// Manual effort constants (minutes per hit × severity)
const MANUAL_MINS_PER_HIT   = 8;    // minutes a human spends on each occurrence
const PILOT_MINS_PER_HIT    = 1.5;  // minutes with UpgradePilot automation

// Proximity weight multipliers
const PROXIMITY_WEIGHT = { tested: 1.5, mixed: 1.0, untested: 0.7 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function riskLabel(score) {
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

/**
 * Determine whether a set of hit files are in test code, prod code, or both.
 * @param {string[]} files — relative file paths
 * @returns {'tested'|'mixed'|'untested'}
 */
function measureProximity(files) {
  const isTest = f => /\btest[s]?\b|\bspec\b|\.test\.|\.spec\./i.test(f);
  const hasTest = files.some(isTest);
  const hasProd = files.some(f => !isTest(f));
  if (hasTest && hasProd) return 'mixed';
  if (hasTest)            return 'tested';
  return 'untested';
}

/**
 * Load breaking-changes.json and index rules by ruleId for O(1) lookup.
 * @returns {Map<string, object>}  ruleId → full rule object (with pkg context)
 */
function loadRuleIndex() {
  const rulesPath = path.resolve(__dirname, '../../data/breaking-changes.json');
  const db        = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const index     = new Map();
  for (const pkg of db.packages) {
    for (const rule of pkg.rules) {
      index.set(rule.id, { ...rule, packageName: pkg.package, toVersion: pkg.toVersion });
    }
  }
  return index;
}

/**
 * Build a human-readable action string from a rule.
 */
function actionFor(rule) {
  // The rule description is already imperative; convert to a clear action line.
  return `Fix: ${rule.description}  →  replacement: \`${rule.replacement}\``;
}

// ─── Core plan synthesis ──────────────────────────────────────────────────────
/**
 * synthesisePlan()
 *
 * This is the reasoning core. It currently runs deterministically; it is
 * designed so that it could be replaced by a structured LLM prompt that
 * receives the same inputs and returns the same output shape.
 * See docs/ARCHITECTURE.md §3 for the delegation contract.
 *
 * @param {object} scanResult
 * @param {object} noteMap
 * @param {Map}    ruleIndex
 * @returns {PackageStep[]}  un-ordered; caller sorts
 */
function synthesisePlan(scanResult, noteMap, ruleIndex) {
  const usageMap    = scanResult.usageMap || {};
  const riskByRule  = scanResult.riskByRule || [];

  // Group riskByRule entries by package
  const byPackage = new Map();
  for (const entry of riskByRule) {
    if (!byPackage.has(entry.package)) byPackage.set(entry.package, []);
    byPackage.get(entry.package).push(entry);
  }

  const packageSteps = [];

  for (const dep of scanResult.breaking) {
    const pkgName   = dep.name;
    const ruleGroup = byPackage.get(pkgName) || [];
    const note      = noteMap[pkgName]       || {};

    // ── Build per-rule steps ─────────────────────────────────────────────────
    const ruleSteps = [];

    for (const riskEntry of ruleGroup) {
      const { ruleId, occurrences, severity, category } = riskEntry;
      const rule = ruleIndex.get(ruleId);

      const hits         = usageMap[ruleId] || [];
      const affectedFiles = [...new Set(hits.map(h => h.file))];
      const proximity     = measureProximity(affectedFiles);
      const proxWeight    = PROXIMITY_WEIGHT[proximity];

      // Per-rule risk contribution (capped at 30 so no single rule dominates)
      const riskContribution = clamp(
        Math.round(occurrences * severity * proxWeight),
        0,
        30
      );

      const manualMinutes = Math.round(occurrences * severity * MANUAL_MINS_PER_HIT);
      const pilotMinutes  = Math.round(occurrences * severity * PILOT_MINS_PER_HIT);

      ruleSteps.push({
        ruleId,
        description:     riskEntry.description,
        occurrences,
        affectedFiles,
        severity,
        category,
        action:          rule ? actionFor(rule) : riskEntry.description,
        replacement:     rule?.replacement ?? '',
        proximity,
        riskContribution,
        manualMinutes,
        pilotMinutes,
        docs:            rule?.docs ?? '',
      });
    }

    // ── Package-level metrics ────────────────────────────────────────────────
    const activeRuleCount = ruleSteps.filter(r => r.occurrences > 0).length;
    const baseComplexity  = 10 * activeRuleCount;
    const rawRisk         = ruleSteps.reduce((s, r) => s + r.riskContribution, 0) + baseComplexity;
    const pkgRiskScore    = clamp(rawRisk, 0, 100);

    // All files touched by any rule in this package
    const allAffectedFiles = [
      ...new Set(ruleSteps.flatMap(r => r.affectedFiles)),
    ];

    const totalManual = ruleSteps.reduce((s, r) => s + r.manualMinutes, 0);
    const totalPilot  = ruleSteps.reduce((s, r) => s + r.pilotMinutes,  0);

    const depInfo = scanResult.dependencies.find(d => d.name === pkgName) || {};

    packageSteps.push({
      package:    pkgName,
      from:       dep.current,
      to:         TARGET_VERSIONS[pkgName] ?? `^${dep.current}`,
      type:       depInfo.type ?? 'prod',
      risk:       riskLabel(pkgRiskScore),
      riskScore:  pkgRiskScore,
      affectedFileCount:    allAffectedFiles.length,
      affectedFiles:        allAffectedFiles,
      steps:                ruleSteps,
      rollbackNote:         ROLLBACK_NOTES[pkgName] ?? `Pin ${pkgName} back to ${dep.current} in package.json.`,
      estimatedManualMinutes: totalManual,
      estimatedPilotMinutes:  totalPilot,
      references:           note.references ?? [],
    });
  }

  return packageSteps;
}

/**
 * Sort packageSteps into the safe upgrade order:
 *   1. dev dependencies first (lower blast radius)
 *   2. within each tier, ascending riskScore
 *   3. ties broken alphabetically
 */
function sortPackageSteps(steps) {
  return [...steps].sort((a, b) => {
    const tierA = a.type === 'prod' ? 1 : 0;
    const tierB = b.type === 'prod' ? 1 : 0;
    if (tierA !== tierB)              return tierA - tierB;
    if (a.riskScore !== b.riskScore)  return a.riskScore - b.riskScore;
    return a.package.localeCompare(b.package);
  });
}

// ─── buildPlan (exported entry point) ────────────────────────────────────────
async function buildPlan(ctx, scanResult, noteMap) {
  const dbg = (...a) => ctx.verbose && process.stderr.write('[planner] ' + a.join(' ') + '\n');

  dbg('Loading rule index …');
  const ruleIndex = loadRuleIndex();

  dbg('Synthesising plan …');
  const rawSteps     = synthesisePlan(scanResult, noteMap, ruleIndex);
  const sortedSteps  = sortPackageSteps(rawSteps);
  sortedSteps.forEach((s, i) => { s.order = i + 1; });

  const totalManual = sortedSteps.reduce((s, p) => s + p.estimatedManualMinutes, 0);
  const totalPilot  = sortedSteps.reduce((s, p) => s + p.estimatedPilotMinutes,  0);

  // Weighted aggregate risk: average over packages, weighted by occurrences
  const totalOccurrences = sortedSteps.reduce(
    (s, p) => s + p.steps.reduce((ss, r) => ss + r.occurrences, 0), 0
  );
  const weightedRisk = totalOccurrences > 0
    ? sortedSteps.reduce((s, p) => {
        const pkgOcc = p.steps.reduce((ss, r) => ss + r.occurrences, 0);
        return s + p.riskScore * (pkgOcc / totalOccurrences);
      }, 0)
    : 0;
  const totalRiskScore = Math.round(clamp(weightedRisk, 0, 100));

  const summary = sortedSteps.length
    ? `${sortedSteps.length} package upgrade(s) planned in safe order. ` +
      `Manual effort: ${totalManual} min → UpgradePilot: ${totalPilot} min ` +
      `(save ${totalManual - totalPilot} min). Aggregate risk: ${riskLabel(totalRiskScore)}.`
    : 'No breaking upgrades detected.';

  const plan = {
    schemaVersion:       '1.0',
    projectPath:         scanResult.projectPath,
    createdAt:           new Date().toISOString(),
    totalRiskScore,
    totalManualMinutes:  totalManual,
    totalPilotMinutes:   totalPilot,
    estimatedSaving:     totalManual - totalPilot,
    packages:            sortedSteps,
    summary,
  };

  dbg('Plan built:', summary);
  return plan;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(plan) {
  const lines = [];

  lines.push('# UpgradePilot Migration Plan');
  lines.push('');
  lines.push(`**Project:** \`${plan.projectPath}\`  `);
  lines.push(`**Generated:** ${plan.createdAt}  `);
  lines.push(`**Aggregate Risk:** ${riskLabel(plan.totalRiskScore)} (${plan.totalRiskScore}/100)  `);
  lines.push('');

  // ── Summary table ─────────────────────────────────────────────────────────
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Package | From | To | Type | Risk | Affected Files | Manual (min) | Pilot (min) |');
  lines.push('|---|---------|------|----|------|------|----------------|-------------|-------------|');
  for (const pkg of plan.packages) {
    const riskEmoji = pkg.risk === 'high' ? '🔴' : pkg.risk === 'medium' ? '🟡' : '🟢';
    lines.push(
      `| ${pkg.order} ` +
      `| \`${pkg.package}\` ` +
      `| \`${pkg.from}\` ` +
      `| \`${pkg.to}\` ` +
      `| ${pkg.type} ` +
      `| ${riskEmoji} ${pkg.risk} ` +
      `| ${pkg.affectedFileCount} ` +
      `| ${pkg.estimatedManualMinutes} ` +
      `| ${pkg.estimatedPilotMinutes} |`
    );
  }
  lines.push('');

  // ── Time savings callout ──────────────────────────────────────────────────
  lines.push('## Estimated Time Savings');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Manual migration | **${plan.totalManualMinutes} min** (≈ ${Math.ceil(plan.totalManualMinutes / 60)} h) |`);
  lines.push(`| With UpgradePilot | **${plan.totalPilotMinutes} min** (≈ ${Math.ceil(plan.totalPilotMinutes / 60)} h) |`);
  lines.push(`| **Time saved** | **${plan.estimatedSaving} min (${Math.round((plan.estimatedSaving / plan.totalManualMinutes) * 100)}%)** |`);
  lines.push('');

  // ── Per-package detail sections ───────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Per-Package Migration Steps');
  lines.push('');

  for (const pkg of plan.packages) {
    const riskEmoji = pkg.risk === 'high' ? '🔴' : pkg.risk === 'medium' ? '🟡' : '🟢';
    lines.push(`### Step ${pkg.order} — \`${pkg.package}\` ${riskEmoji}`);
    lines.push('');
    lines.push(`**Upgrade:** \`${pkg.from}\` → \`${pkg.to}\`  `);
    lines.push(`**Risk:** ${pkg.risk} (score ${pkg.riskScore}/100)  `);
    lines.push(`**Affected files:** ${pkg.affectedFileCount}  `);
    lines.push(`**Manual effort:** ${pkg.estimatedManualMinutes} min  `);
    lines.push(`**With UpgradePilot:** ${pkg.estimatedPilotMinutes} min  `);
    lines.push('');

    if (pkg.affectedFiles.length) {
      lines.push('**Files to update:**');
      lines.push('');
      pkg.affectedFiles.forEach(f => lines.push(`- \`${f}\``));
      lines.push('');
    }

    lines.push('**Rule-level changes:**');
    lines.push('');
    lines.push('| Rule | Occurrences | Severity | Proximity | Risk | Manual (min) | Pilot (min) |');
    lines.push('|------|-------------|----------|-----------|------|-------------|-------------|');
    for (const step of pkg.steps) {
      if (step.occurrences === 0) continue;
      lines.push(
        `| [\`${step.ruleId}\`](${step.docs || '#'}) ` +
        `| ${step.occurrences} ` +
        `| ${step.severity} ` +
        `| ${step.proximity} ` +
        `| ${step.riskContribution} ` +
        `| ${step.manualMinutes} ` +
        `| ${step.pilotMinutes} |`
      );
    }
    lines.push('');

    lines.push('**Actions:**');
    lines.push('');
    let actionIdx = 0;
    for (const step of pkg.steps) {
      if (step.occurrences === 0) continue;
      actionIdx++;
      lines.push(`${actionIdx}. ${step.action}`);
    }
    lines.push('');

    if (pkg.references.length) {
      lines.push('**References:**');
      lines.push('');
      pkg.references.forEach(r => lines.push(`- <${r}>`));
      lines.push('');
    }

    lines.push(`> **Rollback:** ${pkg.rollbackNote}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('*Generated by [UpgradePilot](https://github.com/upgradepilot/upgradepilot)*');
  return lines.join('\n');
}

export const planner = { buildPlan, renderMarkdown };
