import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, clearSession, sendChat } from "../api";
import { useGoogleActivities } from "../googleActivities";
import { applyGoogleActivitySuggestions, googleActivitiesConfirmMessage, withGoogleActivitiesReviewed } from "../journey/googleActivities";
import { parseAssistantResponse } from "../parse";
import { completeness, displayName, profileSummary, useProfile, summaryForGuide, usesProgress } from "../profile";
import { makeTitle, newId } from "../storage";
import type { Handoff, Health } from "../App";
import type { ActivitySectionId, AidMode, Conversation, Message, PersonalInfo, ReviewMode, StoryMode } from "../types";
import { ChatView } from "../components/ChatView";
import { Composer } from "../components/Composer";
import { Markdown } from "../components/Markdown";
import { RetryIcon } from "../components/icons";
import { GuidedView } from "../components/story/GuidedView";
import { GuidedTurnBubble } from "../components/story/GuidedTurnBubble";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { mentorById, specialistFor, type Mentor } from "../game/characters";
import { STAGE_GUIDE, stageFor, useCurrentStage } from "../journey/guides";
import { navigate } from "../router";
import { activitiesStatus, clearOpenActivityAnswer, journeyOf, type CheckpointId } from "../journey/logic";
import { applyGuidedEffect, storyComplete } from "../journey/guided";
import { useGuidedStory } from "../journey/useGuidedStory";
import { activityReportMessage, applyDrafts, chosenPiqs, currentEssay, fillInProfileMessage, ESSAY_FOLLOW_UPS, FOLLOW_UP_THANKS, usedActivities, essayNotesFrom, miloNotes, PERSONAL_ANSWER, piqAboutAsk, piqWorkOf, setPiqAnswer, suggestedPiqTitles } from "../journey/piqs";
import { miloNextLine } from "../journey/miloScript";
import { usePiqDrafts } from "../journey/usePiqDrafts";
import { WHAT_COUNTS_ANSWER } from "../game/campusBlurbs";
import { openerFor, type OpenerAction, type ReviewTool } from "../game/openers";
import { ReviewToolDialog } from "../components/story/ReviewApply";
import { virtualCounselorDone } from "../agent/callState";
import { agentOf, applyProgressSummary, cleanTranscriptLine, setAgent } from "../agent/logic";

interface AdvisorProps {
  userId: string;
  visible: boolean;
  onHealth: (health: Health) => void;
  handoff: Handoff | null;
  /** Topbar can open the journey map drawer. */
  mapOpen?: boolean;
  onMapOpenChange?: (open: boolean) => void;
}

type Chats = Record<string, Conversation>;

