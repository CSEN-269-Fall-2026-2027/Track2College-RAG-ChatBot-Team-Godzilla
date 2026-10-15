export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled (e.g. private mode); data just won't persist.
  }
}

export const userKey = (userId: string, name: string) => `t2c.u.${userId}.${name}`;

export function newId(): string {
  return crypto.randomUUID();
}

export function makeTitle(query: string): string {
  const clean = query.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}
