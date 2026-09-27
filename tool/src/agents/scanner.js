/**
 * scanner.js — Dependency Scanner Agent
 *
 * Interface:
 *   scanner.scan(ctx) → Promise<ScanResult>
 *
 * ScanResult: {
 *   projectPath: string,
 *   packageJson: object,          // parsed package.json
 *   dependencies: DepInfo[],      // all direct deps (prod + dev)
 *   outdated: DepInfo[],          // deps where current < latest
 *   breaking: BreakingDep[],      // deps with known breaking changes
 *   summary: string,              // human-readable one-liner
 * }
 *
 * DepInfo: {
 *   name: string,
 *   current: string,              // version in package.json
 *   latest: string | null,        // fetched from registry (stub: null)
 *   type: 'prod' | 'dev' | 'peer',
 * }
 *
 * BreakingDep: DepInfo & {
 *   reason: string,               // why the upgrade is breaking
 *   migrationGuideUrl: string | null,
 * }
 *
 * ctx: { targetPath, dryRun, verbose }
 *
 * Note: Registry lookups are stubbed (returns null for latest) so the agent
 * works fully offline. Swap fetchLatest() for a real npm-registry call when
 * wiring up a live pipeline.
 */

import fs from 'fs';
import path from 'path';

// Known breaking major bumps (extend this table as needed)
const KNOWN_BREAKING = {
  express:    { from: '4', to: '5', reason: 'app.del() removed; res.send(number) no longer sets status; req.param() removed; wildcard routes changed', url: 'https://expressjs.com/en/guide/migrating-5.html' },
  mongoose:   { from: '6', to: '7', reason: 'Model.update() removed; Model.count() removed; callback-style queries removed', url: 'https://mongoosejs.com/docs/migrating_to_7.html' },
  jest:       { from: '27', to: '29', reason: 'jest-circus is now the default runner; several globals changed', url: 'https://jestjs.io/docs/upgrading-to-jest29' },
};

/**
 * Stub: in a real implementation this would call the npm registry API.
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function fetchLatest(name) {
  // Offline stub — returns null to indicate "unknown"
  return null;
}

/**
 * Detect whether a dep is a known breaking upgrade candidate.
 */
function detectBreaking(name, currentVersion) {
  const entry = KNOWN_BREAKING[name];
  if (!entry) return null;
  const majorCurrent = parseInt(currentVersion.replace(/^[^0-9]*/, ''), 10);
  if (majorCurrent === parseInt(entry.from, 10)) {
    return {
      reason: entry.reason,
      migrationGuideUrl: entry.url,
    };
  }
  return null;
}

async function scan(ctx) {
  const pkgPath = path.join(ctx.targetPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`No package.json found at ${pkgPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const allDeps = [
    ...Object.entries(packageJson.dependencies    || {}).map(([n, v]) => ({ name: n, current: v, type: 'prod' })),
    ...Object.entries(packageJson.devDependencies || {}).map(([n, v]) => ({ name: n, current: v, type: 'dev'  })),
    ...Object.entries(packageJson.peerDependencies|| {}).map(([n, v]) => ({ name: n, current: v, type: 'peer' })),
  ];

  const dependencies = await Promise.all(
    allDeps.map(async dep => ({
      ...dep,
      latest: await fetchLatest(dep.name),
    }))
  );

  const outdated  = dependencies.filter(d => d.latest && d.latest !== d.current);
  const breaking  = dependencies
    .map(d => {
      const info = detectBreaking(d.name, d.current);
      return info ? { ...d, ...info } : null;
    })
    .filter(Boolean);

  const summary = breaking.length
    ? `Found ${breaking.length} breaking upgrade candidate(s): ${breaking.map(b => b.name).join(', ')}`
    : `No known breaking upgrades detected among ${dependencies.length} dependencies.`;

  return { projectPath: ctx.targetPath, packageJson, dependencies, outdated, breaking, summary };
}

export const scanner = { scan };
