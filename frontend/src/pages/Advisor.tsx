import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, clearSession, sendChat } from "../api";
import { parseAssistantResponse } from "../parse";
import { displayName, profileSummary, useProfile } from "../profile";
import { makeTitle, newId } from "../storage";
import type { Handoff, Health } from "../App";
import type { Conversation, Message } from "../types";
import { Composer } from "../components/Composer";
import { GuidedView } from "../components/story/GuidedView";
import { StoryView, type AskOptions } from "../components/story/StoryView";
import { useAuth } from "../auth";
import { useGame } from "../game/GameProvider";
import { getStore } from "../data";
import { mentorById } from "../game/characters";
import { openerFor } from "../game/openers";

interface AdvisorProps {
  userId: string;
  visible: boolean;
  onHealth: (health: Health) => void;
  handoff: Handoff | null;
}

type Chats = Record<string, Conversation>;

/** Each advisor keeps its own chat, saved to the account so it survives logout and reloads. */
export function Advisor({ userId, visible, onHealth, handoff }: AdvisorProps) {
  const { account } = useAuth();
  const { profile } = useProfile();
  const { mentor, updateSettings, state } = useGame();
  const storyMode = state.storyMode;

  const mentorRef = useRef(mentor);
  mentorRef.current = mentor;

  const [chats, setChats] = useState<Chats>({});
  /** Advisor whose reply is in flight (only one request at a time). */
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const pending = pendingFor !== null;
  const [freshId, setFreshId] = useState<string | null>(null);
  const conversation = chats[mentor.id] ?? null;

  const abortRef = useRef<AbortController | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const nameRef = useRef("");
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  /** Conversation id → updatedAt last written to the store. */
  const savedRef = useRef(new Map<string, number>());
  const contextRef = useRef<string | null>(null);
  const summary = useMemo(() => profileSummary(profile), [profile]);
  contextRef.current = summary || null;

  const setChat = useCallback((mentorId: string, change: (c: Conversation | null) => Conversation | null) => {
    setChats((all) => {
      const next = change(all[mentorId] ?? null);
      if (!next) {
        const { [mentorId]: _removed, ...rest } = all;
        return rest;
      }
      return { ...all, [mentorId]: next };
    });
  }, []);

  useEffect(() => {
    setChats({});
    setFreshId(null);
    setPendingFor(null);
    abortRef.current?.abort();
    abortRef.current = null;
    savedRef.current = new Map();

    let cancelled = false;
    getStore()
      .then((store) => store.conversations.list(userId))
      .then((list) => {
        if (cancelled) return;
        // Newest first: keep each advisor's latest chat, without clobbering one started while loading.
        const loaded: Chats = {};
        for (const c of list) {
          const id = c.mentorId ?? "sage";
          if (!loaded[id]) loaded[id] = { ...c, mentorId: id };
          savedRef.current.set(c.id, c.updatedAt);
        }
        setChats((current) => ({ ...loaded, ...current }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Persist any chat that changed since it was last saved.
  useEffect(() => {
    for (const c of Object.values(chats)) {
      if (!c.messages.length || savedRef.current.get(c.id) === c.updatedAt) continue;
      savedRef.current.set(c.id, c.updatedAt);
      getStore()
        .then((store) => store.conversations.save(userId, c))
        .catch(() => savedRef.current.delete(c.id));
    }
  }, [chats, userId]);

  useEffect(() => {
    if (visible) {
      document.title = storyMode
        ? "Story · Track2College"
        : conversation?.messages.length
          ? `${conversation.title} · Track2College`
          : "Advisor · Track2College";
    }
  }, [visible, storyMode, conversation?.title, conversation?.messages.length]);

  const appendMessage = useCallback(
    (mentorId: string, message: Message, sessionId?: string) => {
      setChat(mentorId, (c) =>
        c ? { ...c, sessionId: sessionId ?? c.sessionId, messages: [...c.messages, message], updatedAt: Date.now() } : c,
      );
    },
    [setChat],
  );

  const request = useCallback(
    async (query: string, sessionId: string | null, persona: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPendingFor(persona);

      try {
        const response = await sendChat(query, sessionId, contextRef.current, controller.signal, persona);
        const parsed = parseAssistantResponse(response.answer);
        const message: Message = {
          id: newId(),
          role: "assistant",
          content: parsed.answer || response.answer,
          sources: parsed.sources,
          followups: parsed.followups,
          ...(parsed.mood ? { mood: parsed.mood } : {}),
          mentorId: persona,
          responseTimeMs: response.response_time_ms,
          createdAt: Date.now(),
        };
        appendMessage(persona, message, response.session_id);
        setFreshId(message.id);
        onHealth("online");
      } catch (error) {
        if (controller.signal.aborted) return;
        const content = error instanceof ApiError ? error.message : "Something went wrong while generating a response.";
        if (error instanceof ApiError && error.offline) onHealth("offline");
        appendMessage(persona, { id: newId(), role: "assistant", content, error: true, createdAt: Date.now() });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPendingFor(null);
        }
      }
    },
    [appendMessage, onHealth],
  );

  const send = useCallback(
    (text: string, fresh = false, options: AskOptions = {}) => {
      const query = text.trim();
      if (!query || abortRef.current) return;

      const persona = options.mentorId ?? mentorRef.current.id;
      if (options.mentorId && options.mentorId !== mentorRef.current.id) {
        updateSettings({ mentorId: options.mentorId });
      }

      const now = Date.now();
      const userMessage: Message = { id: newId(), role: "user", content: query, createdAt: now };
      const current = chatsRef.current[persona] ?? null;

      if (current && current.messages.length > 0 && !fresh) {
        setChat(persona, () => ({ ...current, messages: [...current.messages, userMessage], updatedAt: now }));
        request(query, current.sessionId, persona);
        return;
      }

      if (fresh && current?.sessionId) clearSession(current.sessionId);
      const next: Conversation = {
        id: current && !fresh ? current.id : newId(),
        title: makeTitle(query),
        sessionId: fresh ? null : (current?.sessionId ?? null),
        mentorId: persona,
        // Freeze the opening message the student saw, so it stays even as the profile changes.
        intro: current?.intro ?? openerFor(mentorById(persona), profileRef.current, nameRef.current).text,
        messages: [userMessage],
        createdAt: current && !fresh ? current.createdAt : now,
        updatedAt: now,
      };
      setChat(persona, () => next);
      setFreshId(null);
      request(query, next.sessionId, persona);
    },
    [request, updateSettings, setChat],
  );

  const retry = useCallback(() => {
    const persona = mentorRef.current.id;
    const convo = chatsRef.current[persona];
    if (!convo || abortRef.current) return;
    const lastUser = [...convo.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setChat(persona, () => ({
      ...convo,
      messages: convo.messages.at(-1)?.error ? convo.messages.slice(0, -1) : convo.messages,
      updatedAt: Date.now(),
    }));
    request(lastUser.content, convo.sessionId, persona);
  }, [request, setChat]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPendingFor(null);
  }, []);

  const sendRef = useRef(send);
  const retryRef = useRef(retry);
  const storyRef = useRef(storyMode);
  sendRef.current = send;
  retryRef.current = retry;
  storyRef.current = storyMode;

  const onAsk = useCallback((question: string, options?: AskOptions) => {
    const persona = options?.mentorId ?? mentorRef.current.id;
    const hasHistory = (chatsRef.current[persona]?.messages.length ?? 0) > 0;
    sendRef.current(question, hasHistory ? false : !!options?.fresh, options);
  }, []);
  const onRetry = useCallback(() => retryRef.current(), []);
  /** Story mode hands a question to a guide: switch to Manual and ask it there. */
  const onGuidedAsk = useCallback(
    (prompt: string, mentorId: string) => {
      updateSettings({ storyMode: false });
      onAsk(prompt, { mentorId: mentorId as AskOptions["mentorId"] });
    },
    [onAsk, updateSettings],
  );
  const onSend = useCallback((text: string) => sendRef.current(text), []);

  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.id) return;
    handled.current = handoff.id;
    if (abortRef.current) stop();
    if (storyRef.current) updateSettings({ storyMode: false });
    const hasHistory = (chatsRef.current[mentorRef.current.id]?.messages.length ?? 0) > 0;
    sendRef.current(handoff.text, !hasHistory);
  }, [handoff, stop, updateSettings]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && abortRef.current) stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, stop]);

  const name = displayName(profile, account?.name ?? "");
  nameRef.current = name;

  return (
    <div className="advisor" hidden={!visible}>
      <div className="main">
        {storyMode ? (
          <GuidedView visible={visible} studentName={name} userId={userId} onAsk={onGuidedAsk} />
        ) : (
          <>
            <StoryView
              messages={conversation?.messages ?? []}
              pending={!!conversation && pendingFor === mentor.id}
              busy={pending}
              freshId={freshId}
              visible={visible}
              studentName={name}
              intro={conversation?.intro ?? mentor.greeting(name)}
              onAsk={onAsk}
              onRetry={onRetry}
              composer={
                <Composer
                  busy={pending}
                  onSend={onSend}
                  onStop={stop}
                  focusKey={visible ? (conversation?.id ?? "new") : "hidden"}
                  placeholder={`Message ${mentor.name}…`}
                />
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
