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
  applyUnlocked: boolean;
  /** Once on Financial Aid, students can chat with any guide. */
  mentorPickOpen: boolean;
  onSelectMentor: (mentorId: Mentor["id"]) => void;
  switcherBusy?: boolean;
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
  applyUnlocked,
  mentorPickOpen,
  onSelectMentor,
  switcherBusy,
  mapOpen: mapOpenProp,
  onMapOpenChange,
}: GuidedViewProps) {
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
          <div className="guided-character-stage">
            <Character
              key={mentor.id}
              mentor={mentor}
              mood={mentorMood}
              size={280}
              className="guided-stage-avatar"
            />
            <div className="guided-stage-meta">
              <strong>{mentor.name}</strong>
              <small>{mentor.title}</small>
            </div>
          </div>
          {mentorPickOpen && (
            <MentorSwitcher
              activeId={mentor.id}
              applyUnlocked={applyUnlocked}
              onSelect={onSelectMentor}
              busy={switcherBusy}
            />
          )}
        </aside>

        <section className="guided-chat story-chat-thread" aria-label={`Chat with ${guideName}`}>
          {chat}
        </section>
      </div>

      <MapDrawer userId={userId} open={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  );
}
