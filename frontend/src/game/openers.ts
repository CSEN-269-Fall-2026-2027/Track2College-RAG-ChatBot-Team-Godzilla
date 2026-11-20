import { counselorMeetingDone, virtualCounselorDone } from "../agent/callState";
import { agentOf } from "../agent/logic";
import { COLLEGE_NAMES } from "../colleges";
import { OTHER_MAJOR } from "../constants";
import { activitiesStatus, PIQ_PROMPTS, PIQ_REQUIRED, UC_APPLY_URL } from "../journey/logic";
import { autoPickPiqLabels, autoPickPiqs, chosenPiqs, essayDone, piqWorkOf } from "../journey/piqs";
import type { Profile, ReviewMode } from "../types";
import { CAMPUS_BLURBS, CAMPUS_TOUR, WHAT_COUNTS_ANSWER } from "./campusBlurbs";
import type { Mentor } from "./characters";

export type OpenerAction =
  /** `prompt` goes to the model; the chat shows `display`, or the label if there's none. A fixed `answer` skips the model. */
  | { kind: "ask"; label: string; prompt: string; display?: string; answer?: string }
  /** Opens this section of the Profile page. */
  | { kind: "profile"; label: string; section: string }
  /** Quill asks its one question for this essay. */
  | { kind: "followUp"; label: string; piqId: string }
  /** Has Quill write this essay. */
  | { kind: "write"; label: string; piqId: string }
  /** Confirm Quill's four picks and draft them all. */
  | { kind: "confirmPiqs"; label: string; piqIds: string[] }
  /** Open the essay-topic picker to swap Quill's picks. */
  | { kind: "swapPiqs"; label: string }
  /** Draft the listed PIQs (after topics are already chosen). */
  | { kind: "draftPiqs"; label: string; piqIds: string[] }
  /** Milo: save all Google-scanned activities. */
  | { kind: "confirmGoogle"; label: string }
  /** Milo: skip Google suggestions and open Profile activities. */
  | { kind: "declineGoogle"; label: string }
  /** Opens one of the application tools (agent/tasks) inside the chat (Review & Apply). */
  | { kind: "tool"; label: string; tool: ReviewTool }
  /** Opens a page in a new tab (e.g. the official UC application). */
  | { kind: "link"; label: string; href: string }
  /** "Help me apply" finished in the background: the student confirms, which records Applied. */
  | { kind: "applyDone"; label: string }
  /** Open the UC login popup to fix the saved email or password. */
  | { kind: "ucLogin"; label: string }
  /** While the background run is going: open the live browser, or stop it. */
  | { kind: "watchApply"; label: string }
  | { kind: "stopApply"; label: string }
  /** Shown but not clickable yet (a feature still to come). */
  | { kind: "soon"; label: string }
  /** Theo: the student confirms their UC list, finishing that step. */
  | { kind: "confirmUcs"; label: string }
  /** Student is done with Jordan after a full meeting: finishes the counselor stop. */
  | { kind: "counselorDone"; label: string }
  /** Student confirms they clicked Send on the counselor email — finishes that task. */
  | { kind: "markEmailSent"; label: string };

/** The application tools the Review & Apply personas offer in the chat. */
export type ReviewTool = "email" | "call" | "apply";

export interface Opener {
  text: string;
  actions: OpenerAction[];
}

/** The first thing the Counselor (counselor stop) or Application assistant (apply stop) says; its buttons stay under it. */
export function reviewModeLine(mode: ReviewMode, name: string, callDone = true, emailDone = false): string {
  const hi = `Hey${name ? ` ${name}` : ""}!`;
  if (mode === "counselor") {
    if (!emailDone) {
      return `${hi} Let's email your counselor to set up a meeting.`;
    }
    if (!callDone) {
      return `${hi} Email's done. Next, meet with Jordan, your virtual counselor.`;
    }
    return `${hi} You've emailed your counselor and met Jordan. Next up: your UC application.`;
  }
  // Application assistant: only after the counselor stop (email + full meeting with Jordan).
  return emailDone && callDone
    ? `${hi} I'll fill in your UC application from your profile. I'll work in the background unless you want to watch.`
    : `${hi} Finish the Counselor stop first: email your counselor and meet Jordan. Then I can fill in your UC application.`;
}

