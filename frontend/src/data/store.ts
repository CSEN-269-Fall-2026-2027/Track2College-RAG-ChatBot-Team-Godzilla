import type { GameState } from "../game/progress";
import type { Account, Conversation, CoursePlan, Profile, ProfileAnalysis, Transcript } from "../types";

export interface Session {
  account: Account;
  /** Supabase JWT used as Bearer token for the Track2College API when present. */
  accessToken: string | null;
}

export type SignUpResult = { session: Session } | { confirmEmail: true };

export class AuthError extends Error {}

/**
 * Everything the app persists goes through this interface (Supabase Auth + tables).
 */
export interface DataStore {
  kind: "supabase";
  auth: {
    getSession(): Promise<Session | null>;
    signUp(name: string, email: string, password: string): Promise<SignUpResult>;
    signIn(email: string, password: string): Promise<Session>;
    signOut(): Promise<void>;
    resetPassword(email: string): Promise<void>;
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
  /** Story-mode progress (XP, achievements, mentor settings). */
  game: {
    get(userId: string): Promise<Partial<GameState> | null>;
    save(userId: string, state: GameState): Promise<void>;
  };
  /**
   * Re-checks the password, then permanently deletes all of this user's saved data
   * (every table row and uploaded file). The login itself is kept.
   */
  resetAllData(userId: string, email: string, password: string): Promise<void>;
}
