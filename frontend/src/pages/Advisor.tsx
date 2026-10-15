import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, clearSession, sendChat } from "../api";
import { parseAssistantResponse } from "../parse";
import { displayName, profileSummary, useProfile } from "../profile";
import { getStore } from "../data";
import { makeTitle, newId, readJSON, userKey, writeJSON } from "../storage";
import type { Handoff, Health } from "../App";
import type { Conversation, Message, Profile } from "../types";
import { Sidebar } from "../components/Sidebar";
import { ChatView } from "../components/ChatView";
import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { PlusIcon, SidebarIcon, UserIcon } from "../components/icons";
import { useAuth } from "../auth";

const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;

interface AdvisorProps {
  userId: string;
  visible: boolean;
  health: Health;
  onHealth: (health: Health) => void;
  handoff: Handoff | null;
}

function suggestionsFor(p: Profile) {
  const college = p.colleges[0]?.name;
  const major = p.goals.majors.find((m) => m !== "Undecided");
  const list = [
    college
      ? { title: college, prompt: `What does ${college} look for in freshman applicants?` }
      : { title: "Applications", prompt: "What do UC schools look for in freshman applicants?" },
    { title: "Financial aid", prompt: "What do I need to complete the FAFSA, and when is it due?" },
    major
      ? { title: major, prompt: `Which schools have strong ${major} programs, and how competitive are they?` }
      : { title: "Choosing a major", prompt: "Do I need to pick a major when I apply?" },
    { title: "Requirements", prompt: "What are the A–G course requirements for UC and CSU?" },
  ];
  return list;
}