/** The buttons under the Counselor's / Application assistant's first message. Forced order: email → call → apply. */
export function reviewActions(mode: ReviewMode, callDone = true, emailDone = false): OpenerAction[] {
  if (mode === "counselor") {
    if (!emailDone) return [{ kind: "tool", label: "Email my counselor", tool: "email" }];
    if (!callDone) return [{ kind: "tool", label: "Meet with my virtual counselor", tool: "call" }];
    return [
      { kind: "tool", label: "Email my counselor again", tool: "email" },
      { kind: "tool", label: "Meet with my virtual counselor again", tool: "call" },
    ];
  }
  return emailDone && callDone ? [{ kind: "tool", label: "Help me apply", tool: "apply" }] : [];
}

/**
 * First thing a guide says in an empty Story chat, based on what the profile already shows.
 * The Counselor and Application assistant always open with their buttons.
 */
export function openerFor(mentor: Mentor, profile: Profile, name: string): Opener {
  const hi = `Hey${name ? ` ${name}` : ""}!`;

  if (mentor.id === "counselor" || mentor.id === "assistant") {
    const agent = agentOf(profile);
    const callDone = counselorMeetingDone(agent);
    const emailDone = !!agent.counselorEmail?.sentAt;
    // The background run filled everything in (its browser is already closed): move on when they say so.
    if (mentor.id === "assistant" && agent.pendingApply && !agent.ucAccount?.piqAt) {
      return {
        text: `${hi} Your UC application is filled in. Look it over on UC, then submit it there.`,
        actions: [
          { kind: "link", label: "Open UC application", href: UC_APPLY_URL },
          { kind: "applyDone", label: "Done with application" },
        ],
      };
    }
    // A full meeting with Jordan, not yet confirmed: like the email, move on only when they say so.
    if (mentor.id === "counselor" && emailDone && !callDone && virtualCounselorDone(agent.counselorCall)) {
      return {
        text: `${hi} Nice work with Jordan! Ready to move on?`,
        actions: [
          { kind: "tool", label: "Meet with Jordan again", tool: "call" },
          { kind: "counselorDone", label: "Done with counselor" },
        ],
      };
    }
    // Gmail was opened but the student hasn't said they sent it: ask before moving on.
    if (mentor.id === "counselor" && !emailDone && agent.counselorEmail?.openedAt) {
      return {
        text: `${hi} Your email is open in Gmail. Once you've clicked Send, let me know and we'll move on.`,
        actions: [
          { kind: "tool", label: "Open the email again", tool: "email" },
          { kind: "markEmailSent", label: "I've sent the email" },
        ],
      };
    }
    return { text: reviewModeLine(mentor.id, name, callDone, emailDone), actions: reviewActions(mentor.id, callDone, emailDone) };
  }

  if (mentor.id === "quill") {
    const chosen = chosenPiqs(profile);
    if (chosen.length < PIQ_REQUIRED) {
      const labels = autoPickPiqLabels(profile);
      const picks = labels.join("\n");
      const piqIds = autoPickPiqs(profile);
      return {
        // "Essay #N" in bold on each line; the Why? prompt below keeps the plain labels.
        text: `${hi} I'll be writing about these four essays:\n\n${labels.map((l) => l.replace(/^(Essay #\d+)/, "**$1**")).join("\n")}`,
        actions: [
          {
            kind: "ask",
            label: "Why?",
            display: "Why did you pick these four essays?",
            prompt:
              `Why did you select these four essays for me?\n\nThe four you picked:\n${picks}\n\n` +
              "Explain briefly, in plain language, how they fit my activities and major. " +
              "Format it as a Markdown bullet list, one bullet per essay, each starting with its label in bold exactly as listed above, " +
              'like "- **Essay #1: Leadership** — why it fits".',
          },
          { kind: "confirmPiqs", label: "Sounds good", piqIds },
          { kind: "swapPiqs", label: "I want to swap" },
        ],
      };
    }

    const pending = chosen.filter((id) => !essayDone(profile, id));
    if (pending.length) {
      return {
        text: `${hi} I'll draft all four essays now — they'll land in Profile → Essays.`,
        actions: [{ kind: "draftPiqs", label: pending.length === PIQ_REQUIRED ? "Draft my essays" : "Finish drafting", piqIds: pending }],
      };
    }

    const written = chosen.flatMap((essayId) => {
      const q = PIQ_PROMPTS.find((x) => x.id === essayId);
      const text = piqWorkOf(profile, essayId).draft?.text.trim();
      return q && text ? [{ q, text }] : [];
    });
    return {
      text: `${hi} Your four essay drafts are ready. Would you like to add anything to the essays?`,
      actions: [
        {
          kind: "ask",
          label: "Yes, add something",
          prompt:
            "I'd like to add something to my essays. Ask me what I want to change or add, then help me revise.",
        },
        { kind: "profile", label: "Open essays in Profile", section: "essays" },
        ...written.map(({ q, text }) => ({
          kind: "ask" as const,
          label: `Analyze ${q.title}`,
          prompt: `Please analyze my essay about ${q.title}. The question is: ${q.prompt}\n\nMy essay:\n${text}`,
        })),
      ],
    };
  }

  if (mentor.id === "milo") {
    if (activitiesStatus(profile).done) {
      return {
        text: `${hi} Do you want to add more activities?`,
        actions: [
          { kind: "ask", label: "What counts as an activity?", prompt: "What counts as an activity on the UC application?", answer: WHAT_COUNTS_ANSWER },
          { kind: "profile", label: "Add an activity", section: "activities" },
        ],
      };
    }
    return {
      text: `${hi} Is this all of your activities and honors:`,
      actions: [
        { kind: "ask", label: "What counts as an activity?", prompt: "What counts as an activity on the UC application?", answer: WHAT_COUNTS_ANSWER },
        {
          kind: "ask",
          label: "How many should I list?",
          prompt: "How many activities should I list on the UC application, and what matters most to include?",
        },
        { kind: "profile", label: "Open activities in Profile", section: "activities" },
      ],
    };
  }

  if (mentor.id === "theo") {
    const chosen = profile.colleges.map((c) => c.name).filter((n) => COLLEGE_NAMES.includes(n));
    if (chosen.length) {
      const list = chosen.length > 1 ? `${chosen.slice(0, -1).join(", ")} and ${chosen[chosen.length - 1]}` : chosen[0];
      const major = profile.goals.intendedMajor;
      const knownMajor = !!major && major !== OTHER_MAJOR;
      const all = chosen.length >= COLLEGE_NAMES.length;
      const learn: OpenerAction = knownMajor
        ? {
            kind: "ask",
            label: "Learn about all UCs",
            prompt: `Tell me about ${major} at each of my UCs (${list}). One or two short lines per campus.`,
            display: "Learn about all UCs",
          }
        : all
          ? { kind: "ask", label: "Learn about all UCs", prompt: "Tell me a little about each UC campus.", answer: CAMPUS_TOUR }
          : { kind: "ask", label: "Learn about all UCs", prompt: `Tell me a little about each of my UCs (${list}). One or two short lines per campus.` };
      return {
        text: `${hi} We'll be applying to ${all ? "all nine UC campuses" : list}.`,
        actions: [learn, { kind: "confirmUcs", label: "Confirm" }, { kind: "profile", label: "Decline", section: "campuses" }],
      };
    }
    // Major often comes from onboarding before any campus is saved: bias the tour to that major.
    const major = profile.goals.intendedMajor;
    const knownMajor = !!major && major !== OTHER_MAJOR;
    const campusButtons: OpenerAction[] = COLLEGE_NAMES.map((n) =>
      knownMajor
        ? {
            kind: "ask" as const,
            label: n,
            prompt: `What's special about ${n} for someone interested in ${major}? Lead with what ${major} is like there (programs, strengths, how students in that field experience the campus), then add a little about the campus overall.`,
            display: `What's special about ${n}?`,
          }
        : {
            kind: "ask" as const,
            label: n,
            prompt: `What's special about ${n}? What sets it apart from the other UCs?`,
            display: `What's special about ${n}?`,
            answer: CAMPUS_BLURBS[n],
          },
    );
    const tour: OpenerAction = knownMajor
      ? {
          kind: "ask",
          label: "Tell me about each UC",
          prompt: `Tell me a little about each UC campus for someone interested in ${major}. For every campus, lead with what ${major} is like there, then one short line about the campus overall.`,
          display: "Tell me about each UC",
        }
      : { kind: "ask", label: "Tell me about each UC", prompt: "Tell me a little about each UC campus.", answer: CAMPUS_TOUR };
    return {
      text: knownMajor
        ? `${hi} I'm Theo, and I've walked all nine UC campuses. Want a quick tour for ${major}, or is there one campus you're curious about?`
        : `${hi} I'm Theo, and I've walked all nine UC campuses. Want the quick tour, or is there one you're curious about?`,
      actions: [tour, ...campusButtons],
    };
  }

  return { text: mentor.greeting(name), actions: [] };
}

