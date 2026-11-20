import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, clearSession, sendChat } from "../api";
import { useGoogleActivities } from "../googleActivities";
import { completeGoogleActivitiesConfirm, confirmGoogleWaitlist, googleActivitiesFoundMessage, googleHonorsFoundMessage, mergeIntoWaitlist, queueGoogleSuggestionsOnce, setWaitlist, waitlistOf } from "../journey/googleActivities";
import { ActivityWaitlistDialog } from "../components/story/ActivityWaitlistDialog";
import { parseAssistantResponse } from "../parse";
import { completeness, displayName, profileSummary, useProfile, summaryForGuide, usesProgress } from "../profile";
import { makeTitle, newId } from "../storage";
import type { Handoff, Health } from "../App";
import type { AgentState, Conversation, Message, PersonalInfo, StoryMode } from "../types";
import { ChatView } from "../components/ChatView";
import { Composer } from "../components/Composer";
import { Markdown } from "../components/Markdown";
import { RetryIcon } from "../components/icons";
import { GuidedView } from "../components/story/GuidedView";
import { GuidedTurnBubble } from "../components/story/GuidedTurnBubble";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { mentorById, specialistFor, type Mentor } from "../game/characters";
import { STAGE_GUIDE, useCurrentStage, useJourneyFinished } from "../journey/guides";
import { navigate } from "../router";
import { activitiesStatus, isReviewStage, journeyOf, PIQ_REQUIRED } from "../journey/logic";
import { applyGuidedEffect, storyComplete } from "../journey/guided";
import { useGuidedStory } from "../journey/useGuidedStory";
import { applyDrafts, chosenPiqs, currentEssay, ESSAY_FOLLOW_UPS, FOLLOW_UP_THANKS, usedActivities, essayNotesFrom, miloNotes, PERSONAL_ANSWER, piqAboutAsk, piqWorkOf, setPiqAnswer, suggestedPiqTitles } from "../journey/piqs";
import { usePiqDrafts } from "../journey/usePiqDrafts";
import { WHAT_COUNTS_ANSWER } from "../game/campusBlurbs";
import { doneOpener, openerFor, type OpenerAction, type ReviewTool } from "../game/openers";
import { ReviewToolDialog } from "../components/story/ReviewApply";
import { PiqSwapDialog } from "../components/story/PiqSwapDialog";
import { counselorMeetingDone } from "../agent/callState";
import { autoEmailCounselor, closePendingTab, emailCounselor, openPendingTab, type CounselorEmailProblem } from "../agent/counselorEmailAuto";
import { usePlanning } from "../planning";
import { splitStudentName } from "../onboarding/logic";
import { CounselorEmailProblemDialog } from "../components/story/CounselorEmailProblemDialog";
import { ApplyLoginDialog, ApplyWatchDialog } from "../components/story/ApplyDialogs";
import { useBackgroundApply } from "../agent/useBackgroundApply";
import { agentOf, applyProgressSummary, cleanTranscriptLine, commitApplied, sameEmail, setAgent } from "../agent/logic";

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
  const { transcripts } = usePlanning();
  // Students onboarded before we kept the last name: fill it from their transcript once.
  // It's how "Email my counselor" matches them to their counselor's last-name range.
  const transcriptLastName = splitStudentName(transcripts[0]?.studentName ?? "").last;
  useEffect(() => {
    if (!transcriptLastName || profile.basics.lastName.trim()) return;
    update((p) => (p.basics.lastName.trim() ? p : { ...p, basics: { ...p.basics, lastName: transcriptLastName } }));
  }, [transcriptLastName, profile.basics.lastName, update]);
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
  const { suggestions: googleSuggestions, status: googleScan, connected: googleConnected, scan: scanGoogle } = useGoogleActivities();
  const [googleConfirmDismissed, setGoogleConfirmDismissed] = useState(false);

  const googleImported = !!journeyOf(profile).checks?.["google-activities-imported"];
  const googleReviewedFlag = !!journeyOf(profile).checks?.["google-activities-reviewed"];
  // The first finished scan goes into a waitlist, not the profile (even when it found nothing, so
  // Milo can say "I found 0"). Milo's Confirm moves it into the profile.
  useEffect(() => {
    if (googleImported || googleScan !== "ready" || googleConnected !== true) return;
    if (activitiesStatus(profile).done) return;
    update((p) => queueGoogleSuggestionsOnce(p, googleSuggestions, newId));
  }, [googleSuggestions, googleScan, googleConnected, googleImported, profile, update]);
  /** Milo's Edit: the popup that edits the waitlist. */
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  /** The first Google scan this visit has finished (ready or failed). */
  const [googleScanSettled, setGoogleScanSettled] = useState(false);
  useEffect(() => {
    if (googleScan === "ready" || googleScan === "error") setGoogleScanSettled(true);
  }, [googleScan]);
  // Older Confirm only set google-reviewed — finish Activities so Milo doesn't reopen 0/1/2/3 or Theo.
  useEffect(() => {
    if (!googleReviewedFlag || activitiesStatus(profile).done) return;
    update(completeGoogleActivitiesConfirm);
  }, [googleReviewedFlag, profile, update]);

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
  const journeyDone = useJourneyFinished();
  const currentStageRef = useRef(currentStage);
  currentStageRef.current = currentStage;
  const agent = agentOf(profile);
  /** The mode to send with a request: the Counselor's and Application assistant's own. */
  const modeFor = (persona: string): StoryMode | null => (persona === "counselor" || persona === "assistant" ? persona : null);
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
        setChats((current) => ({ ...loaded, ...current }));
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
        } else request(query, current.sessionId, persona);
        return;
      }

      if (fresh && current?.sessionId) clearSession(current.sessionId);
      const next: Conversation = {
        id: current && !fresh ? current.id : newId(),
        title: makeTitle(display ?? query),
        sessionId: fresh ? null : (current?.sessionId ?? null),
        mentorId: persona,
        // Freeze the opening message the student saw, so it stays even as the profile changes.
        intro: (fresh ? undefined : current?.intro) ?? openerFor(mentorById(persona), profileRef.current, nameRef.current).text,
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
            intro: openerFor(mentorById("quill"), profileRef.current, nameRef.current).text,
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

  // Chat follows the current chapter's guide. Once the application is in, the journey is done and the
  // student picks any guide with the arrows beside the character.
  const mentorPickOpen = journeyDone;
  const mentorPickOpenRef = useRef(mentorPickOpen);
  mentorPickOpenRef.current = mentorPickOpen;
  const [pickedGuide, setPickedGuide] = useState<Mentor["id"]>("sage");
  // Application Assistant (and Counselor tools) unlock only after earlier journey steps are done.
  const applyUnlocked = storyComplete(profile, completeness(profile).sections);
  const guide = mentorById(mentorPickOpen ? pickedGuide : STAGE_GUIDE[currentStage]);
  /** The application tool open under the Review & Apply persona's first message. */
  const [reviewTool, setReviewTool] = useState<ReviewTool | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  /** Why "Email my counselor" stopped (shown in a small popup with name + email fields), or null. */
  const [emailProblem, setEmailProblem] = useState<CounselorEmailProblem | null>(null);
  /** "Help me apply": the background cloud run, its Watch popup, and the UC login popup (null closed; "" no message; else why). */
  const bgApply = useBackgroundApply();
  const [watchOpen, setWatchOpen] = useState(false);
  const [loginAsk, setLoginAsk] = useState<string | null>(null);
  /** Start in the background with the saved UC login; ask for one only if there isn't any. */
  const startApply = () => {
    const saved = agentOf(profileRef.current).ucAccount;
    if (saved?.email && saved.password) {
      void bgApply.start({ email: saved.email, password: saved.password });
      return;
    }
    // No message: the popup is just the login. (A wrong login comes back with UC's reason.)
    setLoginAsk("");
  };
  // Something needs the student: open the live browser (or the login popup) on its own.
  const issueKey = bgApply.issue ? `${bgApply.issue.kind}:${bgApply.issue.message}` : "";
  useEffect(() => {
    if (!bgApply.issue) return;
    if (bgApply.issue.kind === "login") {
      setWatchOpen(false);
      setLoginAsk(bgApply.issue.message);
    } else {
      setWatchOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per new issue, not on every poll
  }, [issueKey]);
  // Finished: the browser is already closed, so the live view has nothing left to show.
  const applyFinished = !!bgApply.run?.finished;
  useEffect(() => {
    if (applyFinished) setWatchOpen(false);
  }, [applyFinished]);
  useEffect(() => {
    if (!applyUnlocked) setReviewTool(null);
  }, [applyUnlocked]);
  const guideRef = useRef(guide.id);
  guideRef.current = guide.id;

  /** Ask a guide (the one on screen by default). Other guides only once the journey is done and any can be picked. */
  const askGuide = useCallback((prompt: string, mentorId: Mentor["id"] = guideRef.current, preset = true, display?: string) => {
    const locked = !mentorPickOpenRef.current;
    const targetId = locked ? guideRef.current : mentorId;
    if (!locked && targetId !== guideRef.current) setPickedGuide(targetId);
    const hasHistory = (chatsRef.current[targetId]?.messages.length ?? 0) > 0;
    sendRef.current(prompt, !hasHistory, targetId, preset, display);
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
              title: mentorId === "counselor" || mentorId === "assistant" ? "Review & Apply" : makeTitle(content),
              sessionId: null,
              mentorId,
              intro: openerFor(mentorById(mentorId), profileRef.current, nameRef.current).text,
              messages: [note],
              createdAt: now,
              updatedAt: now,
            },
      );
      setFreshId(note.id);
    },
    [setChat],
  );
  // After the journey, chats start fresh each time, so the call isn't logged into the Counselor's chat.
  const onCallLog = useCallback(
    (text: string) => {
      if (!mentorPickOpenRef.current) postNote(text, "counselor");
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
  // Finishing activities ends that conversation (it's saved), so Milo opens fresh with what's next.
  const activitiesDone = activitiesStatus(profile).done;
  const lastActivitiesDone = useRef(activitiesDone);
  useEffect(() => {
    if (activitiesDone && !lastActivitiesDone.current) restartChat("milo");
    lastActivitiesDone.current = activitiesDone;
  }, [activitiesDone, restartChat]);

  /** All-four drafting from Quill's chat: the chat shows the request + reply instead of restarting per essay. */
  const [bulkDrafting, setBulkDrafting] = useState(false);
  const bulkDraftingRef = useRef(false);
  /** Drafting finished (or failed): Quill opens fresh with the drafts-ready message. */
  const endBulkDraft = useCallback(() => {
    bulkDraftingRef.current = false;
    setBulkDrafting(false);
    restartChat("quill");
  }, [restartChat]);

  // Quill works through one essay at a time: a new essay starts a clean chat. What the student
  // types there is saved with the essay, so writing it (here or in Profile) can use it.
  const essayId = currentEssay(profile);
  const quillMessages = chats.quill?.messages;
  const lastEssay = useRef(essayId);
  useEffect(() => {
    // That includes picking the four topics: the suggestions chat ends and essay 1 starts clean.
    if (lastEssay.current !== essayId) {
      // While all four are drafting, each finished draft moves essayId; keep the "let's draft" exchange on screen.
      if (!bulkDraftingRef.current) restartChat("quill");
      lastEssay.current = essayId;
      return;
    }
    if (!essayId || !quillMessages) return;
    const notes = essayNotesFrom(quillMessages);
    if (notes && notes !== piqWorkOf(profile, essayId).answers[PERSONAL_ANSWER]) update((p) => setPiqAnswer(p, essayId, PERSONAL_ANSWER, notes));
  }, [essayId, quillMessages, profile, update, restartChat]);

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
    }),
    [askGuide],
  );
  const guided = useGuidedStory(name, guidedHandlers);

  // After the journey, every guide's chat is a new chat: switching to one (or arriving) starts it over.
  const lastFreshGuide = useRef<Mentor["id"] | null>(null);
  useEffect(() => {
    if (!mentorPickOpen) {
      lastFreshGuide.current = null;
      return;
    }
    if (lastFreshGuide.current === guide.id) return;
    lastFreshGuide.current = guide.id;
    restartChat(guide.id);
  }, [mentorPickOpen, guide.id, restartChat]);

  const selectMentor = useCallback(
    (mentorId: Mentor["id"]) => {
      if (mentorPickOpen) setPickedGuide(mentorId);
    },
    [mentorPickOpen],
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
  const reviewGuide = guide.id === "counselor" || guide.id === "assistant";
  const started = !!guideChat?.messages.length;
  const miloDone = guide.id === "milo" && activitiesStatus(profile).done;
  // Done with the journey: every guide opens with their standard greeting and buttons for their basic job.
  const baseOpener = useMemo(
    () => (mentorPickOpen ? doneOpener(guide, profile, name) : openerFor(guide, profile, name)),
    [mentorPickOpen, guide, profile, name],
  );
  // "Help me apply" runs in the background: while it's going (or after it stopped), the assistant says so.
  const applyRunning = bgApply.running;
  const applyDetail = bgApply.run?.detail ?? "";
  const applyIssue = bgApply.issue;
  const hasSavedUcLogin = !!agent.ucAccount?.email;
  const opener = useMemo(() => {
    if (guide.id !== "assistant") return baseOpener;
    const hi = `Hey${name ? ` ${name.split(/\s+/)[0]}` : ""}!`;
    if (applyRunning) {
      return {
        text: `${hi} I'm filling in your UC application in the background. ${applyDetail}`.trim(),
        actions: [
          { kind: "watchApply", label: "Watch" },
          { kind: "stopApply", label: "Stop" },
        ] satisfies OpenerAction[],
      };
    }
    if (applyIssue && applyIssue.kind !== "code") {
      return {
        text: `${hi} The UC assistant stopped: ${applyIssue.message}`,
        // A wrong login can't be retried as is: fix it instead.
        actions: (applyIssue.kind === "login"
          ? [{ kind: "ucLogin", label: "Change UC login" }]
          : [
              { kind: "watchApply", label: "See what happened" },
              { kind: "tool", label: "Try again", tool: "apply" },
            ]) satisfies OpenerAction[],
      };
    }
    // Once a login is saved, it can always be changed (a typo would otherwise stick on every try).
    const hasHelpApply = baseOpener.actions.some((a) => a.kind === "tool" && a.tool === "apply");
    if (hasSavedUcLogin && hasHelpApply) {
      return { ...baseOpener, actions: [...baseOpener.actions, { kind: "ucLogin", label: "Change UC login" } satisfies OpenerAction] };
    }
    return baseOpener;
  }, [guide.id, baseOpener, name, applyRunning, applyDetail, applyIssue, hasSavedUcLogin]);
  // Suggested prompt chips stay under the greeting for every guide.
  // While Quill drafts all four, the chat keeps his picks message and the exchange below it, without buttons.
  const quillDrafting = guide.id === "quill" && bulkDrafting;
  const showActions = opener.actions.length > 0 && !quillDrafting;
  const turnActive =
    guided.turn.speaker === guide.id ||
    (isReviewStage(guided.turn.checkpointId) && reviewGuide) ||
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
  /** Quill's "I want to swap" popup: the picks it opens with, or null when closed. */
  const [swapPiqs, setSwapPiqs] = useState<string[] | null>(null);
  useEffect(() => {
    const ids = pendingDraftIds.current;
    if (!ids?.length) return;
    if (!ids.every((id) => chosenPiqs(profile).includes(id))) return;
    pendingDraftIds.current = null;
    void piqDrafts.generate(ids).finally(endBulkDraft);
  }, [profile, piqDrafts, endBulkDraft]);

  /** "Sounds good" / swap / "Draft my essays": the student asks, Quill answers, then drafting runs. */
  const startBulkDraft = (finishing: boolean) => {
    bulkDraftingRef.current = true;
    setBulkDrafting(true);
    answerWithoutModel(
      finishing ? "Let's finish my essays." : "Let's draft my essays.",
      finishing
        ? "I got you! Finishing the rest now. They'll show up in Profile → Essays."
        : "I got you! Drafting all four now. They'll show up in Profile → Essays.",
      "quill",
    );
  };

  const emailOpts = () => ({
    profile,
    studentName:
      [profile.basics.firstName, profile.basics.lastName]
        .map((p) => p.trim())
        .filter(Boolean)
        .join(" ") ||
      account?.name?.trim() ||
      "",
    agent,
    change: (fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn)),
  });
  /** The popup's manual counselor: write the email and open Gmail, or show the next problem. */
  const emailManually = (counselor: { name: string; email: string }) => {
    if (emailBusy) return;
    setEmailBusy(true);
    // Open the tab on the click itself, or the browser blocks it by the time the email is written.
    const tab = openPendingTab();
    void emailCounselor({ ...emailOpts(), tab }, counselor)
      .then((result) => {
        if (result.status === "needs-ui") closePendingTab(tab);
        setEmailProblem(result.status === "needs-ui" ? result.problem : null);
      })
      .catch(() => closePendingTab(tab))
      .finally(() => setEmailBusy(false));
  };

  const runOpener = (action: OpenerAction) => {
    if (action.kind === "tool") {
      // Don't open Apply until a full virtual-counselor run-through is done.
      if (action.tool === "apply" && !counselorMeetingDone(agent)) return;
      // Email: find + draft + open Gmail. A small error popup only when a step can't finish on its own.
      if (action.tool === "email") {
        if (emailBusy) return;
        setEmailBusy(true);
        setEmailProblem(null);
        // Open the tab on the click itself: finding the counselor and writing the email take longer
        // than a browser lets a click open a tab, which is why Gmail was blocked the first time.
        const tab = openPendingTab();
        void autoEmailCounselor({ ...emailOpts(), tab })
          .then((result) => {
            if (result.status === "needs-ui") closePendingTab(tab);
            setEmailProblem(result.status === "needs-ui" ? result.problem : null);
          })
          .catch(() => closePendingTab(tab))
          .finally(() => setEmailBusy(false));
        return;
      }
      if (action.tool === "apply") {
        startApply();
        return;
      }
      setReviewTool(action.tool);
      return;
    }
    if (action.kind === "soon") return;
    if (action.kind === "ucLogin") {
      setLoginAsk("");
      return;
    }
    if (action.kind === "watchApply") {
      setWatchOpen(true);
      return;
    }
    if (action.kind === "stopApply") {
      void bgApply.stop();
      return;
    }
    if (action.kind === "link") {
      window.open(action.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (action.kind === "applyDone") {
      const saved = agent.ucAccount;
      const creds = bgApply.login ?? (saved?.password ? { email: saved.email, password: saved.password } : null);
      update((p) => setAgent(p, (a) => commitApplied(a, creds, Date.now())));
      bgApply.clear();
      return;
    }
    if (action.kind === "confirmUcs") {
      update((p) => {
        const j = journeyOf(p);
        return { ...p, ucJourney: { ...j, checks: { ...j.checks, "ucs-confirmed": true } } };
      });
      return;
    }
    if (action.kind === "counselorDone") {
      update((p) => setAgent(p, (a) => ({ ...a, counselorDoneAt: Date.now() })));
      return;
    }
    if (action.kind === "markEmailSent") {
      update((p) =>
        setAgent(p, (a) => ({ ...a, counselorEmail: a.counselorEmail && { ...a.counselorEmail, sentAt: Date.now() } })),
      );
      return;
    }
    if (action.kind === "profile") {
      navigate("profile", action.section);
      return;
    }
    if (action.kind === "confirmPiqs") {
      startBulkDraft(false);
      update((p) => applyGuidedEffect(p, { type: "setPiqs", piqIds: action.piqIds }, newId));
      pendingDraftIds.current = action.piqIds;
      return;
    }
    if (action.kind === "swapPiqs") {
      // Popup picker, pre-checked with Quill's four (the confirm button next to it carries them).
      const quillPicks = opener.actions.find((a) => a.kind === "confirmPiqs");
      setSwapPiqs(quillPicks?.kind === "confirmPiqs" ? quillPicks.piqIds : []);
      return;
    }
    if (action.kind === "draftPiqs") {
      startBulkDraft(action.piqIds.length < PIQ_REQUIRED);
      void piqDrafts.generate(action.piqIds).finally(endBulkDraft);
      return;
    }
    if (action.kind === "confirmGoogle") {
      // Moves the waitlist into the profile and finishes Activities.
      update((p) => confirmGoogleWaitlist(p, newId));
      setGoogleConfirmDismissed(true);
      return;
    }
    if (action.kind === "declineGoogle") {
      // Edit or add to the waitlist in a popup; it still waits for Confirm.
      setWaitlistOpen(true);
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
  // Milo's step is always this list (the old "do you volunteer / work / have awards" questions are gone).
  // Without Google, or while it hasn't found anything, the list is empty: "I found 0", and Edit adds.
  // "Looking…" only before the first scan settles; a later "Search Google again" keeps the list (and its popup) up.
  const googleScanning = !googleScanSettled && googleConnected !== false && waitlistOf(profile) === null;
  const googleWaitlist = waitlistOf(profile) ?? (googleScanning ? null : []);
  const miloListStep = guide.id === "milo" && !googleConfirmDismissed && !googleReviewed && !activitiesStatus(profile).done;
  const showGoogleConfirm = miloListStep && googleWaitlist !== null;
  const openerActions: OpenerAction[] = miloListStep && !showGoogleConfirm
    ? [] // Still looking: no buttons (and never Milo's old ones during this step).
    : showGoogleConfirm
    ? [
        { kind: "confirmGoogle", label: "Confirm" },
        { kind: "declineGoogle", label: "Edit" },
        {
          kind: "ask",
          label: "What counts as an activity?",
          prompt: "What counts as an activity or honor on the UC application?",
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
          mentorPickOpen={mentorPickOpen}
          onSelectMentor={selectMentor}
          switcherBusy={pending}
          busyCaption={
            quillDrafting ? "Writing your essays…" : guide.id === "assistant" && applyRunning ? "Filling in your UC application…" : null
          }
          mapOpen={drawerOpen}
          onMapOpenChange={setDrawerOpen}
          chat={
            <>
              <ChatView
                intro={
                  <>
                    <div className="guided-chat-head guided-chat-head-tools">
                      <button
                        type="button"
                        className="chat-restart"
                        onClick={() => {
                          restartChat(guide.id);
                        }}
                        aria-label={`Restart your chat with ${guide.name}`}
                        title="Start over from the first message"
                      >
                        <RetryIcon width={14} height={14} />
                        <span>Restart</span>
                      </button>
                    </div>
                    {/* Only this guide's turn — never Theo/other handoffs inside Milo's chat. */}
                    <div className="guided-prompt-slot">
                      {showGoogleConfirm || guided.turn.chatOnly || !turnActive ? null : (
                        <GuidedTurnBubble
                          turn={guided.turn}
                          active={turnActive}
                          saved={guided.saved}
                          draft={guided.draft}
                          setDraft={guided.setDraft}
                          pickedCampuses={guided.pickedCampuses}
                          setPickedCampuses={guided.setPickedCampuses}
                          piqDrafts={guided.piqDrafts}
                          pick={guided.pick}
                          run={guided.run}
                          submitDraft={guided.submitDraft}
                          speakerName={speakerMentor.name}
                          onContinueWithSpeaker={() => selectMentor(guided.turn.speaker)}
                        />
                      )}
                    </div>
                    <div className="row row-assistant">
                      <div className="bubble bubble-assistant">
                        <Markdown
                          colonHeadings={false}
                          text={
                            started && guide.id !== "theo" && (guide.id !== "quill" || quillDrafting) && !miloDone
                              ? (guideChat?.intro ?? opener.text)
                              : opener.text
                          }
                        />
                      </div>
                    </div>
                    {miloListStep && googleWaitlist === null && (
                      <div className="row row-assistant">
                        <div className="bubble bubble-assistant">
                          <Markdown text="Looking through your email and calendar for activities and honors…" />
                        </div>
                      </div>
                    )}
                    {showGoogleConfirm && googleWaitlist && (
                      <>
                        <div className="row row-assistant">
                          <div className="bubble bubble-assistant">
                            <Markdown text={googleActivitiesFoundMessage(googleWaitlist)} />
                          </div>
                        </div>
                        {/* Honors in their own bubble, right after the last activity. */}
                        <div className="row row-assistant">
                          <div className="bubble bubble-assistant">
                            <Markdown text={googleHonorsFoundMessage(googleWaitlist)} />
                          </div>
                        </div>
                      </>
                    )}
                    {waitlistOpen && googleWaitlist && (
                      <ActivityWaitlistDialog
                        items={googleWaitlist}
                        newId={newId}
                        onRescan={
                          googleConnected
                            ? async (items) => mergeIntoWaitlist(items, await scanGoogle({ force: true, throwOnError: true }), newId)
                            : null
                        }
                        onClose={() => setWaitlistOpen(false)}
                        onSave={(items) => {
                          setWaitlistOpen(false);
                          update((p) => setWaitlist(p, items));
                        }}
                      />
                    )}
                    {(showGoogleConfirm || (showActions && !miloListStep)) && (
                      <div className="story-opener-actions" role="group" aria-label={`${guide.name}'s suggestions`}>
                        {openerActions.map((a) => {
                          const open = a.kind === "tool" && reviewTool === a.tool;
                          return (
                            <button
                              key={a.label}
                              type="button"
                              className={`story-opener-action${open ? " on" : ""}`}
                              onClick={() => runOpener(a)}
                              title={a.kind === "soon" ? "Coming soon" : undefined}
                              disabled={
                                a.kind === "soon" ||
                                (a.kind !== "tool" && pending) ||
                                (a.kind === "tool" && a.tool === "email" && emailBusy) ||
                                (a.kind === "write" && piqDrafts.busy) ||
                                ((a.kind === "confirmPiqs" || a.kind === "draftPiqs") && piqDrafts.busy)
                              }
                              aria-pressed={a.kind === "tool" ? open : undefined}
                            >
                              {a.kind === "tool" && a.tool === "email" && emailBusy
                                ? "Opening Gmail…"
                                : a.kind === "write" && piqDrafts.isBrainstorming(a.piqId)
                                  ? "Brainstorming your essay…"
                                  : (a.kind === "confirmPiqs" || a.kind === "draftPiqs") && piqDrafts.busy
                                    ? "Drafting…"
                                    : a.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {swapPiqs && (
                      <PiqSwapDialog
                        initial={swapPiqs}
                        onClose={() => setSwapPiqs(null)}
                        onSubmit={(piqIds) => {
                          setSwapPiqs(null);
                          startBulkDraft(false);
                          update((p) => applyGuidedEffect(p, { type: "setPiqs", piqIds }, newId));
                          pendingDraftIds.current = piqIds;
                        }}
                      />
                    )}
                    {watchOpen && (
                      <ApplyWatchDialog
                        run={bgApply.run}
                        issue={bgApply.issue}
                        email={bgApply.login?.email ?? agent.ucAccount?.email ?? ""}
                        onSendCode={bgApply.sendCode}
                        onRetry={() => {
                          setWatchOpen(false);
                          startApply();
                        }}
                        onStop={() => void bgApply.stop()}
                        onClose={() => setWatchOpen(false)}
                      />
                    )}
                    {loginAsk !== null && (
                      <ApplyLoginDialog
                        message={loginAsk}
                        email={agent.ucAccount?.email ?? account?.email ?? ""}
                        onClose={() => setLoginAsk(null)}
                        onSave={(login) => {
                          setLoginAsk(null);
                          // Replace the saved login right away, so "Help me apply" never reuses a wrong one.
                          update((p) =>
                            setAgent(p, (a) => {
                              const same = sameEmail(a.ucAccount?.email, login.email);
                              return {
                                ...a,
                                ucAccount: same && a.ucAccount
                                  ? { ...a.ucAccount, password: login.password }
                                  : { email: login.email, password: login.password, generatedAt: Date.now() },
                              };
                            }),
                          );
                          void bgApply.start(login);
                        }}
                      />
                    )}
                    {emailProblem && (
                      <CounselorEmailProblemDialog
                        problem={emailProblem}
                        busy={emailBusy}
                        onSubmit={emailManually}
                        onClose={() => setEmailProblem(null)}
                      />
                    )}
                    {reviewGuide && reviewTool && opener.actions.some((a) => a.kind === "tool" && a.tool === reviewTool) && (
                      <ReviewToolDialog
                        onClose={() => setReviewTool(null)}
                        onCallLog={onCallLog}
                      />
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
                onFillInProfile={() => navigate("profile", "activities")}
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
