import { useCallback, useEffect, useRef, useState } from "react";
import { activeUcRun, cancelUcAccount, closeCloudBrowsers, startUcAccount, submitUcCode, ucAccountStatus, type UcRun } from "../api";
import { useAuth } from "../auth";
import { useProfile } from "../profile";
import type { AgentState } from "../types";
import { agentOf, sameEmail, setAgent, withUcRunProgress } from "./logic";
import { personalFacts, ucFacts, ucPiqs } from "./tasks";

export interface UcLogin {
  email: string;
  password: string;
}

/** What needs the student, so the Watch popup opens on its own. Null while the assistant can carry on. */
export type ApplyIssue =
  | { kind: "code"; message: string }
  | { kind: "your-turn"; message: string }
  | { kind: "login"; message: string }
  | { kind: "failed"; message: string };

const POLL_MS = 1000;

/** UC statuses where the student acts in the live browser before the assistant goes on. */
const YOUR_TURN = new Set(["waiting", "needs_you"]);

export function issueOf(run: UcRun | null, startError: string | null): ApplyIssue | null {
  if (startError) return { kind: "failed", message: startError };
  if (!run) return null;
  // While the server looks for the code in Gmail (and while it enters one), don't ask the student.
  if (run.status === "needs_code" && !run.code_search) {
    return { kind: "code", message: "UC emailed you a verification code. Enter it to keep going." };
  }
  if (run.status === "login_failed") return { kind: "login", message: "UC said that email or password is wrong. Check your UC login and try again." };
  if (!run.open && (run.status === "error" || run.status === "disconnected")) return { kind: "failed", message: run.detail };
  if (run.open && !run.finished && YOUR_TURN.has(run.status)) return { kind: "your-turn", message: run.detail };
  return null;
}

/**
 * "Help me apply" in the background: one Browserbase run that fills in the UC application while the
 * student keeps chatting. They can watch the live browser any time; it pops up on its own only when
 * something needs them. Every way a run ends (finished, stopped, failed) closes the cloud browser.
 */
export function useBackgroundApply() {
  const { account } = useAuth();
  const { profile, update } = useProfile();
  const [run, setRun] = useState<UcRun | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);
  const login = useRef<UcLogin | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const change = useCallback((fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn)), [update]);

  // A run that's still going from before (another tab, a reload): follow it.
  useEffect(() => {
    let live = true;
    void activeUcRun().then((found) => {
      if (!live || !found || found.run.browser !== "cloud") return;
      runId.current = found.runId;
      setRun(found.run);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Close every cloud browser this student has open. Best effort: Browserbase ends it at its timeout anyway. */
  const releaseBrowser = useCallback(async () => {
    const id = runId.current;
    if (id) await cancelUcAccount(id).catch(() => undefined);
    await closeCloudBrowsers().catch(() => undefined);
  }, []);

  // Follow the run, saving each milestone (login accepted, verified, About you...) as it happens.
  useEffect(() => {
    if (!run?.open || !runId.current) return;
    const id = runId.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const next = await ucAccountStatus(id, controller.signal);
        if (runId.current !== id) return;
        setRun(next);
        // Applied (piqAt) waits for "Done with application"; pendingApply shows that button.
        change((a) => {
          const progressed = withUcRunProgress(a, { ...next, piq: false }, login.current, Date.now());
          return next.finished || next.piq ? { ...progressed, pendingApply: true } : progressed;
        });
        // Done: close the browser right away instead of leaving it running.
        if (next.finished) void releaseBrowser();
      } catch (e) {
        if (controller.signal.aborted) return;
        setStartError(e instanceof Error ? e.message : "Lost track of the UC browser.");
        setRun((r) => (r ? { ...r, open: false } : r));
        void releaseBrowser();
      }
    }, POLL_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [run, change, releaseBrowser]);

  // A run that ended badly (failed, wrong login) has already let go of its session; sweep any leftover.
  const ended = !!run && !run.open;
  useEffect(() => {
    if (ended) void closeCloudBrowsers().catch(() => undefined);
  }, [ended]);

  /** Start (or restart) the background run with this UC login. */
  const start = useCallback(
    async (creds: UcLogin) => {
      const p = profileRef.current;
      const saved = agentOf(p).ucAccount;
      const known = saved && sameEmail(saved.email, creds.email) ? saved : undefined;
      login.current = creds;
      setStartError(null);
      const starting: UcRun = {
        status: "opening",
        detail: "Starting the cloud browser…",
        mode: known ? "login" : "create",
        open: true,
        created: false,
        browser: "cloud",
        live_url: null,
        page_url: "",
        finished: false,
        verified: false,
        setup: false,
        about: false,
        about_report: { filled: [], missing: [], check: [] },
        piq: false,
        piq_report: { entered: [], skipped: [] },
      };
      runId.current = null;
      setRun(starting);
      try {
        const id = await startUcAccount(
          creds.email,
          creds.password,
          known ? "login" : "create",
          { ...ucFacts(p, account?.name ?? ""), ...(await personalFacts(account?.id)) },
          !!known?.aboutAt,
          !!(known?.verifiedAt || known?.signedInAt),
          ucPiqs(p),
          "cloud",
        );
        runId.current = id;
        setRun({ ...starting });
      } catch (e) {
        // Already running (e.g. another tab): follow that run instead.
        const found = await activeUcRun();
        if (found) {
          runId.current = found.runId;
          setRun(found.run);
          return;
        }
        setRun(null);
        setStartError(e instanceof Error ? e.message : "Couldn't start the UC assistant.");
      }
    },
    [account?.id, account?.name],
  );

  /** Stop: the run lets go and the cloud browser is closed. */
  const stop = useCallback(async () => {
    setRun((r) => (r ? { ...r, detail: "Stopping…" } : r));
    await releaseBrowser();
  }, [releaseBrowser]);

  const sendCode = useCallback(async (code: string) => {
    if (!runId.current) return;
    await submitUcCode(runId.current, code);
    setRun((r) => (r ? { ...r, status: "checking_code", detail: "Entering your code…" } : r));
  }, []);

  /** Forget a finished or failed run (after the student has seen it). */
  const clear = useCallback(() => {
    runId.current = null;
    setRun(null);
    setStartError(null);
  }, []);

  return {
    run,
    /** A run is going in the cloud right now. */
    running: !!run?.open && !run.finished,
    issue: issueOf(run, startError),
    login: login.current,
    start,
    stop,
    sendCode,
    clear,
  };
}
