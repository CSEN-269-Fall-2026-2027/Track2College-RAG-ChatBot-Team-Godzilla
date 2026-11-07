import { describe, expect, it } from "vitest";
import { TypedEchoFilter, callPhase, isWrapUpLine, mouthFrame, nearBottom, presence, virtualCounselorDone } from "../agent/callState";

const base = { joined: true, starting: false, status: "disconnected", error: null, hadSession: false };

describe("callPhase", () => {
  it("is idle until the student joins", () => {
    expect(callPhase({ ...base, joined: false })).toBe("idle");
  });

  it("connects while checking the mic or fetching the token", () => {
    expect(callPhase({ ...base, starting: true })).toBe("connecting");
    expect(callPhase({ ...base, status: "connecting" })).toBe("connecting");
  });

  it("is live only while the SDK says connected", () => {
    expect(callPhase({ ...base, status: "connected" })).toBe("live");
  });

  it("reports a failed start (e.g. mic denied) as an error", () => {
    expect(callPhase({ ...base, error: "Allow microphone access" })).toBe("error");
  });

  it("treats a call that connected and then dropped as ended, even with an error", () => {
    expect(callPhase({ ...base, hadSession: true })).toBe("ended");
    expect(callPhase({ ...base, hadSession: true, error: "dropped" })).toBe("ended");
  });
});

describe("presence", () => {
  it("speaking wins over thinking, and only while live", () => {
    expect(presence("live", true, true)).toBe("speaking");
    expect(presence("live", false, true)).toBe("thinking");
    expect(presence("live", false, false)).toBe("listening");
    expect(presence("ended", true, true)).toBe("ended");
    expect(presence("connecting", true, false)).toBe("connecting");
  });
});

describe("mouthFrame", () => {
  it("closes on silence and opens with level", () => {
    expect(mouthFrame(0)).toBe(0);
    expect(mouthFrame(0.08)).toBe(1);
    expect(mouthFrame(0.5)).toBe(2);
  });
});

describe("nearBottom", () => {
  it("follows only when the reader is near the end", () => {
    expect(nearBottom(1000, 560, 400)).toBe(true);
    expect(nearBottom(1000, 200, 400)).toBe(false);
  });
});

describe("TypedEchoFilter", () => {
  it("swallows one server echo of a typed reply, ignoring case and punctuation", () => {
    const f = new TypedEchoFilter();
    f.add("Fall 2027, please!");
    expect(f.consume("fall 2027 please")).toBe(true);
    expect(f.consume("fall 2027 please")).toBe(false);
  });

  it("never swallows spoken lines that weren't typed", () => {
    const f = new TypedEchoFilter();
    f.add("San Jose");
    expect(f.consume("I was born in Mexico")).toBe(false);
  });
});

describe("isWrapUpLine", () => {
  it("spots Jordan's scripted goodbye", () => {
    expect(
      isWrapUpLine("Thanks so much for talking with me today, Darren Tang! When you're ready, you can go ahead with your UC application."),
    ).toBe(true);
  });

  it("spots the chat path's goodbye too", () => {
    expect(isWrapUpLine("Thanks so much for talking with me today, Maya! Come back any time you have more questions.")).toBe(true);
  });

  it("ignores other lines, including the silence prompt", () => {
    expect(isWrapUpLine("Are you still there? If you have any more questions, feel free to ask!")).toBe(false);
    expect(isWrapUpLine("Thanks so much for talking with me today!")).toBe(false);
  });
});

describe("virtualCounselorDone", () => {
  it("stays incomplete after only the first check-in answer", () => {
    expect(virtualCounselorDone({ lines: [{ role: "student", text: "I'm doing well" }] })).toBe(false);
    expect(
      virtualCounselorDone({
        lines: [
          { role: "counselor", text: "How's senior year going?" },
          { role: "student", text: "Pretty good" },
        ],
      }),
    ).toBe(false);
  });

  it("completes once Jordan says goodbye and the student has spoken", () => {
    expect(
      virtualCounselorDone({
        lines: [
          { role: "student", text: "I'm good" },
          {
            role: "counselor",
            text: "Thanks so much for talking with me today! When you're ready, you can go ahead with your UC application.",
          },
        ],
      }),
    ).toBe(true);
  });
});
