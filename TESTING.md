# Testing — college list → readiness checklist

Feature under test: **Explore “Add to list” → `profile.colleges` → Insights readiness checklist** (`list-build`).

This covers two kinds of tests from the testing article:

1. **Integration** — connected modules pass data correctly (`toggleCollegeOnProfile` ↔ `planningChecklist`).
2. **End-to-end** — one user journey from empty list → four adds → checklist complete → Overview `nextSteps` no longer includes `list-build`.

## Files added or changed

| File | Role |
|------|------|
| `frontend/src/collegeList.ts` | Shared add/remove helper used by Explore and tests |
| `frontend/src/pages/Explore.tsx` | Calls `toggleCollegeOnProfile` (same path as production) |
| `frontend/src/tests/fixtures.ts` | Blank profile for tests (no Supabase) |
| `frontend/src/tests/collegeList.integration.test.ts` | Integration tests |
| `frontend/src/tests/collegeList.e2e.test.ts` | End-to-end journey test |
| `frontend/vitest.config.ts` | Vitest config |
| `frontend/package.json` | `test` / `test:watch` scripts + `vitest` |

## What each test checks

### Integration (`collegeList.integration.test.ts`)

- Adding four colleges via the Explore helper marks `list-build` done in `planningChecklist`.
- Three colleges leave `list-build` incomplete.
- Removing a college after four were added flips `list-build` back to incomplete.

### End-to-end (`collegeList.e2e.test.ts`)

Full journey for a grade-12 student: empty list → add four schools → checklist done → `nextSteps` no longer includes `list-build`.

## Commands

```bash
cd frontend
npm install
npm test
```

Watch mode: `npm run test:watch`

## Demonstration (break → fail → restore → pass)

Verified steps:

1. Run `npm test` — all tests pass.
2. Temporarily break the rule in `frontend/src/checklist.ts`: change `p.colleges.length >= 4` to `>= 99` on the `list-build` `autoDone`.
3. Run `npm test` again — integration and e2e assertions that expect `list-build` done after four colleges fail.
4. Restore `>= 4`.
5. Run `npm test` — all tests pass again.

## Limitations (what is mocked / not covered)

- **No browser UI** — does not click Explore buttons or render React.
- **No Supabase / network** — profile updates are in-memory; persistence and auth are not exercised.
- **No backend / RAG** — college-list feature is frontend-only data flow.
- Tests use the same helpers and checklist logic as the app (`collegeList` + `checklist`), not a separate duplicate of the rules.
