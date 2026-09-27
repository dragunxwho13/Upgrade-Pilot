# UpgradePilot

> **AI-powered agentic co-pilot that scans, plans, applies, and verifies dependency upgrades — fully automated, diff-reviewed, and test-gated. Supports Node.js and Python projects.**

Built live with **IBM Bob 2.0** during a hackathon: six named task sessions, 67 unit tests, a complete Express 4→5 / Mongoose 6→7 Node.js migration, and a Python Flask 2→3 generalization — both pipelines proven end-to-end with `upgradepilot demo`.

---

## Architecture

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 320" width="780" height="320" font-family="-apple-system,Segoe UI,system-ui,sans-serif" font-size="13">
  <!-- Background -->
  <rect width="780" height="320" fill="#f7f8fa" rx="10"/>

  <!-- Title -->
  <text x="390" y="28" text-anchor="middle" font-size="15" font-weight="700" fill="#1f2328">UpgradePilot — Six-Agent Pipeline</text>

  <!-- CLI box -->
  <rect x="10" y="50" width="120" height="44" rx="6" fill="#1f2328"/>
  <text x="70" y="67" text-anchor="middle" fill="#fff" font-weight="600">cli.js</text>
  <text x="70" y="84" text-anchor="middle" fill="#9ca3af" font-size="11">entry point</text>

  <!-- Arrow CLI → Scanner -->
  <line x1="130" y1="72" x2="160" y2="72" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Scanner -->
  <rect x="160" y="50" width="130" height="44" rx="6" fill="#3b82d4"/>
  <text x="225" y="67" text-anchor="middle" fill="#fff" font-weight="600">scanner.js</text>
  <text x="225" y="84" text-anchor="middle" fill="#dbeafe" font-size="11">glob · match · risk</text>

  <!-- Arrow Scanner → Librarian -->
  <line x1="290" y1="72" x2="320" y2="72" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Librarian -->
  <rect x="320" y="50" width="130" height="44" rx="6" fill="#3b82d4"/>
  <text x="385" y="67" text-anchor="middle" fill="#fff" font-weight="600">librarian.js</text>
  <text x="385" y="84" text-anchor="middle" fill="#dbeafe" font-size="11">changelogs · guides</text>

  <!-- Arrow Librarian → Planner -->
  <line x1="450" y1="72" x2="480" y2="72" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Planner -->
  <rect x="480" y="50" width="130" height="44" rx="6" fill="#7c5cd8"/>
  <text x="545" y="67" text-anchor="middle" fill="#fff" font-weight="600">planner.js</text>
  <text x="545" y="84" text-anchor="middle" fill="#ede9fe" font-size="11">order · risk · time</text>

  <!-- Arrow row 1 down to row 2 -->
  <line x1="545" y1="94" x2="545" y2="130" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="545" y1="94" x2="385" y2="130" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="545" y1="94" x2="225" y2="130" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Row 2: Codemoder, Verifier, Scribe -->
  <!-- Codemoder -->
  <rect x="80" y="130" width="140" height="56" rx="6" fill="#1f2328"/>
  <text x="150" y="150" text-anchor="middle" fill="#fff" font-weight="600">codemoder.js</text>
  <text x="150" y="166" text-anchor="middle" fill="#9ca3af" font-size="11">parallel crew</text>
  <text x="150" y="180" text-anchor="middle" fill="#9ca3af" font-size="10">node · python</text>

  <!-- Verifier -->
  <rect x="315" y="130" width="140" height="56" rx="6" fill="#1f2328"/>
  <text x="385" y="150" text-anchor="middle" fill="#fff" font-weight="600">verifier.js</text>
  <text x="385" y="166" text-anchor="middle" fill="#9ca3af" font-size="11">install · test · fix</text>
  <text x="385" y="180" text-anchor="middle" fill="#9ca3af" font-size="10">up to 3 fix cycles</text>

  <!-- Scribe -->
  <rect x="550" y="130" width="140" height="56" rx="6" fill="#1f2328"/>
  <text x="620" y="150" text-anchor="middle" fill="#fff" font-weight="600">scribe.js</text>
  <text x="620" y="166" text-anchor="middle" fill="#9ca3af" font-size="11">reports · diffs</text>
  <text x="620" y="180" text-anchor="middle" fill="#9ca3af" font-size="10">Markdown · JSON</text>

  <!-- Arrows down to outputs -->
  <line x1="150" y1="186" x2="150" y2="222" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="385" y1="186" x2="385" y2="222" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="620" y1="186" x2="620" y2="222" stroke="#e5e7eb" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Output boxes -->
  <rect x="60" y="222" width="182" height="38" rx="5" fill="#fff" stroke="#e5e7eb"/>
  <text x="151" y="236" text-anchor="middle" fill="#57606a" font-size="11">tool/out/diffs/</text>
  <text x="151" y="252" text-anchor="middle" fill="#57606a" font-size="11">codemod-log.json</text>

  <rect x="295" y="222" width="182" height="38" rx="5" fill="#fff" stroke="#e5e7eb"/>
  <text x="386" y="236" text-anchor="middle" fill="#57606a" font-size="11">verification.json</text>
  <text x="386" y="252" text-anchor="middle" fill="#57606a" font-size="11">12/12 tests ✓ new majors</text>

  <rect x="530" y="222" width="182" height="38" rx="5" fill="#fff" stroke="#e5e7eb"/>
  <text x="621" y="236" text-anchor="middle" fill="#57606a" font-size="11">migration-plan.json</text>
  <text x="621" y="252" text-anchor="middle" fill="#57606a" font-size="11">MIGRATION_PLAN.md</text>

  <!-- data/breaking-changes.json feeds both scanner and codemoder -->
  <rect x="230" y="272" width="200" height="34" rx="5" fill="#fef3c7" stroke="#fbbf24"/>
  <text x="330" y="286" text-anchor="middle" fill="#92400e" font-size="11" font-weight="600">data/breaking-changes.json</text>
  <text x="330" y="300" text-anchor="middle" fill="#92400e" font-size="10">18 rules · 5 packages · node + python</text>
  <line x1="330" y1="272" x2="225" y2="186" stroke="#fbbf24" stroke-width="1" stroke-dasharray="4 3"/>
  <line x1="330" y1="272" x2="150" y2="186" stroke="#fbbf24" stroke-width="1" stroke-dasharray="4 3"/>

  <!-- Arrow marker -->
  <defs>
    <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L7,3.5 z" fill="#e5e7eb"/>
    </marker>
  </defs>
