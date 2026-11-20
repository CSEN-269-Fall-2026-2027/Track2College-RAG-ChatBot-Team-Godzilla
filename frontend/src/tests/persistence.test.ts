import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWriteQueue } from "../data/writeQueue";
import { emptyProfile } from "../profile";
import type { Transcript } from "../types";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { createSupabaseStore } from "../data/supabase";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ok = () => Promise.resolve({ data: null, error: null });

function fakeClient() {
  const upsert = vi.fn((_table: string, _value: unknown) => ok());
  const listRows = vi.fn((_table: string, _from: number, _to: number): Promise<{ data: { data: unknown }[]; error: null }> => Promise.resolve({ data: [], error: null }));
  const removeRows = vi.fn((_table: string, _user: string) => ok());
  const bucket = {
    upload: vi.fn(ok),
    remove: vi.fn(ok),
    list: vi.fn((_prefix: string, _options: unknown): Promise<{ data: { id: string | null; name: string }[] | null; error: { message: string } | null }> => Promise.resolve({ data: [], error: null })),
  };
  const auth = {
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: "alice" } }, error: null })),
    getSession: vi.fn(async (): Promise<{ data: { session: null }; error: { message: string } | null }> => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  };
  const client = {
    auth,
    from: vi.fn((table: string) => ({
      select: () => {
        const query = {
          eq: () => query,
          order: () => query,
          range: (from: number, to: number) => listRows(table, from, to),
        };
        return query;
      },
      upsert: (value: unknown) => upsert(table, value),
      delete: () => ({ eq: (_field: string, user: string) => removeRows(table, user) }),
    })),
    storage: { from: vi.fn(() => bucket) },
  };
  mocks.createClient.mockReturnValue(client);
  return { store: createSupabaseStore("https://example.supabase.co", "public-key"), upsert, removeRows, listRows, bucket, auth };
}

beforeEach(() => vi.clearAllMocks());

describe("ordered account writes", () => {
  it("waits for an older write to finish before writing a newer version of the same row", async () => {
    const q = createWriteQueue();
    const old = deferred<void>();
    const events: string[] = [];
    const first = q.run("alice:profile", async () => { events.push("old"); await old.promise; });
    const second = q.run("alice:profile", async () => { events.push("new"); });
    const other = q.run("bob:profile", async () => { events.push("bob"); });
    await other;
    expect(events).toEqual(["old", "bob"]);
    old.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["old", "bob", "new"]);
  });

  it("recovers after a failed write and drains work queued while draining", async () => {
    const q = createWriteQueue();
    const failed = q.run("profile", async () => { throw new Error("offline"); });
    await expect(failed).rejects.toThrow("offline");
    const nested = vi.fn();
    void q.run("profile", async () => { void q.run("chat", async () => nested()); });
    await q.drain();
    expect(nested).toHaveBeenCalledOnce();
    await expect(q.run("profile", async () => "saved")).resolves.toBe("saved");
  });

  it("serializes actual Supabase profile saves", async () => {
    const { store, upsert } = fakeClient();
    const pending = deferred<{ data: null; error: null }>();
    upsert.mockImplementationOnce(() => pending.promise);
    const first = store.profiles.save("alice", emptyProfile("Old"));
    const second = store.profiles.save("alice", emptyProfile("New"));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    pending.resolve({ data: null, error: null });
    await Promise.all([first, second]);
    expect(upsert.mock.calls.map(([, value]) => (value as { data: { basics: { firstName: string } } }).data.basics.firstName)).toEqual(["Old", "New"]);
  });
});

const transcript: Transcript = {
  id: "transcript-1", fileName: "grades.md", uploadedAt: 1, storagePath: "alice/transcript-1/grades.md",
  studentName: "Alice", school: "High School", reportedGpa: { unweighted: "", weighted: "" },
  courses: [], summary: "", strengths: [], concerns: [],
};

describe("Supabase failures", () => {
  it("reports session and sign-out failures", async () => {
    const { store, auth } = fakeClient();
    auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: "session failed" } });
    auth.signOut.mockResolvedValue({ error: { message: "sign-out failed" } });
    await expect(store.auth.getSession()).rejects.toThrow("session failed");
    await expect(store.auth.signOut()).rejects.toThrow("sign-out failed");
  });

  it("does not claim a transcript was saved when the original upload failed", async () => {
    const { store, bucket, upsert } = fakeClient();
    bucket.upload.mockRejectedValue(new Error("Storage unavailable"));
    await expect(store.transcripts.save("alice", transcript, new File(["grades"], "grades.md"))).rejects.toThrow("Storage unavailable");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("preserves the transcript row when deleting its file failed", async () => {
    const { store, bucket, removeRows } = fakeClient();
    bucket.remove.mockRejectedValue(new Error("Storage unavailable"));
    await expect(store.transcripts.remove("alice", transcript)).rejects.toThrow("Storage unavailable");
    expect(removeRows).not.toHaveBeenCalled();
  });
});

