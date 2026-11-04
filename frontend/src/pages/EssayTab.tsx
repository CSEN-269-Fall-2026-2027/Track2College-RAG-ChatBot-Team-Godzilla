import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { activitiesStatus, journeyOf, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, setPiqStatus } from "../journey/logic";
import { canGeneratePiq, chosenPiqs, countWords, deleteDraft, editDraft, piqWorkOf, swapPiq } from "../journey/piqs";
import { usePiqDrafts } from "../journey/usePiqDrafts";
import { useProfile } from "../profile";
import { navigate } from "../router";
import { CheckIcon, CopyIcon, FileIcon, RetryIcon, SparkIcon, TrashIcon } from "../components/icons";
import type { Profile } from "../types";

/** Profile → Essays: one card per chosen UC PIQ — drafted automatically from activities, then revised by the student. */
export function EssayTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile } = useProfile();
  const piq = usePiqDrafts();

  const openStory = () => navigate("advisor");

  const ids = chosenPiqs(profile);

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
        Read each draft closely and make it sound like you before you submit.
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
  const [changing, setChanging] = useState(false);
  const meta = PIQ_PROMPTS.find((q) => q.id === id);
  const n = PIQ_PROMPTS.findIndex((q) => q.id === id) + 1;
  const draft = piqWorkOf(profile, id).draft;
  const words = draft ? countWords(draft.text) : 0;
  const over = words > PIQ_WORD_LIMIT;
  const generatable = canGeneratePiq(profile, id);
  const writing = piq.isGenerating(id);
  const error = piq.errorFor(id);

  const activitiesDone = activitiesStatus(profile).done;

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

  const remove = () => {
    if (!window.confirm(`Delete your “${meta?.title}” response? This can't be undone.`)) return;
    setEditing(false);
    update((p) => deleteDraft(p, id));
  };

  const others = PIQ_PROMPTS.filter((q) => !chosenPiqs(profile).includes(q.id));

  const status = ready ? "ready" : draft ? "draft" : generatable ? "can-generate" : "needs-answers";
  const statusLabel = { ready: "Ready", draft: "Draft", "can-generate": writing ? "Writing…" : "Ready to generate", "needs-answers": "Needs one answer" }[status];

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

      <div className="essay-card-question">
        <div className="essay-card-question-top">
          <span className="essay-card-question-label">Question {n} of 8 · the prompt you're answering</span>
          <button type="button" className="link-btn" onClick={() => setChanging((c) => !c)} aria-expanded={changing} disabled={writing}>
            {changing ? "Cancel" : "Change question"}
          </button>
        </div>
        <p>{meta?.prompt}</p>
      </div>

      {changing && (
        <div className="essay-change" role="group" aria-label={`Pick a different question instead of ${meta?.title}`}>
          <p className="essay-change-note">
            Pick a different question. {draft ? "Your current response stays saved in case you switch back." : ""}
          </p>
          <ul>
            {others.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="essay-change-option"
                  onClick={() => {
                    update((p) => swapPiq(p, id, q.id));
                    setChanging(false);
                  }}
                >
                  <strong>
                    {PIQ_PROMPTS.findIndex((x) => x.id === q.id) + 1}. {q.title}
                  </strong>
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
              <button
                className={ready ? "btn-ghost" : "btn-primary"}
                disabled={!ready && over}
                title={!ready && over ? `Cut it to ${PIQ_WORD_LIMIT} words first` : undefined}
                onClick={() => update((p) => ({ ...p, ucJourney: setPiqStatus(journeyOf(p), id, ready ? "drafting" : "ready") }))}
              >
                {ready ? "Mark as draft" : "Mark ready"}
              </button>
              <MoreMenu
                label={`More for ${meta?.title}`}
                items={[
                  { label: copied ? "Copied" : "Copy text", icon: <CopyIcon width={14} height={14} />, onClick: copy, disabled: writing },
                  { label: writing ? "Writing…" : "Rewrite with Quill", icon: <RetryIcon width={14} height={14} />, onClick: regenerate, disabled: piq.busy },
                  {
                    label: "Ask for revision help",
                    onClick: () =>
                      onAsk(`Help me revise my UC PIQ response for "${meta?.prompt}" so it sounds more like me and stays under ${PIQ_WORD_LIMIT} words:\n\n${draft.text}`),
                  },
                  { label: "Delete response", icon: <TrashIcon width={14} height={14} />, onClick: remove, disabled: writing, danger: true },
                ]}
              />
            </div>
          </footer>
        </>
      ) : generatable ? (
        <div className="essay-card-pending">
          <p>
            {writing
              ? "Quill is writing this essay from your activities and profile…"
              : activitiesDone
                ? "Quill has what it needs for this essay."
                : "Quill will draft this automatically once your activities are done — or write it now."}
          </p>
          <button className="btn-primary" onClick={() => piq.generate([id])} disabled={piq.busy}>
            <SparkIcon width={15} height={15} />
            {writing ? "Writing your essay…" : "Generate this essay"}
          </button>
        </div>
      ) : (
        <div className="essay-card-pending">
          <p>Quill needs one answer from you before drafting this one.</p>
          <button className="btn-ghost" onClick={onOpenStory}>
            Answer with Quill
          </button>
        </div>
      )}
    </li>
  );
}

interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** A "More" button that opens a short list of less-used actions. Escape or a click outside closes it. */
function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
  };

  return (
    <div className="more-menu" ref={ref}>
      <button ref={buttonRef} type="button" className="btn-ghost" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        More ▾
      </button>
      {open && (
        <div className="more-menu-list" role="menu" onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`more-menu-item${item.danger ? " is-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
