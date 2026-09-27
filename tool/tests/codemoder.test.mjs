/**
 * tool/tests/codemoder.test.mjs
 *
 * Unit tests for tool/src/agents/codemoder.js using Node's built-in test runner.
 * Run with:  node --test tests/codemoder.test.mjs
 *
 * Test plan (25 tests):
 *
 * EXPRESS transforms (applyRulesToFile)
 *   1.  express/app-del       — app.del( → app.delete(
 *   2.  express/app-del       — does NOT touch app.delete( (negative-lookahead safe)
 *   3.  express/res-send-status — res.send(404) → res.sendStatus(404)
 *   4.  express/res-send-status — res.send(200) → res.sendStatus(200)
 *   5.  express/res-send-status — res.send('text') NOT touched (no 3-digit number)
 *   6.  express/req-param     — req.param('id') → req.params.id TODO comment
 *   7.  express/wildcard-route — app.get('*') → app.get("/{*splat}"
 *   8.  express/wildcard-route — router.post('*') transformed too
 *   9.  express fixture file  — all 4 rules fire, line numbers correct
 *  10.  clean fixture file    — zero express replacements
 *
 * MONGOOSE transforms
 *  11.  mongoose/model-update  — .update( → .updateOne(
 *  12.  mongoose/model-count   — .count( → .countDocuments(
 *  13.  mongoose/callback-query — find(filter, fn) transformed
 *  14.  mongoose/callback-exec  — .exec(function → .exec( + comment
 *  15.  mongoose/find-one-and-update-callback — callback form transformed
 *  16.  mongoose fixture file  — all 5 rules fire
 *
 * JEST transforms
 *  17.  jest/set-timeout       — jest.setTimeout( → comment replacement
 *  18.  jest/jasmine-globals   — jasmine. → jest.
 *  19.  jest fixture file      — both rules fire
 *
 * UNIFIED DIFF
 *  20.  unifiedDiff()          — returns '' for identical input
 *  21.  unifiedDiff()          — contains --- / +++ headers for changed input
 *  22.  unifiedDiff()          — contains -old line and +new line
 *
 * FULL APPLY (dry-run)
 *  23.  apply() dry-run on fixtures/ — writes no source files
 *  24.  apply() dry-run on fixtures/ — codemod-log.json created with replacements
 *  25.  apply() dry-run on fixtures/ — 3 patch files created (express, mongoose, jest)
 */

import { test, describe }  from 'node:test';
import assert              from 'node:assert/strict';
import fs                  from 'node:fs';
import path                from 'node:path';
import os                  from 'node:os';
import { fileURLToPath }   from 'node:url';

import { codemoder } from '../src/agents/codemoder.js';

const {
  applyRulesToFile,
  loadPackageRules,
  unifiedDiff,
  apply,
} = codemoder;

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.resolve(__dirname, 'fixtures');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRules(pkgName) {
  return loadPackageRules().get(pkgName) ?? [];
}

function applyExpress(src)  { return applyRulesToFile(src, 'test.js', getRules('express'));  }
function applyMongoose(src) { return applyRulesToFile(src, 'test.js', getRules('mongoose')); }
function applyJest(src)     { return applyRulesToFile(src, 'test.js', getRules('jest'));     }

// Create a temporary directory for dry-run output so we don't pollute tool/out
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'upgradepilot-test-'));
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS TRANSFORMS
// ─────────────────────────────────────────────────────────────────────────────

