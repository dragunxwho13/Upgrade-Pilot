# UpgradePilot — Architecture & LLM Delegation Design

> **Session:** Planner — risk-scored migration plan  
> **Last updated:** see git log

---

## 1. Repository Layout

```
upgradepilot/
├── tool/                         # CLI workspace
│   ├── cli.js                    # Entry point — subcommand dispatch
│   ├── data/
│   │   └── breaking-changes.json # Rule database with severity weights
│   ├── out/                      # Generated artefacts (git-ignored in CI)
│   │   ├── usage-map.json        # Scanner output
│   │   ├── migration-plan.json   # Planner output (JSON)
│   │   └── MIGRATION_PLAN.md     # Planner output (Markdown)
│   ├── src/agents/               # Six independent agent modules
│   │   ├── scanner.js            # Glob + pattern-match → usage-map
│   │   ├── librarian.js          # Fetch migration notes / changelogs
│   │   ├── planner.js            # Risk-score + build migration plan ← THIS DOC
│   │   ├── codemoder.js          # Apply AST/regex codemods
│   │   ├── verifier.js           # Run test suite, capture verdict
│   │   └── scribe.js             # Render & persist reports
│   └── tests/
│       ├── fixtures/             # Tiny legacy JS files for unit tests
│       └── scanner.test.mjs      # 20 unit tests (node:test)
└── sample-app/                   # Acme Orders API — legacy Express 4 / Mongoose 6
    ├── src/
    └── tests/                    # 12 supertest integration tests
```

---

## 2. Agent Pipeline

```
             ┌──────────┐   ScanResult    ┌───────────┐   NoteMap
  targetPath │ scanner  │ ─────────────► │ librarian │ ──────────►
             └──────────┘                └───────────┘            │
                                                                   ▼
                                                          ┌──────────────┐
                                                          │   planner    │
                                                          └──────┬───────┘
                                                                 │ MigrationPlan
                                                    ┌────────────┼────────────┐
                                                    ▼            ▼            ▼
                                              codemoder       verifier      scribe
                                           (apply fixes)   (run tests)   (reports)
```

Each agent is a **pure function module** that exports a single primary function:

| Agent | Export | Input | Output |
|-------|--------|-------|--------|
| `scanner`  | `scan(ctx)`                        | `ctx`                        | `ScanResult`     |
| `librarian`| `fetchNotes(ctx, scanResult)`      | `ctx`, `ScanResult`          | `NoteMap`        |
| `planner`  | `buildPlan(ctx, scanResult, notes)`| `ctx`, `ScanResult`, `NoteMap` | `MigrationPlan` |
| `codemoder`| `apply(ctx, plan)`                 | `ctx`, `MigrationPlan`       | `CodemodeResult` |
| `verifier` | `verify(ctx, codemodeResult)`      | `ctx`, `CodemodeResult`      | `Verdict`        |
| `scribe`   | `write(ctx, plan)`                 | `ctx`, `MigrationPlan`       | `string`         |

Agents are **model-agnostic**: none imports a model SDK directly. LLM calls are
injected via the context object or by swapping the reasoning backend behind a
stable interface. See §3 for the planner's delegation contract.

---

## 3. Planner LLM Delegation Design

### 3.1 Current (Deterministic) Implementation

`buildPlan()` calls an internal `synthesisePlan()` function that:

1. Reads `breaking-changes.json` for per-rule metadata (severity, replacement, docs).
2. Walks the `usageMap` from the scanner to count hits per rule.
3. Computes a risk score per rule using:
   ```
   perRuleRisk = clamp(occurrences × severity × proximityWeight, 0, 30)
   ```
   where `proximityWeight` is 1.5 if the pattern appears in test files, 1.0
   if mixed, 0.7 if only in non-test code.
4. Sums per-rule risk + a base-complexity term to get a package-level score.
5. Estimates effort using fixed coefficients:
   ```
   manualMinutes = occurrences × severity × 8
   pilotMinutes  = occurrences × severity × 1.5
   ```
6. Sorts packages into safe upgrade order (dev deps before prod, ascending risk).

### 3.2 LLM Delegation Contract

`synthesisePlan()` is the **single seam** designed for LLM replacement. Its
contract is:

```ts
// Input context passed to the LLM (serialisable to JSON)
interface SynthesisInput {
  scanResult: ScanResult;   // from scanner.js
  noteMap:    NoteMap;      // from librarian.js
  ruleIndex:  RuleIndexEntry[];  // flattened from breaking-changes.json
}

// Output the LLM must return (identical shape to deterministic version)
type SynthesisOutput = PackageStep[];
```

The LLM receives no mutable state — only these three read-only data structures
— so the delegation is stateless and repeatable.

### 3.3 Wiring IBM watsonx.ai Granite

To delegate `synthesisePlan()` to IBM watsonx.ai Granite (or any compatible
model), implement an **adapter** module that conforms to the same signature:

