/**
 * tool/tests/python-scanner.test.mjs
 *
 * Unit tests for the Python-ecosystem extensions to scanner.js.
 * Tests parseRequirements(), detectEcosystem(), collectSourceFiles(),
 * and scanFile() with flask/requests rules.
 *
 * Run with:
 *   node --test tool/tests/python-scanner.test.mjs
 */

import { test }          from 'node:test';
import assert            from 'node:assert/strict';
import path              from 'node:path';
import fs                from 'node:fs';
import { fileURLToPath } from 'node:url';

import { scanner } from '../src/agents/scanner.js';

const {
  loadRules,
  buildFlatRules,
  scanFile,
  parseRequirements,
  detectEcosystem,
  collectSourceFiles,
} = scanner;

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.resolve(__dirname, 'fixtures');
const SAMPLE2    = path.resolve(__dirname, '../../sample-app2');
const FLASK_FIXTURE = path.join(FIXTURES, 'flask-legacy.py');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function flatRulesForPkg(pkgName) {
  const db = loadRules();
  return buildFlatRules(db, 'python').filter(({ pkg }) => pkg.package === pkgName);
}

// ─── 1. parseRequirements ─────────────────────────────────────────────────────
test('1. parseRequirements() parses pinned versions correctly', () => {
  const content = `
Flask==2.3.3
Werkzeug==2.3.7
requests==2.28.2
# a comment
pytest==7.4.4
`.trim();
  const deps = parseRequirements(content);
  assert.equal(deps.length, 4, 'should have 4 deps');
  const flask = deps.find(d => d.name === 'flask');
  assert.ok(flask, 'flask found');
  assert.equal(flask.current, '2.3.3');
  const req = deps.find(d => d.name === 'requests');
  assert.ok(req, 'requests found');
  assert.equal(req.current, '2.28.2');
});

test('2. parseRequirements() ignores blank lines, comments, -r includes', () => {
  const content = `
# header comment
Flask==2.3.3

-r base.txt
--extra-index-url https://example.com
`.trim();
  const deps = parseRequirements(content);
  assert.equal(deps.length, 1, 'only Flask counts');
  assert.equal(deps[0].name, 'flask');
});

test('3. parseRequirements() handles >= and ~= version specs', () => {
  const content = `Flask>=2.0\nrequests~=2.28\n`;
  const deps = parseRequirements(content);
  assert.equal(deps.length, 2);
  assert.equal(deps[0].current, '2.0');
  assert.equal(deps[1].current, '2.28');
});

test('4. parseRequirements() handles bare package names (no version)', () => {
  const content = `flask\nrequests\n`;
  const deps = parseRequirements(content);
  assert.equal(deps.length, 2);
  assert.equal(deps[0].current, '*');
});

// ─── 2. detectEcosystem ───────────────────────────────────────────────────────
test('5. detectEcosystem() returns "python" for a dir with requirements.txt', () => {
  assert.equal(detectEcosystem(SAMPLE2), 'python');
});

test('6. detectEcosystem() returns "node" for a dir with package.json only', () => {
  assert.equal(detectEcosystem(FIXTURES), 'node');
});

// ─── 3. collectSourceFiles ────────────────────────────────────────────────────
test('7. collectSourceFiles() finds .py files with /\\.py$/ regex', () => {
  const pyFiles = collectSourceFiles(SAMPLE2, /\.py$/);
  assert.ok(pyFiles.length >= 2, `expected ≥ 2 .py files, got ${pyFiles.length}`);
  assert.ok(pyFiles.every(f => f.endsWith('.py')), 'all .py extension');
});

test('8. collectSourceFiles() finds .py fixture file', () => {
  const pyFiles = collectSourceFiles(FIXTURES, /\.py$/);
  assert.ok(pyFiles.some(f => f.endsWith('flask-legacy.py')), 'found flask-legacy.py');
  assert.ok(pyFiles.every(f => !f.includes('node_modules')), 'no node_modules');
});

// ─── 4. Flask rule scanning ───────────────────────────────────────────────────
test('9. scanFile() finds flask/escape-import in flask-legacy.py', () => {
  const rules = flatRulesForPkg('flask');
  const hits  = scanFile(FLASK_FIXTURE, 'flask-legacy.py', rules);
  const escHits = hits.filter(h => h.ruleId === 'flask/escape-import');
  assert.ok(escHits.length >= 1, 'at least one flask/escape-import hit');
  assert.equal(escHits[0].file, 'flask-legacy.py');
});

test('10. scanFile() finds flask/markup-import in flask-legacy.py', () => {
  const rules = flatRulesForPkg('flask');
  const hits  = scanFile(FLASK_FIXTURE, 'flask-legacy.py', rules);
  const markupHits = hits.filter(h => h.ruleId === 'flask/markup-import');
  assert.ok(markupHits.length >= 1, 'at least one flask/markup-import hit');
});

test('11. scanFile() finds flask/json-sort-keys-config in flask-legacy.py', () => {
  const rules = flatRulesForPkg('flask');
  const hits  = scanFile(FLASK_FIXTURE, 'flask-legacy.py', rules);
  const cfgHits = hits.filter(h => h.ruleId === 'flask/json-sort-keys-config');
  assert.ok(cfgHits.length >= 1, 'at least one flask/json-sort-keys-config hit');
});

