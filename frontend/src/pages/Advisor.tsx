import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, clearSession, sendChat } from "../api";
import { parseAssistantResponse } from "../parse";
import { displayName, profileSummary, useProfile } from "../profile";
import { makeTitle, newId } from "../storage";
import type { Handoff, Health } from "../App";
import type { Conversation, Message } from "../types";
import { ChatView } from "../components/ChatView";
import { Composer } from "../components/Composer";
import { Character } from "../components/story/Character";
import { GuidedView } from "../components/story/GuidedView";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { mentorById, specialistFor, type Mentor } from "../game/characters";
import { STAGE_GUIDE, stageFor, useCurrentStage } from "../journey/guides";
import { journeyOf, togglePiq, type CheckpointId } from "../journey/logic";
import { openerFor, type OpenerAction } from "../game/openers";

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
  const { profile, update } = useProfile();

  const [chats, setChats] = useState<Chats>({});
  /** Advisor whose reply is in flight (only one request at a time). */
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const pending = pendingFor !== null;
  const [freshId, setFreshId] = useState<string | null>(null);

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
    if (visible) document.title = "Chatbot · Track2College";
  }, [visible]);

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
    (text: string, fresh: boolean, persona: Mentor["id"]) => {
      const query = text.trim();
      if (!query || abortRef.current) return;

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
    [request, setChat],
  );

  const retry = useCallback((persona: string) => {
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
  sendRef.current = send;
  retryRef.current = retry;

  // The chat is with the current chapter's guide, or with the person whose planet the student
  // clicked. Moving on to a new chapter returns the chat to that chapter's guide.
  const currentStage = useCurrentStage();
  const currentStageRef = useRef(currentStage);
  currentStageRef.current = currentStage;
  const [selectedStage, setSelectedStage] = useState<CheckpointId | null>(null);
  useEffect(() => setSelectedStage(null), [currentStage]);
  const guide = mentorById(STAGE_GUIDE[selectedStage ?? currentStage]);
  const guideRef = useRef(guide.id);
  guideRef.current = guide.id;

  /** Ask a guide (the one on screen by default); a different guide brings their planet into focus. */
  const askGuide = useCallback((prompt: string, mentorId: Mentor["id"] = guideRef.current) => {
    if (mentorId !== guideRef.current) setSelectedStage(stageFor(mentorId, currentStageRef.current));
    const hasHistory = (chatsRef.current[mentorId]?.messages.length ?? 0) > 0;
    sendRef.current(prompt, !hasHistory, mentorId);
  }, []);
  const onGuideFollowup = useCallback((question: string) => askGuide(question), [askGuide]);
  const onGuideRetry = useCallback(() => retryRef.current(guideRef.current), []);
  const onGuideSend = useCallback((text: string) => sendRef.current(text, false, guideRef.current), []);

  // Questions sent from other pages (Profile, Essays, Transcript) go to the guide who covers them.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.id) return;
    handled.current = handoff.id;
    if (abortRef.current) stop();
    askGuide(handoff.text, specialistFor(handoff.text));
  }, [handoff, stop, askGuide]);

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
  const guideChat = chats[guide.id] ?? null;
  const guideBusy = pendingFor === guide.id;
  // Before the first message, the guide opens with a line (and quick actions) based on the profile.
  const opener = useMemo(() => openerFor(guide, profile, name), [guide, profile, name]);
  const started = !!guideChat?.messages.length;

  const runOpener = (action: OpenerAction) => {
    if (action.kind === "pickPiq") {
      update((p) => {
        const journey = journeyOf(p);
        return action.piqId in journey.piqs ? p : { ...p, ucJourney: togglePiq(journey, action.piqId) };
      });
    }
    askGuide(action.prompt, guide.id);
  };

  return (
    <div className="advisor" hidden={!visible}>
      <div className="main">
        <GuidedView
          visible={visible}
          studentName={name}
          userId={userId}
          onAsk={askGuide}
          guideName={guide.name}
          selectedStage={selectedStage}
          onSelectStage={setSelectedStage}
          chat={
            <>
              <ChatView
                intro={
                  <>
                    <div className="guided-chat-head" title={guide.specialty}>
                      <Character
                        key={guide.id}
                        mentor={guide}
                        mood={guideBusy ? "thinking" : "happy"}
                        size={120}
                        className="guided-speaker-avatar"
                      />
                      <span>
                        <strong>{guide.name}</strong>
                        <small>{guide.title}</small>
                      </span>
                    </div>
                    <div className="row row-assistant">
                      <div className="bubble bubble-assistant">{started ? (guideChat?.intro ?? guide.greeting(name)) : opener.text}</div>
                    </div>
                    {!started && !guideBusy && opener.actions.length > 0 && (
                      <div className="story-opener-actions" role="group" aria-label={`${guide.name}'s suggestions`}>
                        {opener.actions.map((a) => (
                          <button key={a.label} type="button" className="story-opener-action" onClick={() => runOpener(a)} disabled={pending}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                }
                messages={guideChat?.messages ?? []}
                pending={guideBusy}
                busy={pending}
                freshId={freshId}
                onFollowup={onGuideFollowup}
                onRetry={onGuideRetry}
              />
              <Composer
                busy={pending}
                onSend={onGuideSend}
                onStop={stop}
                focusKey={visible ? (guideChat?.id ?? `story-${guide.id}`) : "hidden"}
                placeholder={`Message ${guide.name}…`}
              />
            </>
          }
        />
      </div>
    </div>
  );
}
