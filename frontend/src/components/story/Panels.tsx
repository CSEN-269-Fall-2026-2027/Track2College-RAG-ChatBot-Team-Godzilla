import { useEffect, type ReactNode } from "react";
import { MENTORS, type Mentor } from "../../game/characters";
import { useGame } from "../../game/GameProvider";
import { chime } from "../../game/sound";
import { Character } from "./Character";
import { XIcon } from "../icons";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="story-drawer-wrap">
      <button className="story-drawer-scrim" onClick={onClose} aria-label="Close panel" tabIndex={-1} />
      <aside className="story-drawer" role="dialog" aria-label={title}>
        <header className="story-drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon width={16} height={16} />
          </button>
        </header>
        <div className="story-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function MentorSelect({ onPicked }: { onPicked: (mentor: Mentor) => void }) {
  const { state, updateSettings } = useGame();
  return (
    <ul className="mentor-list">
      {MENTORS.map((m) => {
        const active = m.id === state.mentorId;
        return (
          <li key={m.id}>
            <button
              className={`mentor-card ${active ? "active" : ""}`}
              style={{ ["--mentor-accent" as string]: m.palette.accent }}
              aria-pressed={active}
              onClick={() => {
                if (state.sound) chime("select");
                updateSettings({ mentorId: m.id });
                onPicked(m);
              }}
            >
              <span className="mentor-card-art">
                <Character mentor={m} mood={active ? "happy" : "neutral"} size={92} />
              </span>
              <span className="mentor-card-text">
                <span className="mentor-card-name">
                  {m.name} {active && <em>Current</em>}
                </span>
                <span className="mentor-card-title">{m.title}</span>
                <span className="mentor-card-spec">{m.specialty}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
