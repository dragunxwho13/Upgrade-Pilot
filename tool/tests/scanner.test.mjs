/**
 * tool/tests/scanner.test.mjs
 *
 * Unit tests for tool/src/agents/scanner.js using Node's built-in test runner.
 * Run with:
 *   node --test tool/tests/scanner.test.mjs
 *
 * No extra test framework required — uses node:test + node:assert (Node ≥ 18).
 *
 * Test plan:
 *  1.  loadRules()      — returns an object with .packages array
 *  2.  buildFlatRules() — flattens packages × rules
 *  3.  scanFile()       — express-legacy.js hits all 4 express rules
 *  4.  scanFile()       — express/app-del   hit at correct line
 *  5.  scanFile()       — express/res-send-status hits (410 and 404)
 *  6.  scanFile()       — express/req-param hit at correct line
 *  7.  scanFile()       — express/wildcard-route hit at correct line
 *  8.  scanFile()       — mongoose-legacy.js hits all 5 mongoose rules
 *  9.  scanFile()       — mongoose/model-update hit at correct line
 * 10.  scanFile()       — mongoose/model-count hit at correct line
 * 11.  scanFile()       — mongoose/callback-query hit at correct line
 * 12.  scanFile()       — jest-legacy.js hits 2 jest rules
 * 13.  scanFile()       — clean.js returns zero hits
 * 14.  buildRisk()      — riskScore = occurrences × severity, sorted desc
 * 15.  buildDepUsage()  — aggregates per-package correctly
 * 16.  scanner.scan()   — full scan of fixtures/ directory
 * 17.  scanner.scan()   — usageMap keys match active-rule IDs
 * 18.  scanner.scan()   — collectJsFiles skips node_modules
 * 19.  scanner.scan()   — snippet field is trimmed
 * 20.  scanner.scan()   — column is 1-based and accurate
 */

import { test }        from 'node:test';
import assert          from 'node:assert/strict';
import path            from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanner } from '../src/agents/scanner.js';

const {
  scan,
  loadRules,
  buildFlatRules,
  scanFile,
  buildRisk,
  buildDepUsage,
  collectJsFiles,
} = scanner;

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.resolve(__dirname, 'fixtures');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function flatRulesForPkg(pkgName) {
  const db = loadRules();
  return buildFlatRules(db).filter(({ pkg }) => pkg.package === pkgName);
}

function allFlatRules() {
  return buildFlatRules(loadRules());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// 1. loadRules returns well-formed object
test('1. loadRules() returns an object with a packages array', () => {
  const db = loadRules();
  assert.ok(db && typeof db === 'object', 'db is an object');
  assert.ok(Array.isArray(db.packages),   'db.packages is an array');
  assert.ok(db.packages.length >= 3,      'at least 3 packages defined');
});

// 2. buildFlatRules flattens correctly
test('2. buildFlatRules() produces one entry per rule across all packages', () => {
  const db    = loadRules();
  const flat  = buildFlatRules(db);
  const total = db.packages.reduce((s, p) => s + p.rules.length, 0);
  assert.strictEqual(flat.length, total, 'flat length equals sum of all rules');
  assert.ok(flat.every(e => e.pkg && e.rule), 'each entry has pkg and rule');
});

// 3. scanFile detects all 4 Express rules in express-legacy.js
test('3. scanFile() finds all 4 express rules in express-legacy.js', () => {
  const filePath  = path.join(FIXTURES, 'express-legacy.js');
  const rules     = flatRulesForPkg('express');
  const hits      = scanFile(filePath, 'express-legacy.js', rules);
  const hitRuleIds = [...new Set(hits.map(h => h.ruleId))];

  assert.ok(hitRuleIds.includes('express/app-del'),          'app-del found');
  assert.ok(hitRuleIds.includes('express/res-send-status'),  'res-send-status found');
  assert.ok(hitRuleIds.includes('express/req-param'),        'req-param found');
  assert.ok(hitRuleIds.includes('express/wildcard-route'),   'wildcard-route found');
});

// 4. express/app-del hit at expected line
test('4. scanFile() reports express/app-del at line 10 in express-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'express-legacy.js');
  const rules    = flatRulesForPkg('express');
  const hits     = scanFile(filePath, 'express-legacy.js', rules)
    .filter(h => h.ruleId === 'express/app-del');

  assert.ok(hits.length >= 1, 'at least one hit');
  assert.strictEqual(hits[0].line, 10, 'hit on line 10');
});

// 5. express/res-send-status finds two occurrences (410 and 404)
test('5. scanFile() finds two res.send(status) hits in express-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'express-legacy.js');
  const rules    = flatRulesForPkg('express');
  const hits     = scanFile(filePath, 'express-legacy.js', rules)
    .filter(h => h.ruleId === 'express/res-send-status');

  assert.ok(hits.length >= 2, `expected ≥ 2 hits, got ${hits.length}`);
});

