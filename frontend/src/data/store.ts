import type { Account, Conversation, CoursePlan, Profile, ProfileAnalysis, Transcript } from "../types";

export interface Session {
  account: Account;
  /** Bearer token for the Track2College API; null for device-local accounts. */
  accessToken: string | null;
}

export type SignUpResult = { session: Session } | { confirmEmail: true };

export class AuthError extends Error {}

/**
 * Everything the app persists goes through this interface, so the storage
 * backend (browser localStorage today, Supabase later) can be swapped without
 * touching pages or providers.
 */
export interface DataStore {
  kind: "local" | "supabase";
  auth: {
    getSession(): Promise<Session | null>;
    signUp(name: string, email: string, password: string): Promise<SignUpResult>;
    signIn(email: string, password: string): Promise<Session>;
    signOut(): Promise<void>;
    onChange(listener: (session: Session | null) => void): () => void;
  };
  profiles: {
    get(userId: string): Promise<Profile | null>;
    save(userId: string, profile: Profile): Promise<void>;
  };
  conversations: {
    list(userId: string): Promise<Conversation[]>;
    save(userId: string, conversation: Conversation): Promise<void>;
    remove(userId: string, id: string): Promise<void>;
  };
  analyses: {
    get(userId: string): Promise<ProfileAnalysis | null>;
    save(userId: string, analysis: ProfileAnalysis): Promise<void>;
  };
  transcripts: {
    list(userId: string): Promise<Transcript[]>;
    /** Persists the record; when a file is given, the original upload is stored too (if supported). */
    save(userId: string, transcript: Transcript, file?: File): Promise<Transcript>;
    remove(userId: string, transcript: Transcript): Promise<void>;
  };
  coursePlans: {
    list(userId: string): Promise<CoursePlan[]>;
    save(userId: string, plan: CoursePlan): Promise<void>;
    remove(userId: string, id: string): Promise<void>;
  };
}
