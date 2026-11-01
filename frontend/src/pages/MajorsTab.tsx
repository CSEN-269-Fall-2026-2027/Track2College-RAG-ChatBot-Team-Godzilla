import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { COLLEGES } from "../colleges";
import { MAJOR_SUGGESTIONS } from "../constants";
import { QUIZ, miloPrompt, quizComplete, topAreas, type QuizAnswers } from "../journey/majorQuiz";
import { useProfile } from "../profile";
import { href } from "../router";
import { readJSON, userKey, writeJSON } from "../storage";
import { ChipsInput, Segmented } from "../components/Form";
import { CheckIcon, PlusIcon, RetryIcon } from "../components/icons";

/** Same cap as the majors box (ChipsInput's default). */
const MAX_MAJORS = 5;

/** Profile → Major selection: the majors the student is considering, plus the Major match survey. */
export function MajorsTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile, update } = useProfile();
  const majors = profile.goals.majors;
  const setMajors = (next: string[]) => update((p) => ({ ...p, goals: { ...p.goals, majors: next } }));

  const ucs = profile.colleges.filter((c) => COLLEGES.some((u) => u.name.toLowerCase() === c.name.toLowerCase()));
  const campusMajorsSet = ucs.filter((c) => c.major?.trim()).length;

  return (
    <>
      <section className="pf-panel">
        <header className="pf-panel-head">
          <div className="pf-panel-title">
            <h2>Major selection</h2>
            <p>The majors you're considering. They shape advice from your guides and the essays Quill drafts.</p>
          </div>
        </header>
        <div className="pf-panel-body">
          <div className="form-grid">
            <ChipsInput
              label="Majors you're considering"
              values={majors}
              onChange={setMajors}
              suggestions={MAJOR_SUGGESTIONS}
              placeholder="Add a major"
            />
            <Segmented
              label="Still exploring majors?"
              value={profile.onboarding.exploringMajors ? "yes" : majors.length ? "no" : ""}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) =>
                update((p) => ({
                  ...p,
                  onboarding: { ...p.onboarding, exploringMajors: v === "yes" },
                  goals: v === "yes" ? { ...p.goals, majors: p.goals.majors.length ? p.goals.majors : ["Undeclared"] } : p.goals,
                }))
              }
              wide
            />
          </div>
          {ucs.length > 0 && (
            <p className="pf-note mj-campus-note">
              {campusMajorsSet} of {ucs.length} UC campus{ucs.length === 1 ? " has" : "es have"} an intended major.{" "}
              <a href={href("profile", "campuses")}>Set majors per campus</a>
            </p>
          )}
        </div>
      </section>

      <MajorMatch majors={majors} onAdd={(m) => majors.length < MAX_MAJORS && setMajors([...majors, m])} onAsk={onAsk} />
    </>
  );
}

/** Six quick questions → top interest areas → UC majors to add or ask Milo about. */
function MajorMatch({ majors, onAdd, onAsk }: { majors: string[]; onAdd: (major: string) => void; onAsk: (text: string) => void }) {
  const { account } = useAuth();
  const key = userKey(account?.id ?? "anon", "majorQuiz");
  const [answers, setAnswers] = useState<QuizAnswers>(() => readJSON<QuizAnswers>(key, {}));
  const [step, setStep] = useState(() => Math.min(Object.keys(answers).length, QUIZ.length));

  useEffect(() => writeJSON(key, answers), [key, answers]);

  const done = quizComplete(answers) && step >= QUIZ.length;
  // Saved answers from an older version of the survey can leave gaps: resume at the first one.
  const current = step < QUIZ.length ? step : Math.max(0, QUIZ.findIndex((q) => !q.options.some((o) => o.id === answers[q.id])));
  const has = (m: string) => majors.some((x) => x.toLowerCase() === m.toLowerCase());

  const choose = (questionId: string, optionId: string) => {
    setAnswers((a) => ({ ...a, [questionId]: optionId }));
    setStep(current + 1);
  };

  const restart = () => {
    setAnswers({});
    setStep(0);
  };

  return (
    <section className="pf-panel mj-quiz" aria-labelledby="mj-quiz-title">
      <header className="pf-panel-head">
        <div className="pf-panel-title">
          <h2 id="mj-quiz-title">Major match survey</h2>
          <p>Not sure what to study? Six quick questions point you to majors worth a look. It's a starting point, not a verdict.</p>
        </div>
        {Object.keys(answers).length > 0 && (
          <button type="button" className="pf-edit" onClick={restart}>
            <RetryIcon width={14} height={14} /> Start over
          </button>
        )}
      </header>

      <div className="pf-panel-body">
        {!done ? (
          <QuestionStep
            index={current}
            selected={answers[QUIZ[current].id]}
            onChoose={(optionId) => choose(QUIZ[current].id, optionId)}
            onBack={current > 0 ? () => setStep(current - 1) : undefined}
          />
        ) : (
          <Results answers={answers} has={has} full={majors.length >= MAX_MAJORS} onAdd={onAdd} onAsk={onAsk} />
        )}
      </div>
    </section>
  );
}