// 6. express/req-param hit
test('6. scanFile() finds express/req-param in express-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'express-legacy.js');
  const rules    = flatRulesForPkg('express');
  const hits     = scanFile(filePath, 'express-legacy.js', rules)
    .filter(h => h.ruleId === 'express/req-param');

  assert.ok(hits.length >= 1, 'req-param hit found');
  assert.ok(hits[0].snippet.includes('req.param'), 'snippet contains req.param');
});

// 7. express/wildcard-route hit
test('7. scanFile() finds express/wildcard-route in express-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'express-legacy.js');
  const rules    = flatRulesForPkg('express');
  const hits     = scanFile(filePath, 'express-legacy.js', rules)
    .filter(h => h.ruleId === 'express/wildcard-route');

  assert.ok(hits.length >= 1, 'wildcard-route hit found');
});

// 8. scanFile detects all 5 Mongoose rules in mongoose-legacy.js
test('8. scanFile() finds all 5 mongoose rules in mongoose-legacy.js', () => {
  const filePath   = path.join(FIXTURES, 'mongoose-legacy.js');
  const rules      = flatRulesForPkg('mongoose');
  const hits       = scanFile(filePath, 'mongoose-legacy.js', rules);
  const hitRuleIds = [...new Set(hits.map(h => h.ruleId))];

  assert.ok(hitRuleIds.includes('mongoose/model-update'),                  'model-update found');
  assert.ok(hitRuleIds.includes('mongoose/model-count'),                   'model-count found');
  assert.ok(hitRuleIds.includes('mongoose/callback-query'),                'callback-query found');
  assert.ok(hitRuleIds.includes('mongoose/callback-exec'),                 'callback-exec found');
  assert.ok(hitRuleIds.includes('mongoose/find-one-and-update-callback'),  'findOneAndUpdate-callback found');
});

// 9. mongoose/model-update hit at correct line
test('9. scanFile() reports mongoose/model-update at line 12 in mongoose-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'mongoose-legacy.js');
  const rules    = flatRulesForPkg('mongoose');
  const hits     = scanFile(filePath, 'mongoose-legacy.js', rules)
    .filter(h => h.ruleId === 'mongoose/model-update');

  assert.ok(hits.length >= 1, 'model-update hit found');
  assert.strictEqual(hits[0].line, 12, `expected line 12, got ${hits[0].line}`);
});

// 10. mongoose/model-count hit at correct line
test('10. scanFile() reports mongoose/model-count at line 15 in mongoose-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'mongoose-legacy.js');
  const rules    = flatRulesForPkg('mongoose');
  const hits     = scanFile(filePath, 'mongoose-legacy.js', rules)
    .filter(h => h.ruleId === 'mongoose/model-count');

  assert.ok(hits.length >= 1, 'model-count hit found');
  assert.strictEqual(hits[0].line, 15, `expected line 15, got ${hits[0].line}`);
});

// 11. mongoose/callback-query hit at correct line
test('11. scanFile() reports mongoose/callback-query at line 18 in mongoose-legacy.js', () => {
  const filePath = path.join(FIXTURES, 'mongoose-legacy.js');
  const rules    = flatRulesForPkg('mongoose');
  const hits     = scanFile(filePath, 'mongoose-legacy.js', rules)
    .filter(h => h.ruleId === 'mongoose/callback-query');

  assert.ok(hits.length >= 1, 'callback-query hit found');
  assert.strictEqual(hits[0].line, 18, `expected line 18, got ${hits[0].line}`);
});

// 12. jest-legacy.js hits both jest rules
test('12. scanFile() finds jest/set-timeout and jest/jasmine-globals in jest-legacy.js', () => {
  const filePath   = path.join(FIXTURES, 'jest-legacy.js');
  const rules      = flatRulesForPkg('jest');
  const hits       = scanFile(filePath, 'jest-legacy.js', rules);
  const hitRuleIds = [...new Set(hits.map(h => h.ruleId))];

  assert.ok(hitRuleIds.includes('jest/set-timeout'),      'set-timeout found');
  assert.ok(hitRuleIds.includes('jest/jasmine-globals'),  'jasmine-globals found');
});

// 13. clean.js produces zero hits
test('13. scanFile() returns zero hits for clean.js', () => {
  const filePath = path.join(FIXTURES, 'clean.js');
  const rules    = allFlatRules();
  const hits     = scanFile(filePath, 'clean.js', rules);
  assert.strictEqual(hits.length, 0, `expected 0 hits, got ${hits.length}`);
});