describe('express transforms', () => {

  test('1. express/app-del: app.del( → app.delete(', () => {
    const { modified, replacements } = applyExpress("app.del('/path', handler);");
    assert.ok(modified.includes('app.delete('), 'transformed to app.delete(');
    assert.ok(!modified.includes('app.del('),   'original pattern gone');
    assert.strictEqual(replacements.length, 1);
    assert.strictEqual(replacements[0].ruleId, 'express/app-del');
    assert.strictEqual(replacements[0].line, 1);
  });

  test('2. express/app-del: does NOT transform app.delete( (negative-lookahead)', () => {
    const src = "app.delete('/path', handler);";
    const { modified, replacements } = applyExpress(src);
    assert.strictEqual(modified, src, 'already-migrated code untouched');
    assert.strictEqual(replacements.length, 0);
  });

  test('3. express/res-send-status: res.send(404) → res.sendStatus(404)', () => {
    const { modified, replacements } = applyExpress('res.send(404);');
    assert.ok(modified.includes('res.sendStatus(404)'), 'status code preserved');
    assert.strictEqual(replacements[0].ruleId, 'express/res-send-status');
  });

  test('4. express/res-send-status: res.send(200) → res.sendStatus(200)', () => {
    const { modified } = applyExpress('return res.send(200);');
    assert.ok(modified.includes('res.sendStatus(200)'));
  });

  test("5. express/res-send-status: res.send('text') NOT touched", () => {
    const src = "res.send('hello world');";
    const { modified, replacements } = applyExpress(src);
    assert.strictEqual(modified, src);
    assert.strictEqual(replacements.filter(r => r.ruleId === 'express/res-send-status').length, 0);
  });

  test("6. express/req-param: req.param('id') → req.params.id with TODO comment", () => {
    const { modified, replacements } = applyExpress("const id = req.param('id');");
    assert.ok(modified.includes('req.params.id'), 'uses req.params.id');
    assert.ok(modified.includes('TODO'),          'TODO comment added');
    assert.strictEqual(replacements[0].ruleId, 'express/req-param');
  });

  test("7. express/wildcard-route: app.get('*') → app.get(\"/{*splat}\"", () => {
    const { modified, replacements } = applyExpress("app.get('*', handler);");
    assert.ok(modified.includes('/{*splat}'), 'wildcard updated');
    assert.strictEqual(replacements[0].ruleId, 'express/wildcard-route');
  });

  test("8. express/wildcard-route: router.post('*') also transformed", () => {
    const { modified } = applyExpress("app.post('*', handler);");
    assert.ok(modified.includes('/{*splat}'));
  });

  test('9. express fixture file: all 4 rules fire with correct line numbers', () => {
    const src  = fs.readFileSync(path.join(FIXTURES, 'express-legacy.js'), 'utf8');
    const { replacements } = applyExpress(src);
    const ids  = [...new Set(replacements.map(r => r.ruleId))];
    assert.ok(ids.includes('express/app-del'),         'app-del fires');
    assert.ok(ids.includes('express/res-send-status'), 'res-send-status fires');
    assert.ok(ids.includes('express/req-param'),       'req-param fires');
    assert.ok(ids.includes('express/wildcard-route'),  'wildcard-route fires');
    // app.del is on line 10
    const appDelHit = replacements.find(r => r.ruleId === 'express/app-del' && r.before.includes('app.del('));
    assert.ok(appDelHit, 'app.del hit found');
    assert.strictEqual(appDelHit.line, 10, 'app.del on line 10');
  });

  test('10. clean fixture: zero express replacements', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'clean.js'), 'utf8');
    const { replacements } = applyExpress(src);
    assert.strictEqual(replacements.length, 0, 'clean file → no replacements');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MONGOOSE TRANSFORMS
// ─────────────────────────────────────────────────────────────────────────────

describe('mongoose transforms', () => {

  test('11. mongoose/model-update: .update( → .updateOne(', () => {
    const { modified, replacements } = applyMongoose('Order.update({ a: 1 }, { $set: { b: 2 } });');
    assert.ok(modified.includes('.updateOne('), 'updated to updateOne');
    assert.ok(!modified.includes('.update('),   'original gone');
    assert.strictEqual(replacements[0].ruleId, 'mongoose/model-update');
  });

  test('12. mongoose/model-count: .count( → .countDocuments(', () => {
    const { modified, replacements } = applyMongoose('const n = await Order.count({});');
    assert.ok(modified.includes('.countDocuments('));
    assert.strictEqual(replacements[0].ruleId, 'mongoose/model-count');
  });

  test('13. mongoose/callback-query: find(filter, fn) transformed', () => {
    const src = "Order.find({ name: 'x' }, function (err, docs) { console.log(docs); });";
    const { modified, replacements } = applyMongoose(src);
    // The pattern matches — replacement is "await .find("
    assert.ok(replacements.some(r => r.ruleId === 'mongoose/callback-query'), 'callback-query fires');
  });

  test('14. mongoose/callback-exec: .exec(function → transformed', () => {
    const src = "Order.find({}).exec(function (err, docs) { cb(err, docs); });";
    const { replacements } = applyMongoose(src);
    assert.ok(replacements.some(r => r.ruleId === 'mongoose/callback-exec'), 'callback-exec fires');
  });

  test('15. mongoose/find-one-and-update-callback: callback form transformed', () => {
    const src = "Order.findOneAndUpdate({ a: 1 }, { $set: { b: 2 } }, function (err, doc) {});";
    const { replacements } = applyMongoose(src);
    assert.ok(
      replacements.some(r => r.ruleId === 'mongoose/find-one-and-update-callback'),
      'findOneAndUpdate-callback fires'
    );
  });

  test('16. mongoose fixture: all 5 rules fire', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'mongoose-legacy.js'), 'utf8');
    const { replacements } = applyMongoose(src);
    const ids = [...new Set(replacements.map(r => r.ruleId))];
    assert.ok(ids.includes('mongoose/model-update'),                 'model-update');
    assert.ok(ids.includes('mongoose/model-count'),                  'model-count');
    assert.ok(ids.includes('mongoose/callback-query'),               'callback-query');
    assert.ok(ids.includes('mongoose/callback-exec'),                'callback-exec');
    assert.ok(ids.includes('mongoose/find-one-and-update-callback'), 'findOneAndUpdate-callback');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// JEST TRANSFORMS
// ─────────────────────────────────────────────────────────────────────────────

describe('jest transforms', () => {

  test('17. jest/set-timeout: jest.setTimeout( → replacement comment', () => {
    const { replacements } = applyJest('jest.setTimeout(10000);');
    assert.ok(replacements.some(r => r.ruleId === 'jest/set-timeout'), 'set-timeout fires');
    assert.strictEqual(replacements[0].line, 1);
  });

  test('18. jest/jasmine-globals: jasmine. → jest.', () => {
    const { modified, replacements } = applyJest('const spy = jasmine.createSpy();');
    assert.ok(modified.includes('jest.createSpy'), 'jasmine → jest');
    assert.strictEqual(replacements[0].ruleId, 'jest/jasmine-globals');
  });

  test('19. jest fixture: both set-timeout and jasmine-globals fire', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'jest-legacy.js'), 'utf8');
    const { replacements } = applyJest(src);
    const ids = [...new Set(replacements.map(r => r.ruleId))];
    assert.ok(ids.includes('jest/set-timeout'),     'set-timeout fires');
    assert.ok(ids.includes('jest/jasmine-globals'), 'jasmine-globals fires');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED DIFF
// ─────────────────────────────────────────────────────────────────────────────

describe('unifiedDiff', () => {

  test('20. unifiedDiff(): returns empty string for identical files', () => {
    const src = 'line one\nline two\n';
    assert.strictEqual(unifiedDiff('test.js', src, src), '');
  });

  test('21. unifiedDiff(): contains --- and +++ headers for changed content', () => {
    const old = 'app.del(\'/path\', h);\n';
    const nw  = 'app.delete(\'/path\', h);\n';
    const diff = unifiedDiff('app.js', old, nw);
    assert.ok(diff.includes('--- a/app.js'), 'has --- header');
    assert.ok(diff.includes('+++ b/app.js'), 'has +++ header');
    assert.ok(diff.includes('@@'),           'has hunk header');
  });

  test('22. unifiedDiff(): shows -old and +new lines', () => {
    const old = "res.send(404);\n";
    const nw  = "res.sendStatus(404);\n";
    const diff = unifiedDiff('routes.js', old, nw);
    assert.ok(diff.includes('-res.send(404);'),       '-old line present');
    assert.ok(diff.includes('+res.sendStatus(404);'), '+new line present');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// FULL APPLY — DRY-RUN
// ─────────────────────────────────────────────────────────────────────────────

describe('apply() dry-run on fixtures directory', () => {

  // Snapshot mtimes before the run to verify no source files are touched
  function snapshotMtimes(dir) {
    const snap = new Map();
    function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else snap.set(fp, fs.statSync(fp).mtimeMs);
      }
    }
    walk(dir);
    return snap;
  }

  // Minimal plan shape the codemoder expects
  const fakePlan = {
    packages: [
      { package: 'express' },
      { package: 'mongoose' },
      { package: 'jest' },
    ],
  };

  test('23. apply() dry-run: writes zero source files', async () => {
    const out    = tmpDir();
    const before = snapshotMtimes(FIXTURES);
    await apply({ targetPath: FIXTURES, dryRun: true, verbose: false, outDir: out }, fakePlan);
    const after  = snapshotMtimes(FIXTURES);

    for (const [fp, mtime] of before) {
      assert.strictEqual(after.get(fp), mtime, `${path.basename(fp)} mtime changed (file was written!)`);
    }
  });

  test('24. apply() dry-run: codemod-log.json is created with replacements', async () => {
    const out = tmpDir();
    const result = await apply(
      { targetPath: FIXTURES, dryRun: true, verbose: false, outDir: out },
      fakePlan
    );
    assert.ok(fs.existsSync(result.logPath),    'log file exists');
    const log = JSON.parse(fs.readFileSync(result.logPath, 'utf8'));
    assert.ok(log.dryRun === true,              'log.dryRun is true');
    assert.ok(Array.isArray(log.replacements),  'log.replacements is array');
    assert.ok(log.totalReplacements > 0,        `totalReplacements > 0 (got ${log.totalReplacements})`);
    assert.ok(log.replacements.every(r =>
      r.ruleId && r.file && typeof r.line === 'number' && r.before && r.after
    ), 'every replacement has ruleId, file, line, before, after');
  });

  test('25. apply() dry-run: 3 patch files created for express, mongoose, jest', async () => {
    const out = tmpDir();
    const result = await apply(
      { targetPath: FIXTURES, dryRun: true, verbose: false, outDir: out },
      fakePlan
    );
    const expectedPatches = ['express.patch', 'mongoose.patch', 'jest.patch'];
    for (const patchName of expectedPatches) {
      const patchPath = path.join(result.diffDir, patchName);
      assert.ok(fs.existsSync(patchPath), `${patchName} exists`);
    }

    // express and mongoose patches must be non-empty (fixtures have breaking patterns)
    const expressPatch  = fs.readFileSync(path.join(result.diffDir, 'express.patch'),  'utf8');
    const mongoosePatch = fs.readFileSync(path.join(result.diffDir, 'mongoose.patch'), 'utf8');
    assert.ok(expressPatch.length  > 0, 'express.patch is non-empty');
    assert.ok(mongoosePatch.length > 0, 'mongoose.patch is non-empty');
  });

});
