import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { Logo, LogoutIcon, MoonIcon, SunIcon } from "../components/icons";
import { usePlanning } from "../planning";
import { useProfile, type SaveState } from "../profile";
import type { Theme } from "../App";
import type { Profile } from "../types";
import { JourneyPath } from "./JourneyPath";
import { GoogleConnectPanel } from "./GoogleConnectPanel";
import { QuestionFields } from "./QuestionFields";
import { ABOUT_YOU_CHECKPOINT, CHECKPOINT_COUNT, CHECKPOINTS, applyTranscriptBasics, checkpointErrors, markComplete, questionErrors, questionsForCheckpoint, resumeCheckpoint, setCheckpoint } from "./logic";

type OnboardingPhase = "questions" | "google";

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

function stepTag(checkpoint: number, questionId?: string) {
  if (questionId === "transcript" || checkpoint === 0) return "Step 1";
  if (checkpoint === ABOUT_YOU_CHECKPOINT) return "Step 3";
  return CHECKPOINTS[checkpoint]?.title ?? "About you";
}

/**
 * Flow: transcript → Connect Google → confirm details → start.
 * Transcript and Google connection are required.
 */
export function OnboardingPage({ theme, onToggleTheme, onFinished }: OnboardingPageProps) {
  const { account, signOut } = useAuth();
  const { profile, update, saveState } = useProfile();
  const { transcripts } = usePlanning();
  const [checkpoint, setCp] = useState(() => {
    const saved = resumeCheckpoint(profile);
    // Path index 1 is Google (no questions) — resume into the Google phase instead.
    return saved === 1 ? 0 : saved;
  });
  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState<OnboardingPhase>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected" || params.get("google") === "error") return "google";
    return resumeCheckpoint(profile) === 1 ? "google" : "questions";
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [finishedAnim, setFinishedAnim] = useState(false);

  const googleStep = phase === "google";
  const qs = useMemo(() => questionsForCheckpoint(checkpoint, profile), [checkpoint, profile]);
  const question = qs[Math.min(qIndex, Math.max(0, qs.length - 1))];
  const hasTranscript = transcripts.length > 0;
  // What still blocks Continue / Start my plan on this screen (the button stays disabled until it's empty).
  const missing = question ? questionErrors(profile, question.id, { hasTranscript }) : [];

  // The upload goes through planning, not onChange, so drop a stale "upload your transcript" error here.
  useEffect(() => {
    if (hasTranscript) setErrors([]);
  }, [hasTranscript]);

  /** During celebrate, show the runner already moving toward the next mark. */
  const pathCheckpoint = finishedAnim
    ? CHECKPOINT_COUNT
    : googleStep
      ? 1
      : celebrate
        ? checkpoint === 0
          ? 1
          : CHECKPOINT_COUNT
        : checkpoint;

  useEffect(() => {
    document.title = "Onboarding · Track2College";
  }, []);

  useEffect(() => {
    if (googleStep || profile.onboarding.completed) return;
    if (profile.onboarding.checkpoint === checkpoint) return;
    update((p) => setCheckpoint(p, checkpoint));
  }, [checkpoint, googleStep, profile.onboarding.checkpoint, profile.onboarding.completed, update]);

  useEffect(() => {
    setQIndex((i) => Math.min(i, Math.max(0, qs.length - 1)));
  }, [qs.length]);

  // If the transcript was uploaded before grade/year prefill existed, fill blanks once on Step 3.
  useEffect(() => {
    if (phase !== "questions" || checkpoint !== ABOUT_YOU_CHECKPOINT) return;
    const latest = transcripts[0];
    if (!latest) return;
    update((p) => {
      const next = applyTranscriptBasics(p, latest);
      const same =
        next.basics.firstName === p.basics.firstName &&
        next.basics.lastName === p.basics.lastName &&
        next.basics.highSchool === p.basics.highSchool &&
        next.basics.gradeLevel === p.basics.gradeLevel &&
        next.basics.graduationYear === p.basics.graduationYear &&
        next.academics.gpaUnweighted === p.academics.gpaUnweighted &&
        next.academics.gpaWeighted === p.academics.gpaWeighted;
      return same ? p : next;
    });
  }, [phase, checkpoint, transcripts, update]);

  const patch = useCallback(
    (next: Profile) => {
      update(() => next);
      setErrors([]);
    },
    [update],
  );

  const finish = useCallback(() => {
    const errs = checkpointErrors(profile);
    if (errs.length) {
      setPhase("questions");
      setCp(ABOUT_YOU_CHECKPOINT);
      setQIndex(0);
      setErrors(errs);
      setCelebrate(false);
      return;
    }
    setFinishedAnim(true);
    onFinished();
    update((p) => markComplete(p));
  }, [profile, onFinished, update]);

  const advanceAfterCheckpoint = useCallback(() => {
    setCelebrate(false);
    // After transcript: Connect Google next.
    if (checkpoint === 0) {
      setPhase("google");
      update((p) => setCheckpoint(p, 1));
      return;
    }
    // After confirm: start the plan (no extra summary step).
    finish();
  }, [checkpoint, update, finish]);

  const completeQuestion = (opts?: { skipped?: boolean }) => {
    if (!question || celebrate || finishedAnim) return;
    if (!opts?.skipped) {
      const errs = questionErrors(profile, question.id, { hasTranscript });
      if (errs.length) {
        setErrors(errs);
        return;
      }
    } else if (question.required) {
      const errs = questionErrors(profile, question.id, { hasTranscript });
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
    if (celebrate || finishedAnim) return;
    setErrors([]);
    if (googleStep) {
      setPhase("questions");
      setCp(0);
      setQIndex(0);
      return;
    }
    if (qIndex > 0) {
      setQIndex((i) => i - 1);
      return;
    }
    if (checkpoint === ABOUT_YOU_CHECKPOINT) {
      setPhase("google");
    }
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

          {googleStep ? (
            <GoogleConnectPanel
              onContinue={() => {
                setPhase("questions");
                setCp(ABOUT_YOU_CHECKPOINT);
                setQIndex(0);
              }}
              onBack={goBack}
            />
          ) : question ? (
            <>
              <p className="ob-section-tag">{stepTag(checkpoint, question.id)}</p>
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
                <button type="button" className="btn-ghost" onClick={goBack} disabled={(checkpoint === 0 && qIndex === 0) || celebrate || finishedAnim}>
                  Back
                </button>
                <div className="ob-actions-right">
                  {missing.length > 0 && errors.length === 0 && checkpoint === ABOUT_YOU_CHECKPOINT && (
                    <ul className="ob-missing">
                      {missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}
                  {!question.required && (
                    <button type="button" className="ob-skip" onClick={() => completeQuestion({ skipped: true })} disabled={celebrate || finishedAnim}>
                      Skip question
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => completeQuestion()}
                    disabled={missing.length > 0 || celebrate || finishedAnim}
                  >
                    {checkpoint === ABOUT_YOU_CHECKPOINT ? "Start my plan" : "Continue"}
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
