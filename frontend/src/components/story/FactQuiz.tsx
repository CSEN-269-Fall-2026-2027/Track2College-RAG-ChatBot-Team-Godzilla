import { useMemo, useState } from "react";
import { shuffled, type UcFact } from "../../journey/facts";
import { ArrowRightIcon, CheckIcon } from "../icons";

/**
 * Story mode's Review & Apply step: a UC fun-facts quiz. Four shuffled answers (one true),
 * feedback once one is picked, then "Next fact". Every fact shows once before any repeats.
 */
export function FactQuiz({ facts }: { facts: UcFact[] }) {
  const [order, setOrder] = useState(() => shuffled(facts.map((f) => f.id)));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const fact = facts.find((f) => f.id === order[index]) ?? facts[0];
  const options = useMemo(() => shuffled([fact.answer, ...fact.wrong]), [fact]);
  const right = picked === fact.answer;

  const next = () => {
    setPicked(null);
    if (index + 1 < order.length) {
      setIndex(index + 1);
    } else {
      // Start a fresh round, without repeating the last fact first.
      const again = shuffled(facts.map((f) => f.id));
      if (again[0] === fact.id && again.length > 1) again.push(again.shift()!);
      setOrder(again);
      setIndex(0);
    }
  };

  return (
    <div className="fact-quiz" key={fact.id}>
      <p className="guided-question" role="status">
        <span className="fact-quiz-tag">UC fun fact</span>
        {fact.question}
      </p>

      <div className="guided-choices" role="group" aria-label="Answers">
        {options.map((option) => {
          const state = !picked ? "" : option === fact.answer ? " is-right" : option === picked ? " is-wrong" : " is-dim";
          return (
            <button
              key={option}
              type="button"
              className={`guided-choice fact-choice${state}`}
              onClick={() => setPicked(option)}
              disabled={!!picked}
              aria-pressed={picked === option}
            >
              {picked && option === fact.answer && <CheckIcon width={15} height={15} />}
              {option}
            </button>
          );
        })}
      </div>

      {picked && (
        <div className={`fact-quiz-result${right ? " is-right" : ""}`} role="status">
          <p>
            <strong>{right ? "Correct!" : `Not quite. The answer is: ${fact.answer}.`}</strong> {fact.why}
          </p>
          <button type="button" className="btn-primary" onClick={next} autoFocus>
            Next fact <ArrowRightIcon width={15} height={15} />
          </button>
        </div>
      )}
    </div>
  );
}