test('12. scanFile() finds flask/flask-env in flask-legacy.py', () => {
  const rules = flatRulesForPkg('flask');
  const hits  = scanFile(FLASK_FIXTURE, 'flask-legacy.py', rules);
  const envHits = hits.filter(h => h.ruleId === 'flask/flask-env');
  assert.ok(envHits.length >= 1, 'at least one flask/flask-env hit');
});

test('13. scanFile() finds all 5 flask rules active in flask-legacy.py', () => {
  const rules    = flatRulesForPkg('flask');
  const hits     = scanFile(FLASK_FIXTURE, 'flask-legacy.py', rules);
  const ruleIds  = [...new Set(hits.map(h => h.ruleId))];
  assert.ok(ruleIds.length === 5, `expected 5 distinct flask rules, got ${ruleIds.length}: ${ruleIds.join(', ')}`);
});

// ─── 5. requests rule scanning ───────────────────────────────────────────────
test('14. scanFile() finds requests/packages-urllib3 in flask-legacy.py', () => {
  const rules = flatRulesForPkg('requests');
  const hits  = scanFile(FLASK_FIXTURE, 'flask-legacy.py', rules);
  assert.ok(hits.length >= 1, 'at least one requests/packages-urllib3 hit');
  assert.equal(hits[0].ruleId, 'requests/packages-urllib3');
});

// ─── 6. buildFlatRules ecosystem filter ──────────────────────────────────────
test('15. buildFlatRules(db, "python") only returns flask + requests rules', () => {
  const db    = loadRules();
  const rules = buildFlatRules(db, 'python');
  const pkgs  = [...new Set(rules.map(({ pkg }) => pkg.package))];
  assert.ok(pkgs.includes('flask'),    'python rules include flask');
  assert.ok(pkgs.includes('requests'), 'python rules include requests');
  assert.ok(!pkgs.includes('express'), 'python rules exclude express');
  assert.ok(!pkgs.includes('mongoose'),'python rules exclude mongoose');
});

test('16. buildFlatRules(db, "node") only returns node rules', () => {
  const db    = loadRules();
  const rules = buildFlatRules(db, 'node');
  const pkgs  = [...new Set(rules.map(({ pkg }) => pkg.package))];
  assert.ok(pkgs.includes('express'),  'node rules include express');
  assert.ok(pkgs.includes('mongoose'), 'node rules include mongoose');
  assert.ok(!pkgs.includes('flask'),   'node rules exclude flask');
  assert.ok(!pkgs.includes('requests'),'node rules exclude requests');
});

// ─── 7. Full scan on sample-app2 ─────────────────────────────────────────────
test('17. scanner.scan() on sample-app2 detects python ecosystem', async () => {
  const result = await scanner.scan({ targetPath: SAMPLE2, verbose: false, dryRun: false });
  assert.equal(result.ecosystem, 'python', 'ecosystem should be python');
  assert.ok(result.requirements !== null, 'requirements should be populated');
  assert.equal(result.packageJson, null, 'packageJson should be null for Python');
});

test('18. scanner.scan() on sample-app2 finds flask and requests in dependencies', async () => {
  const result = await scanner.scan({ targetPath: SAMPLE2, verbose: false, dryRun: false });
  const names  = result.dependencies.map(d => d.name);
  assert.ok(names.includes('flask'),    'flask in dependencies');
  assert.ok(names.includes('requests'), 'requests in dependencies');
});

test('19. scanner.scan() on sample-app2 reports breaking changes for flask and requests', async () => {
  const result = await scanner.scan({ targetPath: SAMPLE2, verbose: false, dryRun: false });
  const breakingNames = result.breaking.map(b => b.name);
  assert.ok(breakingNames.includes('flask'),    'flask is a breaking dep');
  assert.ok(breakingNames.includes('requests'), 'requests is a breaking dep');
});

test('20. scanner.scan() on sample-app2 finds flask/escape-import hits in usageMap', async () => {
  const result = await scanner.scan({ targetPath: SAMPLE2, verbose: false, dryRun: false });
  const escHits = result.usageMap['flask/escape-import'] || [];
  assert.ok(escHits.length >= 1, `expected ≥1 flask/escape-import hits, got ${escHits.length}`);
});

test('21. scanner.scan() on sample-app2 finds requests/packages-urllib3 hits', async () => {
  const result = await scanner.scan({ targetPath: SAMPLE2, verbose: false, dryRun: false });
  const hits   = result.usageMap['requests/packages-urllib3'] || [];
  assert.ok(hits.length >= 1, `expected ≥1 requests/packages-urllib3 hits, got ${hits.length}`);
});

test('22. scanner.scan() on sample-app2 summary mentions flask and requests', async () => {
  const result = await scanner.scan({ targetPath: SAMPLE2, verbose: false, dryRun: false });
  assert.ok(result.summary.includes('flask') || result.summary.includes('requests'),
    `summary should mention flask or requests: ${result.summary}`);
});
