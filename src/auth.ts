import { type StoredAuth } from "./storage.js";

export interface AuthConfig {
  authToken: string;
  csrfToken: string;
  userId?: string;
  username?: string;
}

export function buildCookieHeader(auth: AuthConfig | StoredAuth): string {
  return `auth_token=${auth.authToken}; ct0=${auth.csrfToken}`;
}

// Public bearer token used by Twitter's web client
export const BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
