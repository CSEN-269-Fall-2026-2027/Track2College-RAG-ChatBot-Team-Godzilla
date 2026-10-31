# Testing

## Frontend (Vitest)

```bash
cd frontend
npm install
npm test            # or: npm run test:watch
```

Tests live in `frontend/src/tests/` and run in Node (no browser, no Supabase, no network). Fixtures are in `fixtures.ts`.

| File | Covers |
|------|--------|
| `guided.test.ts` | Guided-mode turn logic (`journey/guided.ts`): grade/campus pickers, chapter hand-offs, PIQ picker |
| `journey.test.ts` | UC journey progress and map route (`journey/logic.ts`) |
| `onboarding.logic.test.ts` | Onboarding required fields, checkpoints, resume, app gating (`onboarding/logic.ts`) |
| `openers.test.ts` | Each guide's opening line (`game/openers.ts`) |
| `piqs.test.ts` | PIQ follow-up questions and completion rules (`journey/piqs.ts`) |
| `story.test.ts` | Dialogue paging, mood parsing, mentors (`game/dialogue.ts`, `game/characters.ts`) |

Type-check with `npm run typecheck`.

## Backend (unittest)

```bash
cd backend
source .venv/bin/activate
python -m unittest
```

| File | Covers |
|------|--------|
| `test_followup_refs.py` | Resolving "Q1" / "question 2" against earlier follow-up questions |
| `test_persona.py` | Persona prompts and `Mood:` line extraction |
| `test_piq.py` | PIQ prompts, unknown-id rejection, 350-word trimming |

## Not covered

- React rendering and clicks (no browser tests).
- Supabase persistence and auth.
- Live Groq calls. Backend tests don't touch the network.
