import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, checkHealth, clearSession, sendChat } from "./api";
import { parseAssistantResponse } from "./parse";
import { loadState, makeTitle, newId, saveState } from "./storage";
import type { Conversation, Message } from "./types";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { MoonIcon, PlusIcon, SidebarIcon, SunIcon } from "./components/icons";

type Theme = "light" | "dark";
type Health = "checking" | "online" | "offline";

const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;

export default function App() {
  const [initial] = useState(loadState);
  const [conversations, setConversations] = useState<Conversation[]>(initial.conversations);
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? "light");
  const [health, setHealth] = useState<Health>("checking");

  const abortRef = useRef<AbortController | null>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const busy = pendingId !== null;

  useEffect(() => {
    saveState({ conversations, activeId });
  }, [conversations, activeId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("t2c.theme", theme);
  }, [theme]);

  useEffect(() => {
    let controller = new AbortController();
    const probe = async () => {
      controller.abort();
      controller = new AbortController();
      setHealth((await checkHealth(controller.signal)) ? "online" : "offline");
    };
    probe();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") probe();
    }, 30_000);
    return () => {
      window.clearInterval(id);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    document.title = active ? `${active.title} · Track2College` : "Track2College";
  }, [active?.title]);

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
        const response = await sendChat(query, sessionId, controller.signal);
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
        setHealth("online");
      } catch (error) {
        if (controller.signal.aborted) return;
        const content =
          error instanceof ApiError ? error.message : "Something went wrong while generating a response.";
        if (error instanceof ApiError && content.startsWith("Couldn't reach")) setHealth("offline");
        appendMessage(conversationId, { id: newId(), role: "assistant", content, error: true, createdAt: Date.now() });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPendingId(null);
        }
      }
    },
    [appendMessage],
  );

  const send = useCallback(
    (text: string) => {
      const query = text.trim();
      if (!query || abortRef.current) return;

      const now = Date.now();
      const userMessage: Message = { id: newId(), role: "user", content: query, createdAt: now };
      const existing = conversationsRef.current.find((c) => c.id === activeId);

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
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId, pendingId, stop],
  );

  // Stable handlers keep memoized message rows from re-rendering on every keystroke or reveal frame.
  const sendRef = useRef(send);
  const retryRef = useRef(retry);
  sendRef.current = send;
  retryRef.current = retry;
  const onFollowup = useCallback((question: string) => sendRef.current(question), []);
  const onRetry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        newChat();
      }
      if (event.key === "Escape" && abortRef.current) stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newChat, stop]);

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onSelect={selectConversation}
        onDelete={deleteConversation}
      />

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <>
                <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar" title="Open sidebar">
                  <SidebarIcon />
                </button>
                <button className="icon-btn" onClick={newChat} aria-label="New chat" title="New chat (⌘⇧O)">
                  <PlusIcon />
                </button>
              </>
            )}
            <span className="topbar-title">{active?.title ?? "Track2College"}</span>
          </div>
          <div className="topbar-right">
            <span className={`status status-${health}`} title={`API ${health}`}>
              <span className="status-dot" />
              {health === "online" ? "Online" : health === "offline" ? "Offline" : "Connecting"}
            </span>
            <button
              className="icon-btn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title="Toggle theme"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
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
          <EmptyState onPick={send} />
        )}

        <Composer busy={busy} onSend={send} onStop={stop} focusKey={activeId ?? "new"} />
      </main>
    </div>
  );
}
