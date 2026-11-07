import { useEffect, useState } from "react";
import type { AskOptions } from "../App";
import { PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT } from "../journey/logic";
import { chosenPiqs, countWords, deleteDraft, editDraft, essayHasText, essayHelpRequest, essaysReadyCount, limitWords, overLimit, piqWorkOf, resetEssays, startedDraft, swapPiq } from "../journey/piqs";
import { usePiqDrafts } from "../journey/usePiqDrafts";
import { useProfile } from "../profile";
import { navigate, setLeaveGuard } from "../router";
import { ChatIcon, CheckIcon, FileIcon, SparkIcon, TrashIcon } from "../components/icons";
import type { Profile } from "../types";

const UNSAVED_WARNING = "You have unsaved changes to this essay. Leave without saving?";

/** Profile → Essays: the four chosen UC PIQs, each opening into its own page. */
export function EssayTab({ onAsk }: { onAsk: (text: string, options?: AskOptions) => void }) {
  const { profile, update } = useProfile();
  const piq = usePiqDrafts();
  const [openId, setOpenId] = useState<string | null>(null);
  /** Pasting over a draft the student never asked for: the box starts empty until they type. */
  const [startBlank, setStartBlank] = useState(false);

  const openStory = () => navigate("advisor");
  const ids = chosenPiqs(profile);

  // "I already wrote my essay" opens that essay.
  useEffect(() => {
    if (!piq.editRequest) return;
    setOpenId(piq.editRequest);
    setStartBlank(!startedDraft(profile, piq.editRequest));
    piq.requestEdit(null);
  }, [piq, profile]);

  if (!ids.length) {
    return (
      <section className="card essays-empty">
        <div className="essays-empty-icon" aria-hidden="true">
          <FileIcon width={22} height={22} />
        </div>
        <h2>Choose your Personal Insight Questions</h2>
        <p className="essays-empty-sub">
          Answer 4 of 8 questions, up to {PIQ_WORD_LIMIT} words each.
        </p>
        <div className="essays-empty-actions">
          <button className="btn-primary" onClick={openStory}>
            Start with Quill
          </button>
        </div>
      </section>
    );
  }

  if (openId && ids.includes(openId)) {
    return (
      <EssayPage
        key={openId}
        id={openId}
        profile={profile}
        startBlank={startBlank}
        piq={piq}
        onAsk={onAsk}
        onBack={() => {
          setOpenId(null);
          setStartBlank(false);
        }}
        onSwitch={(to) => {
          setOpenId(to);
          setStartBlank(false);
        }}
      />
    );
  }

  const overCount = ids.filter((id) => countWords(piqWorkOf(profile, id).draft?.text ?? "") > PIQ_WORD_LIMIT).length;

  return (
    <>
      <section className="card essays-summary">
        <div>
          <h2>Your UC Personal Insight Questions</h2>
          <p>
            {ids.length < PIQ_REQUIRED ? `${ids.length} of ${PIQ_REQUIRED} chosen · ` : ""}
            {essaysReadyCount(profile)}/{PIQ_REQUIRED} ready
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
        <div className="essays-summary-actions">
          {ids.length < PIQ_REQUIRED && (
            <button className="btn-ghost" onClick={openStory}>
              Choose {PIQ_REQUIRED - ids.length} more with Quill
            </button>
          )}
          <button
            className="btn-ghost"
            disabled={piq.busy}
            onClick={() => {
              if (window.confirm("Start your essays over? This removes the questions you chose and deletes their essays.")) update(resetEssays);
            }}
          >
            Reset
          </button>
        </div>
      </section>

      <ol className="essay-rows">
        {ids.map((id) => {
          const meta = PIQ_PROMPTS.find((q) => q.id === id);
          const ready = essayHasText(profile, id);
          const words = countWords(piqWorkOf(profile, id).draft?.text ?? "");
          return (
            <li key={id} className={`card essay-row${ready ? " is-ready" : ""}`}>
              <div className="essay-row-text">
                <h3>{meta?.title}</h3>
                <p>{meta?.prompt}</p>
                <span className={`essay-status ${ready ? "ready" : ""}`}>
                  {piq.isGenerating(id) ? (
                    "Generating…"
                  ) : ready ? (
                    <>
                      <CheckIcon width={12} height={12} /> Ready · {words} words
                    </>
                  ) : (
                    "Not started"
                  )}
                </span>
              </div>
              <button type="button" className="btn-primary" onClick={() => setOpenId(id)} aria-label={`Enter ${meta?.title}`}>
                Enter
              </button>
            </li>
          );
        })}
      </ol>

      <p className="privacy-note">
        Read each draft closely and make it sound like you before you submit.
      </p>
    </>
  );
}

