import type { DataStore } from "./store";

export { AuthError, type DataStore, type Session, type SignUpResult } from "./store";

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

if (!rawUrl || !rawKey) {
  throw new Error(
    "Supabase is required. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env at the project root (see supabase/README.md).",
  );
}

const SUPABASE_URL = rawUrl;
const SUPABASE_ANON_KEY = rawKey;

let storePromise: Promise<DataStore> | null = null;

/** Lazily creates the Supabase-backed store. */
export function getStore(): Promise<DataStore> {
  storePromise ??= import("./supabase").then((m) => m.createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY));
  return storePromise;
}
