import { memo, useMemo } from "react";
import type { Conversation } from "../types";
import { ChatIcon, PlusIcon, SidebarIcon, TrashIcon } from "./icons";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const DAY = 24 * 60 * 60 * 1000;

function groupLabel(timestamp: number, now: number) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (timestamp >= startOfToday) return "Today";
  if (timestamp >= startOfToday - DAY) return "Yesterday";
  if (timestamp >= startOfToday - 7 * DAY) return "Previous 7 days";
  return "Older";
}

export const Sidebar = memo(function Sidebar({
  conversations,
  activeId,
  open,
  onClose,
  onNew,
  onSelect,
  onDelete,
}: SidebarProps) {
  const groups = useMemo(() => {
    const now = Date.now();
    const result: { label: string; items: Conversation[] }[] = [];
    for (const convo of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const label = groupLabel(convo.updatedAt, now);
      const group = result.at(-1);
      if (group?.label === label) group.items.push(convo);
      else result.push({ label, items: [convo] });
    }
    return result;
  }, [conversations]);

  return (
    <>
      <div className={`scrim ${open ? "visible" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Chat history">
        <div className="sidebar-top">
          <span className="sidebar-title">Conversations</span>
          <button className="icon-btn" onClick={onClose} aria-label="Hide conversations" title="Hide conversations">
            <SidebarIcon />
          </button>
        </div>

        <button className="new-chat" onClick={onNew}>
          <PlusIcon width={16} height={16} />
          New chat
        </button>

        <nav className="history">
          {groups.length === 0 && <p className="history-empty">Your conversations will show up here.</p>}
          {groups.map((group) => (
            <div key={group.label} className="history-group">
              <h2 className="history-label">{group.label}</h2>
              {group.items.map((convo) => (
                <div key={convo.id} className={`history-item ${convo.id === activeId ? "active" : ""}`}>
                  <button className="history-select" onClick={() => onSelect(convo.id)} title={convo.title}>
                    <ChatIcon width={15} height={15} />
                    <span>{convo.title}</span>
                  </button>
                  <button
                    className="history-delete"
                    onClick={() => onDelete(convo.id)}
                    aria-label={`Delete "${convo.title}"`}
                    title="Delete"
                  >
                    <TrashIcon width={15} height={15} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
});
