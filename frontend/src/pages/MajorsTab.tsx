import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { MAJOR_CHOICES, OTHER_MAJOR, toMajorChoice } from "../constants";
import { QUIZ, miloPrompt, quizComplete, topAreas, type QuizAnswers } from "../journey/majorQuiz";
import { useProfile } from "../profile";
import { readJSON, userKey, writeJSON } from "../storage";
import { SelectField } from "../components/Form";
import { CheckIcon, RetryIcon } from "../components/icons";

const MAJOR_OPTIONS = MAJOR_CHOICES.map((m) => ({ value: m, label: m }));

/** Profile → Major selection: the one intended major for every UC campus, plus the Major match survey. */
export function MajorsTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile, update } = useProfile();
  const major = profile.goals.intendedMajor;
  const setMajor = (next: string) => update((p) => ({ ...p, goals: { ...p.goals, intendedMajor: next } }));

  return (
    <>
      <section className="pf-panel">
        <header className="pf-panel-head">
          <div className="pf-panel-title">
            <h2>Major selection</h2>
          </div>
        </header>
        <div className="pf-panel-body">
          <div className="form-grid">
            <SelectField label="Intended major (all UC campuses)" value={major} options={MAJOR_OPTIONS} onChange={setMajor} placeholder="Choose a major…" />
          </div>
        </div>
      </section>

      <MajorMatch major={major} onPick={(m) => setMajor(toMajorChoice(m))} onAsk={onAsk} />
    </>
  );
}

/** Six quick questions → top interest areas → a major to pick, or ask Milo about. */
function MajorMatch({ major, onPick, onAsk }: { major: string; onPick: (major: string) => void; onAsk: (text: string) => void }) {
  const { account } = useAuth();
  const key = userKey(account?.id ?? "anon", "majorQuiz");
  const [answers, setAnswers] = useState<QuizAnswers>(() => readJSON<QuizAnswers>(key, {}));
  const [step, setStep] = useState(() => Math.min(Object.keys(answers).length, QUIZ.length));

  useEffect(() => writeJSON(key, answers), [key, answers]);

  const done = quizComplete(answers) && step >= QUIZ.length;
  // Saved answers from an older version of the survey can leave gaps: resume at the first one.
  const current = step < QUIZ.length ? step : Math.max(0, QUIZ.findIndex((q) => !q.options.some((o) => o.id === answers[q.id])));

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
          <p>Six quick questions to find majors worth a look.</p>
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
          <Results answers={answers} major={major} onPick={onPick} onAsk={onAsk} />
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
  major,
  onPick,
  onAsk,
}: {
  answers: QuizAnswers;
  /** The intended major saved now. */
  major: string;
  onPick: (major: string) => void;
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
              {area.majors.map((m) => {
                // Majors outside the ten choices save as "Other".
                const choice = toMajorChoice(m);
                const label = choice === OTHER_MAJOR ? `${m} (Other)` : m;
                return choice === major && choice !== OTHER_MAJOR ? (
                  <span key={m} className="mj-major added">
                    <CheckIcon width={13} height={13} /> {label}
                  </span>
                ) : (
                  <button key={m} type="button" className="mj-major" onClick={() => onPick(m)} aria-label={`Make ${label} my intended major`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <div className="mj-actions">
        <button type="button" className="btn-primary" onClick={() => onAsk(miloPrompt(areas))}>
          Ask Milo about my results
        </button>
        <span className="field-hint">Picking a major here sets your intended major above.</span>
      </div>
    </div>
  );
}
