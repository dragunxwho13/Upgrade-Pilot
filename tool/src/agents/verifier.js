/**
 * verifier.js — Test Suite Verifier Agent
 *
 * Interface:
 *   verifier.verify(ctx, codemodeResult) → Promise<Verdict>
 *
 * Verdict: {
 *   passed: boolean,
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 *   testSummary: string,           // e.g. "12 passed, 0 failed"
 *   codemodeResult: CodemodeResult,
 * }
 *
 * ctx:           { targetPath, dryRun, verbose }
 * codemodeResult: CodemodeResult from codemoder.apply()
 *
 * Behaviour:
 * - Spawns `npm test` inside ctx.targetPath and captures stdout/stderr.
 * - Parses common test runner output to extract a summary line.
 * - In dryRun mode, skips execution and returns a synthetic verdict.
 */

import { spawnSync } from 'child_process';

/**
 * Parse test runner output into a brief summary string.
 * Handles Jest, Mocha, and generic "X passing / Y failing" formats.
 */
function parseSummary(output) {
  // Jest: "Tests: 12 passed, 12 total"
  const jestMatch = output.match(/Tests?:\s*(.*?)\n/);
  if (jestMatch) return jestMatch[1].trim();

  // Mocha: "12 passing"
  const mochaMatch = output.match(/(\d+)\s+passing/);
  if (mochaMatch) return `${mochaMatch[1]} passing`;

  // Tap / generic
  const tapMatch = output.match(/(ok|not ok)\s+\d+/g);
  if (tapMatch) {
    const ok    = tapMatch.filter(l => l.startsWith('ok')).length;
    const notOk = tapMatch.filter(l => l.startsWith('not ok')).length;
    return `${ok} passed, ${notOk} failed`;
  }

  return 'see stdout for details';
}

async function verify(ctx, codemodeResult) {
  if (ctx.dryRun) {
    return {
      passed:         true,
      exitCode:       0,
      stdout:         '',
      stderr:         '',
      testSummary:    '[dry-run] Tests not executed.',
      codemodeResult,
    };
  }

  const result = spawnSync('npm', ['test'], {
    cwd:      ctx.targetPath,
    encoding: 'utf8',
    timeout:  120_000,
    shell:    true,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const exitCode = result.status ?? 1;

  return {
    passed:         exitCode === 0,
    exitCode,
    stdout,
    stderr,
    testSummary:    parseSummary(stdout + stderr),
    codemodeResult,
  };
}

export const verifier = { verify };
