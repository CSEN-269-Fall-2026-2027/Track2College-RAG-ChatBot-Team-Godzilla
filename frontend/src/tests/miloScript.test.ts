import { describe, expect, it } from "vitest";
import { miloNextLine } from "../journey/miloScript";
import { activityReportMessage } from "../journey/piqs";
import type { ActivitySectionId, Message } from "../types";

/** Plays a chat: the opening message, then each answer, with Milo's scripted line after each. Returns his lines. */
function play(section: ActivitySectionId, count: number, answers: string[]) {
  const messages: Message[] = [];
  const lines: (string | undefined)[] = [];
  const say = (role: Message["role"], content: string) => messages.push({ id: String(messages.length), role, content, createdAt: 0 });
  const reply = () => {
    const line = miloNextLine(messages);
    lines.push(line?.content);
    if (line) say("assistant", line.content);
  };
  say("user", activityReportMessage(section, count));
  reply();
  for (const answer of answers) {
    say("user", answer);
    reply();
  }
  return lines;
}

const DETAIL = "What did you do in this role, and is there a moment you remember? You can skip this if you want.";

describe("Milo's scripted questions", () => {
  it("asks kind, then name and role, then one standard question about the role", () => {
    expect(play("activities", 1, ["Sport", "Soccer, captain", "I run practices."])).toEqual([
      "Do you want to add a sport, club, or band?",
      "What's the sport, and what's your role?",
      DETAIL,
      "That's everything I need. Hit Done to save it.",
    ]);
  });

  it("goes through two activities one at a time", () => {
    expect(play("activities", 2, ["Club", "Robotics, programmer", "skip", "Something else", "Chess, member", "We won state."])).toEqual([
      "Do you want to add a sport, club, or band?",
      "What's the club, and what's your role?",
      DETAIL,
      "Do you want to add another sport, club, or band?",
      "What's the activity, and what's your role?",
      DETAIL,
      "That's everything I need. Hit Done to save it.",
    ]);
  });

  it("skips the name question when they type the activity instead of tapping a button", () => {
    expect(play("activities", 1, ["Soccer, I'm captain"])[1]).toBe(DETAIL);
  });

  it("offers buttons only on the sport, club, or band question", () => {
    const messages: Message[] = [{ id: "0", role: "user", content: activityReportMessage("activities", 1), createdAt: 0 }];
    expect(miloNextLine(messages)?.options).toEqual(["Sport", "Club", "Band"]);
    messages.push({ id: "1", role: "assistant", content: "x", createdAt: 0 }, { id: "2", role: "user", content: "Sport", createdAt: 0 });
    expect(miloNextLine(messages)?.options).toBeUndefined();
  });

  it("has fitting questions for jobs, volunteering, and awards, with no kind question", () => {
    expect(play("job", 1, ["Cafe, barista"])).toEqual(["Where do you work, and what's your job there?", DETAIL]);
    expect(play("volunteering", 1, ["Food bank, sorting"])[1]).toContain("moment from volunteering");
    expect(play("awards", 1, ["Honor roll"])[1]).toContain("What level was it");
  });

  it("hands the student's own question, and anything after the script, to the model", () => {
    expect(play("activities", 1, ["Do clubs count?"])[1]).toBeUndefined();
    expect(play("activities", 1, ["Sport", "Soccer", "Practices", "One more thing"])[4]).toBeUndefined();
    const other: Message[] = [{ id: "0", role: "user", content: "What counts as an activity?", createdAt: 0 }];
    expect(miloNextLine(other)).toBeNull();
  });
});
