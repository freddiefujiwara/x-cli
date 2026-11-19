import { BEARER_TOKEN } from "./auth.js";

let cachedToken: string | null = null;
let cacheExpiry = 0;

export async function getGuestToken(): Promise<string> {
  // Return cached token if still valid (cache for 1 hour)
  if (cachedToken && Date.now() < cacheExpiry) {
    return cachedToken;
  }

  const response = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: {
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get guest token (${response.status}): ${text}`);
  }

  const data = await response.json();

  if (!data.guest_token) {
    throw new Error("No guest_token in response");
  }

  cachedToken = data.guest_token;
  cacheExpiry = Date.now() + 3600000; // 1 hour

  return cachedToken as string;
}
