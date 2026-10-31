import { useCallback, useMemo, type ReactNode } from "react";
import type { Message } from "../../types";
import { MENTORS, type Mentor } from "../../game/characters";
import { useGame } from "../../game/GameProvider";
import { openerFor, type OpenerAction } from "../../game/openers";
import { journeyOf, togglePiq } from "../../journey/logic";
import { useProfile } from "../../profile";
import { ChatView } from "../ChatView";
import { Character } from "./Character";

export interface AskOptions {
  followup?: boolean;
  mentorId?: Mentor["id"];
  fresh?: boolean;
}

interface StoryViewProps {
  messages: Message[];
  pending: boolean;
  busy: boolean;
  freshId: string | null;
  visible: boolean;
  studentName: string;
  onAsk: (question: string, options?: AskOptions) => void;
  onRetry: () => void;
  /** Opening message shown above the conversation once it has started. */
  intro: string;
  /** Message box, rendered under the conversation (not under the guide panel). */
  composer: ReactNode;
}

const GUIDE_BLURB: Record<Mentor["id"], string> = {
  sage: "Admissions",
  penny: "Financial aid",
  quill: "Essays",
  milo: "Majors",
};

/** Conversational advisor: chat + message box on the left, big guide + picker on the right. */
export function StoryView({
  messages,
  pending,
  busy,
  freshId,
  visible,
  studentName,
  onAsk,
  onRetry,
  intro,
  composer,
}: StoryViewProps) {
  const { mentor, updateSettings } = useGame();
  const { profile, update } = useProfile();

  const opener = useMemo(() => openerFor(mentor, profile, studentName), [mentor, profile, studentName]);

  const runAction = (action: OpenerAction) => {
    if (action.kind === "pickPiq") {
      update((p) => {
        const journey = journeyOf(p);
        return action.piqId in journey.piqs ? p : { ...p, ucJourney: togglePiq(journey, action.piqId) };
      });
    }
    onAsk(action.prompt, { mentorId: mentor.id });
  };

  const onFollowup = useCallback(
    (question: string) => onAsk(question, { followup: true, mentorId: mentor.id }),
    [onAsk, mentor.id],
  );

  const selectGuide = (id: Mentor["id"]) => {
    if (id === mentor.id) return;
    updateSettings({ mentorId: id });
  };

  const empty = messages.length === 0 && !pending;
  const talking = pending;

  return (
    <div className={`story story-chat${visible ? "" : " is-hidden"}`}>
      <div className="scene scene-plain" aria-hidden="true" />

      <div className="story-chat-layout">
        <div className="story-chat-thread">
          {empty ? (
            <div className="story-chat-empty">
              <div className="speech-bubble story-chat-greeting" role="status">
                {opener.text}
              </div>
              {opener.actions.length > 0 && (
                <div className="story-opener-actions" role="group" aria-label={`${mentor.name}'s suggestions`}>
                  {opener.actions.map((a) => (
                    <button key={a.label} type="button" className="story-opener-action" onClick={() => runAction(a)} disabled={busy}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ChatView
              intro={
                <div className="speech-bubble story-chat-greeting story-chat-intro" role="note">
                  {intro}
                </div>
              }
              messages={messages}
              pending={pending}
              busy={busy}
              freshId={freshId}
              onFollowup={onFollowup}
              onRetry={onRetry}
            />
          )}
          {composer}
        </div>

        <aside className="story-guide-rail" aria-label="Choose a guide">
          <div className="story-guide-stage">
            <Character
              key={mentor.id}
              mentor={mentor}
              mood={pending ? "thinking" : "happy"}
              talking={talking}
              size={360}
              className="story-mentor story-mentor-lg"
            />
            <div className="story-guide-meta">
              <strong>{mentor.name}</strong>
              <span>{mentor.title}</span>
              <p>{mentor.specialty}</p>
            </div>
          </div>

          <div className="story-guide-picker" role="tablist" aria-label="Guides">
            {MENTORS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={m.id === mentor.id}
                className={`story-guide-pick ${m.id === mentor.id ? "on" : ""}`}
                onClick={() => selectGuide(m.id)}
              >
                <Character mentor={m} mood={m.id === mentor.id ? "happy" : "neutral"} size={48} className="story-guide-thumb" />
                <span className="story-guide-pick-text">
                  <strong>{m.name}</strong>
                  <small>{GUIDE_BLURB[m.id]}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
