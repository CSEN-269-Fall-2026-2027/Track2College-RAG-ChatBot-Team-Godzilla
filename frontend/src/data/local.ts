import { newId, readJSON, userKey, writeJSON } from "../storage";
import type { Account, Conversation, CoursePlan, Profile, ProfileAnalysis, Transcript } from "../types";
import { AuthError, type DataStore, type Session } from "./store";

const USERS_KEY = "t2c.users.v1";
const SESSION_KEY = "t2c.session.v1";
const MAX_CONVERSATIONS = 50;

interface StoredUser extends Account {
  salt: string;
  passwordHash: string;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 210_000 },
    material,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const loadUsers = () => readJSON<StoredUser[]>(USERS_KEY, []);
const toSession = ({ id, name, email, createdAt }: StoredUser): Session => ({
  account: { id, name, email, createdAt },
  accessToken: null,
});

function collection<T extends { id: string }>(name: string, sortKey: (item: T) => number, limit = Infinity) {
  const read = (userId: string) => readJSON<T[]>(userKey(userId, name), []);
  return {
    list: async (userId: string) => read(userId).sort((a, b) => sortKey(b) - sortKey(a)),
    upsert: (userId: string, item: T) => {
      const items = [item, ...read(userId).filter((x) => x.id !== item.id)];
      writeJSON(userKey(userId, name), items.sort((a, b) => sortKey(b) - sortKey(a)).slice(0, limit));
    },
    remove: (userId: string, id: string) => writeJSON(userKey(userId, name), read(userId).filter((x) => x.id !== id)),
  };
}

/** Device-local store: accounts and data live in this browser's localStorage. */
export function createLocalStore(): DataStore {
  const listeners = new Set<(session: Session | null) => void>();
  const emit = (session: Session | null) => listeners.forEach((listener) => listener(session));

  const conversations = collection<Conversation>("conversations", (c) => c.updatedAt, MAX_CONVERSATIONS);
  const transcripts = collection<Transcript>("transcripts", (t) => t.uploadedAt);
  const plans = collection<CoursePlan>("coursePlans", (p) => p.createdAt);

  return {
    kind: "local",
    auth: {
      async getSession() {
        const userId = readJSON<string | null>(SESSION_KEY, null);
        const user = loadUsers().find((u) => u.id === userId);
        return user ? toSession(user) : null;
      },
      async signUp(name, email, password) {
        const normalizedEmail = email.trim().toLowerCase();
        const users = loadUsers();
        if (users.some((u) => u.email === normalizedEmail)) {
          throw new AuthError("An account with this email already exists. Try signing in.");
        }
        const salt = newId();
        const user: StoredUser = {
          id: newId(),
          name: name.trim(),
          email: normalizedEmail,
          createdAt: Date.now(),
          salt,
          passwordHash: await hashPassword(password, salt),
        };
        writeJSON(USERS_KEY, [...users, user]);
        writeJSON(SESSION_KEY, user.id);
        const session = toSession(user);
        emit(session);
        return { session };
      },
      async signIn(email, password) {
        const user = loadUsers().find((u) => u.email === email.trim().toLowerCase());
        if (!user || (await hashPassword(password, user.salt)) !== user.passwordHash) {
          throw new AuthError("That email and password don't match an account on this device.");
        }
        writeJSON(SESSION_KEY, user.id);
        const session = toSession(user);
        emit(session);
        return session;
      },
      async signOut() {
        localStorage.removeItem(SESSION_KEY);
        emit(null);
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    profiles: {
      get: async (userId) => readJSON<Profile | null>(userKey(userId, "profile"), null),
      save: async (userId, profile) => writeJSON(userKey(userId, "profile"), profile),
    },
    conversations: {
      list: conversations.list,
      save: async (userId, conversation) => conversations.upsert(userId, conversation),
      remove: async (userId, id) => conversations.remove(userId, id),
    },
    analyses: {
      get: async (userId) => readJSON<ProfileAnalysis | null>(userKey(userId, "analysis"), null),
      save: async (userId, analysis) => writeJSON(userKey(userId, "analysis"), analysis),
    },
    transcripts: {
      list: transcripts.list,
      async save(userId, transcript) {
        transcripts.upsert(userId, transcript);
        return transcript;
      },
      remove: async (userId, transcript) => transcripts.remove(userId, transcript.id),
    },
    coursePlans: {
      list: plans.list,
      save: async (userId, plan) => plans.upsert(userId, plan),
      remove: async (userId, id) => plans.remove(userId, id),
    },
  };
}
