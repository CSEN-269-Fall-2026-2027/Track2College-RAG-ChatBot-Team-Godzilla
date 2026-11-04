import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, clearSession, sendChat } from "../api";
import { parseAssistantResponse } from "../parse";
import { displayName, profileSummary, useProfile } from "../profile";
import { makeTitle, newId } from "../storage";
import type { Handoff, Health } from "../App";
import type { AidMode, Conversation, Message, PersonalInfo, ReviewMode, StoryMode } from "../types";
import { ChatView } from "../components/ChatView";
import { Composer } from "../components/Composer";
import { Character } from "../components/story/Character";
import { RetryIcon } from "../components/icons";
import { GuidedView } from "../components/story/GuidedView";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { mentorById, specialistFor, type Mentor } from "../game/characters";
import { STAGE_GUIDE, stageFor, useCurrentStage } from "../journey/guides";
import { journeyOf, togglePiq, type CheckpointId } from "../journey/logic";
import { openerFor, type OpenerAction, type ReviewTool } from "../game/openers";
import { ReviewToolDialog } from "../components/story/ReviewApply";
import { agentOf, applyProgressSummary, cleanTranscriptLine } from "../agent/logic";

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

  // Review & Apply: the chat is with the persona the student picked (Counselor or Application assistant).
  const currentStage = useCurrentStage();
  const currentStageRef = useRef(currentStage);
  currentStageRef.current = currentStage;
  const agent = agentOf(profile);
  const reviewMode: ReviewMode = agent.reviewMode ?? "counselor";
  // Financial Aid: Penny's chat follows the mode the student picked (FAFSA or Scholarships).
  const aidMode: AidMode | null = currentStage === "aid" ? (agent.aidMode ?? "fafsa") : null;
  const aidModeRef = useRef(aidMode);
  aidModeRef.current = aidMode;
  /** The mode to send with a request: the Review & Apply personas' own, or Penny's on Financial Aid. */
  const modeFor = (persona: string): StoryMode | null =>
    persona === "counselor" || persona === "assistant" ? persona : persona === "penny" ? aidModeRef.current : null;
  const callRef = useRef(agent.counselorCall);
  callRef.current = agent.counselorCall;
  // Birthday / birthplace live in their own table (from the call with Jordan); the chat only says
  // whether they're on file. Re-read after each call, since that's when they're saved.
  const [personal, setPersonal] = useState<PersonalInfo | null>(null);
  const callEndedAt = agent.counselorCall?.endedAt;
  useEffect(() => {
    let live = true;
    getStore()
      .then((store) => store.personalInfo.get(userId))
      .then((info) => live && setPersonal(info ?? {}))
      .catch(() => live && setPersonal(null));
    return () => {
      live = false;
    };
  }, [userId, callEndedAt]);
  /** What the application tools did (counselor, UC account, Intent to Register, dates): every guide gets it. */
  const progressRef = useRef("");
  progressRef.current = useMemo(() => applyProgressSummary(profile, personal), [profile, personal]);
  /**
   * The profile and application progress go with every message (/chat takes up to 6000 characters).
   * The Counselor also gets the last call with Jordan, keeping its latest lines.
   */
  const contextFor = (persona: string) => {
    const base = [contextRef.current, progressRef.current].filter(Boolean).join("\n\n").slice(0, 6000);
    const lines = callRef.current?.lines ?? [];
    if (modeFor(persona) !== "counselor" || !lines.length) return base || null;
    const call = lines.map((l) => `${l.role === "student" ? "Student" : "Jordan"}: ${cleanTranscriptLine(l.text)}`).join("\n");
    // /chat accepts up to 6000 characters of profile context. The call always keeps at least 1500
    // of them (its latest lines); the profile above it gives way if needed.
    const label = "\n\nVIRTUAL COUNSELOR CALL (latest, with Jordan):\n";
    const recent = call.slice(-Math.max(1500, 6000 - base.length - label.length));
    return base.slice(0, 6000 - label.length - recent.length) + label + recent;
  };

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
    // Every session starts with empty chats. Earlier sessions' chats stay saved in Supabase as the
    // record of what the student asked, but they're never loaded back in.
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
        const response = await sendChat(query, sessionId, contextFor(persona), controller.signal, persona, modeFor(persona));
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
    (text: string, fresh: boolean, persona: Mentor["id"], preset = false) => {
      const query = text.trim();
      if (!query || abortRef.current) return;

      const now = Date.now();
      const userMessage: Message = { id: newId(), role: "user", content: query, createdAt: now, ...(preset ? { preset: true } : {}) };
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
        intro: current?.intro ?? openerFor(mentorById(persona), profileRef.current, nameRef.current, modeFor(persona)).text,
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
  const [selectedStage, setSelectedStage] = useState<CheckpointId | null>(null);
  useEffect(() => setSelectedStage(null), [currentStage]);
  const stage = selectedStage ?? currentStage;
  const guide = mentorById(stage === "review" ? reviewMode : STAGE_GUIDE[stage]);
  /** The application tool open under the Review & Apply persona's first message. */
  const [reviewTool, setReviewTool] = useState<ReviewTool | null>(null);
  const guideRef = useRef(guide.id);
  guideRef.current = guide.id;

  /** Ask a guide (the one on screen by default); a different guide brings their planet into focus. */
  /** Sends a ready-made question (a button, or a hand-off from another page) to a guide. */
  const askGuide = useCallback((prompt: string, mentorId: Mentor["id"] = guideRef.current, preset = true) => {
    if (mentorId !== guideRef.current) setSelectedStage(stageFor(mentorId, currentStageRef.current));
    const hasHistory = (chatsRef.current[mentorId]?.messages.length ?? 0) > 0;
    sendRef.current(prompt, !hasHistory, mentorId, preset);
  }, []);
  /** A message from a guide that isn't a model reply (the call log, a mode switch). Starts the chat if needed. */
  const postNote = useCallback(
    (content: string, mentorId: Mentor["id"]) => {
      const now = Date.now();
      const note: Message = { id: newId(), role: "assistant", content, mentorId, createdAt: now };
      setChat(mentorId, (c) =>
        c?.messages.at(-1)?.content === content
          ? c
          : c
            ? { ...c, messages: [...c.messages, note], updatedAt: now }
          : {
              id: newId(),
              title: mentorId === "counselor" || mentorId === "assistant" ? "Review & Apply" : mentorId === "penny" && aidModeRef.current ? "Financial Aid" : makeTitle(content),
              sessionId: null,
              mentorId,
              intro: openerFor(mentorById(mentorId), profileRef.current, nameRef.current, modeFor(mentorId)).text,
              messages: [note],
              createdAt: now,
              updatedAt: now,
            },
      );
      setFreshId(note.id);
    },
    [setChat],
  );
  const onCallLog = useCallback(
    (text: string) => {
      postNote(text, "counselor");
    },
    [postNote],
  );

  // Restarting a guide's chat (the restart button, or switching modes) goes back to the opening
  // message. The old chat stays saved as a record of what was asked; it just leaves the screen.
  const restartChat = useCallback(
    (mentorId: Mentor["id"]) => {
      if (pendingFor === mentorId) stop();
      const old = chatsRef.current[mentorId];
      if (!old) return;
      if (old.sessionId) void clearSession(old.sessionId);
      setChat(mentorId, () => null);
      setFreshId(null);
    },
    [pendingFor, stop, setChat],
  );
  const onModeChange = useCallback(
    (_mode: ReviewMode) => {
      restartChat("counselor");
      restartChat("assistant");
      setReviewTool(null);
    },
    [restartChat],
  );
  const onAidModeChange = useCallback((_mode: AidMode) => restartChat("penny"), [restartChat]);

  const onGuideFollowup = useCallback((question: string) => askGuide(question, guideRef.current, false), [askGuide]);
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
  const guideMode = guide.id === "penny" ? aidMode : null;
  // The Review & Apply personas keep their buttons under the first message for the whole chat.
  const reviewGuide = guide.id === "counselor" || guide.id === "assistant";
  const started = !!guideChat?.messages.length;
  const showActions = reviewGuide || (!started && !guideBusy);
  const opener = useMemo(() => openerFor(guide, profile, name, guideMode), [guide, profile, name, guideMode]);
  const runOpener = (action: OpenerAction) => {
    if (action.kind === "tool") {
      setReviewTool(action.tool);
      return;
    }
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
          onModeChange={onModeChange}
          onAidModeChange={onAidModeChange}
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
                      {started && (
                        <button
                          type="button"
                          className="chat-restart"
                          onClick={() => restartChat(guide.id)}
                          aria-label={`Restart your chat with ${guide.name}`}
                          title="Start over from the first message"
                        >
                          <RetryIcon width={14} height={14} />
                          <span>Restart</span>
                        </button>
                      )}
                    </div>
                    <div className="row row-assistant">
                      <div className="bubble bubble-assistant">{started ? (guideChat?.intro ?? guide.greeting(name)) : opener.text}</div>
                    </div>
                    {showActions && opener.actions.length > 0 && (
                      <div className="story-opener-actions" role="group" aria-label={`${guide.name}'s suggestions`}>
                        {opener.actions.map((a) => {
                          const open = a.kind === "tool" && reviewTool === a.tool;
                          return (
                            <button
                              key={a.label}
                              type="button"
                              className={`story-opener-action${open ? " on" : ""}`}
                              onClick={() => runOpener(a)}
                              disabled={a.kind !== "tool" && pending}
                              aria-pressed={a.kind === "tool" ? open : undefined}
                            >
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {reviewGuide && reviewTool && opener.actions.some((a) => a.kind === "tool" && a.tool === reviewTool) && (
                      <ReviewToolDialog tool={reviewTool} onClose={() => setReviewTool(null)} onCallLog={onCallLog} />
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
