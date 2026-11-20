import { describe, expect, it } from "vitest";
import { confirmGoogleWaitlist, googleActivitiesFoundMessage, googleHonorsFoundMessage, mergeIntoWaitlist, queueGoogleSuggestionsOnce, setWaitlist, waitlistOf } from "../journey/googleActivities";
import { activitiesStatus } from "../journey/logic";
import { blankProfile } from "./fixtures";

let n = 0;
const id = () => `id-${n++}`;
const found = [
  { name: "Robotics Club", role: "Captain", description: "Led the build team.", level: "", section: "activities" },
  { name: "Food Bank", role: "Volunteer", description: "", level: "", section: "volunteering" },
  { name: "AP Scholar", role: "", description: "", level: "national", section: "awards" },
];

describe("Google activities waitlist", () => {
  it("puts what Google found in a waitlist, not the profile", () => {
    const p = queueGoogleSuggestionsOnce(blankProfile(), found, id);
    expect(p.activities).toEqual([]);
    expect(p.awards).toEqual([]);
    expect(waitlistOf(p)?.map((i) => i.name)).toEqual(["Robotics Club", "Food Bank", "AP Scholar"]);
    // A second scan doesn't overwrite what's there (or the student's edits).
    expect(waitlistOf(queueGoogleSuggestionsOnce(p, [], id))).toHaveLength(3);
  });

  it("still makes an empty waitlist when Google found nothing, so Milo can say 0", () => {
    const p = queueGoogleSuggestionsOnce(blankProfile(), [], id);
    expect(waitlistOf(p)).toEqual([]);
    expect(googleActivitiesFoundMessage([])).toBe("I found **0 activities** from your email and calendar.");
    expect(googleHonorsFoundMessage([])).toBe("I found **0 honors** from your email and calendar.");
  });

  it("lists activities in one message and honors in the next", () => {
    const list = waitlistOf(queueGoogleSuggestionsOnce(blankProfile(), found, id))!;
    expect(googleActivitiesFoundMessage(list)).toBe(
      "I found **2 activities** from your email and calendar.\n\n1. **Robotics Club** — Captain · Led the build team.\n2. **Food Bank** — Volunteer",
    );
    expect(googleHonorsFoundMessage(list)).toBe("I found **1 honor** from your email and calendar.\n\n1. **AP Scholar** — national");
  });

  it("Confirm moves the (edited) waitlist into the profile and finishes Activities", () => {
    let p = queueGoogleSuggestionsOnce(blankProfile(), found, id);
    // Decline popup: drop Food Bank, add a job.
    const edited = waitlistOf(p)!.filter((i) => i.name !== "Food Bank");
    p = setWaitlist(p, [...edited, { id: id(), section: "job", name: "Safeway", role: "Cashier", description: "", level: "" }]);
    p = confirmGoogleWaitlist(p, id);
    expect(p.activities.map((a) => [a.name, a.category])).toEqual([
      ["Robotics Club", "extracurricular"],
      ["Safeway", "work"],
    ]);
    expect(p.awards.map((a) => [a.title, a.level])).toEqual([["AP Scholar", "national"]]);
    expect(waitlistOf(p)).toBeNull();
    expect(activitiesStatus(p).done).toBe(true);
  });
});

describe("Google waitlist without Google first", () => {
  it("keeps what the student added and merges in Google's finds later (no repeats)", () => {
    let p = setWaitlist(blankProfile(), [{ id: "a", section: "activities", name: "Robotics Club", role: "Member", description: "", level: "" }]);
    p = queueGoogleSuggestionsOnce(p, found, id);
    const list = waitlistOf(p)!;
    expect(list.map((i) => i.name)).toEqual(["Robotics Club", "Food Bank", "AP Scholar"]);
    // The student's own entry wins over Google's.
    expect(list[0].role).toBe("Member");
  });
});

describe("Search Google again", () => {
  it("adds only new finds after the student's list, keeping their edits", () => {
    const mine = [{ id: "a", section: "activities" as const, name: "Robotics Club", role: "President", description: "", level: "" }];
    const merged = mergeIntoWaitlist(mine, [{ name: "robotics club", role: "Member", description: "", level: "", section: "activities" }, { name: "Varsity Soccer", role: "Player", description: "", level: "", section: "activities" }], id);
    expect(merged.map((i) => [i.name, i.role])).toEqual([
      ["Robotics Club", "President"],
      ["Varsity Soccer", "Player"],
    ]);
  });
});
