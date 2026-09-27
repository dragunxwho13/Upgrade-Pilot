# IBM Bob 2.0 — Evidence Folder

This folder holds session screenshots that prove IBM Bob 2.0 was the primary driver of UpgradePilot's development.

---

## Who adds screenshots here?

Every team member who ran a Bob task session must drop their evidence here **before the submission deadline**.

---

## Naming convention

```
<github-username>-<task-slug>.png
```

Examples:

| File | What to capture |
|------|----------------|
| `alice-scaffold.png` | Bob Agent mode session for "Scaffold: UpgradePilot monorepo + legacy sample app" — show the task name in the title bar and the final "12/12 ✅" output |
| `bob-scanner.png` | Bob session for "Scanner: usage map and risk scoring" — show 20/20 unit tests green |
| `carol-planner.png` | Bob session for "Planner: risk-scored migration plan" — show `migration-plan.json` generated |
| `dave-codemod.png` | Bob session for "Codemod Crew: parallel per-package migrations" — show `[codemod-crew] express ✓ 26 | mongoose ✓ 21` in the terminal |
| `eve-verifier.png` | Bob session for "Verifier: tests to green" — show `12 passed, 0 failed, 12 total` on Express 5 / Mongoose 7 / Jest 29 |
| `frank-polish.png` | Bob session for "Submission polish: README, evidence, CI, demo script" — show this file being created |

---

## Task slugs (for reference)

| Slug | Full task session name |
|------|----------------------|
| `scaffold` | Scaffold: UpgradePilot monorepo + legacy sample app |
| `scanner` | Scanner: usage map and risk scoring |
| `planner` | Planner: risk-scored migration plan |
| `codemod` | Codemod Crew: parallel per-package migrations |
| `verifier` | Verifier: tests to green |
| `polish` | Submission polish: README, evidence, CI, demo script |

---

## What makes a good screenshot?

1. **Show the Bob session name** — visible in the task breadcrumb or title bar.
2. **Show the terminal output** — especially the Definition of Done check (green tests, file counts, etc.).
3. **Include a timestamp** if possible — hover over the session creation time.
4. **One PNG per task session** — full-page capture preferred; crop to remove personal desktop icons.

---

## Folder contents

```
ibm-bob-evidence/
├── README.md          ← this file
└── <member>-<task>.png   ← add yours here
```

---

> **Note:** This folder is tracked by git. Do NOT add screenshots containing browser passwords, personal emails, or any credentials. Crop or blur such content before uploading.
