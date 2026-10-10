import { Logo } from "./icons";

const SUGGESTIONS = [
  { title: "Financial aid", prompt: "What do I need to complete the FAFSA, and when is it due?" },
  { title: "Applications", prompt: "What's the difference between Early Decision and Early Action?" },
  { title: "Scholarships", prompt: "How can I find scholarships I'm eligible for?" },
  { title: "Essays", prompt: "What makes a strong college application essay?" },
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="empty">
      <Logo size={52} />
      <h1>Where are you headed next?</h1>
      <p className="empty-sub">
        Ask Track2College about college admissions, financial aid, and scholarships. Answers come with their sources.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} className="suggestion" onClick={() => onPick(s.prompt)}>
            <span className="suggestion-title">{s.title}</span>
            <span className="suggestion-prompt">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
