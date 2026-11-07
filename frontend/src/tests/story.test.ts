/**
 * Unit tests for Story mode's pure logic: dialogue paging, mood parsing,
 * and XP / achievement / quest rules. No React, Supabase or API.
 */
import { describe, expect, it } from "vitest";
import { summaryForGuide } from "../profile";
import { inferMood, sceneFor, specialistFor, mentorById } from "../game/characters";
import { MAX_PAGE_CHARS, packSentences, paginate, plainText } from "../game/dialogue";
import { hydrateGameState, initialGameState } from "../game/progress";
import { parseAssistantResponse } from "../parse";


describe("dialogue paging", () => {
  it("keeps short answers on one page", () => {
    expect(paginate("You should file the FAFSA early.")).toEqual([{ say: "You should file the FAFSA early." }]);
  });

  it("splits long prose at sentence boundaries under the page limit", () => {
    const sentence = "This sentence is about forty-five chars long. ";
    const pages = paginate(sentence.repeat(12).trim());
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.say.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
      expect(page.say.endsWith(".")).toBe(true);
    }
  });

  it("attaches a list to the intro line that announces it", () => {
    const pages = paginate("To apply you need to:\n• Make an FSA ID\n• Gather tax returns\n\nGood luck!");
    expect(pages).toEqual([
      { say: "To apply you need to:", list: "• Make an FSA ID\n• Gather tax returns" },
      { say: "Good luck!" },
    ]);
  });

  it("gives a list without an intro its own page", () => {
    const pages = paginate("1. First step\n2. Second step");
    expect(pages[0].list).toBe("1. First step\n2. Second step");
    expect(pages[0].say).toMatch(/keep in mind/);
  });

  it("strips markdown the dialogue box can't render", () => {
    expect(plainText("## Heading\n**Bold** and [a link](https://x.org)")).toBe("Heading Bold and a link");
  });

  it("puts an over-long sentence on its own page instead of dropping it", () => {
    const long = "a".repeat(MAX_PAGE_CHARS + 20) + ".";
    expect(packSentences(["Hi.", long, "Bye."])).toEqual(["Hi.", long, "Bye."]);
  });
});

describe("summaryForGuide", () => {
  const summary = ["Name: Darren", "Activities: Soccer", "Needs financial aid: yes", "Reported unweighted GPA: 3.8", "Intended major (the same at every UC campus): Biology"].join("\n");
  it("sends each guide only what it uses", () => {
    expect(summaryForGuide(summary, "milo")).toBe("Name: Darren\nActivities: Soccer\nIntended major (the same at every UC campus): Biology");
    expect(summaryForGuide(summary, "penny")).not.toContain("Activities");
    expect(summaryForGuide(summary, "penny")).toContain("Needs financial aid");
    expect(summaryForGuide(summary, "theo")).not.toContain("Soccer");
    expect(summaryForGuide(summary, "quill")).toContain("Soccer");
    expect(summaryForGuide(summary, "sage")).toBe(summary);
  });
});

describe("mood parsing", () => {
  it("removes a Mood tag stuck to the end of a sentence or mid-reply", () => {
    expect(parseAssistantResponse("Answer:\nWhat do you do there?Mood: neutral").answer).toBe("What do you do there?");
    expect(parseAssistantResponse("Answer:\nFirst one?Mood: neutral Second one?").answer).toBe("First one?Second one?");
    expect(parseAssistantResponse("Answer:\nYour mood: happy days ahead").answer).toBe("Your mood: happy days ahead");
  });

  it("turns an Options line into answer buttons and hides it from the reply", () => {
    const parsed = parseAssistantResponse("Answer:\nDo you want to add a sport, club, or band?\nOptions: Sport | Club | Band | Something else\nMood: happy");
    expect(parsed.answer).toBe("Do you want to add a sport, club, or band?");
    expect(parsed.options).toEqual(["Sport", "Club", "Band", "Something else"]);
    expect(parsed.mood).toBe("happy");
  });

  it("offers Yes and No on a plain yes/no question even without an Options line", () => {
    expect(parseAssistantResponse("Answer:\nGot it. Do you have a job right now?").options).toEqual(["Yes", "No"]);
  });

  it("offers no buttons on open questions or statements", () => {
    for (const reply of [
      "What do you do on the team? You can skip this if you want.",
      "What's the activity, and what's your role?",
      "Can you tell me about a moment you remember?",
      "Do you prefer labs or field work?",
      "You're all set.",
    ]) {
      expect(parseAssistantResponse(`Answer:\n${reply}`).options).toEqual([]);
    }
  });

  it("reads and removes the backend's leading Mood line", () => {
    const parsed = parseAssistantResponse("Mood: excited\nAnswer:\nYou qualify!\n\nFollow-up Questions you might have:\nQ1. What next?");
    expect(parsed.mood).toBe("excited");
    expect(parsed.answer).toBe("You qualify!");
    expect(parsed.followups).toEqual(["What next?"]);
  });

  it("ignores unknown moods and never leaks the line into follow-ups", () => {
    const parsed = parseAssistantResponse("Answer:\nHi\n\nFollow-up Questions you might have:\nQ1. More?\nMood: furious");
    expect(parsed.mood).toBeUndefined();
    expect(parsed.followups).toEqual(["More?"]);
  });

  it("falls back to a client-side guess", () => {
    expect(inferMood({ content: "x", mood: "thinking" })).toBe("thinking");
    expect(inferMood({ content: "Oops", error: true })).toBe("concerned");
    expect(inferMood({ content: "The deadline is March 2." })).toBe("concerned");
    expect(inferMood({ content: "Here is how it works." })).toBe("happy");
  });
});

describe("mentors", () => {
  it("routes questions to the right specialist and scene", () => {
    expect(specialistFor("How do I apply for the Cal Grant?")).toBe("penny");
    expect(specialistFor("How long should my personal statement be?")).toBe("quill");
    expect(specialistFor("What GPA does UCLA want?")).toBe("sage");
    expect(specialistFor("Is computer science an impacted major?")).toBe("theo");
    expect(specialistFor("What's special about UC Santa Cruz?")).toBe("theo");
    expect(specialistFor("Which UCs should I apply to?")).toBe("theo");
    expect(specialistFor("What's the UC Davis application deadline?")).toBe("sage");
    expect(specialistFor("What is UC Davis tuition?")).toBe("penny");
    expect(sceneFor("scholarship deadlines", mentorById("sage"))).toBe("office");
    expect(sceneFor(undefined, mentorById("quill"))).toBe("library");
  });

  it("falls back to the default mentor for unknown ids", () => {
    expect(mentorById("nope").id).toBe("sage");
  });
});

describe("story settings", () => {
  it("hydrates stored settings and drops retired XP/quest fields", () => {
    const state = hydrateGameState({ mentorId: "bogus" as never, sound: false, xp: 50, stats: {} } as never);
    expect(state).toEqual({ ...initialGameState(), sound: false });
    expect("xp" in state).toBe(false);
  });

  it("falls back to defaults for missing storage", () => {
    expect(hydrateGameState(null)).toEqual(initialGameState());
  });
});
