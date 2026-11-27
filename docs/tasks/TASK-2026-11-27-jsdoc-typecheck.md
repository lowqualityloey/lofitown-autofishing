# Task: Incremental JSDoc type-checking, CI & documentation alignment (M1–M3 + M5)

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-27 · Status: completed · Code Commit: `00c52dc`

## Objective

Introduce dev-only static type-checking (`typescript@7.0.2`, `tsconfig.json` with `noEmit: true` + `strictNullChecks: true`, shared `types.d.ts`, and incremental `// @ts-check` + JSDoc annotations) across the userscript modules and Node tooling while preserving the zero-runtime-dependency build and unchanged Tampermonkey URL install.

## Specification

- RFC: [2026-11-27-jsdoc-typecheck-and-architecture.md](../specs/2026-11-27-jsdoc-typecheck-and-architecture.md) (`PLAN-jsdoc-typecheck`, `DECISION-jsdoc-typecheck-001`)

## In Scope

- **M1**: `tsconfig.json`, `types.d.ts`, `package.json` (`devDependencies.typescript: "7.0.2"` + `typecheck` script), `package-lock.json`, `// @ts-check` + JSDoc on `layout.js` and `session.js`.
- **M2**: `panel.js` (`// @ts-check` + `@satisfies` on `PAUSE_WHY` & `RUNNERS`), `fishserve.js`, `build-userscript.js`, `scripts/*.js`.
- **M3**: `autofish.js` (`// @ts-check`, shared contracts, `@satisfies` on `DIAL_COUNTER`, leaving `coarseScan` hot loop untouched).
- **M5**: `.github/workflows/test.yml`, `README.md`, `AUTOFISH.md`, `PROMPTKIT.md`, `docs/STATE.md`, `docs/README.md`.

## Explicit Non-Goals (Milestone Boundary)

- M4 (splitting `autofish.js` sentinel blocks into `src/` and building a headless `step()` simulator) is deferred to a separate follow-on task after M1–M3 + M5 ship.
- No `.ts` rewrite, no bundler, no runtime npm dependencies, no changes to Tampermonkey `@downloadURL`/`@updateURL` or `scripts/release.js`.
- No behavioral changes to fishing detection, press planning, or panel UI during typing milestones.

## Acceptance Criteria

1. `[x]` `AC-1 (M1)`: `npm run typecheck` exits `0` with `layout.js` and `session.js` under `// @ts-check`; `node build-userscript.js && node --test` passes with zero regressions.
2. `[x]` `AC-2 (M2)`: `panel.js`, `fishserve.js`, `build-userscript.js`, and `scripts/*.js` pass `npm run typecheck` (`exit 0`) with `@satisfies` enforcing `PAUSE_WHY` and `RUNNERS` exhaustiveness.
3. `[x]` `AC-3 (M3)`: `autofish.js` passes `npm run typecheck` (`exit 0`) with `DIAL_COUNTER` `@satisfies` and zero runtime behavior changes (`node build-userscript.js && node --test` green).
4. `[x]` `AC-4 (M5)`: CI (`.github/workflows/test.yml`) and all impacted docs (`README.md`, `AUTOFISH.md`, `PROMPTKIT.md`, `docs/STATE.md`, `docs/README.md`) are updated and verified alongside `tests/docs.test.js` + `check-doctor.sh`.

## Verification Evidence
- Code & tooling commit: `00c52dc`
- Checks run after M1–M3+M5 edits: `npm run typecheck` (`exit 0`, `checkJs: true`), `node build-userscript.js` (`416,601` bytes), `node --test` (`431 pass, 0 fail`), `check-doctor.sh` (`state-freshness: OK`).