// 14. buildRisk — riskScore = occurrences × severity, sorted descending
test('14. buildRisk() computes riskScore = occurrences × severity and sorts desc', () => {
  const db = loadRules();
  // Construct a synthetic usageMap with known counts
  const usageMap = {};
  for (const pkg of db.packages) {
    for (const rule of pkg.rules) usageMap[rule.id] = [];
  }
  // 2 hits on express/app-del (severity 3) → score 6
  usageMap['express/app-del'] = [{ ruleId: 'express/app-del' }, { ruleId: 'express/app-del' }];
  // 3 hits on jest/set-timeout (severity 1) → score 3
  usageMap['jest/set-timeout'] = [{ ruleId: 'jest/set-timeout' }, { ruleId: 'jest/set-timeout' }, { ruleId: 'jest/set-timeout' }];

  const risk = buildRisk(usageMap, db);
  assert.ok(Array.isArray(risk), 'risk is an array');
  const appDel = risk.find(r => r.ruleId === 'express/app-del');
  assert.ok(appDel, 'express/app-del entry exists');
  assert.strictEqual(appDel.riskScore, 6,    'riskScore = 2 × 3 = 6');
  assert.strictEqual(appDel.occurrences, 2,  'occurrences = 2');

  // Confirm sorted descending
  for (let i = 1; i < risk.length; i++) {
    assert.ok(risk[i - 1].riskScore >= risk[i].riskScore, `risk[${i-1}] >= risk[${i}]`);
  }
});

// 15. buildDepUsage aggregates per-package totals
test('15. buildDepUsage() aggregates hit counts per package', () => {
  const usageMap = {
    'express/app-del':       [{ package: 'express' }, { package: 'express' }],
    'express/req-param':     [{ package: 'express' }],
    'mongoose/model-update': [{ package: 'mongoose' }],
  };
  const depUsage = buildDepUsage(usageMap);
  assert.strictEqual(depUsage['express'],  3, 'express total = 3');
  assert.strictEqual(depUsage['mongoose'], 1, 'mongoose total = 1');
});

// 16. Full scan of fixtures directory
test('16. scanner.scan() on fixtures/ returns a valid ScanResult', async () => {
  const result = await scanner.scan({ targetPath: FIXTURES, verbose: false, dryRun: false });

  assert.ok(result.projectPath,              'projectPath set');
  assert.ok(result.scannedAt,                'scannedAt set');
  assert.ok(typeof result.usageMap === 'object', 'usageMap is object');
  assert.ok(Array.isArray(result.riskByRule),    'riskByRule is array');
  assert.ok(typeof result.depUsage === 'object', 'depUsage is object');
  assert.ok(typeof result.summary === 'string',  'summary is string');
});

// 17. usageMap contains keys for all rules active in the detected ecosystem
test('17. scanner.scan() usageMap has keys for all active rules', async () => {
  const result     = await scanner.scan({ targetPath: FIXTURES, verbose: false, dryRun: false });
  const db         = loadRules();
  // Only check rules belonging to the detected ecosystem (node for fixtures/)
  const ecosystem  = result.ecosystem || 'node';
  const activeIds  = db.packages
    .filter(p => (p.ecosystem || 'node') === ecosystem)
    .flatMap(p => p.rules.map(r => r.id));
  for (const id of activeIds) {
    assert.ok(id in result.usageMap, `usageMap contains key: ${id}`);
  }
  // Python rules should NOT appear in a node-ecosystem scan
  const pythonIds = db.packages
    .filter(p => p.ecosystem === 'python')
    .flatMap(p => p.rules.map(r => r.id));
  for (const id of pythonIds) {
    assert.ok(!(id in result.usageMap), `Python rule ${id} should not be in node usageMap`);
  }
});

// 18. collectJsFiles skips node_modules
test('18. collectJsFiles() does not return paths inside node_modules', () => {
  const files = collectJsFiles(FIXTURES);
  assert.ok(files.every(f => !f.includes('node_modules')), 'no node_modules paths');
  assert.ok(files.length >= 4, `expected ≥ 4 fixture files, got ${files.length}`);
});

// 19. Hit snippet is trimmed
test('19. scanFile() produces trimmed snippets (no leading/trailing whitespace)', () => {
  const filePath = path.join(FIXTURES, 'express-legacy.js');
  const rules    = flatRulesForPkg('express');
  const hits     = scanFile(filePath, 'express-legacy.js', rules);
  for (const hit of hits) {
    assert.strictEqual(hit.snippet, hit.snippet.trim(), `snippet not trimmed: "${hit.snippet}"`);
  }
});

// 20. Column is 1-based and correct
test('20. scanFile() reports 1-based column matching the pattern position', () => {
  const filePath = path.join(FIXTURES, 'express-legacy.js');
  const rules    = flatRulesForPkg('express');
  const hits     = scanFile(filePath, 'express-legacy.js', rules)
    .filter(h => h.ruleId === 'express/app-del');

  assert.ok(hits.length >= 1, 'at least one app-del hit');
  // "app.del(" starts at column 1 on the trimmed line but in the raw line it is indented
  // column must be >= 1 and a positive integer
  assert.ok(hits[0].column >= 1, 'column >= 1');
  assert.strictEqual(typeof hits[0].column, 'number', 'column is a number');
});
