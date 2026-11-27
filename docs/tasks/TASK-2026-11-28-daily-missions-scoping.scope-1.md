# Scope Change Record: TASK-2026-11-28-daily-missions-scoping (scope-1)
<a id="TASK-2026-11-28-daily-missions-scoping.scope-1"></a>

- **Task ID**: `TASK-2026-11-28-daily-missions-scoping`
- **Created**: `2026-11-28 07:24 (UTC+13)`
- **Actor**: `ZCode session (GLM-5.3-Flash)`
- **Change**: Changed Files expand to include `docs/README.md` (two index rows: the task record and this Scope Change Record, which the same test also requires indexed) and this Scope Change Record. Objective, acceptance criteria, explicit non-goals, risk, and verification condition are unchanged.
- **Trigger**: The first verification run (`node --test`, exit 1) failed `tests/docs.test.js:32` — "every doc in specs, reviews, tasks and releases is listed in docs/README.md" — with `actual: ['tasks/TASK-2026-11-28-daily-missions-scoping.md']` vs `expected: []`. The repository's docs invariant requires indexing every new task record; the test was **not** modified or weakened.
- **Impact**: None on the scope boundary — all changes remain docs-only. One additional tracked file changes (`docs/README.md`), one additional untracked-ish record file is added alongside it.
- **Approval**: Gated Mode — covered by the owner's authorization of this dogfooding task; surfaced explicitly at the completion/sign-off gate.
