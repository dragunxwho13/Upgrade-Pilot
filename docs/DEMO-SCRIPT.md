# UpgradePilot — 3-Minute Demo Script

> **On-camera walkthrough.** Every command is copy-pasteable. Expected output highlights are shown inline. Total runtime: ~3 minutes.

---

## Setup (before you hit record)

```bash
# Make sure you are in the repo root
cd /path/to/upgradepilot

# Confirm Node version
node --version   # must be ≥ 18

# Install (if you haven't already)
npm install

# Confirm tool deps are in place
cd tool && npm install && cd ..
```

---

## Scene 1 — Help (0:00 – 0:15)

```bash
node tool/cli.js --help
```

**Expected output highlight:**
```
UpgradePilot v0.1.0
AI-powered dependency upgrade co-pilot for Node.js projects.

Subcommands:
  scan    Detect outdated / breaking dependencies + source usage map
  plan    Generate an upgrade plan with risk scores
  run     Apply codemods and bump versions
  report  Emit a Markdown or JSON upgrade report
  demo    Run the full pipeline on the built-in sample-app
```

*Talking point: "One CLI, five subcommands, six agents — all written by IBM Bob 2.0."*

---

## Scene 2 — Scan (0:15 – 0:45)

```bash
node tool/cli.js scan --path ./sample-app
```

**Expected output highlight (stderr):**
```
🔍 Scanning .../sample-app …

Summary: Found 53 hit(s) across 8 rule(s) in 6 file(s). Packages affected: express, mongoose.

Rule                                    Pkg         Hits  Sev  Risk
──────────────────────────────────────────────────────────────────────
express/res-send-status                 express     10    3    30
mongoose/model-update                   mongoose    10    3    30
mongoose/model-count                    mongoose    9     3    27
express/app-del                         express     8     3    24
...
```

*Talking point: "The scanner globs all JS files, applies 11 regex rules from `breaking-changes.json`, and produces a risk score per rule: occurrences × severity × proximity-to-test-code."*

**Saved artefact:**
```
[scan] Saved → tool/out/usage-map.json
```

---

## Scene 3 — Plan (0:45 – 1:15)

```bash
node tool/cli.js plan --path ./sample-app
```

**Expected output highlight:**
```markdown
## Summary

| # | Package  | From     | To       | Type | Risk       | Affected Files | Manual (min) | Pilot (min) |
|---|----------|----------|----------|------|------------|----------------|-------------|-------------|
| 1 | `jest`   | `27.5.1` | `^29.0.0`| dev  | 🟢 low     | 0              | 0           | 0           |
| 2 | `express`| `4.18.2` | `^5.0.0` | prod | 🔴 high    | 3              | 712         | 134         |
| 3 | `mongoose`| `6.12.3`| `^7.0.0` | prod | 🔴 high    | 3              | 496         | 94          |

## Estimated Time Savings

| Metric | Value |
|--------|-------|
| Manual migration | **1208 min** (≈ 21 h) |
| With UpgradePilot | **228 min** (≈ 4 h) |
| **Time saved** | **980 min (81%)** |
```

*Talking point: "Safe ordering — dev dependencies first, prod by ascending risk. Every step has per-rule effort estimates. This plan could be delegated to IBM watsonx.ai Granite — see `docs/ARCHITECTURE.md`."*

**Saved artefacts:**
```
[plan] Saved JSON → tool/out/migration-plan.json
[plan] Saved MD   → tool/out/MIGRATION_PLAN.md
```

---

## Scene 4 — Codemod dry-run (1:15 – 1:50)

```bash
node tool/cli.js run --path ./sample-app --dry-run
```

**Expected output highlight (stderr):**
```
⚙️  Running upgrade pipeline on .../sample-app [dry-run] …
[codemod-crew] jest ✓ 0 replacements | express ✓ 26 replacements | mongoose ✓ 21 replacements

[dry-run] 47 replacement(s) across 3 package(s) — no files written.
Diffs  → tool/out/diffs
Log    → tool/out/codemod-log.json
```

*Talking point: "Three workers ran in parallel via `Promise.all`. Each worker only touches its own package's APIs. Diffs are pure-JS unified patches — compatible with `git apply`. No files were written because of `--dry-run`."*

**Inspect the express patch:**
```bash
head -30 tool/out/diffs/express.patch
```

Expected highlight:
```diff
--- a/src/app.js
+++ b/src/app.js
@@ -35,7 +35,7 @@
-  app.del('/legacy/delete-order/:id', async (req, res) => {
+  app.delete('/legacy/delete-order/:id', async (req, res) => {
```

---

## Scene 5 — Tests green on new majors (1:50 – 2:30)

```bash
cd sample-app && npm test
```

**Expected output highlight:**
```
PASS tests/orders.test.js
  √ 1. GET /health returns 200 and status ok
  √ 2. GET /orders returns empty array when no orders exist
  √ 3. POST /orders creates a new order and returns 201
  √ 4. POST /orders returns 400 when required fields are missing
  √ 5. GET /orders/:id returns the correct order (exercises req.param())
  √ 6. GET /orders/:id returns 404 for a non-existent ID (legacy res.send(404))
  √ 7. PUT /orders/:id updates an order and returns the new document
  √ 8. PATCH /orders/:id/status updates status via legacy Model.update()
  √ 9. GET /orders/meta/count returns correct total via legacy Model.count()
  √ 10. GET /orders/customer/:name returns orders by customer (legacy callback query)
  √ 11. DELETE /legacy/delete-order/:id works via legacy app.del() route
  √ 12. GET on unknown route returns 404 via legacy app.get("*") wildcard

Tests:       12 passed, 12 total
```

*Talking point: "Express 5, Mongoose 7, Jest 29 — 12/12, zero fix cycles, no manual edits."*

```bash
cd ..
```

---

## Scene 6 — Tool unit tests (2:30 – 2:50)

```bash
cd tool && npm test
```

**Expected output highlight:**
```
✔ 1. loadRules() returns an object with a packages array
✔ 2. buildFlatRules() produces one entry per rule across all packages
...
✔ 25. apply() dry-run: 3 patch files created for express, mongoose, jest

ℹ tests 45
ℹ pass  45
ℹ fail  0
```

*Talking point: "45 unit tests covering the scanner and codemod crew — run with Node's built-in test runner, zero extra test dependencies."*

```bash
cd ..
```

---

## Scene 7 — Verification artefact (2:50 – 3:00)

```bash
node -e "const v=require('./tool/out/verification.json'); console.log(JSON.stringify({passed:v.passed,testCounts:v.testCounts,fixCycles:v.fixCycles,mode:v.mode},null,2))"
```

**Expected output:**
```json
{
  "passed": true,
  "testCounts": {
    "passed": 12,
    "failed": 0,
    "total": 12
  },
  "fixCycles": 0,
  "mode": "real"
}
```

*Closing line: "From 53 legacy-pattern hits to 12/12 green in one pipeline run. UpgradePilot — built with IBM Bob 2.0."*

---

## Backup / fallback commands

If anything fails on camera, these always work:

```bash
# Re-run scan only (read-only, always safe)
node tool/cli.js scan --path ./sample-app

# Show the saved migration plan
cat tool/out/MIGRATION_PLAN.md

# Show the verification result
cat tool/out/verification.json
```

---

## Tips

- Run `npm install` in both `tool/` and `sample-app/` before recording.
- Use a terminal with a dark theme and 14pt font for readability.
- Keep the repo root as the working directory for Scenes 1–4 and 7.
- The `demo` subcommand (`node tool/cli.js demo`) runs the full pipeline in one shot if you prefer a single command for the video.
