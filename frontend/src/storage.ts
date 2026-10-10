import type { Conversation } from "./types";

const STORAGE_KEY = "t2c.conversations.v1";
const ACTIVE_KEY = "t2c.active.v1";
const MAX_STORED = 50;

export interface StoredState {
  conversations: Conversation[];
  activeId: string | null;
}

export function loadState(): StoredState {
  try {
    const conversations = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Conversation[];
    const activeId = localStorage.getItem(ACTIVE_KEY);
    return {
      conversations: Array.isArray(conversations) ? conversations : [],
      activeId: conversations.some((c) => c.id === activeId) ? activeId : null,
    };
  } catch {
    return { conversations: [], activeId: null };
  }
}

export function saveState({ conversations, activeId }: StoredState): void {
  try {
    const kept = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage full or disabled (e.g. private mode); history just won't persist.
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export function makeTitle(query: string): string {
  const clean = query.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}
