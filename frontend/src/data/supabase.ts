import { createClient, type Session as SupabaseSession } from "@supabase/supabase-js";
import type { Conversation, CoursePlan, Profile, ProfileAnalysis, Transcript } from "../types";
import { AuthError, type DataStore, type Session } from "./store";

/** Generated schema types live in `./database.types` for reference / future typed queries. */

/** Table and bucket names must match supabase/schema.sql. */
const TABLES = {
  profiles: "profiles",
  analyses: "profile_analyses",
  conversations: "conversations",
  transcripts: "transcripts",
  coursePlans: "course_plans",
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
  const client = createClient(url, anonKey);

  // Per-user singleton rows keyed by user_id (profile, latest analysis).
  const singleton = <T>(table: string) => ({
    async get(userId: string): Promise<T | null> {
      const row = check(await client.from(table).select("data").eq("user_id", userId).maybeSingle());
      return (row?.data as T) ?? null;
    },
    async save(userId: string, value: T) {
      check(await client.from(table).upsert({ user_id: userId, data: value, updated_at: new Date().toISOString() }));
    },
  });

  // Per-user collections; the full record lives in `data`, with `id` mirrored for upserts.
  const collection = <T extends { id: string }>(table: string) => ({
    async list(userId: string): Promise<T[]> {
      const rows = check(await client.from(table).select("data").eq("user_id", userId).order("updated_at", { ascending: false }));
      return (rows ?? []).map((row) => row.data as T);
    },
    async save(userId: string, value: T) {
      check(await client.from(table).upsert({ id: value.id, user_id: userId, data: value, updated_at: new Date().toISOString() }));
    },
    async remove(userId: string, id: string) {
      check(await client.from(table).delete().eq("user_id", userId).eq("id", id));
    },
  });

  const profiles = singleton<Profile>(TABLES.profiles);
  const analyses = singleton<ProfileAnalysis>(TABLES.analyses);
  const conversations = collection<Conversation>(TABLES.conversations);
  const transcripts = collection<Transcript>(TABLES.transcripts);
  const coursePlans = collection<CoursePlan>(TABLES.coursePlans);

  return {
    kind: "supabase",
    auth: {
      async getSession() {
        const { data } = await client.auth.getSession();
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
        await client.auth.signOut();
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
    analyses,
    conversations,
    transcripts: {
      list: transcripts.list,
      async save(userId, transcript, file) {
        let record = transcript;
        if (file) {
          const path = `${userId}/${transcript.id}/${file.name}`;
          try {
            check(await client.storage.from(TRANSCRIPT_BUCKET).upload(path, file, { upsert: true, contentType: file.type }));
            record = { ...transcript, storagePath: path };
          } catch (error) {
            // Storage may be unavailable while a project finishes restoring; still keep the parsed record.
            console.warn("[supabase] transcript file upload skipped:", error);
          }
        }
        await transcripts.save(userId, record);
        return record;
      },
      async remove(userId, transcript) {
        if (transcript.storagePath) {
          try {
            check(await client.storage.from(TRANSCRIPT_BUCKET).remove([transcript.storagePath]));
          } catch (error) {
            console.warn("[supabase] transcript file delete skipped:", error);
          }
        }
        await transcripts.remove(userId, transcript.id);
      },
    },
    coursePlans,
  };
}
