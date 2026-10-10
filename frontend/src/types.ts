export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  sources?: string[];
  followups?: string[];
  responseTimeMs?: number;
  error?: boolean;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  sessionId: string | null;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}