describe("password-confirmed reset", () => {
  it("does not delete account data if backend cleanup failed", async () => {
    const { store, bucket, removeRows } = fakeClient();
    await expect(store.resetAllData("alice", "alice@example.com", "password", async () => {
      throw new Error("Google disconnect failed");
    })).rejects.toThrow("Google disconnect failed");
    expect(bucket.list).not.toHaveBeenCalled();
    expect(removeRows).not.toHaveBeenCalled();
    await expect(store.profiles.save("alice", emptyProfile())).resolves.toBeUndefined();
  });

  it("does not delete anything if reauthentication returned another account", async () => {
    const { store, bucket, removeRows } = fakeClient();
    await expect(store.resetAllData("bob", "alice@example.com", "password")).rejects.toThrow("account you want to reset");
    expect(bucket.list).not.toHaveBeenCalled();
    expect(removeRows).not.toHaveBeenCalled();
  });

  it("stops when listing storage fails instead of reporting a successful reset", async () => {
    const { store, bucket, removeRows } = fakeClient();
    bucket.list.mockResolvedValue({ data: null, error: { message: "Storage unavailable" } });
    await expect(store.resetAllData("alice", "alice@example.com", "password")).rejects.toThrow("Storage unavailable");
    expect(removeRows).not.toHaveBeenCalled();
    // A failed reset must let the student save again.
    await expect(store.profiles.save("alice", emptyProfile())).resolves.toBeUndefined();
  });

  it("waits for pending saves and prevents stale edits from recreating deleted data", async () => {
    const { store, upsert, bucket } = fakeClient();
    const pending = deferred<{ data: null; error: null }>();
    upsert.mockImplementationOnce(() => pending.promise);
    const saved = store.profiles.save("alice", emptyProfile("Old"));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledOnce());
    const reset = store.resetAllData("alice", "alice@example.com", "password");
    await Promise.resolve();
    expect(bucket.list).not.toHaveBeenCalled();
    await expect(store.profiles.save("alice", emptyProfile("Late"))).rejects.toThrow("being reset");
    pending.resolve({ data: null, error: null });
    await saved;
    await reset;
    const final = upsert.mock.calls.at(-1)![1] as { data: ReturnType<typeof emptyProfile> };
    expect(final.data.onboarding.completed).toBe(false);
    expect(final.data.basics.firstName).toBe("");
    await expect(store.profiles.save("alice", emptyProfile("Late"))).rejects.toThrow("being reset");
  });

  it("removes every storage page and treats a missing live table as an error", async () => {
    const { store, bucket, removeRows } = fakeClient();
    bucket.list.mockImplementation(async (prefix, options) => {
      const offset = (options as { offset: number }).offset;
      if (prefix === "alice") return { data: [{ id: null, name: "folder" }], error: null };
      return { data: offset === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `${i}.md` })) : [{ id: "last", name: "last.md" }], error: null };
    });
    removeRows.mockRejectedValueOnce(new Error("profiles missing"));
    await expect(store.resetAllData("alice", "alice@example.com", "password")).rejects.toThrow("profiles missing");
    expect(bucket.list).toHaveBeenCalledWith("alice/folder", expect.objectContaining({ offset: 1000 }));
    expect(bucket.remove.mock.calls.map((args) => (args as unknown as [string[]])[0].length)).toEqual([1000, 1]);
  });
});

describe("complete collection reads", () => {
  it("reads every page instead of silently losing older records after the first 500", async () => {
    const { store, listRows } = fakeClient();
    listRows.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => ({ data: { id: String(i) } })), error: null });
    listRows.mockResolvedValueOnce({ data: [{ data: { id: "last" } }], error: null });
    const rows = await store.conversations.list("alice");
    expect(rows).toHaveLength(501);
    expect(rows.at(-1)?.id).toBe("last");
    expect(listRows.mock.calls).toEqual([["conversations", 0, 499], ["conversations", 500, 999]]);
  });
});
