import { href } from "../router";
import { Logo } from "./icons";

interface EmptyStateProps {
  name: string;
  personalized: boolean;
  suggestions: { title: string; prompt: string }[];
  onPick: (prompt: string) => void;
}

export function EmptyState({ name, personalized, suggestions, onPick }: EmptyStateProps) {
  return (
    <div className="empty">
      <Logo size={52} />
      <h1>{name ? `What can I help with, ${name}?` : "Where are you headed next?"}</h1>
      <p className="empty-sub">
        Ask about admissions, financial aid, and scholarships. Answers cite official college sources
        {personalized ? " and are tailored to your profile." : "."}
        {!personalized && (
          <>
            {" "}
            <a href={href("profile")}>Complete your profile</a> for personalized advice.
          </>
        )}
      </p>
      <div className="suggestions">
        {suggestions.map((s) => (
          <button key={s.title} className="suggestion" onClick={() => onPick(s.prompt)}>
            <span className="suggestion-title">{s.title}</span>
            <span className="suggestion-prompt">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
