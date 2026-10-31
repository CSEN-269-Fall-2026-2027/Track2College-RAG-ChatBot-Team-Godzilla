import { useState } from "react";
import { useGame } from "../game/GameProvider";
import { journeyOf, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, setPiqStatus } from "../journey/logic";
import { canGeneratePiq, chosenPiqs, countWords, editDraft, nextDetailQuestion, PIQ_DETAIL_QUESTIONS, piqWorkOf } from "../journey/piqs";
import { usePiqDrafts } from "../journey/usePiqDrafts";
import { useProfile } from "../profile";
import { navigate } from "../router";
import { CheckIcon, CopyIcon, FileIcon, RetryIcon, SparkIcon } from "../components/icons";
import type { Profile } from "../types";

/** Materials → Essays: one card per chosen UC PIQ — answer Quill's questions, generate that essay, then revise it. */
export function EssayTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile } = useProfile();
  const { updateSettings } = useGame();
  const piq = usePiqDrafts();

  const openStory = () => {
    updateSettings({ storyMode: true });
    navigate("advisor");
  };

  const ids = chosenPiqs(profile);

  if (!ids.length) {
    return (
      <section className="card essays-empty">
        <div className="essays-empty-icon" aria-hidden="true">
          <FileIcon width={22} height={22} />
        </div>
        <h2>Choose your Personal Insight Questions</h2>
        <p className="essays-empty-sub">
          UC asks you to answer 4 of 8 questions, {PIQ_WORD_LIMIT} words each. Pick them with Quill in Story mode and answer a few follow-up
          questions — each essay can be generated as soon as its questions are done.
        </p>
        <div className="essays-empty-actions">
          <button className="btn-primary" onClick={openStory}>
            Start with Quill
          </button>
        </div>
      </section>
    );
  }

  const statuses = journeyOf(profile).piqs;
  const drafted = ids.filter((id) => piqWorkOf(profile, id).draft).length;
  const readyCount = ids.filter((id) => statuses[id] === "ready").length;
  const overCount = ids.filter((id) => countWords(piqWorkOf(profile, id).draft?.text ?? "") > PIQ_WORD_LIMIT).length;

  return (
    <>
      <section className="card essays-summary">
        <div>
          <h2>Your UC Personal Insight Questions</h2>
          <p>
            {ids.length < PIQ_REQUIRED ? `${ids.length} of ${PIQ_REQUIRED} chosen · ` : ""}
            {drafted} of {PIQ_REQUIRED} drafted · {readyCount} marked ready
            {overCount ? (
              <>
                {" · "}
                <span className="essays-warn">
                  {overCount} over {PIQ_WORD_LIMIT} words
                </span>
              </>
            ) : null}
          </p>
        </div>
        {ids.length < PIQ_REQUIRED && (
          <button className="btn-ghost" onClick={openStory}>
            Choose {PIQ_REQUIRED - ids.length} more with Quill
          </button>
        )}
      </section>

      <ol className="essay-cards">
        {ids.map((id) => (
          <EssayCard key={id} id={id} profile={profile} ready={statuses[id] === "ready"} piq={piq} onAsk={onAsk} onOpenStory={openStory} />
        ))}
      </ol>

      <p className="privacy-note">
        Drafts are written only from your answers and profile. Read each one closely and change anything that doesn't sound like you before
        submitting on the UC application.
      </p>
    </>
  );
}

