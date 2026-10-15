import { createLocalStore } from "./local";
import type { DataStore } from "./store";

export { AuthError, type DataStore, type Session, type SignUpResult } from "./store";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const STORE_KIND: DataStore["kind"] = SUPABASE_URL && SUPABASE_ANON_KEY ? "supabase" : "local";

let storePromise: Promise<DataStore> | null = null;

/** Lazily creates the store; the Supabase client is only downloaded when it's configured. */
export function getStore(): Promise<DataStore> {
  storePromise ??=
    STORE_KIND === "supabase"
      ? import("./supabase").then((m) => m.createSupabaseStore(SUPABASE_URL!, SUPABASE_ANON_KEY!))
      : Promise.resolve(createLocalStore());
  return storePromise;
}