function QuestionStep({
  index,
  selected,
  onChoose,
  onBack,
}: {
  index: number;
  selected?: string;
  onChoose: (optionId: string) => void;
  onBack?: () => void;
}) {
  const q = QUIZ[index];
  return (
    <div className="mj-step">
      <div className="mj-progress" aria-hidden="true">
        {QUIZ.map((x, i) => (
          <span key={x.id} className={i < index ? "done" : i === index ? "on" : ""} />
        ))}
      </div>
      <p className="mj-count">
        Question {index + 1} of {QUIZ.length}
      </p>
      <h3 className="mj-prompt" id={`mj-q-${q.id}`}>
        {q.prompt}
      </h3>
      <div className="mj-options" role="radiogroup" aria-labelledby={`mj-q-${q.id}`}>
        {q.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected === o.id}
            className={`mj-option${selected === o.id ? " on" : ""}`}
            onClick={() => onChoose(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {onBack && (
        <button type="button" className="btn-ghost mj-back" onClick={onBack}>
          Back
        </button>
      )}
    </div>
  );
}

function Results({
  answers,
  has,
  full,
  onAdd,
  onAsk,
}: {
  answers: QuizAnswers;
  has: (major: string) => boolean;
  /** The majors list is at its limit. */
  full: boolean;
  onAdd: (major: string) => void;
  onAsk: (text: string) => void;
}) {
  const areas = topAreas(answers);
  return (
    <div className="mj-results">
      <p className="mj-count">Your top interest areas</p>
      <ol className="mj-areas">
        {areas.map((area, i) => (
          <li key={area.id} className="mj-area">
            <div className="mj-area-head">
              <span className="mj-rank">{i + 1}</span>
              <div>
                <strong>{area.title}</strong>
                <p>{area.blurb}</p>
              </div>
            </div>
            <div className="mj-majors" aria-label={`Majors in ${area.title}`}>
              {area.majors.map((m) =>
                has(m) ? (
                  <span key={m} className="mj-major added">
                    <CheckIcon width={13} height={13} /> {m}
                  </span>
                ) : (
                  <button
                    key={m}
                    type="button"
                    className="mj-major"
                    onClick={() => onAdd(m)}
                    disabled={full}
                    aria-label={`Add ${m} to my majors`}
                    title={full ? `You can list up to ${MAX_MAJORS} majors — remove one above to add this` : undefined}
                  >
                    <PlusIcon width={13} height={13} /> {m}
                  </button>
                ),
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="mj-actions">
        <button type="button" className="btn-primary" onClick={() => onAsk(miloPrompt(areas))}>
          Ask Milo about my results
        </button>
        <span className="field-hint">
          {full
            ? `Your list is full (${MAX_MAJORS} majors). Remove one above to add another.`
            : "Majors you add show up in your list above. Milo, the majors guide, can help you compare them."}
        </span>
      </div>
    </div>
  );
}
