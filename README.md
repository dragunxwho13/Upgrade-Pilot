# UpgradePilot 🚀

> AI-powered agentic co-pilot that scans, plans, applies, and verifies dependency upgrades in Node.js projects — fully automated, diff-reviewed, and test-gated.

---

## Monorepo layout

```
upgradepilot/
├── tool/          # CLI — npx upgradepilot <subcommand>
└── sample-app/    # "Acme Orders API" — deliberately legacy Express app used for demos
```

---

## Quickstart

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9 (workspaces support)

### Install everything

```bash
npm install
```

### Run the CLI (no install required)

```bash
node tool/cli.js --help
```

Or link it globally:

```bash
npm link --workspace tool
upgradepilot --help
```

### Run sample-app tests (legacy deps, 12 integration tests)

```bash
cd sample-app
npm test
```

---

## CLI subcommands

| Subcommand | What it does |
|------------|-------------|
| `scan`     | Detect outdated / breaking dependencies |
| `plan`     | Generate an AI upgrade plan with risk scores |
| `run`      | Apply codemods and bump versions |
| `report`   | Emit a Markdown / JSON upgrade report |
| `demo`     | Run the full pipeline against the built-in sample-app |

```bash
node tool/cli.js scan --path ./sample-app
node tool/cli.js plan --path ./sample-app
node tool/cli.js run  --path ./sample-app --dry-run
node tool/cli.js report --path ./sample-app --format markdown
node tool/cli.js demo
```

---

## Architecture

```
cli.js
└── src/agents/
    ├── scanner.js    # Reads package.json, detects outdated deps & breaking changes
    ├── librarian.js  # Fetches changelogs, release notes, migration guides
    ├── planner.js    # Builds an ordered upgrade plan with risk assessment
    ├── codemoder.js  # Applies AST-level codemods to fix breaking API changes
    ├── verifier.js   # Runs test suites and diff-reviews results
    └── scribe.js     # Formats and persists upgrade reports
```

---

## Security note

This repository is **public**. Never commit `.env` files, API keys, or any credentials.
See `.gitignore` for excluded paths.

---

## License

MIT
