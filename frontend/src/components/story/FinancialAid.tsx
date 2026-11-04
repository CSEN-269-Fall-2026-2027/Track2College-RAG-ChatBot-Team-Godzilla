import { agentOf, aidDeadlineDate, setAgent } from "../../agent/logic";
import type { GuidedChoice, GuidedTurn } from "../../journey/guided";
import { useProfile } from "../../profile";
import type { AidMode } from "../../types";
import { ExternalIcon } from "../icons";

const MODES: { id: AidMode; label: string }[] = [
  { id: "fafsa", label: "FAFSA" },
  { id: "scholarships", label: "Scholarships" },
];

const ask = (id: string, label: string, prompt: string): GuidedChoice => ({
  id,
  label,
  effect: { type: "ask", mentorId: "penny", prompt },
});

const SCHOLARSHIP_CHOICES: GuidedChoice[] = [
  ask("find", "Find scholarships for me", "Based on my profile, what kinds of scholarships am I likely to qualify for, and where should I look?"),
  ask("essay", "Help me write a scholarship essay", "Can you help me write a scholarship essay? Start by asking me a few questions, and help me reuse stories from my Personal Insight answers."),
  ask("plan", "Make me a scholarship plan", "Help me make a simple plan to find, track, and apply for scholarships this year, including how to keep track of deadlines."),
  ask("uc", "UC campus scholarships", "How do scholarships at the UC campuses work? Do I need a separate application, or does my UC application and FAFSA cover it?"),
];

/**
 * Story mode's Financial Aid step. The student picks FAFSA or Scholarships (and can switch any
 * time); Penny's prompt in the chat follows the mode. FAFSA keeps the step's own questions
 * (`turn`), so marking the FAFSA or CA Dream Act submitted still finishes the step.
 */
export function FinancialAid({
  turn,
  onPick,
  onModeChange,
  disabled,
}: {
  turn: GuidedTurn;
  onPick: (choice: GuidedChoice) => void;
  onModeChange: (mode: AidMode) => void;
  disabled?: boolean;
}) {
  const { profile, update } = useProfile();
  const mode: AidMode = agentOf(profile).aidMode ?? "fafsa";

  const pickMode = (next: AidMode) => {
    if (next === mode) return;
    update((p) => setAgent(p, (a) => ({ ...a, aidMode: next })));
    onModeChange(next);
  };

  const prompt =
    mode === "fafsa"
      ? turn.prompt
      : "Scholarships are free money you don't pay back. Want help finding ones that fit you, or writing the essays? I'll use your profile, so the ideas match your majors, activities, and background.";
  const choices = mode === "fafsa" ? turn.choices : SCHOLARSHIP_CHOICES;
  const due = new Date(`${aidDeadlineDate(profile)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="review-apply financial-aid">
      <div className="counselor-switch review-mode-switch" role="tablist" aria-label="What Penny helps with">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : undefined} onClick={() => pickMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      <p className="guided-question" role="status">
        {prompt}
      </p>

      {mode === "fafsa" && (
        <div className="aid-forms">
          <ul className="apply-aid-notes">
            <li>
              <strong>FAFSA</strong> is for U.S. citizens and eligible noncitizens. <strong>CA Dream Act</strong> is for undocumented
              students, DACA recipients, and others who qualify for California's AB 540 tuition exemption. File one.
            </li>
            <li>
              <strong>Cal Grant priority deadline: {due}.</strong> Your school also sends your GPA, so ask your counselor to confirm it did.
            </li>
            <li>Applying to UC doesn't apply you for aid. You're considered for UC grants once your aid application is in.</li>
          </ul>
          <div className="aid-links">
            <a className="apply-inline-link" href="https://studentaid.gov/h/apply-for-aid/fafsa" target="_blank" rel="noreferrer">
              Open the FAFSA <ExternalIcon width={12} height={12} />
            </a>
            <a className="apply-inline-link" href="https://dream.csac.ca.gov/" target="_blank" rel="noreferrer">
              CA Dream Act <ExternalIcon width={12} height={12} />
            </a>
            <a className="apply-inline-link" href="https://admission.universityofcalifornia.edu/tuition-financial-aid/" target="_blank" rel="noreferrer">
              UC tuition and aid <ExternalIcon width={12} height={12} />
            </a>
          </div>
        </div>
      )}

      <div className="guided-choices" role="group" aria-label="Your reply">
        {choices.map((choice) => (
          <button key={choice.id} type="button" className="guided-choice" onClick={() => onPick(choice)} disabled={disabled}>
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
