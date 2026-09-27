/**
 * librarian.js — Changelog & Migration Guide Librarian Agent
 *
 * Interface:
 *   librarian.fetchNotes(ctx, scanResult) → Promise<NoteMap>
 *
 * NoteMap: {
 *   [depName: string]: ReleaseNote
 * }
 *
 * ReleaseNote: {
 *   name: string,
 *   currentVersion: string,
 *   breakingSummary: string,       // short prose of breaking changes
 *   migrationSteps: string[],      // ordered action items
 *   references: string[],          // URLs to changelogs / guides
 * }
 *
 * ctx:        { targetPath, dryRun, verbose }
 * scanResult: ScanResult returned by scanner.scan()
 *
 * Note: Content is hard-coded knowledge for the hackathon demo. In production
 * replace the MIGRATION_DB entries with live fetches from GitHub releases,
 * npm changelogs, or an LLM-powered retrieval pipeline.
 */

// ─── Embedded migration knowledge base ───────────────────────────────────────
// Node.js ecosystem entries
const MIGRATION_DB = {
  express: {
    breakingSummary: 'Express 5 removes several deprecated APIs from v4: app.del(), res.send(number), req.param(), and changes wildcard route matching.',
    migrationSteps: [
      'Replace app.del(path, handler) with app.delete(path, handler)',
      'Replace res.send(statusCode) with res.sendStatus(statusCode) or res.status(code).send()',
      'Replace req.param(name) with req.params.name, req.query.name, or req.body.name',
      'Update wildcard routes: app.get("*") → app.get("/{*splat}", handler) or app.get("*splat", handler)',
      'Run `npx @expressjs/codemod upgrade` to automate most changes',
    ],
    references: [
      'https://expressjs.com/en/guide/migrating-5.html',
      'https://github.com/expressjs/express/blob/5.x/History.md',
    ],
  },
  mongoose: {
    breakingSummary: 'Mongoose 7 removes callback-style API, Model.update(), Model.count(), and several other deprecated methods.',
    migrationSteps: [
      'Replace Model.update(filter, update, cb) with await Model.updateOne(filter, update)',
      'Replace Model.count(filter) with await Model.countDocuments(filter)',
      'Replace all callback-style queries with async/await or .then()',
      'Replace Model.findOneAndUpdate() callback with async version',
      'Review all .exec(callback) calls — remove callbacks, use await instead',
    ],
    references: [
      'https://mongoosejs.com/docs/migrating_to_7.html',
      'https://github.com/Automattic/mongoose/blob/master/CHANGELOG.md',
    ],
  },
  jest: {
    breakingSummary: 'Jest 28/29 switches to jest-circus by default, removes some globals, and tightens TypeScript types.',
    migrationSteps: [
      'Remove explicit testRunner: "jest-jasmine2" if set',
      'Update snapshot serializers if using custom ones',
      'Replace jest.setTimeout() calls at top level with testTimeout in config',
    ],
    references: [
      'https://jestjs.io/docs/upgrading-to-jest28',
      'https://jestjs.io/docs/upgrading-to-jest29',
    ],
  },

  // ── Python ecosystem entries ───────────────────────────────────────────────
  flask: {
    breakingSummary: 'Flask 3.0 removes flask.escape, flask.Markup, several legacy config keys (JSON_SORT_KEYS, JSONIFY_PRETTYPRINT_REGULAR), and the FLASK_ENV environment variable.',
    migrationSteps: [
      'Replace `from flask import escape` with `from markupsafe import escape`',
      'Replace `from flask import Markup` with `from markupsafe import Markup`',
      'Remove app.config[\'JSON_SORT_KEYS\'] — configure via app.json_provider_class instead',
      'Remove app.config[\'JSONIFY_PRETTYPRINT_REGULAR\'] — use DefaultJSONProvider',
      'Replace FLASK_ENV environment variable with FLASK_DEBUG or app.config[\'DEBUG\']',
      'See flask-3-migration.md in tool/data/ for the full corpus of changes',
    ],
    references: [
      'https://flask.palletsprojects.com/en/3.0.x/changes/',
      'https://flask.palletsprojects.com/en/3.0.x/upgrading/',
      'tool/data/flask-3-migration.md',
    ],
  },
  requests: {
    breakingSummary: 'The requests.packages.urllib3 private shim was removed — import urllib3 directly.',
    migrationSteps: [
      'Replace `from requests.packages import urllib3` with `import urllib3`',
      'Replace `requests.packages.urllib3.disable_warnings()` with `urllib3.disable_warnings()`',
    ],
    references: [
      'https://docs.python-requests.org/en/latest/community/updates/',
      'https://github.com/psf/requests/blob/main/HISTORY.md',
    ],
  },
};

/**
 * Build a ReleaseNote for a single breaking dep.
 */
function buildNote(dep) {
  const db = MIGRATION_DB[dep.name];
  if (db) {
    return {
      name:            dep.name,
      currentVersion:  dep.current,
      breakingSummary: db.breakingSummary,
      migrationSteps:  db.migrationSteps,
      references:      db.references,
    };
  }
  // Generic fallback for unknown packages
  return {
    name:            dep.name,
    currentVersion:  dep.current,
    breakingSummary: dep.reason || 'Breaking changes detected — consult the changelog.',
    migrationSteps:  ['Review the package changelog and migrate manually.'],
    references:      dep.migrationGuideUrl ? [dep.migrationGuideUrl] : [],
  };
}

async function fetchNotes(ctx, scanResult) {
  const noteMap = {};
  for (const dep of scanResult.breaking) {
    noteMap[dep.name] = buildNote(dep);
  }
  return noteMap;
}

export const librarian = { fetchNotes };