/**
 * After the journey is done: every guide opens with their standard greeting and a few buttons that
 * just do their basic job (nothing here moves the journey on, and nothing says "again").
 */
export function doneOpener(mentor: Mentor, profile: Profile, name: string): Opener {
  const text = mentor.greeting(name.trim().split(/\s+/)[0] ?? "");
  switch (mentor.id) {
    case "theo": {
      const major = profile.goals.intendedMajor;
      const knownMajor = !!major && major !== OTHER_MAJOR;
      const chosen = profile.colleges.map((c) => c.name).filter((n) => COLLEGE_NAMES.includes(n));
      const campuses = chosen.length ? chosen : COLLEGE_NAMES;
      const list = campuses.length > 1 ? `${campuses.slice(0, -1).join(", ")} and ${campuses[campuses.length - 1]}` : campuses[0];
      const learn: OpenerAction = knownMajor
        ? {
            kind: "ask",
            label: "Learn about all UCs",
            prompt: `Tell me about ${major} at each of my UCs (${list}). One or two short lines per campus.`,
            display: "Learn about all UCs",
          }
        : { kind: "ask", label: "Learn about all UCs", prompt: `Tell me a little about each of my UCs (${list}). One or two short lines per campus.` };
      // One button per campus on their list, about their major there.
      const perCampus: OpenerAction[] = campuses.map((n) => ({
        kind: "ask",
        label: n,
        prompt: knownMajor
          ? `What's ${major} like at ${n}? Lead with the program and what stands out for ${major} students, then a line about the campus.`
          : `What's special about ${n}? What sets it apart from the other UCs?`,
        display: `Tell me about ${n}`,
      }));
      return { text, actions: [learn, ...perCampus] };
    }
    case "milo":
      return { text, actions: [{ kind: "profile", label: "Add more activities", section: "activities" }] };
    case "quill": {
      const essays = chosenPiqs(profile).flatMap((id) => {
        const q = PIQ_PROMPTS.find((x) => x.id === id);
        const draft = piqWorkOf(profile, id).draft?.text.trim();
        return q && draft ? [`${q.title} (question: ${q.prompt})\n${draft}`] : [];
      });
      const prompt = essays.length
        ? `Please review my essays. For each one, tell me what's working and the one or two changes that would help most.\n\n${essays.join("\n\n---\n\n")}`
        : "Please help me review my essays. I haven't saved any drafts yet, so tell me where to start.";
      return { text, actions: [{ kind: "ask", label: "Review my essays", prompt, display: "Review my essays" }] };
    }
    case "counselor":
      return {
        text,
        actions: [
          { kind: "tool", label: "Email my counselor", tool: "email" },
          { kind: "tool", label: "Meet with my virtual counselor", tool: "call" },
        ],
      };
    case "assistant":
      return { text, actions: [{ kind: "tool", label: "Help me apply", tool: "apply" }] };
    case "penny":
      // FAFSA help is coming later: the button is there but can't be clicked yet.
      return { text, actions: [{ kind: "soon", label: "Apply for FAFSA" }] };
    default:
      // Sage, the general guide, just greets.
      return { text, actions: [] };
  }
}