</svg>
```

---

## Quickstart

### Prerequisites
- **Node.js ≥ 18** · **npm ≥ 9**
- **Python ≥ 3.9** · **pip** (for the Python sample app)

```bash
# Clone and install
git clone https://github.com/your-org/upgradepilot.git
cd upgradepilot
npm install

# Confirm the CLI works
node tool/cli.js --help
```

### Run the full pipeline against both included legacy apps

```bash
# One-shot demo — runs both apps, prints reports for each ecosystem
node tool/cli.js demo

# Node.js app only (Acme Orders API — Express 4→5, Mongoose 6→7)
node tool/cli.js scan --path ./sample-app
node tool/cli.js plan --path ./sample-app
node tool/cli.js run  --path ./sample-app --dry-run

# Python app only (Acme Inventory API — Flask 2→3, requests 2.28→2.32)
node tool/cli.js scan --path ./sample-app2
node tool/cli.js plan --path ./sample-app2
node tool/cli.js run  --path ./sample-app2 --dry-run
```

### Run the unit test suites

```bash
# tool/ — 67 unit tests (scanner + codemoder + python-scanner) — Node 18 native runner
cd tool && npm test

# sample-app/ — 12 supertest integration tests on Express 5 + Mongoose 7 + Jest 29
cd sample-app && npm test