```js
// tool/src/adapters/watsonx-planner.js
import WatsonXAI from '@ibm-cloud/watsonx-ai';  // IBM SDK

const client = WatsonXAI.newInstance({ version: '2024-05-31' });

/**
 * Drop-in replacement for synthesisePlan().
 * Same signature, same output shape.
 */
export async function synthesisePlan(scanResult, noteMap, ruleIndex) {
  const prompt = buildPrompt(scanResult, noteMap, [...ruleIndex.values()]);

  const response = await client.generateText({
    modelId:    'ibm/granite-3-8b-instruct',
    projectId:  process.env.WATSONX_PROJECT_ID,
    input:      prompt,
    parameters: {
      decoding_method: 'greedy',
      max_new_tokens:  4096,
      temperature:     0,   // deterministic for plan generation
    },
  });

  // Parse the structured JSON the model returns
  return JSON.parse(response.result.results[0].generated_text);
}
```

#### System prompt skeleton

```
You are a Node.js upgrade expert. Given a JSON scan result, migration notes,
and a rule index, produce a JSON array of PackageStep objects in upgrade-safe
order (dev deps first, then prod sorted by ascending risk).

Each PackageStep must include: package, from, to, type, risk, riskScore,
affectedFileCount, affectedFiles, steps (RuleStep[]), rollbackNote,
estimatedManualMinutes, estimatedPilotMinutes, references.

Each RuleStep must include: ruleId, description, occurrences, affectedFiles,
severity, category, action, replacement, proximity, riskContribution,
manualMinutes, pilotMinutes, docs.

Risk scoring guidelines:
  perRuleRisk  = clamp(occurrences × severity × proximityWeight, 0, 30)
  packageRisk  = clamp(Σ perRuleRisk + 10×activeRuleCount, 0, 100)
  proximityWeight: tested=1.5, mixed=1.0, untested=0.7
  risk label: <35=low, 35–64=medium, ≥65=high

Effort guidelines:
  manualMinutes = occurrences × severity × 8
  pilotMinutes  = occurrences × severity × 1.5

Output only valid JSON. No prose, no markdown fences.
```

#### Enabling the adapter in `buildPlan()`

```js
// In planner.js — switch backend via environment variable
import { synthesisePlan as llmSynth } from '../adapters/watsonx-planner.js';

async function buildPlan(ctx, scanResult, noteMap) {
  const ruleIndex = loadRuleIndex();

  // Delegate to LLM when UPGRADEPILOT_LLM=watsonx
  const rawSteps = process.env.UPGRADEPILOT_LLM === 'watsonx'
    ? await llmSynth(scanResult, noteMap, ruleIndex)
    : synthesisePlan(scanResult, noteMap, ruleIndex);   // deterministic fallback

  // …rest of buildPlan() unchanged
}
```

No other code changes are needed. The exported `buildPlan()` interface, all
downstream agents, and the CLI remain identical.

### 3.4 Why This Design Preserves Safety

| Concern | How it's addressed |
|---------|-------------------|
| Hallucinated file paths | Scanner produces the ground-truth `usageMap`; the LLM only interprets it |
| Non-deterministic risk scores | Fixed formula in system prompt; `temperature: 0` |
| Output schema drift | `buildPlan()` validates shape before returning; bad JSON throws |
| Cost control | LLM is only called for the `plan` step, not `scan` or `verify` |
| Offline mode | `UPGRADEPILOT_LLM` unset → falls back to deterministic `synthesisePlan()` |

---

## 4. Data Contracts

### 4.1 `breaking-changes.json` schema

```json
{
  "packages": [{
    "package":      "string",   // npm package name
    "fromVersion":  "string",   // major being upgraded FROM
    "toVersion":    "string",   // major being upgraded TO
    "migrationGuide": "url",
    "rules": [{
      "id":             "package/slug",
      "description":    "string",
      "removedPattern": "regex string",
      "patternFlags":   "string",
      "replacement":    "string",
      "severity":       1|2|3,
      "category":       "removed-api|changed-behaviour|deprecated-api",
      "docs":           "url"
    }]
  }]
}
```

Adding a new package is a **data-only change** — no code modifications needed
in scanner, planner, or codemoder.

### 4.2 `migration-plan.json` schema (MigrationPlan)

Full schema is documented at the top of [`tool/src/agents/planner.js`](../tool/src/agents/planner.js).
The `schemaVersion` field allows forward-compatible consumers to detect breaking
changes to the output format.

---

## 5. Extension Points

| What you want to add | Where to add it |
|---------------------|----------------|
| New breaking package rules | `tool/data/breaking-changes.json` only |
| Live npm-registry version check | `scanner.js` → `fetchLatest()` stub |
| Real changelog fetching | `librarian.js` → `fetchNotes()` |
| LLM-powered plan synthesis | `planner.js` → `synthesisePlan()` adapter |
| New codemod transforms | `codemoder.js` → `TRANSFORM_RULES` |
| CI integration | Call `verifier.js` in your pipeline after `codemoder.js` |
| Alternative output formats | `scribe.js` → add a new renderer alongside `toMarkdown()` |

---

## 6. Running the Pipeline

```bash
# Step 1 — Scan
node tool/cli.js scan --path ./sample-app --out ./tool/out/usage-map.json --json

# Step 2 — Plan (reads usage-map via scanner re-run; persists migration-plan.json + MIGRATION_PLAN.md)
node tool/cli.js plan --path ./sample-app

# Step 3 — Apply codemods (dry-run)
node tool/cli.js run  --path ./sample-app --dry-run

# Step 4 — Full demo
node tool/cli.js demo
```

---

*Part of the UpgradePilot monorepo — see [README.md](../README.md) for quickstart.*
