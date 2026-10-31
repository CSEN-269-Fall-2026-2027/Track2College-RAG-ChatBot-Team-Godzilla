import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { Logo, LogoutIcon, MoonIcon, SunIcon } from "../components/icons";
import { useProfile, type SaveState } from "../profile";
import type { Theme } from "../App";
import type { Profile } from "../types";
import { JourneyPath } from "./JourneyPath";
import { QuestionFields, SummaryList } from "./QuestionFields";
import {
  CHECKPOINT_COUNT,
  CHECKPOINTS,
  checkpointErrors,
  markComplete,
  questionErrors,
  questionsForCheckpoint,
  resumeCheckpoint,
  setCheckpoint,
} from "./logic";

interface OnboardingPageProps {
  theme: Theme;
  onToggleTheme: () => void;
  onFinished: () => void;
}

function saveLabel(state: SaveState) {
  if (state === "saving") return "Saving…";
  if (state === "saved") return "Saved";
  if (state === "error") return "Couldn't save — check your connection";
  return "";
}

export function OnboardingPage({ theme, onToggleTheme, onFinished }: OnboardingPageProps) {
  const { account, signOut } = useAuth();
  const { profile, update, saveState } = useProfile();
  const [checkpoint, setCp] = useState(() => resumeCheckpoint(profile));
  const [qIndex, setQIndex] = useState(0);
  const [summary, setSummary] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [finishedAnim, setFinishedAnim] = useState(false);

  const qs = useMemo(() => questionsForCheckpoint(checkpoint), [checkpoint]);
  const question = qs[Math.min(qIndex, Math.max(0, qs.length - 1))];

  /** During celebrate, show the runner already moving toward the next mark. */
  const pathCheckpoint = summary || finishedAnim
    ? CHECKPOINT_COUNT
    : celebrate
      ? checkpoint >= CHECKPOINT_COUNT - 1
        ? CHECKPOINT_COUNT
        : checkpoint + 1
      : checkpoint;

  useEffect(() => {
    document.title = "Onboarding · Track2College";
  }, []);

  useEffect(() => {
    if (summary || profile.onboarding.completed) return;
    if (profile.onboarding.checkpoint === checkpoint) return;
    update((p) => setCheckpoint(p, checkpoint));
  }, [checkpoint, summary, profile.onboarding.checkpoint, profile.onboarding.completed, update]);

  useEffect(() => {
    setQIndex((i) => Math.min(i, Math.max(0, qs.length - 1)));
  }, [qs.length]);

  const patch = useCallback(
    (next: Profile) => {
      update(() => next);
      setErrors([]);
    },
    [update],
  );

  const advanceAfterCheckpoint = useCallback(() => {
    setCelebrate(false);
    if (checkpoint >= CHECKPOINT_COUNT - 1) {
      setSummary(true);
      update((p) => setCheckpoint(p, CHECKPOINT_COUNT));
      return;
    }
    setCp((c) => c + 1);
    setQIndex(0);
  }, [checkpoint, update]);

  const completeQuestion = (opts?: { skipped?: boolean }) => {
    if (!question || celebrate) return;
    if (!opts?.skipped) {
      const errs = questionErrors(profile, question.id);
      if (errs.length) {
        setErrors(errs);
        return;
      }
    } else if (question.required) {
      const errs = questionErrors(profile, question.id);
      setErrors(errs.length ? errs : ["This step is required."]);
      return;
    }
    setErrors([]);

    if (qIndex < qs.length - 1) {
      setQIndex((i) => i + 1);
      return;
    }
    setCelebrate(true);
  };

  const goBack = () => {
    if (celebrate) return;
    setErrors([]);
    if (summary) {
      setSummary(false);
      setCp(CHECKPOINT_COUNT - 1);
      setQIndex(Math.max(0, questionsForCheckpoint(CHECKPOINT_COUNT - 1).length - 1));
      return;
    }
    if (qIndex > 0) {
      setQIndex((i) => i - 1);
      return;
    }
    if (checkpoint > 0) {
      const prev = checkpoint - 1;
      setCp(prev);
      setQIndex(Math.max(0, questionsForCheckpoint(prev).length - 1));
    }
  };

  const finish = () => {
    const errs = checkpointErrors(profile, 0);
    if (errs.length) {
      setSummary(false);
      setCp(0);
      setQIndex(0);
      setErrors(errs);
      return;
    }
    // Summary only appears after checkpoint 3 — refuse finish if they somehow skip ahead.
    if (!summary) {
      setErrors(["Keep going — finish all three steps first."]);
      return;
    }
    setFinishedAnim(true);
    // Route to Advisor before marking complete so the gated app doesn't open Materials on an empty hash.
    onFinished();
    update((p) => markComplete(p));
  };

  return (
    <div className="ob">
      <header className="ob-top">
        <div className="ob-brand">
          <Logo size={26} />
          <span>Track2College</span>
        </div>
        <div className="ob-top-actions">
          <span className={`ob-save ob-save-${saveState}`} aria-live="polite">
            {saveLabel(saveState)}
          </span>
          <button type="button" className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button type="button" className="icon-btn" onClick={() => signOut()} aria-label="Sign out" title={account?.email}>
            <LogoutIcon />
          </button>
        </div>
      </header>

      <div className="ob-shell">
        <JourneyPath checkpoint={pathCheckpoint} celebrate={celebrate} onCelebrateEnd={advanceAfterCheckpoint} />

        <main className="ob-content" aria-labelledby="ob-heading">
          {finishedAnim && (
            <p className="ob-celebrate" role="status">
              Ready to begin…
            </p>
          )}

          {summary ? (
            <>
              <h1 id="ob-heading">Your starting line</h1>
              <p className="ob-hint">Glance over your answers, edit anything, then start your plan.</p>
              <SummaryList
                profile={profile}
                onJump={(i) => {
                  setSummary(false);
                  setCp(i);
                  setQIndex(0);
                  setErrors([]);
                }}
              />
              <div className="ob-actions">
                <button type="button" className="btn-ghost" onClick={goBack}>
                  Back
                </button>
                <button type="button" className="btn-primary" onClick={finish}>
                  Start my plan
                </button>
              </div>
            </>
          ) : question ? (
            <>
              <p className="ob-section-tag">{CHECKPOINTS[checkpoint].title}</p>
              <h1 id="ob-heading">{question.prompt}</h1>
              {question.hint && <p className="ob-hint">{question.hint}</p>}

              <div className="ob-answer">
                <QuestionFields questionId={question.id} profile={profile} onChange={patch} />
              </div>

              {errors.length > 0 && (
                <ul className="ob-errors" role="alert">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}

              <div className="ob-actions">
                <button type="button" className="btn-ghost" onClick={goBack} disabled={(checkpoint === 0 && qIndex === 0) || celebrate}>
                  Back
                </button>
                <div className="ob-actions-right">
                  {!question.required && (
                    <button type="button" className="ob-skip" onClick={() => completeQuestion({ skipped: true })} disabled={celebrate}>
                      Skip question
                    </button>
                  )}
                  <button type="button" className="btn-primary" onClick={() => completeQuestion()} disabled={celebrate}>
                    {qIndex >= qs.length - 1 && checkpoint >= CHECKPOINT_COUNT - 1 ? "Review answers" : "Continue"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
