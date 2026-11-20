# Completed codebase cleanup

The retired pipelines have been removed. Current chat copy, guide actions, essay drafting,
Google activity confirmation, counselor tools, and cloud UC application behavior are preserved.

## Removed

- Retired profile analysis, course-plan generation, generic essay generation, and scripted
  activity-extraction endpoints, clients, request models, prompts, and unused backend modules.
- Milo's old count-based activity interview and its scripted replies. Saved interview notes
  still feed essay context, and old completion records still count toward progress.
- Old counselor-email and UC application popups, their local/cloud switch, unused helper UI,
  image, and CSS. The current automatic counselor email, Jordan call, background application,
  login/code dialogs, and Watch panel remain.
- Parked FAFSA/scholarship mode picker and its special prompts. Penny's normal chat remains.
- Unreachable onboarding questions, old dialogue paging/sound/facts, unused helpers and icons,
  and CSS selectors without live references. Dynamically constructed classes were preserved.
- Hidden full-page map; old map links redirect to the advisor. The map popup remains.
- Game preference provider: no component read its context or changed its settings. The journey
  map and current guide switching do not depend on it.

## Persistence fixes

- Serialized per-row saves prevent older requests from overwriting newer edits.
- Transcript storage upload/delete errors now propagate; failed reads show an error and retry
  instead of pretending the student has no transcripts. Failed deletes retain the visible row.
- Transcript and conversation reads traverse all pages.
- Reset verifies the reauthenticated account, pauses new writes, drains pending writes, requires
  backend Google disconnection, and removes every storage page before reseeding the blank profile.
  Storage failures and missing live tables stop the reset. There is no fixed-delay flush heuristic.
- Authentication restores subscribe before the session snapshot, propagate errors, and finish
  loading on failure. Profile timestamps advance even for edits in the same millisecond.
- The Supabase store uses the generated database types.
- Blocking chat generation runs in FastAPI's synchronous worker pool.

## Supabase alignment

Live REST schema and private transcript bucket settings were inspected. Two disposable accounts
verified 34 live checks covering sign-in, owner writes/reads, cross-user read/update/insert denial,
Google-token table restrictions, and private transcript upload/download. Both accounts and all
probe files were removed afterward.

The existing `profile_analyses`, `course_plans`, and `game_progress` tables retain existing data.
No product feature reads or writes them; Reset still clears them if present. Fresh installations
no longer create them. The live schema was not destructively changed.

## Verification

- Frontend typecheck and production build pass.
- Frontend tests cover the current journey, guide routing, response parsing, onboarding,
  Google waitlist, essay drafting, counselor/apply progress, and persistence failure cases.
- Backend: 106 tests pass using `backend/.venv/bin/python -m unittest discover -s tests`.
  This includes the existing UC HTML fixtures for sign-up, login fallback, verification-code
  retry, exact About you fields, PIQ behavior, run ownership, and credential redaction.
- Browser checks at desktop/tablet widths confirm Google cannot be skipped, the exact major
  prompt sits left of Start my plan, selecting Still exploring unlocks the button, and there
  are no page errors.
- `backend/uc_sections.py` and the HTML-dependent UC selectors/filling routines were preserved.
- Live emails, voice calls, and real UC applications were not sent or submitted during testing.