/** One essay: edit and save it, switch its question, delete it, rewrite it, or ask Quill for help. */
function EssayPage({
  id,
  profile,
  startBlank,
  piq,
  onAsk,
  onBack,
  onSwitch,
}: {
  id: string;
  profile: Profile;
  startBlank: boolean;
  piq: ReturnType<typeof usePiqDrafts>;
  onAsk: (text: string, options?: AskOptions) => void;
  onBack: () => void;
  onSwitch: (to: string) => void;
}) {
  const { update } = useProfile();
  const meta = PIQ_PROMPTS.find((q) => q.id === id);
  const draft = piqWorkOf(profile, id).draft;
  const savedText = draft?.text ?? "";
  /** What's on file, which the box is compared against. A paste over an unrequested draft starts from nothing. */
  const [baseline, setBaseline] = useState(startBlank ? "" : savedText);
  const [text, setText] = useState(baseline);
  /** The last edit went past the limit, so the end of it was cut. */
  const [clipped, setClipped] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [changing, setChanging] = useState(false);

  const words = countWords(text);
  const over = words > PIQ_WORD_LIMIT;
  const writing = piq.isGenerating(id);
  const error = piq.errorFor(id);
  const dirty = text !== baseline;

  // A rewrite (or Quill saving from the chat) replaces what's on screen.
  const [lastSaved, setLastSaved] = useState(savedText);
  if (savedText !== lastSaved) {
    setLastSaved(savedText);
    setBaseline(savedText);
    setText(savedText);
  }

  // Leaving by any other route (the sidebar, the top bar, closing the tab) asks too.
  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard(() => window.confirm(UNSAVED_WARNING));
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  /** True when it's fine to leave this essay. */
  const confirmLeave = () => {
    if (dirty && !window.confirm(UNSAVED_WARNING)) return false;
    setLeaveGuard(null);
    return true;
  };

  const save = () => {
    const kept = limitWords(text);
    update((p) => (kept.trim() ? editDraft(p, id, kept) : deleteDraft(p, id)));
    setText(kept);
    setBaseline(kept);
    setLastSaved(kept.trim() ? kept : "");
    setClipped(false);
    setJustSaved(true);
  };

  const rewrite = () => {
    if (draft && !window.confirm(`Regenerate your “${meta?.title}” essay? It will replace what's here.`)) return;
    setJustSaved(false);
    void piq.generate([id], { regenerate: !!draft });
  };

  const remove = () => {
    if (!window.confirm(`Delete your “${meta?.title}” response? This can't be undone.`)) return;
    setJustSaved(false);
    setClipped(false);
    update((p) => deleteDraft(p, id));
    setText("");
    setBaseline("");
    setLastSaved("");
  };

  const askQuill = () => {
    if (!confirmLeave()) return;
    const help = essayHelpRequest(profile, id);
    onAsk(help.query, { display: help.display, mentorId: "quill" });
  };

  const others = PIQ_PROMPTS.filter((q) => !chosenPiqs(profile).includes(q.id));

  return (
    <section className="card essay-page">
      <button type="button" className="link-btn essay-back" onClick={() => confirmLeave() && onBack()}>
        ← Back to all essays
      </button>

      <h2 className="essay-page-title">{meta?.title}</h2>

      <div className="essay-card-question">
        <div className="essay-card-question-top">
          <span className="essay-card-question-label">The question you're answering</span>
          <button type="button" className="link-btn" onClick={() => setChanging((c) => !c)} aria-expanded={changing} disabled={writing}>
            {changing ? "Cancel" : "Switch question"}
          </button>
        </div>
        <p>{meta?.prompt}</p>
      </div>

      {changing && (
        <div className="essay-change" role="group" aria-label={`Pick a different question instead of ${meta?.title}`}>
          <p className="essay-change-note">
            Pick a different question. {draft ? "Your saved response stays here in case you switch back." : ""}
          </p>
          <ul>
            {others.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="essay-change-option"
                  onClick={() => {
                    if (!confirmLeave()) return;
                    update((p) => swapPiq(p, id, q.id));
                    onSwitch(q.id);
                  }}
                >
                  <strong>{q.title}</strong>
                  <span>{q.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {writing ? (
        <div className="essay-card-body is-writing" aria-busy="true">
          <p className="essay-rewriting">Generating…</p>
        </div>
      ) : (
        <textarea
          className="essay-card-editor"
          value={text}
          placeholder="Paste or type your essay here."
          onChange={(e) => {
            setClipped(overLimit(e.target.value));
            setJustSaved(false);
            setText(limitWords(e.target.value));
          }}
          rows={14}
          aria-label={`${meta?.title} essay`}
        />
      )}

      <div className="essay-meter" aria-hidden="true">
        <span className={over ? "over" : ""} style={{ width: `${Math.min(100, (words / PIQ_WORD_LIMIT) * 100)}%` }} />
      </div>

      <div className="essay-page-status">
        <span className={`essay-count${over ? " over" : ""}`} aria-live="polite">
          {words} / {PIQ_WORD_LIMIT} words{over ? ` · cut ${words - PIQ_WORD_LIMIT}` : ""}
          {clipped ? ` · UC's limit is ${PIQ_WORD_LIMIT} words, so anything past it was removed` : ""}
        </span>
        <span className="essay-save-note" role="status">
          {dirty ? "Unsaved changes" : justSaved ? "Saved" : ""}
        </span>
      </div>

      <div className="essay-page-actions">
        <button type="button" className="btn-primary" onClick={save} disabled={!dirty || writing}>
          Save
        </button>
        <button type="button" className="btn-ghost" onClick={askQuill} disabled={writing}>
          <ChatIcon width={14} height={14} /> Get help from Quill
        </button>
        <button type="button" className="btn-ghost" onClick={rewrite} disabled={piq.busy}>
          <SparkIcon width={14} height={14} /> {writing ? "Generating…" : draft ? "Regenerate my essay" : "Generate my essay"}
        </button>
        <button type="button" className="btn-ghost essay-delete" onClick={remove} disabled={writing || !draft}>
          <TrashIcon width={14} height={14} /> Delete response
        </button>
      </div>
    </section>
  );
}
