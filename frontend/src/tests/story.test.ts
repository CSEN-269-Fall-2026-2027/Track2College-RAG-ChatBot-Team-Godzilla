/** Live guide routing, prompt context, and response parsing. */
import { describe, expect, it } from "vitest";
import { summaryForGuide } from "../profile";
import { specialistFor, mentorById } from "../game/characters";
import { parseAssistantResponse } from "../parse";

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


});

describe("mentors", () => {
  it("routes questions to the right specialist", () => {
    expect(specialistFor("How do I apply for the Cal Grant?")).toBe("penny");
    expect(specialistFor("How long should my personal statement be?")).toBe("quill");
    expect(specialistFor("What GPA does UCLA want?")).toBe("sage");
    expect(specialistFor("Is computer science an impacted major?")).toBe("theo");
    expect(specialistFor("What's special about UC Santa Cruz?")).toBe("theo");
    expect(specialistFor("Which UCs should I apply to?")).toBe("theo");
    expect(specialistFor("What's the UC Davis application deadline?")).toBe("sage");
    expect(specialistFor("What is UC Davis tuition?")).toBe("penny");
  });

  it("falls back to the default mentor for unknown ids", () => {
    expect(mentorById("nope").id).toBe("sage");
  });
});
