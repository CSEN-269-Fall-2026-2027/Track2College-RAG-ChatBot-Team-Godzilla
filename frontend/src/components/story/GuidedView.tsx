import { useState, type ReactNode } from "react";
import type { Mentor } from "../../game/characters";
import type { Mood } from "../../types";
import { PixelMapIcon } from "../icons";
import { Character } from "./Character";
import { MapDrawer } from "./MapDrawer";
import { MentorSwitcher } from "./MentorSwitcher";

interface GuidedViewProps {
  visible: boolean;
  userId: string;
  /** Chat column (header + messages + composer + guided turn). */
  chat: ReactNode;
  guideName: string;
  mentor: Mentor;
  mentorMood?: Mood;
  /** Once the journey is done (after Apply), students switch between every guide with arrows. */
  mentorPickOpen: boolean;
  onSelectMentor: (mentorId: Mentor["id"]) => void;
  switcherBusy?: boolean;
  /**
   * The guide is busy on the student's behalf (Quill drafting the essays, John filling in the UC
   * application): they dance while a pencil writes beside them, with this caption underneath.
   */
  busyCaption?: string | null;
  /** Map popup — opened from the character-box Map button. */
  mapOpen?: boolean;
  onMapOpenChange?: (open: boolean) => void;
}

/**
 * Character column (~28% width) with optional mentor switcher; chat the rest.
 * Journey map stays a popup from the character-box Map button.
 */
export function GuidedView({
  visible,
  userId,
  chat,
  guideName,
  mentor,
  mentorMood = "happy",
  mentorPickOpen,
  onSelectMentor,
  switcherBusy,
  busyCaption = null,
  mapOpen: mapOpenProp,
  onMapOpenChange,
}: GuidedViewProps) {
  const writing = !!busyCaption;
  const [internalOpen, setInternalOpen] = useState(false);
  const mapOpen = mapOpenProp ?? internalOpen;
  const setMapOpen = (open: boolean) => {
    onMapOpenChange?.(open);
    if (mapOpenProp === undefined) setInternalOpen(open);
  };

  return (
    <div className={`story story-guided${visible ? "" : " is-hidden"}`}>
      <div className="scene scene-plain" aria-hidden="true" />

      <div className="guided-layout">
        <aside className="guided-character-col" aria-label={mentor.name}>
          <button
            type="button"
            className="guided-map-btn"
            onClick={() => setMapOpen(true)}
            aria-label="Open journey map"
            title="Journey map"
          >
            <PixelMapIcon size={28} />
            <span>Map</span>
          </button>
          <div className={`guided-character-stage${writing ? " is-writing" : ""}`}>
            <div className="guided-stage-figure">
              <Character
                key={mentor.id}
                mentor={mentor}
                mood={mentorMood}
                size={280}
                className={`guided-stage-avatar${writing ? " is-dancing" : ""}`}
              />
              {writing && (
                <span className="writing-page" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <svg className="writing-pencil" viewBox="0 0 24 24" width="28" height="28">
                    <path d="M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z" fill="#f2c230" stroke="#232a3a" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M15 6.5l2.5 2.5 2-2a1.77 1.77 0 0 0-2.5-2.5l-2 2z" fill="#e58c8c" stroke="#232a3a" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </div>
            {writing && (
              <p className="writing-caption" role="status">
                {busyCaption}
              </p>
            )}
            <div className="guided-stage-meta">
              <strong>{mentor.name}</strong>
              <small>{mentor.title}</small>
            </div>
          </div>
          {mentorPickOpen && <MentorSwitcher activeId={mentor.id} onSelect={onSelectMentor} busy={switcherBusy} />}
        </aside>

        <section className="guided-chat story-chat-thread" aria-label={`Chat with ${guideName}`}>
          {chat}
        </section>
      </div>

      <MapDrawer userId={userId} open={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  );
}