function EssayCard({
  id,
  profile,
  ready,
  piq,
  onAsk,
  onOpenStory,
}: {
  id: string;
  profile: Profile;
  ready: boolean;
  piq: ReturnType<typeof usePiqDrafts>;
  onAsk: (text: string) => void;
  onOpenStory: () => void;
}) {
  const { update } = useProfile();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = PIQ_PROMPTS.find((q) => q.id === id);
  const n = PIQ_PROMPTS.findIndex((q) => q.id === id) + 1;
  const draft = piqWorkOf(profile, id).draft;
  const words = draft ? countWords(draft.text) : 0;
  const over = words > PIQ_WORD_LIMIT;
  const generatable = canGeneratePiq(profile, id);
  const writing = piq.isGenerating(id);
  const error = piq.errorFor(id);

  const questions = PIQ_DETAIL_QUESTIONS[id] ?? [];
  const answers = piqWorkOf(profile, id).answers;
  const remaining = questions.filter((q) => (q.optional ? !(q.id in answers) : !answers[q.id]?.trim())).length;
  const next = nextDetailQuestion(profile, id);

  const copy = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const regenerate = () => {
    if (!window.confirm(`Regenerate your “${meta?.title}” essay? Any edits you've made to it will be replaced.`)) return;
    setEditing(false);
    void piq.generate([id], { regenerate: true });
  };

  const status = ready ? "ready" : draft ? "draft" : generatable ? "can-generate" : "needs-answers";
  const statusLabel = { ready: "Ready", draft: "Draft", "can-generate": "Ready to generate", "needs-answers": "Needs answers" }[status];

  return (
    <li className={`card essay-card is-${status}`}>
      <header className="essay-card-head">
        <span className="essay-card-num">{n}</span>
        <div className="essay-card-title">
          <h3>{meta?.title}</h3>
          <span className={`essay-status ${status}`}>
            {status === "ready" && <CheckIcon width={12} height={12} />} {statusLabel}
          </span>
        </div>
      </header>

      <p className="essay-card-question">{meta?.prompt}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {draft ? (
        <>
          {editing ? (
            <textarea
              className="essay-card-editor"
              value={draft.text}
              onChange={(e) => update((p) => editDraft(p, id, e.target.value))}
              rows={14}
              aria-label={`Edit ${meta?.title} essay`}
              autoFocus
            />
          ) : (
            <div className={`essay-card-body${writing ? " is-writing" : ""}`} aria-busy={writing}>
              {writing ? (
                <p className="essay-rewriting">Rewriting your essay… this can take a few seconds.</p>
              ) : (
                draft.text.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))
              )}
            </div>
          )}

          <div className="essay-meter" aria-hidden="true">
            <span className={over ? "over" : ""} style={{ width: `${Math.min(100, (words / PIQ_WORD_LIMIT) * 100)}%` }} />
          </div>

          <footer className="essay-card-foot">
            <span className={`essay-count${over ? " over" : ""}`} aria-live="polite">
              {words} / {PIQ_WORD_LIMIT} words{over ? ` · cut ${words - PIQ_WORD_LIMIT}` : ""}
            </span>
            <div className="essay-card-actions">
              <button className="btn-ghost" onClick={() => setEditing((e) => !e)} disabled={writing}>
                {editing ? "Done editing" : "Edit"}
              </button>
              <button className="btn-ghost" onClick={copy} disabled={writing}>
                <CopyIcon width={14} height={14} /> {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn-ghost" onClick={regenerate} disabled={piq.busy}>
                <RetryIcon width={14} height={14} /> {writing ? "Writing…" : "Regenerate"}
              </button>
              <button
                className="btn-ghost"
                onClick={() =>
                  onAsk(`Help me revise my UC PIQ response for "${meta?.prompt}" so it sounds more like me and stays under ${PIQ_WORD_LIMIT} words:\n\n${draft.text}`)
                }
              >
                Get revision help
              </button>
              <button
                className={ready ? "btn-ghost" : "btn-primary"}
                disabled={!ready && over}
                title={!ready && over ? `Cut it to ${PIQ_WORD_LIMIT} words first` : undefined}
                onClick={() => update((p) => ({ ...p, ucJourney: setPiqStatus(journeyOf(p), id, ready ? "drafting" : "ready") }))}
              >
                {ready ? "Mark as draft" : "Mark ready"}
              </button>
            </div>
          </footer>
        </>
      ) : generatable ? (
        <div className="essay-card-pending">
          <p>Quill has everything needed for this essay.</p>
          <button className="btn-primary" onClick={() => piq.generate([id])} disabled={piq.busy}>
            <SparkIcon width={15} height={15} />
            {writing ? "Writing your essay…" : "Generate this essay"}
          </button>
        </div>
      ) : (
        <div className="essay-card-pending">
          <p>
            Answer {remaining} more question{remaining === 1 ? "" : "s"} before this essay can be generated
            {next ? (
              <>
                {" "}
                — next: <em>{next.question}</em>
              </>
            ) : null}
          </p>
          <button className="btn-ghost" onClick={onOpenStory}>
            Answer with Quill
          </button>
        </div>
      )}
    </li>
  );
}