/** Each advisor keeps its own chat, saved to the account so it survives logout and reloads. */
export function Advisor({ userId, visible, onHealth, handoff, mapOpen, onMapOpenChange }: AdvisorProps) {
  const { account } = useAuth();
  const { profile, update } = useProfile();
  const piqDrafts = usePiqDrafts();

  const [chats, setChats] = useState<Chats>({});
  /** Advisor whose reply is in flight (only one request at a time). */
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const pending = pendingFor !== null;
  const [freshId, setFreshId] = useState<string | null>(null);
  const [localMapOpen, setLocalMapOpen] = useState(false);
  const drawerOpen = mapOpen ?? localMapOpen;
  const setDrawerOpen = useCallback(
    (open: boolean) => {
      onMapOpenChange?.(open);
      if (mapOpen === undefined) setLocalMapOpen(open);
    },
    [mapOpen, onMapOpenChange],
  );
  const { suggestions: googleSuggestions } = useGoogleActivities();
  const [googleConfirmDismissed, setGoogleConfirmDismissed] = useState(false);

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
    const base = [summaryForGuide(contextRef.current ?? "", persona), usesProgress(persona) ? progressRef.current : ""].filter(Boolean).join("\n\n").slice(0, 6000);
    // Quill works from what the student told Milo and any essay it just wrote in the chat (which
    // never goes through /chat itself). Those keep at least 4000 of the 6000 characters.
    if (persona === "quill") {
      const essay = [...(chatsRef.current.quill?.messages ?? [])].reverse().find((m) => m.essayFor)?.content;
      const notes = miloNotes(journeyOf(profileRef.current));
      const used = usedActivities(profileRef.current, currentEssay(profileRef.current) ?? undefined);
      const extra = [
        used.length ? `\n\nACTIVITIES ALREADY USED IN OTHER ESSAYS: ${used.join(", ")}` : "",
        essay && `\n\nTHE ESSAY YOU JUST WROTE FOR THE STUDENT:\n${essay}`,
        notes && `\n\nWHAT THE STUDENT TOLD MILO ABOUT THEIR ACTIVITIES:\n${notes}`,
      ]
        .filter(Boolean)
        .join("");
      if (extra) {
        const kept = extra.slice(0, Math.max(4000, 6000 - base.length));
        return base.slice(0, 6000 - kept.length) + kept;
      }
    }
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

  // Load the latest chat per advisor from Supabase (empty stubs from "restart" are skipped).
  useEffect(() => {
    let live = true;
    setChats({});
    setFreshId(null);
    setPendingFor(null);
    abortRef.current?.abort();
    abortRef.current = null;
    savedRef.current = new Map();
    getStore()
      .then((store) => store.conversations.list(userId))
      .then((listed) => {
        if (!live) return;
        const latest: Chats = {};
        for (const c of listed) {
          const key = c.mentorId || "sage";
          if (!latest[key] || c.updatedAt > latest[key].updatedAt) latest[key] = c;
        }
        const loaded: Chats = {};
        for (const [key, c] of Object.entries(latest)) {
          if (!c.messages.length) continue;
          loaded[key] = c;
          savedRef.current.set(c.id, c.updatedAt);
        }
        setChats(loaded);
      })
      .catch(() => {
        // Offline / first load: start with empty chats; new messages still save when possible.
      });
    return () => {
      live = false;
    };
  }, [userId]);

  // Persist any chat that changed since it was last saved.
  useEffect(() => {
    for (const c of Object.values(chats)) {
      if (savedRef.current.get(c.id) === c.updatedAt) continue;
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
        const body = parsed.answer || response.answer;
        // After "Suggest four essays", offer a chip per Top 4 + Backup title (same ask as Quill's opener buttons).
        const suggestionChips =
          persona === "quill" && query.trim().toLowerCase().startsWith("suggest four essays")
            ? suggestedPiqTitles(body)
            : [];
        const message: Message = {
          id: newId(),
          role: "assistant",
          content: body,
          sources: parsed.sources,
          followups: suggestionChips.length ? suggestionChips : parsed.followups,
          ...(parsed.options.length ? { options: parsed.options } : {}),
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

  /** Milo's questions are written in advance, so they don't need the model. */
  const sayScripted = useCallback(
    (persona: Mentor["id"], messages: Message[]) => {
      const line = persona === "milo" ? miloNextLine(messages) : null;
      if (!line) return false;
      const reply: Message = { id: newId(), role: "assistant", content: line.content, mentorId: "milo", createdAt: Date.now(), ...(line.options ? { options: line.options } : {}) };
      appendMessage(persona, reply);
      setFreshId(reply.id);
      return true;
    },
    [appendMessage],
  );

  const send = useCallback(
    (text: string, fresh: boolean, persona: Mentor["id"], preset = false, display?: string) => {
      const query = text.trim();
      if (!query || abortRef.current) return;

      const now = Date.now();
      const userMessage: Message = {
        id: newId(),
        role: "user",
        content: display ?? query,
        createdAt: now,
        ...(display ? { sentAs: query } : {}),
        ...(preset ? { preset: true } : {}),
      };
      const current = chatsRef.current[persona] ?? null;

      if (current && current.messages.length > 0 && !fresh) {
        const messages = [...current.messages, userMessage];
        const answersQuestion = !!current.messages.at(-1)?.essayFollowUp;
        setChat(persona, () => ({ ...current, messages, updatedAt: now }));
        // That answers Quill's one question for the essay, which gets saved with it. No model needed.
        if (answersQuestion) {
          const thanks: Message = { id: newId(), role: "assistant", content: FOLLOW_UP_THANKS, mentorId: "quill", createdAt: now };
          appendMessage(persona, thanks);
          setFreshId(thanks.id);
        } else if (!sayScripted(persona, messages)) request(query, current.sessionId, persona);
        return;
      }

      if (fresh && current?.sessionId) clearSession(current.sessionId);
      const next: Conversation = {
        id: current && !fresh ? current.id : newId(),
        title: makeTitle(display ?? query),
        sessionId: fresh ? null : (current?.sessionId ?? null),
        mentorId: persona,
        // Freeze the opening message the student saw, so it stays even as the profile changes.
        intro: (fresh ? undefined : current?.intro) ?? openerFor(mentorById(persona), profileRef.current, nameRef.current, modeFor(persona)).text,
        messages: [userMessage],
        createdAt: current && !fresh ? current.createdAt : now,
        updatedAt: now,
      };
      setChat(persona, () => next);
      setFreshId(null);
      if (!sayScripted(persona, next.messages)) request(query, next.sessionId, persona);
    },
    [request, sayScripted, setChat],
  );

  const retry = useCallback((persona: string) => {
    const convo = chatsRef.current[persona];
    if (!convo || abortRef.current) return;
    const lastUser = [...convo.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // A failed "Brainstorm my essay" writes it again, which adds its message back.
    if (lastUser.essayFor) {
      setChat(persona, () => ({ ...convo, messages: convo.messages.slice(0, convo.messages.indexOf(lastUser)), updatedAt: Date.now() }));
      writeRef.current(lastUser.essayFor);
      return;
    }
    setChat(persona, () => ({
      ...convo,
      messages: convo.messages.at(-1)?.error ? convo.messages.slice(0, -1) : convo.messages,
      updatedAt: Date.now(),
    }));
    request(lastUser.sentAs ?? lastUser.content, convo.sessionId, persona);
  }, [request, setChat]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPendingFor(null);
  }, []);

  /** "Brainstorm my essay": Quill writes it into the chat. It's only saved if the student says so. */
  const writeEssayInChat = async (piqId: string) => {
    if (abortRef.current) return;
    const now = Date.now();
    const asked: Message = { id: newId(), role: "user", content: "Brainstorm my essay", essayFor: piqId, preset: true, createdAt: now };
    const hadEssay = chatsRef.current.quill?.messages.some((m) => m.role === "assistant" && m.essayFor);
    setChat("quill", (c) =>
      c
        ? { ...c, messages: [...c.messages, asked], updatedAt: now }
        : {
            id: newId(),
            title: "Brainstorm my essay",
            sessionId: null,
            mentorId: "quill",
            intro: openerFor(mentorById("quill"), profileRef.current, nameRef.current, null).text,
            messages: [asked],
            createdAt: now,
            updatedAt: now,
          },
    );
    setFreshId(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setPendingFor("quill");
    const result = await piqDrafts.write(piqId, { regenerate: hadEssay, signal: controller.signal });
    if (abortRef.current === controller) {
      abortRef.current = null;
      setPendingFor(null);
    }
    if (!result) return;
    const message: Message =
      "error" in result
        ? { id: newId(), role: "assistant", content: result.error, error: true, createdAt: Date.now() }
        : { id: newId(), role: "assistant", content: result.text, essayFor: piqId, mentorId: "quill", createdAt: Date.now() };
    appendMessage("quill", message);
    setFreshId(message.id);
  };
  const writeRef = useRef(writeEssayInChat);
  writeRef.current = writeEssayInChat;
  const saveEssay = useCallback(
    (message: Message) => {
      const id = message.essayFor;
      if (id) update((p) => applyDrafts(p, [{ id, question: "", essay: message.content, wordCount: 0 }]));
    },
    [update],
  );

  const stopRef = useRef(stop);
  stopRef.current = stop;
  const sendRef = useRef(send);
  const retryRef = useRef(retry);
  sendRef.current = send;
  retryRef.current = retry;

  // Chat follows the current chapter's guide until Financial Aid, when any guide can be picked.
  const mentorPickOpen = currentStage === "aid";
  const [selectedStage, setSelectedStage] = useState<CheckpointId | null>(null);
  useEffect(() => setSelectedStage(null), [currentStage]);
  useEffect(() => {
    if (!mentorPickOpen) setSelectedStage(null);
  }, [mentorPickOpen]);
  const stage = mentorPickOpen ? (selectedStage ?? currentStage) : currentStage;
  // Application Assistant (and Counselor tools) unlock only after earlier journey steps are done.
  const applyUnlocked = storyComplete(profile, completeness(profile).sections);
  const effectiveStage = stage === "review" && !applyUnlocked ? currentStage : stage;
  const guide = mentorById(effectiveStage === "review" ? reviewMode : STAGE_GUIDE[effectiveStage]);
  /** The application tool open under the Review & Apply persona's first message. */
  const [reviewTool, setReviewTool] = useState<ReviewTool | null>(null);
  useEffect(() => {
    if (!applyUnlocked) setReviewTool(null);
  }, [applyUnlocked]);
  const guideRef = useRef(guide.id);
  guideRef.current = guide.id;

  /** Ask a guide (the one on screen by default). Other guides only when Financial Aid unlocks free picking. */
  const askGuide = useCallback((prompt: string, mentorId: Mentor["id"] = guideRef.current, preset = true, display?: string) => {
    const locked = currentStageRef.current !== "aid";
    const targetId = locked ? guideRef.current : mentorId;
    if (!locked && targetId !== guideRef.current) setSelectedStage(stageFor(targetId, currentStageRef.current));
    const hasHistory = (chatsRef.current[targetId]?.messages.length ?? 0) > 0;
    sendRef.current(prompt, !hasHistory, targetId, preset, display);
  }, []);
  /** Starts a guide's chat over with this as the first message, dropping any reply still on its way. */
  const restartWith = useCallback((prompt: string, mentorId: Mentor["id"]) => {
    const locked = currentStageRef.current !== "aid";
    const targetId = locked ? guideRef.current : mentorId;
    if (!locked && targetId !== guideRef.current) setSelectedStage(stageFor(targetId, currentStageRef.current));
    stopRef.current();
    sendRef.current(prompt, true, targetId, true);
  }, []);
  /** 3 or more of something: Milo starts over and says to add them on the Profile page, without asking the model. */
  const sendToProfile = useCallback((section: ActivitySectionId) => {
    stopRef.current();
    const old = chatsRef.current.milo;
    if (old?.sessionId) void clearSession(old.sessionId);
    const now = Date.now();
    const asked: Message = { id: newId(), role: "user", content: activityReportMessage(section, 3), preset: true, createdAt: now };
    const reply: Message = { id: newId(), role: "assistant", content: fillInProfileMessage(section), fillInProfile: section, mentorId: "milo", createdAt: now };
    setChat("milo", () => ({
      id: newId(),
      title: "Activities",
      sessionId: null,
      mentorId: "milo",
      intro: openerFor(mentorById("milo"), profileRef.current, nameRef.current, null).text,
      messages: [asked, reply],
      createdAt: now,
      updatedAt: now,
    }));
    setFreshId(reply.id);
  }, [setChat]);
  const fillInProfile = useCallback(
    (message: Message) => {
      const section = message.fillInProfile;
      if (!section) return;
      update((p) => applyGuidedEffect(p, { type: "fillInProfile", section }, newId));
      navigate("profile", "activities");
    },
    [update],
  );
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

  // Restarting a guide's chat clears the screen and writes an empty stub so a reload does not
  // bring the old thread back. Prior message rows stay in Supabase as a record.
  const restartChat = useCallback(
    (mentorId: Mentor["id"]) => {
      if (pendingFor === mentorId) stop();
      const old = chatsRef.current[mentorId];
      if (!old) return;
      if (old.sessionId) void clearSession(old.sessionId);
      setChat(mentorId, () => null);
      setFreshId(null);
      const stub: Conversation = {
        id: newId(),
        title: old.title,
        sessionId: null,
        mentorId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      savedRef.current.set(stub.id, stub.updatedAt);
      getStore()
        .then((store) => store.conversations.save(userId, stub))
        .catch(() => savedRef.current.delete(stub.id));
    },
    [pendingFor, stop, setChat, userId],
  );
  // Resetting essays on the Profile page clears the chosen questions, and Quill's chat goes with it.
  const essayCount = Object.keys(journeyOf(profile).piqs).length;
  const lastEssayCount = useRef(essayCount);
  useEffect(() => {
    if (lastEssayCount.current > 0 && essayCount === 0) restartChat("quill");
    lastEssayCount.current = essayCount;
  }, [essayCount, restartChat]);
  // Resetting activities on the Profile page clears the number, and Milo's chat goes with it.
  const activityCount = journeyOf(profile).activityCount;
  const lastActivityCount = useRef(activityCount);
  useEffect(() => {
    if (lastActivityCount.current !== undefined && activityCount === undefined) restartChat("milo");
    lastActivityCount.current = activityCount;
  }, [activityCount, restartChat]);
  // Finishing activities ends that conversation (it's saved), so Milo opens fresh with what's next.
  const activitiesDone = activitiesStatus(profile).done;
  const lastActivitiesDone = useRef(activitiesDone);
  useEffect(() => {
    if (activitiesDone && !lastActivitiesDone.current) restartChat("milo");
    lastActivitiesDone.current = activitiesDone;
  }, [activitiesDone, restartChat]);

  // Quill works through one essay at a time: a new essay starts a clean chat. What the student
  // types there is saved with the essay, so writing it (here or in Profile) can use it.
  const essayId = currentEssay(profile);
  const quillMessages = chats.quill?.messages;
  const lastEssay = useRef(essayId);
  useEffect(() => {
    // That includes picking the four topics: the suggestions chat ends and essay 1 starts clean.
    if (lastEssay.current !== essayId) {
      restartChat("quill");
      lastEssay.current = essayId;
      return;
    }
    if (!essayId || !quillMessages) return;
    const notes = essayNotesFrom(quillMessages);
    if (notes && notes !== piqWorkOf(profile, essayId).answers[PERSONAL_ANSWER]) update((p) => setPiqAnswer(p, essayId, PERSONAL_ANSWER, notes));
  }, [essayId, quillMessages, profile, update, restartChat]);
  const onModeChange = useCallback(
    (_mode: ReviewMode) => {
      restartChat("counselor");
      restartChat("assistant");
      setReviewTool(null);
    },
    [restartChat],
  );
  const onAidModeChange = useCallback((_mode: AidMode) => restartChat("penny"), [restartChat]);

  const onGuideFollowup = useCallback(
    (question: string) => {
      const about = piqAboutAsk(question);
      if (about) askGuide(about.prompt, guideRef.current, true, about.display);
      else askGuide(question, guideRef.current, false);
    },
    [askGuide],
  );
  const onGuideRetry = useCallback(() => retryRef.current(guideRef.current), []);

  // Questions sent from other pages (Profile, Essays, Transcript) go to the guide who covers them.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.id) return;
    handled.current = handoff.id;
    if (abortRef.current) stop();
    askGuide(handoff.text, handoff.mentorId ?? specialistFor(handoff.text), true, handoff.display);
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

  const guidedHandlers = useMemo(
    () => ({
      onAsk: (prompt: string, mentorId?: Mentor["id"], display?: string) => askGuide(prompt, mentorId, true, display),
      onRestartAsk: restartWith,
      onSendToProfile: sendToProfile,
      miloMessages: chats.milo?.messages ?? [],
    }),
    [askGuide, restartWith, sendToProfile, chats.milo?.messages],
  );
  const guided = useGuidedStory(name, guidedHandlers);

  // On Financial Aid, auto-follow the turn's speaker when the student hasn't picked another planet.
  useEffect(() => {
    if (!mentorPickOpen || selectedStage) return;
    const speaker = guided.turn.speaker;
    if (speaker === "counselor" || speaker === "assistant") return;
    const target = stageFor(speaker, currentStage);
    if (target) setSelectedStage(target);
  }, [guided.turn.speaker, guided.turn.id, selectedStage, currentStage, mentorPickOpen]);

  const selectMentor = useCallback(
    (mentorId: Mentor["id"]) => {
      if (!mentorPickOpen) return;
      if (mentorId === "counselor" || mentorId === "assistant") {
        const prev = agentOf(profileRef.current).reviewMode ?? "counselor";
        update((p) => setAgent(p, (a) => ({ ...a, reviewMode: mentorId })));
        setSelectedStage("review");
        if (prev !== mentorId) onModeChange(mentorId);
        return;
      }
      if (STAGE_GUIDE[currentStageRef.current] === mentorId) {
        setSelectedStage(null);
        return;
      }
      const target = stageFor(mentorId, currentStageRef.current);
      if (target) setSelectedStage(target);
    },
    [update, onModeChange, mentorPickOpen],
  );

  const onGuideSend = useCallback(
    (text: string) => {
      if (guided.tryGuidedText(text, guideRef.current)) return;
      sendRef.current(text, false, guideRef.current);
    },
    [guided],
  );

  const guideChat = chats[guide.id] ?? null;
  const guideBusy = pendingFor === guide.id;
  // Before the first message, the guide opens with a line (and quick actions) based on the profile.
  const guideMode = guide.id === "penny" ? aidMode : null;
  const reviewGuide = guide.id === "counselor" || guide.id === "assistant";
  const started = !!guideChat?.messages.length;
  const miloDone = guide.id === "milo" && activitiesStatus(profile).done;
  const opener = useMemo(() => openerFor(guide, profile, name, guideMode), [guide, profile, name, guideMode]);
  // Suggested prompt chips stay under the greeting for every guide.
  const showActions = opener.actions.length > 0;
  const turnActive =
    guided.turn.speaker === guide.id ||
    (guided.turn.checkpointId === "review" && reviewGuide) ||
    (guided.turn.checkpointId === "aid" && guide.id === "penny") ||
    (guided.turn.checkpointId === "done" && guide.id === "sage");
  /** A button whose answer is the same for everyone: shows it right away, for no tokens. */
  const answerWithoutModel = (question: string, answer: string, mentorId: Mentor["id"]) => {
    const now = Date.now();
    const asked: Message = { id: newId(), role: "user", content: question, preset: true, createdAt: now };
    const reply: Message = { id: newId(), role: "assistant", content: answer, mentorId, createdAt: now };
    setChat(mentorId, (c) =>
      c
        ? { ...c, messages: [...c.messages, asked, reply], updatedAt: now }
        : {
            id: newId(),
            title: makeTitle(question),
            sessionId: null,
            mentorId,
            intro: opener.text,
            messages: [asked, reply],
            createdAt: now,
            updatedAt: now,
          },
    );
    setFreshId(reply.id);
  };
  const pendingDraftIds = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = pendingDraftIds.current;
    if (!ids?.length) return;
    if (!ids.every((id) => chosenPiqs(profile).includes(id))) return;
    pendingDraftIds.current = null;
    void piqDrafts.generate(ids);
  }, [profile, piqDrafts]);

  const runOpener = (action: OpenerAction) => {
    if (action.kind === "tool") {
      // Don't open Apply until a full virtual-counselor run-through is done.
      if (action.tool === "apply" && !virtualCounselorDone(agent.counselorCall)) return;
      setReviewTool(action.tool);
      return;
    }
    if (action.kind === "profile") {
      navigate("profile", action.section);
      return;
    }
    if (action.kind === "confirmPiqs") {
      update((p) => applyGuidedEffect(p, { type: "setPiqs", piqIds: action.piqIds }, newId));
      pendingDraftIds.current = action.piqIds;
      return;
    }
    if (action.kind === "swapPiqs") {
      update((p) => {
        const j = journeyOf(p);
        return { ...p, ucJourney: { ...j, checks: { ...j.checks, "choose-piqs": true } } };
      });
      return;
    }
    if (action.kind === "draftPiqs") {
      void piqDrafts.generate(action.piqIds);
      return;
    }
    if (action.kind === "confirmGoogle") {
      update((p) => applyGoogleActivitySuggestions(p, googleSuggestions, newId));
      setGoogleConfirmDismissed(true);
      return;
    }
    if (action.kind === "declineGoogle") {
      update(withGoogleActivitiesReviewed);
      setGoogleConfirmDismissed(true);
      navigate("profile", "activities");
      return;
    }
    if (action.kind === "followUp") {
      const now = Date.now();
      const asked: Message = { id: newId(), role: "user", content: action.label, preset: true, createdAt: now };
      const question: Message = { id: newId(), role: "assistant", content: ESSAY_FOLLOW_UPS[action.piqId], essayFollowUp: action.piqId, mentorId: "quill", createdAt: now };
      setChat("quill", (c) =>
        c
          ? { ...c, messages: [...c.messages, asked, question], updatedAt: now }
          : { id: newId(), title: action.label, sessionId: null, mentorId: "quill", intro: opener.text, messages: [asked, question], createdAt: now, updatedAt: now },
      );
      setFreshId(question.id);
      return;
    }
    if (action.kind === "write") {
      void writeEssayInChat(action.piqId);
      return;
    }
    if (action.kind === "ask" && action.answer) {
      answerWithoutModel(action.display ?? action.label, action.answer, guide.id);
      return;
    }
    askGuide(action.prompt, guide.id, true, action.kind === "ask" ? (action.display ?? action.label) : undefined);
  };

  const speakerMentor = mentorById(guided.turn.speaker);
  const googleReviewed = !!journeyOf(profile).checks?.["google-activities-reviewed"];
  const showGoogleConfirm =
    guide.id === "milo" &&
    !googleConfirmDismissed &&
    !googleReviewed &&
    !activitiesStatus(profile).done &&
    googleSuggestions.length > 0;
  const openerActions: OpenerAction[] = showGoogleConfirm
    ? [
        { kind: "confirmGoogle", label: "Confirm" },
        { kind: "declineGoogle", label: "Decline" },
        {
          kind: "ask",
          label: "What counts as an activity?",
          prompt: "What counts as an activity on the UC application?",
          answer: WHAT_COUNTS_ANSWER,
        },
      ]
    : opener.actions;

  return (
    <div className="advisor" hidden={!visible}>
      <div className="main">
        <GuidedView
          visible={visible}
          userId={userId}
          guideName={guide.name}
          mentor={guide}
          mentorMood={guideBusy ? "thinking" : "happy"}
          applyUnlocked={applyUnlocked}
          mentorPickOpen={mentorPickOpen}
          onSelectMentor={selectMentor}
          switcherBusy={pending}
          mapOpen={drawerOpen}
          onMapOpenChange={setDrawerOpen}
          chat={
            <>
              <ChatView
                intro={
                  <>
                    {(started || (guide.id === "milo" && clearOpenActivityAnswer(profile) !== profile)) && (
                      <div className="guided-chat-head guided-chat-head-tools">
                        <button
                          type="button"
                          className="chat-restart"
                          onClick={() => {
                            restartChat(guide.id);
                            if (guide.id === "milo") update(clearOpenActivityAnswer);
                          }}
                          aria-label={`Restart your chat with ${guide.name}`}
                          title="Start over from the first message"
                        >
                          <RetryIcon width={14} height={14} />
                          <span>Restart</span>
                        </button>
                      </div>
                    )}
                    {/* Guided prompt under greeting; Google confirm is a second chat bubble instead. */}
                    <div className="guided-prompt-slot">
                      {showGoogleConfirm || guided.turn.chatOnly ? null : (
                        <GuidedTurnBubble
                          turn={guided.turn}
                          active={turnActive}
                          saved={guided.saved}
                          draft={guided.draft}
                          setDraft={guided.setDraft}
                          pickedCampuses={guided.pickedCampuses}
                          setPickedCampuses={guided.setPickedCampuses}
                          pickedPiqs={guided.pickedPiqs}
                          setPickedPiqs={guided.setPickedPiqs}
                          piqDrafts={guided.piqDrafts}
                          savingActivities={guided.savingActivities}
                          activityError={guided.activityError}
                          canFinish={guided.canFinish}
                          pick={guided.pick}
                          run={guided.run}
                          submitDraft={guided.submitDraft}
                          onModeChange={onModeChange}
                          onAidModeChange={onAidModeChange}
                          speakerName={speakerMentor.name}
                          onContinueWithSpeaker={() => selectMentor(guided.turn.speaker)}
                        />
                      )}
                    </div>
                    <div className="row row-assistant">
                      <div className="bubble bubble-assistant">
                        <Markdown
                          text={
                            started && guide.id !== "theo" && guide.id !== "quill" && !miloDone
                              ? (guideChat?.intro ?? opener.text)
                              : opener.text
                          }
                        />
                      </div>
                    </div>
                    {showGoogleConfirm && (
                      <div className="row row-assistant">
                        <div className="bubble bubble-assistant">
                          <Markdown text={googleActivitiesConfirmMessage(googleSuggestions)} />
                        </div>
                      </div>
                    )}
                    {(showGoogleConfirm || showActions) && (
                      <div className="story-opener-actions" role="group" aria-label={`${guide.name}'s suggestions`}>
                        {openerActions.map((a) => {
                          const open = a.kind === "tool" && reviewTool === a.tool;
                          return (
                            <button
                              key={a.label}
                              type="button"
                              className={`story-opener-action${open ? " on" : ""}`}
                              onClick={() => runOpener(a)}
                              disabled={
                                (a.kind !== "tool" && pending) ||
                                (a.kind === "write" && piqDrafts.busy) ||
                                ((a.kind === "confirmPiqs" || a.kind === "draftPiqs") && piqDrafts.busy)
                              }
                              aria-pressed={a.kind === "tool" ? open : undefined}
                            >
                              {a.kind === "write" && piqDrafts.isBrainstorming(a.piqId)
                                ? "Brainstorming your essay…"
                                : (a.kind === "confirmPiqs" || a.kind === "draftPiqs") && piqDrafts.busy
                                  ? "Drafting…"
                                  : a.label}
                            </button>
                          );
                        })}
                        {guide.id === "assistant" && (
                          <button
                            type="button"
                            className="story-opener-action"
                            onClick={() => window.open("https://apply.universityofcalifornia.edu/my-application/login", "_blank", "noopener,noreferrer")}
                          >
                            Make an account
                          </button>
                        )}
                      </div>
                    )}
                    {reviewGuide && reviewTool && opener.actions.some((a) => a.kind === "tool" && a.tool === reviewTool) && (
                      <ReviewToolDialog tool={reviewTool} onClose={() => setReviewTool(null)} onCallLog={onCallLog} />
                    )}
                  </>
                }
                footer={null}
                messages={guideChat?.messages ?? []}
                pending={guideBusy}
                busy={pending}
                freshId={freshId}
                onFollowup={onGuideFollowup}
                onRetry={onGuideRetry}
                onSaveEssay={saveEssay}
                onFillInProfile={fillInProfile}
              />
              <Composer
                busy={pending}
                onSend={onGuideSend}
                onStop={stop}
                focusKey={visible ? (guideChat?.id ?? `story-${guide.id}`) : "hidden"}
                placeholder={
                  turnActive && guided.turn.input
                    ? guided.turn.input.placeholder
                    : `Message ${guide.name}…`
                }
              />
            </>
          }
        />
      </div>
    </div>
  );
}
