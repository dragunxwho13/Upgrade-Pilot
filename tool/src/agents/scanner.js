/**
 * scanner.js — Source-Code & Dependency Scanner Agent
 *
 * ─── Public Interface ────────────────────────────────────────────────────────
 *
 *   scanner.scan(ctx)  → Promise<ScanResult>
 *
 * ctx: {
 *   targetPath : string   — root of the project to analyse
 *   dryRun     : boolean  — no-op for scanning, reserved for pipeline compat
 *   verbose    : boolean  — emit debug lines to stderr when true
 * }
 *
 * ─── ScanResult ──────────────────────────────────────────────────────────────
 * {
 *   projectPath  : string,
 *   scannedAt    : string,            // ISO-8601 timestamp
 *   packageJson  : object,            // parsed package.json
 *   dependencies : DepInfo[],
 *   outdated     : DepInfo[],
 *   breaking     : BreakingDep[],
 *   usageMap     : UsageMap,          // ← NEW: per-rule source hits
 *   riskByRule   : RiskEntry[],       // ← NEW: occurrences × severity
 *   depUsage     : DepUsage,          // ← NEW: per-package hit counts
 *   summary      : string,
 * }
 *
 * ─── UsageMap ────────────────────────────────────────────────────────────────
 * {
 *   [ruleId: string]: Hit[]
 * }
 *
 * Hit: {
 *   file    : string,   // relative path from targetPath
 *   line    : number,   // 1-based
 *   column  : number,   // 1-based
 *   snippet : string,   // trimmed source line
 *   ruleId  : string,
 *   package : string,
 * }
 *
 * ─── RiskEntry ───────────────────────────────────────────────────────────────
 * {
 *   ruleId      : string,
 *   package     : string,
 *   description : string,
 *   severity    : number,   // 1 | 2 | 3
 *   occurrences : number,
 *   riskScore   : number,   // occurrences × severity
 *   category    : string,
 * }
 *
 * ─── DepUsage ────────────────────────────────────────────────────────────────
 * {
 *   [packageName: string]: number   // total hit count across all rules
 * }
 *
 * ─── DepInfo ─────────────────────────────────────────────────────────────────
 * {
 *   name    : string,
 *   current : string,
 *   latest  : string | null,
 *   type    : 'prod' | 'dev' | 'peer',
 * }
 *
 * ─── BreakingDep ─────────────────────────────────────────────────────────────
 * DepInfo & {
 *   reason           : string,
 *   migrationGuideUrl: string | null,
 * }
 *
 * ─── Notes ───────────────────────────────────────────────────────────────────
 * - Globs all .js / .mjs / .cjs files under targetPath; skips node_modules,
 *   .git, dist, build, coverage, and the tool's own out/ directory.
 * - Pattern matching uses RegExp (per rule's removedPattern + patternFlags).
 *   Each source line is tested independently so line numbers are exact.
 * - Registry lookups are stubbed (null). Swap fetchLatest() for a live call.
 * - breaking-changes.json is resolved relative to this file so the module
 *   works regardless of cwd.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire }  from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require  = createRequire(import.meta.url);

// ─── Load rule database ───────────────────────────────────────────────────────
const RULES_PATH = path.resolve(__dirname, '../../data/breaking-changes.json');

/** @returns {{ packages: Array }} */
function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
}

// ─── Directory / file walking ─────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'out', '.nyc_output']);

/**
 * Recursively collect all .js/.mjs/.cjs files under dir.
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ─── Pattern matching ─────────────────────────────────────────────────────────
/**
 * Compile a rule's removedPattern into a RegExp.
 * Cached to avoid re-compiling per-file.
 * @param {{ removedPattern: string, patternFlags: string }} rule
 * @returns {RegExp}
 */
const _reCache = new Map();
function ruleRegex(rule) {
  const key = `${rule.removedPattern}|||${rule.patternFlags}`;
  if (!_reCache.has(key)) {
    _reCache.set(key, new RegExp(rule.removedPattern, rule.patternFlags || ''));
  }
  return _reCache.get(key);
}

/**
 * Scan a single file for all rule hits.
 * @param {string} filePath       absolute path
 * @param {string} relPath        path relative to targetPath
 * @param {Array}  rules          flat list of { pkg, rule } pairs
 * @returns {Hit[]}
 */
