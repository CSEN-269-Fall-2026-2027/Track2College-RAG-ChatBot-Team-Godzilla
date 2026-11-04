/** A UC run gets the student's password from the browser, along with their session. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken, startUcAccount } from "../api";

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("starting a UC run", () => {
  it("sends the password and the student's session", async () => {
    setAccessToken("student-token");
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ run_id: "r1" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startUcAccount("maya@example.com", "Tq7#mVx2!pLr9Kd4", "create", {}, false, false, [], "cloud")).resolves.toBe("r1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/agent\/uc-account\/start$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "maya@example.com", password: "Tq7#mVx2!pLr9Kd4", mode: "create", browser: "cloud" });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer student-token");
    expect(headers["X-T2C-Client"]).toBe("2");
  });
});
