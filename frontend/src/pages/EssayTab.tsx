import { useState, type FormEvent } from "react";
import { ApiError, generateEssay, type EssayResult } from "../api";
import { Markdown } from "../components/Markdown";
import { ChatIcon, CopyIcon, RetryIcon, SparkIcon } from "../components/icons";
import { profileSummary, useProfile } from "../profile";
import { href } from "../router";

const SAMPLE_PROMPTS = [
  "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story. (Common App)",
  "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes, or contributed to group efforts over time. (UC PIQ)",
  "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time? (UC PIQ)",
];

export function EssayTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile } = useProfile();
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]);
  const [mode, setMode] = useState<"draft" | "ideas">("ideas");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EssayResult | null>(null);
  const [copied, setCopied] = useState(false);

  const summary = profileSummary(profile);
  const thinProfile = summary.length < 40;

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await generateEssay(prompt.trim(), summary, mode));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate essay help. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyEssay = async () => {
    if (!result?.essay) return;
    await navigator.clipboard.writeText(result.essay);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <section className="card">
        <header className="card-head">
          <h2>Essay coach</h2>
          <p>Paste a prompt. We'll use your profile to brainstorm angles or draft a starting essay — then you revise it in your own voice.</p>
        </header>
        <form className="essay-form" onSubmit={run}>
          <div className="field">
            <label className="field-label" htmlFor="essay-prompt">
              Essay prompt
            </label>
            <textarea
              id="essay-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Paste a Common App, UC PIQ, or supplemental prompt…"
              required
            />
          </div>
          <div className="essay-prompt-chips">
            {SAMPLE_PROMPTS.map((sample) => (
              <button key={sample.slice(0, 24)} type="button" className="chip chip-ghost" onClick={() => setPrompt(sample)}>
                {sample.includes("UC PIQ") ? "UC PIQ sample" : "Common App sample"}
              </button>
            ))}
          </div>
          <div className="essay-mode" role="group" aria-label="Output type">
            <button type="button" className={mode === "ideas" ? "on" : ""} onClick={() => setMode("ideas")}>
              Topic ideas
            </button>
            <button type="button" className={mode === "draft" ? "on" : ""} onClick={() => setMode("draft")}>
              Full draft
            </button>
          </div>
          <button className="btn-primary" disabled={!prompt.trim() || loading}>
            <SparkIcon width={15} height={15} />
            {loading ? "Working…" : mode === "ideas" ? "Brainstorm ideas" : "Draft essay"}
          </button>
        </form>
        {thinProfile && (
          <p className="field-hint">
            Your profile is light — fill in <a href={href("profile", "activities")}>activities</a> and{" "}
            <a href={href("profile", "goals")}>goals</a> for more personal results.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {loading && (
        <section className="card">
          <div className="ai-loading" aria-live="polite">
            <p className="shimmer">{mode === "ideas" ? "Finding angles that fit your story…" : "Drafting from your profile…"}</p>
            <div className="skeleton-lines">
              <span style={{ width: "90%" }} />
              <span style={{ width: "76%" }} />
              <span style={{ width: "62%" }} />
            </div>
          </div>
        </section>
      )}

      {result && !loading && (
        <section className="card essay-result">
          <header className="ai-head">
            <div>
              <h2>{result.title || (mode === "ideas" ? "Topic ideas" : "Draft")}</h2>
              <p className="plan-meta">Treat this as a starting point — rewrite anything that doesn't sound like you.</p>
            </div>
            <div className="transcript-actions">
              {result.essay && (
                <button className="btn-ghost" onClick={copyEssay}>
                  <CopyIcon width={14} height={14} /> {copied ? "Copied" : "Copy draft"}
                </button>
              )}
              <button className="btn-ghost" onClick={() => run()}>
                <RetryIcon width={14} height={14} /> Regenerate
              </button>
            </div>
          </header>

          {result.essay && (
            <div className="essay-draft">
              <Markdown text={result.essay} />
            </div>
          )}

          {result.ideas.length > 0 && (
            <div className="essay-ideas">
              <h3>Ideas</h3>
              <ul>
                {result.ideas.map((idea) => (
                  <li key={`${idea.title}-${idea.angle}`}>
                    <strong>{idea.title || "Angle"}</strong>
                    {idea.angle && <p>{idea.angle}</p>}
                    {idea.why_it_fits && <p className="muted">{idea.why_it_fits}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.tips.length > 0 && (
            <div className="pill-list strengths">
              <h3>Revision tips</h3>
              <ul>
                {result.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          )}

          <footer className="plan-foot">
            <button
              className="link-btn"
              onClick={() =>
                onAsk(
                  `Help me improve this college essay idea for the prompt: ${prompt.slice(0, 200)}. What should I make more specific?`,
                )
              }
            >
              <ChatIcon width={13} height={13} /> Discuss with advisor
            </button>
          </footer>
        </section>
      )}
    </>
  );
}