function scanFile(filePath, relPath, rules) {
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = src.split('\n');
  const hits  = [];

  for (const { pkg, rule } of rules) {
    const re = ruleRegex(rule);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Reset lastIndex for global regexes (patternFlags may include 'g')
      re.lastIndex = 0;
      const match = re.exec(line);
      if (match) {
        hits.push({
          ruleId:  rule.id,
          package: pkg.package,
          file:    relPath.replace(/\\/g, '/'),
          line:    i + 1,
          column:  match.index + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return hits;
}

// ─── Dependency detection ─────────────────────────────────────────────────────
async function fetchLatest(_name) {
  // Offline stub — swap for a real npm-registry fetch in production
  return null;
}

function buildFlatRules(db) {
  const flat = [];
  for (const pkg of db.packages) {
    for (const rule of pkg.rules) {
      flat.push({ pkg, rule });
    }
  }
  return flat;
}

function detectBreakingDep(name, currentVersion, db) {
  const pkg = db.packages.find(p => p.package === name);
  if (!pkg) return null;
  const major = parseInt(currentVersion.replace(/^[^0-9]*/, ''), 10);
  if (major === parseInt(pkg.fromVersion, 10)) {
    return {
      reason:            pkg.rules.map(r => r.description).join('; '),
      migrationGuideUrl: pkg.migrationGuide,
    };
  }
  return null;
}

// ─── Build risk + depUsage summaries ─────────────────────────────────────────
function buildRisk(usageMap, db) {
  const riskByRule = [];
  for (const pkg of db.packages) {
    for (const rule of pkg.rules) {
      const hits       = usageMap[rule.id] || [];
      const occurrences = hits.length;
      riskByRule.push({
        ruleId:      rule.id,
        package:     pkg.package,
        description: rule.description,
        severity:    rule.severity,
        occurrences,
        riskScore:   occurrences * rule.severity,
        category:    rule.category,
      });
    }
  }
  // Sort by riskScore descending so highest risk floats to the top
  riskByRule.sort((a, b) => b.riskScore - a.riskScore);
  return riskByRule;
}

function buildDepUsage(usageMap) {
  const depUsage = {};
  for (const hits of Object.values(usageMap)) {
    for (const hit of hits) {
      depUsage[hit.package] = (depUsage[hit.package] || 0) + 1;
    }
  }
  return depUsage;
}

// ─── Main scan function ───────────────────────────────────────────────────────
async function scan(ctx) {
  const { targetPath, verbose } = ctx;
  const dbg = (...a) => verbose && process.stderr.write('[scanner] ' + a.join(' ') + '\n');

  // 1. Load rule DB
  const db       = loadRules();
  const flatRules = buildFlatRules(db);
  dbg(`Loaded ${flatRules.length} rules from breaking-changes.json`);

  // 2. Read package.json
  const pkgPath = path.join(targetPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`No package.json found at ${pkgPath}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const allDeps = [
    ...Object.entries(packageJson.dependencies     || {}).map(([n, v]) => ({ name: n, current: v, type: 'prod' })),
    ...Object.entries(packageJson.devDependencies  || {}).map(([n, v]) => ({ name: n, current: v, type: 'dev'  })),
    ...Object.entries(packageJson.peerDependencies || {}).map(([n, v]) => ({ name: n, current: v, type: 'peer' })),
  ];

  const dependencies = await Promise.all(
    allDeps.map(async dep => ({ ...dep, latest: await fetchLatest(dep.name) }))
  );

  const outdated = dependencies.filter(d => d.latest && d.latest !== d.current);
  const breaking = dependencies
    .map(d => {
      const info = detectBreakingDep(d.name, d.current, db);
      return info ? { ...d, ...info } : null;
    })
    .filter(Boolean);

  // 3. Collect source files
  const jsFiles = collectJsFiles(targetPath);
  dbg(`Found ${jsFiles.length} JS files to scan`);

  // 4. Restrict rules to packages that are actually installed (keeps noise low)
  const installedPackages = new Set(allDeps.map(d => d.name));
  const activeRules = flatRules.filter(({ pkg }) => installedPackages.has(pkg.package));
  dbg(`Active rules: ${activeRules.length} (packages present: ${[...installedPackages].join(', ')})`);

  // 5. Scan each file
  const usageMap = {};
  for (const { rule } of activeRules) {
    usageMap[rule.id] = [];
  }

  for (const absPath of jsFiles) {
    const relPath = path.relative(targetPath, absPath);
    const hits    = scanFile(absPath, relPath, activeRules);
    for (const hit of hits) {
      usageMap[hit.ruleId].push(hit);
    }
  }

  const totalHits = Object.values(usageMap).reduce((s, h) => s + h.length, 0);
  dbg(`Total hits: ${totalHits}`);

  // 6. Risk scoring
  const riskByRule = buildRisk(usageMap, db);
  const depUsage   = buildDepUsage(usageMap);

  // 7. Summary
  const hitRuleIds = Object.entries(usageMap)
    .filter(([, hits]) => hits.length > 0)
    .map(([id]) => id);

  const summary = hitRuleIds.length
    ? `Found ${totalHits} hit(s) across ${hitRuleIds.length} rule(s) in ${jsFiles.length} file(s). Packages affected: ${Object.keys(depUsage).join(', ')}.`
    : `No breaking-change patterns detected in ${jsFiles.length} JS file(s).`;

  return {
    projectPath:  targetPath,
    scannedAt:    new Date().toISOString(),
    packageJson,
    dependencies,
    outdated,
    breaking,
    usageMap,
    riskByRule,
    depUsage,
    summary,
  };
}

export const scanner = { scan, collectJsFiles, scanFile, buildRisk, buildDepUsage, loadRules, buildFlatRules };
