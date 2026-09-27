/**
 * planner.js — Upgrade Planner Agent
 *
 * Interface:
 *   planner.buildPlan(ctx, scanResult, noteMap) → Promise<UpgradePlan>
 *
 * UpgradePlan: {
 *   projectPath: string,
 *   createdAt: string,             // ISO timestamp
 *   steps: PlanStep[],             // ordered upgrade steps
 *   riskScore: number,             // 0–100 aggregate risk
 *   summary: string,
 * }
 *
 * PlanStep: {
 *   order: number,
 *   package: string,
 *   fromVersion: string,
 *   toVersion: string,             // target semver (e.g. "^5.0.0")
 *   risk: 'low' | 'medium' | 'high',
 *   riskScore: number,             // 0–100
 *   codemods: string[],            // human-readable codemod descriptions
 *   migrationSteps: string[],      // from librarian notes
 *   references: string[],
 * }
 *
 * ctx:        { targetPath, dryRun, verbose }
 * scanResult: ScanResult from scanner.scan()
 * noteMap:    NoteMap from librarian.fetchNotes()
 */

// Risk heuristics per known package upgrade
const RISK_TABLE = {
  express:  { score: 75, level: 'high',   toVersion: '^5.0.0' },
  mongoose: { score: 80, level: 'high',   toVersion: '^7.0.0' },
  jest:     { score: 40, level: 'medium', toVersion: '^29.0.0' },
};

const DEFAULT_RISK = { score: 30, level: 'medium', toVersion: 'latest' };

function riskLabel(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

async function buildPlan(ctx, scanResult, noteMap) {
  const steps = scanResult.breaking.map((dep, idx) => {
    const risk    = RISK_TABLE[dep.name] || DEFAULT_RISK;
    const note    = noteMap[dep.name]    || {};
    return {
      order:          idx + 1,
      package:        dep.name,
      fromVersion:    dep.current,
      toVersion:      risk.toVersion,
      risk:           risk.level,
      riskScore:      risk.score,
      codemods:       note.migrationSteps || [],
      migrationSteps: note.migrationSteps || [],
      references:     note.references     || [],
    };
  });

  // Sort: lower risk first so safer upgrades land before dangerous ones
  steps.sort((a, b) => a.riskScore - b.riskScore);
  steps.forEach((s, i) => { s.order = i + 1; });

  const aggregate = steps.length
    ? Math.round(steps.reduce((acc, s) => acc + s.riskScore, 0) / steps.length)
    : 0;

  return {
    projectPath: scanResult.projectPath,
    createdAt:   new Date().toISOString(),
    steps,
    riskScore:   aggregate,
    summary:     steps.length
      ? `${steps.length} upgrade(s) planned. Aggregate risk: ${riskLabel(aggregate)} (${aggregate}/100).`
      : 'Nothing to upgrade.',
  };
}

export const planner = { buildPlan };