export function Advisor({ userId, visible, health, onHealth, handoff }: AdvisorProps) {
  const { account } = useAuth();
  const { profile } = useProfile();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const savedVersions = useRef(new Map<string, number>());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  const [personalize, setPersonalize] = useState(() => readJSON(userKey(userId, "personalize"), true));

  const abortRef = useRef<AbortController | null>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const contextRef = useRef<string | null>(null);
  const summary = useMemo(() => profileSummary(profile), [profile]);
  contextRef.current = personalize && summary ? summary : null;

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const busy = pendingId !== null;

  useEffect(() => {
    let cancelled = false;
    getStore()
      .then((store) => store.conversations.list(userId))
      .catch(() => [] as Conversation[])
      .then((stored) => {
        if (cancelled) return;
        for (const c of stored) savedVersions.current.set(c.id, c.updatedAt);
        // Merge, since a handoff may have started a conversation before history finished loading.
        setConversations((current) => [...current, ...stored.filter((s) => !current.some((c) => c.id === s.id))]);
        const lastActive = readJSON<string | null>(userKey(userId, "activeChat"), null);
        setActiveId((current) => current ?? (stored.some((c) => c.id === lastActive) ? lastActive : null));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!loaded) return;
    const changed = conversations.filter((c) => savedVersions.current.get(c.id) !== c.updatedAt);
    if (!changed.length) return;
    for (const c of changed) savedVersions.current.set(c.id, c.updatedAt);
    getStore().then((store) => Promise.all(changed.map((c) => store.conversations.save(userId, c)))).catch(() => {});
  }, [userId, loaded, conversations]);

  useEffect(() => writeJSON(userKey(userId, "activeChat"), activeId), [userId, activeId]);
  useEffect(() => writeJSON(userKey(userId, "personalize"), personalize), [userId, personalize]);

  useEffect(() => {
    if (visible) document.title = active ? `${active.title} · Track2College` : "Advisor · Track2College";
  }, [visible, active?.title]);

  const updateConversation = useCallback((id: string, update: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? update(c) : c)));
  }, []);

  const appendMessage = useCallback(
    (id: string, message: Message, sessionId?: string) => {
      updateConversation(id, (c) => ({
        ...c,
        sessionId: sessionId ?? c.sessionId,
        messages: [...c.messages, message],
        updatedAt: Date.now(),
      }));
    },
    [updateConversation],
  );

  const request = useCallback(
    async (conversationId: string, query: string, sessionId: string | null) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPendingId(conversationId);

      try {
        const response = await sendChat(query, sessionId, contextRef.current, controller.signal);
        const parsed = parseAssistantResponse(response.answer);
        const message: Message = {
          id: newId(),
          role: "assistant",
          content: parsed.answer || response.answer,
          sources: parsed.sources,
          followups: parsed.followups,
          responseTimeMs: response.response_time_ms,
          createdAt: Date.now(),
        };
        appendMessage(conversationId, message, response.session_id);
        setFreshId(message.id);
        onHealth("online");
      } catch (error) {
        if (controller.signal.aborted) return;
        const content = error instanceof ApiError ? error.message : "Something went wrong while generating a response.";
        if (error instanceof ApiError && error.offline) onHealth("offline");
        appendMessage(conversationId, { id: newId(), role: "assistant", content, error: true, createdAt: Date.now() });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPendingId(null);
        }
      }
    },
    [appendMessage, onHealth],
  );

  const send = useCallback(
    (text: string, fresh = false) => {
      const query = text.trim();
      if (!query || abortRef.current) return;

      const now = Date.now();
      const userMessage: Message = { id: newId(), role: "user", content: query, createdAt: now };
      const existing = fresh ? undefined : conversationsRef.current.find((c) => c.id === activeId);

      if (existing) {
        appendMessage(existing.id, userMessage);
        request(existing.id, query, existing.sessionId);
        return;
      }

      const conversation: Conversation = {
        id: newId(),
        title: makeTitle(query),
        sessionId: null,
        messages: [userMessage],
        createdAt: now,
        updatedAt: now,
      };
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      setFreshId(null);
      request(conversation.id, query, null);
    },
    [activeId, appendMessage, request],
  );

  const retry = useCallback(() => {
    const convo = conversationsRef.current.find((c) => c.id === activeId);
    if (!convo || abortRef.current) return;
    const lastUser = [...convo.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    updateConversation(convo.id, (c) => ({
      ...c,
      messages: c.messages.at(-1)?.error ? c.messages.slice(0, -1) : c.messages,
    }));
    request(convo.id, lastUser.content, convo.sessionId);
  }, [activeId, request, updateConversation]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPendingId(null);
  }, []);

  const closeSidebarOnMobile = () => {
    if (!isDesktop()) setSidebarOpen(false);
  };

  const newChat = useCallback(() => {
    setActiveId(null);
    setFreshId(null);
    closeSidebarOnMobile();
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    setFreshId(null);
    closeSidebarOnMobile();
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      const convo = conversationsRef.current.find((c) => c.id === id);
      if (!convo) return;
      if (pendingId === id) stop();
      if (convo.sessionId) clearSession(convo.sessionId);
      savedVersions.current.delete(id);
      getStore().then((store) => store.conversations.remove(userId, id)).catch(() => {});
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [userId, activeId, pendingId, stop],
  );

  // Stable handlers keep memoized message rows from re-rendering on every keystroke or reveal frame.
  const sendRef = useRef(send);
  const retryRef = useRef(retry);
  sendRef.current = send;
  retryRef.current = retry;
  const onFollowup = useCallback((question: string) => sendRef.current(question), []);
  const onRetry = useCallback(() => retryRef.current(), []);
  const onSend = useCallback((text: string) => sendRef.current(text), []);

  // Questions handed off from other pages always start a new conversation.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.id) return;
    handled.current = handoff.id;
    if (abortRef.current) stop();
    sendRef.current(handoff.text, true);
  }, [handoff, stop]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        newChat();
      }
      if (event.key === "Escape" && abortRef.current) stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, newChat, stop]);

  const name = displayName(profile, account?.name ?? "");
  const suggestions = useMemo(() => suggestionsFor(profile), [profile]);

  return (
    <div className={`advisor ${sidebarOpen ? "sidebar-open" : ""}`} hidden={!visible}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onSelect={selectConversation}
        onDelete={deleteConversation}
      />

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <>
                <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Show conversations" title="Show conversations">
                  <SidebarIcon />
                </button>
                <button className="icon-btn" onClick={newChat} aria-label="New chat" title="New chat (⌘⇧O)">
                  <PlusIcon />
                </button>
              </>
            )}
            <span className="topbar-title">{active?.title ?? "Advisor"}</span>
          </div>
          <div className="topbar-right">
            <button
              className={`toggle-pill ${personalize ? "on" : ""}`}
              onClick={() => setPersonalize((v) => !v)}
              aria-pressed={personalize}
              title={summary ? "Share your profile with the advisor to get tailored answers" : "Fill out your profile to personalize answers"}
              disabled={!summary}
            >
              <UserIcon width={15} height={15} />
              <span>{personalize && summary ? "Using my profile" : "Profile off"}</span>
            </button>
            {health === "offline" && (
              <span className="status status-offline">
                <span className="status-dot" />
                Offline
              </span>
            )}
          </div>
        </header>

        {active && active.messages.length > 0 ? (
          <ChatView
            key={active.id}
            messages={active.messages}
            pending={pendingId === active.id}
            busy={busy}
            freshId={freshId}
            onFollowup={onFollowup}
            onRetry={onRetry}
          />
        ) : (
          <EmptyState name={name} personalized={personalize && !!summary} suggestions={suggestions} onPick={onSend} />
        )}

        <Composer busy={busy} onSend={onSend} onStop={stop} focusKey={visible ? (activeId ?? "new") : "hidden"} />
      </div>
    </div>
  );
}