# sample-app2/ — 12 pytest integration tests on Flask 2.3.x + requests 2.28.x
cd sample-app2 && python -m pytest test_app.py -v
```

---

## CLI subcommands

| Subcommand | What it does | Key output |
|------------|-------------|------------|
| `scan`     | Auto-detect ecosystem (Node/Python), match 18 breaking-change rules, score risk | `tool/out/usage-map.json` |
| `plan`     | Build ordered upgrade plan with effort estimates | `tool/out/migration-plan.json` + `MIGRATION_PLAN.md` |
| `run`      | Parallel codemod crew (Promise.all per package), ecosystem-aware file collection | `tool/out/diffs/<pkg>.patch` + `codemod-log.json` |
| `report`   | Render Markdown or JSON upgrade summary | stdout / file |
| `demo`     | Run the full pipeline on **both** built-in sample apps (Node.js + Python) | all of the above |

**Flags available on all subcommands:**

```
--path <dir>     Target project directory (default: cwd)
--dry-run        Record diffs and log; write no source files
--json           Emit JSON to stdout
--pretty         Pretty-print JSON output
--out <file>     Write output to specific file
--verbose        Detailed agent logging to stderr
```

---

## Monorepo layout

```
upgradepilot/
├── tool/
│   ├── cli.js                     # Entry point — subcommand dispatch
│   ├── data/
│   │   ├── breaking-changes.json  # 18 rules × 5 packages (node + python) with severity weights
│   │   └── flask-3-migration.md   # Librarian corpus — Flask 2→3 migration guide
│   ├── out/                       # Generated artefacts (gitignored)
│   │   ├── usage-map.json
│   │   ├── migration-plan.json
│   │   ├── MIGRATION_PLAN.md
│   │   ├── codemod-log.json
│   │   ├── verification.json
│   │   └── diffs/
│   ├── src/agents/
│   │   ├── scanner.js             # Multi-ecosystem: Node (.js) + Python (.py + requirements.txt)
│   │   ├── librarian.js           # express, mongoose, jest, flask, requests knowledge base
│   │   ├── planner.js
│   │   ├── codemoder.js           # Ecosystem-aware file collection
│   │   ├── verifier.js
│   │   └── scribe.js
│   └── tests/
│       ├── fixtures/              # Legacy JS + Python fixture files for unit tests
│       ├── scanner.test.mjs       # 20 tests (Node scanner)
│       ├── codemoder.test.mjs     # 25 tests (codemod crew)
│       └── python-scanner.test.mjs # 22 tests (Python ecosystem)
├── sample-app/                    # "Acme Orders API" — Node.js, Express 5 + Mongoose 7
├── sample-app2/                   # "Acme Inventory API" — Python, Flask 2.3.x + requests 2.28.x
│   ├── app.py                     # 6 deliberate breaking patterns (flask/escape, Markup, etc.)
│   ├── requirements.txt           # Pinned to Flask==2.3.3, requests==2.28.2
│   ├── test_app.py                # 12 pytest integration tests — 12/12 pass
│   └── conftest.py
├── docs/
│   ├── ARCHITECTURE.md            # LLM delegation design (watsonx.ai Granite)
│   └── DEMO-SCRIPT.md             # Exact commands for the 3-minute demo video
└── ibm-bob-evidence/              # Bob 2.0 task session screenshots
```

---

## Metrics

### Node.js pipeline — Acme Orders API (Express 4→5, Mongoose 6→7, Jest 27→29)

| Metric | Baseline (manual) | UpgradePilot |
|--------|:-----------------:|:------------:|
| Breaking patterns found | manual grep | **53 hits, 8 rules** |
| Upgrade plan generated | ~2 h | **< 1 s** |
| Estimated manual migration time | **1,208 min (~20 h)** | — |
| Automated migration time | — | **228 min (~4 h)** |
| **Time saved** | — | **980 min (81%)** |
| Fix cycles needed | n/a | **0** |
| Tests passing on new majors | — | **12 / 12** |
| Legacy source hits after upgrade | — | **0** |

### Python pipeline — Acme Inventory API (Flask 2→3, requests 2.28→2.32)

| Metric | Value |
|--------|-------|
| Breaking patterns found | **13 hits, 6 rules** |
| Packages flagged | **flask** (high risk, score 66/100) · **requests** (low risk, score 13/100) |
| Estimated manual migration | **216 min** |
| Estimated pilot migration | **41 min** |
| **Time saved** | **175 min (81%)** |
| Tests on legacy version (Flask 2.3.x) | **12 / 12** |

### Tool test suite

| Suite | Tests |
|-------|-------|
| `scanner.test.mjs` — Node scanner | **20 / 20** |
| `codemoder.test.mjs` — codemod crew | **25 / 25** |
| `python-scanner.test.mjs` — Python ecosystem | **22 / 22** |
| **Total** | **67 / 67** |

---

## How IBM Bob 2.0 built this

This entire project was scaffolded and implemented across **six named task sessions** using **IBM Bob 2.0** in Agent mode. Each session had a declared Definition of Done that was verified before closing.

| # | Task Session | Bob Delivered | DoD |
|---|-------------|---------------|-----|
| 1 | **Scaffold: UpgradePilot monorepo + legacy sample app** | Monorepo, CLI skeleton with 6 agent stubs, Acme Orders API with every breaking pattern, 12 passing supertest tests | `npm test` 12/12 on legacy deps; `--help` prints without crash |
| 2 | **Scanner: usage map and risk scoring** | Full source scanner (glob, regex, line-level hits), `breaking-changes.json` rule DB, `usage-map.json`, 20 unit tests | ≥ 8 distinct rules with file:line hits; scanner tests pass |
| 3 | **Planner: risk-scored migration plan** | `buildPlan()` with occurrence×severity×proximity formula, safe upgrade ordering, effort estimates, Markdown renderer, `docs/ARCHITECTURE.md` LLM delegation design | `migration-plan.json` + `MIGRATION_PLAN.md` generated; times on every step |
| 4 | **Codemod Crew: parallel per-package migrations** | `Promise.all` worker-per-package architecture, pure-JS unified differ, `codemod-log.json`, 3 patch files, 25 unit tests | dry-run produces 3 patches + log with 0 file writes; tests pass |
| 5 | **Verifier: tests to green** | Real-mode verifier (bump → install → test → fix-cycle), dry-run scanner mode, `verification.json`, full Express 5 + Mongoose 7 migration | 12/12 tests green on new majors; dry-run shows 0 legacy source hits |
| 6 | **Submission polish** | Root README rewritten, CI workflow (`.github/workflows/ci.yml`), demo script (`docs/DEMO-SCRIPT.md`), evidence folder | CI green; demo script complete |
| 7 | **Stretch: Python pipeline generalization** | `sample-app2/` Flask 2.3.x app with 6 breaking patterns + 12 pytest tests, Flask/requests rules added to `breaking-changes.json`, scanner/codemoder/librarian extended for Python ecosystem, 22 new Python unit tests, demo runs both apps | `node tool/cli.js demo` outputs reports for both ecosystems; 67/67 tests pass |

All sessions ran with `--verbose` logging; screenshots are in [`ibm-bob-evidence/`](ibm-bob-evidence/README.md).

---

## Contributing

Pull requests welcome. Before opening a PR:

```bash
cd tool && npm test                                          # must be 67/67
cd sample-app && npm test                                    # must be 12/12
cd sample-app2 && python -m pytest test_app.py -v           # must be 12/12
node tool/cli.js demo                                        # must print both reports
```

---

## Security

This repository is **public**. Never commit:
- `.env` files or any file containing credentials
- API keys, tokens, or private keys
- Certificates (`.pem`, `.key`, `.p12`)

See [`.gitignore`](.gitignore) for the full exclusion list.

---

## License

MIT
