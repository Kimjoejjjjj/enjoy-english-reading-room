// src/types/index.ts

export interface User {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaFile {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  type: 'AUDIO' | 'VIDEO' | 'IMAGE';
  url: string;
  thumbnailUrl?: string | null;
  fileSize: number;
  duration?: number | null;
  mimeType: string;
  category?: string | null;
  status?: string;
  totalPages?: number | null;
  totalChapters?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vocabulary {
  id: string;
  userId: string;
  word: string;
  translation?: string | null;
  example?: string | null;
  pronunciation?: string | null;
  notes?: string | null;
  learned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export type AuthProvider = 'email' | 'google' | 'github' | 'mixin';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export type ReadingGoal = number | "OPEN";

export interface ReadingPreferences {
  presets: [number, number, number];
  defaultMinutes: number | null;
  idlePauseMinutes: number | null;
  source?: "account" | "default";
}

export interface ReadingSessionState {
  contentId: string;
  targetSeconds: number | null;
  idlePauseSeconds: number | null;
  elapsedActiveSeconds: number;
  status: "active" | "paused";
  startedAt: number;
  lastActivityAt: number;
  updatedAt: number;
}
