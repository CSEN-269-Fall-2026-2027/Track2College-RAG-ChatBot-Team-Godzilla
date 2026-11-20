import { createClient, type Session as SupabaseSession } from "@supabase/supabase-js";
import type { Conversation, PersonalInfo, Profile, Transcript } from "../types";
import { AuthError, type DataStore, type Session } from "./store";

import type { Database, Json } from "./database.types";
import { createWriteQueue } from "./writeQueue";

/** Table and bucket names must match supabase/schema.sql. */
// Reset also clears retired tables that still exist in deployed projects. No feature reads or writes them.
const TABLES = {
  profiles: "profiles",
  /** Legacy Insights table — still wiped on reset; app no longer reads/writes it. */
  analyses: "profile_analyses",
  conversations: "conversations",
  transcripts: "transcripts",
  /** Legacy course-plan table — still wiped on reset; app no longer reads/writes it. */
  coursePlans: "course_plans",
  /** Retired sound/read-aloud preferences; no screen consumes them. Reset only. */
  game: "game_progress",
  personalInfo: "personal_info",
} as const;
const TRANSCRIPT_BUCKET = "transcripts";

function toSession(session: SupabaseSession): Session {
  const { user } = session;
  return {
    account: {
      id: user.id,
      email: user.email ?? "",
      name: String(user.user_metadata?.full_name ?? user.email ?? ""),
      createdAt: Date.parse(user.created_at),
    },
    accessToken: session.access_token,
  };
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

export function createSupabaseStore(url: string, anonKey: string): DataStore {
  const client = createClient<Database>(url, anonKey);
  const writes = createWriteQueue();
  const resetting = new Set<string>();
  const write = <T>(userId: string, key: string, action: () => Promise<T>) => {
    if (resetting.has(userId)) return Promise.reject(new Error("Your account data is being reset."));
    return writes.run(`${userId}:${key}`, action);
  };

  // Per-user singleton rows keyed by user_id.
  const singleton = <T>(table: "profiles" | "game_progress" | "personal_info") => ({
    async get(userId: string): Promise<T | null> {
      const row = check(await client.from(table).select("data").eq("user_id", userId).maybeSingle());
      return (row?.data as T) ?? null;
    },
    save(userId: string, value: T) {
      return write(userId, table, async () => {
        check(await client.from(table).upsert({ user_id: userId, data: value as Json, updated_at: new Date().toISOString() }));
      });
    },
  });

  // Per-user collections; the full record lives in `data`, with `id` mirrored for upserts.
  const collection = <T extends { id: string }>(table: "conversations" | "transcripts") => ({
    async list(userId: string): Promise<T[]> {
      const records: T[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const rows = check(await client.from(table).select("data").eq("user_id", userId)
          .order("updated_at", { ascending: false }).order("id", { ascending: true })
          .range(offset, offset + pageSize - 1)) ?? [];
        records.push(...rows.map((row) => row.data as T));
        if (rows.length < pageSize) return records;
      }
    },
    save(userId: string, value: T) {
      return write(userId, `${table}:${value.id}`, async () => {
        check(await client.from(table).upsert({ id: value.id, user_id: userId, data: value as unknown as Json, updated_at: new Date().toISOString() }));
      });
    },
    remove(userId: string, id: string) {
      return write(userId, `${table}:${id}`, async () => {
        check(await client.from(table).delete().eq("user_id", userId).eq("id", id));
      });
    },
  });

  const profiles = singleton<Profile>(TABLES.profiles);
  const personalInfo = singleton<PersonalInfo>(TABLES.personalInfo);
  // One row per chat thread; Advisor loads the latest non-empty chat per mentor.
  const conversations = collection<Conversation>(TABLES.conversations);
  const transcripts = collection<Transcript>(TABLES.transcripts);

  return {
    kind: "supabase",
    auth: {
      async getSession() {
        const { data, error } = await client.auth.getSession();
        if (error) throw new AuthError(error.message);
        return data.session ? toSession(data.session) : null;
      },
      async signUp(name, email, password) {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw new AuthError(error.message);
        return data.session ? { session: toSession(data.session) } : { confirmEmail: true };
      },
      async signIn(email, password) {
        const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error || !data.session) throw new AuthError(error?.message ?? "Couldn't sign in.");
        return toSession(data.session);
      },
      async signOut() {
        const { error } = await client.auth.signOut();
        if (error) throw new AuthError(error.message);
      },
      async resetPassword(email) {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
        });
        if (error) throw new AuthError(error.message);
      },
      onChange(listener) {
        const { data } = client.auth.onAuthStateChange((_event, session) => listener(session ? toSession(session) : null));
        return () => data.subscription.unsubscribe();
      },
    },
    profiles,
    personalInfo,
    async resetAllData(userId, email, password, beforeDelete) {
      // Re-authenticate first so a stolen session alone can't wipe everything.
      const { data: authData, error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw new AuthError(authError.message === "Invalid login credentials" ? "That password isn't right." : authError.message);

      if (authData.user?.id !== userId) throw new AuthError("Sign in to the account you want to reset.");
      if (resetting.has(userId)) throw new Error("Your account data is already being reset.");
      resetting.add(userId);
      try {
        // Stop accepting writes, and let every already queued save finish before deleting anything.
        await writes.drain();
        await beforeDelete?.();
        const bucket = client.storage.from(TRANSCRIPT_BUCKET);
        const paths: string[] = [];
        // Storage listings are paginated; a reset must not leave files after the first page.
        const listAll = async (prefix: string) => {
          const entries = [];
          for (let offset = 0; ; offset += 1000) {
            const page = check(await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } })) ?? [];
            entries.push(...page);
            if (page.length < 1000) return entries;
          }
        };
        for (const entry of await listAll(userId)) {
          if (entry.id) paths.push(`${userId}/${entry.name}`);
          else for (const file of await listAll(`${userId}/${entry.name}`)) paths.push(`${userId}/${entry.name}/${file.name}`);
        }
        for (let start = 0; start < paths.length; start += 1000) check(await bucket.remove(paths.slice(start, start + 1000)));

        for (const table of Object.values(TABLES)) {
          const { error } = await client.from(table).delete().eq("user_id", userId);
          // Retired tables may already be dropped; missing live tables indicate a broken migration.
          if (error && (table === TABLES.analyses || table === TABLES.coursePlans || table === TABLES.game) &&
            (error.code === "PGRST205" || error.code === "42P01")) continue;
          if (error) throw new Error(error.message);
        }
        const { emptyProfile } = await import("../profile");
        const blank = { ...emptyProfile(), updatedAt: Date.now() };
        check(await client.from(TABLES.profiles).upsert({ user_id: userId, data: blank as unknown as Json, updated_at: new Date().toISOString() }));
        // Keep writes paused until the caller reloads the page.
      } catch (error) {
        resetting.delete(userId);
        throw error;
      }
    },
    conversations,
    transcripts: {
      list: transcripts.list,
      save(userId, transcript, file) {
        return write(userId, `transcript-file:${transcript.id}`, async () => {
          let record = transcript;
          if (file) {
            // Keep filenames inside their transcript folder even if an upload has path separators.
            const name = file.name.replace(/[\\/]/g, "_");
            const path = `${userId}/${transcript.id}/${name}`;
            const contentType = file.type || (/\.md$/i.test(file.name) ? "text/markdown" : "application/octet-stream");
            check(await client.storage.from(TRANSCRIPT_BUCKET).upload(path, file, { upsert: true, contentType }));
            record = { ...transcript, storagePath: path };
          }
          await transcripts.save(userId, record);
          return record;
        });
      },
      remove(userId, transcript) {
        return write(userId, `transcript-file:${transcript.id}`, async () => {
          if (transcript.storagePath) check(await client.storage.from(TRANSCRIPT_BUCKET).remove([transcript.storagePath]));
          await transcripts.remove(userId, transcript.id);
        });
      },
    },
  };
}
