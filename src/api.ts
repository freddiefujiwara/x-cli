import { randomUUID } from "node:crypto";
import { AuthConfig, buildCookieHeader } from "./auth.js";
import { ClientTransaction, handleXMigration } from "x-client-transaction-id";
import { getGuestToken } from "./guest-token.js";

const TWEET_DETAIL_QUERY_ID = "_8aYOgEDz35BrBcBal1-_w";
const TWEET_BY_REST_ID_QUERY_ID = "aFvUsJm2c-oDkJV75blV6g";
const HOME_TIMELINE_QUERY_ID = "GP_SvUI4lAFrt6UyEnkAGA";
const HOME_LATEST_TIMELINE_QUERY_ID = "HN6oP_7h7HayqyYimz97Iw";

const BASE_URL = "https://x.com/i/api/graphql";  // For authenticated requests
const GUEST_BASE_URL = "https://api.x.com/graphql";  // For guest requests

// Cached transaction client for guest requests
let transactionClient: ClientTransaction | null = null;

// Public bearer token used by Twitter's web client
const BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
  post_ctas_fetch_enabled: true,
  responsive_web_grok_annotations_enabled: false,
};

const FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author: {
    id: string;
    name: string;
    username: string;
    profileImageUrl: string;
  };
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views: number;
    bookmarks: number;
  };
  isReply: boolean;
  inReplyToTweetId?: string;
}

export interface TweetThread {
  mainTweet: Tweet;
  parentTweets: Tweet[];
  replies: Tweet[];
}

export interface HomeTimelineResult {

  tweets: Tweet[];
  cursor?: string; // For next page (if available)
}
export interface HomeLatestTimelineResult extends HomeTimelineResult {}

function extractTweetFromResult(result: any): Tweet | null {
  if (!result || result.__typename === "TweetTombstone") {
    return null;
  }

  const tweet = result.__typename === "TweetWithVisibilityResults"
    ? result.tweet
    : result;

  if (!tweet?.legacy || !tweet?.core?.user_results?.result) {
    return null;
  }

  const legacy = tweet.legacy;
  const user = tweet.core.user_results.result;
  const userLegacy = user.legacy || {};
  const userCore = user.core || {};

  return {
    id: tweet.rest_id,
    text: legacy.full_text,
    createdAt: legacy.created_at,
    author: {
      id: user.rest_id,
      name: userCore.name || userLegacy.name || "",
      username: userCore.screen_name || userLegacy.screen_name || "",
      profileImageUrl: user.avatar?.image_url || userLegacy.profile_image_url_https || "",
    },
    metrics: {
      likes: legacy.favorite_count || 0,
      retweets: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      quotes: legacy.quote_count || 0,
      views: parseInt(tweet.views?.count || "0", 10),
      bookmarks: legacy.bookmark_count || 0,
    },
    isReply: !!legacy.in_reply_to_status_id_str,
    inReplyToTweetId: legacy.in_reply_to_status_id_str,
  };
}

export async function getTweetDetail(
  tweetId: string,
  auth: AuthConfig
): Promise<TweetThread> {
  const variables = {
    focalTweetId: tweetId,
    with_rux_injections: true,
    rankingMode: "Relevance",
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
    fieldToggles: JSON.stringify(FIELD_TOGGLES),
  });

  const url = `${BASE_URL}/${TWEET_DETAIL_QUERY_ID}/TweetDetail?${params}`;

  // Generate a random UUID for this session
  const clientUuid = randomUUID();

  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      cookie: buildCookieHeader(auth),
      "x-csrf-token": auth.csrfToken,
      "x-client-uuid": clientUuid,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`API request failed (${response.status}): ${text}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();

  // Check for errors in response
  if (data.errors) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`);
  }

  return parseTweetDetailResponse(data, tweetId);
}

function parseTweetDetailResponse(data: any, focalTweetId: string): TweetThread {
  const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
  const entries: any[] = [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries" && instruction.entries) {
      entries.push(...instruction.entries);
    }
  }

  let mainTweet: Tweet | null = null;
  const parentTweets: Tweet[] = [];
  const replies: Tweet[] = [];
  let foundEmptyTweetResults = false;

  for (const entry of entries) {
    const entryId = entry.entryId || "";
    const content = entry.content;

    if (entryId.startsWith("tweet-")) {
      const tweetResult = content?.itemContent?.tweet_results?.result;

      // Check if tweet_results exists but is empty (auth issue)
      if (!tweetResult && content?.itemContent?.tweet_results &&
          Object.keys(content.itemContent.tweet_results).length === 0) {
        foundEmptyTweetResults = true;
      }

      const tweet = extractTweetFromResult(tweetResult);

      if (tweet) {
        if (tweet.id === focalTweetId) {
          mainTweet = tweet;
        } else if (mainTweet === null) {
          parentTweets.push(tweet);
        } else {
          replies.push(tweet);
        }
      }
    } else if (entryId.startsWith("conversationthread-")) {
      const items = content?.items || [];
      for (const item of items) {
        const tweetResult = item?.item?.itemContent?.tweet_results?.result;
        const tweet = extractTweetFromResult(tweetResult);
        if (tweet && tweet.id !== focalTweetId) {
          replies.push(tweet);
        }
      }
    }
  }

  if (!mainTweet) {
    if (foundEmptyTweetResults) {
      const error = new Error(
        "Authentication failed or expired. The API returned the tweet structure but without content.\n\n" +
        "Your auth cookies may be invalid or expired. Try:\n" +
        "1. Run 'x logout' then 'x login' to re-authenticate\n" +
        "2. Or manually update ~/.config/x-cli/auth.json with fresh cookies from your browser"
      ) as Error & { status: number };
      error.status = 401;
      throw error;
    }
    throw new Error("Could not find the requested tweet");
  }

  return {
    mainTweet,
    parentTweets,
    replies,
  };
}

export async function getHomeTimeline(
  auth: AuthConfig,
  opts?: {
    count?: number;
    cursor?: string;
    includePromotedContent?: boolean;
    withCommunity?: boolean;
  }
): Promise<HomeTimelineResult> {
  const variables = {
    count: opts?.count ?? 40,
    cursor: opts?.cursor, // Better not to send if undefined
    includePromotedContent: opts?.includePromotedContent ?? true,
    withCommunity: opts?.withCommunity ?? true,
  };

  // Delete cursor if it is undefined (the API may not like it)
  if (!variables.cursor) delete (variables as any).cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
  });

  const url = `${BASE_URL}/${HOME_TIMELINE_QUERY_ID}/HomeTimeline?${params}`;

  const clientUuid = randomUUID();

  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "ja,en-US;q=0.7,en;q=0.3",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      cookie: buildCookieHeader(auth),
      "x-csrf-token": auth.csrfToken,
      "x-client-uuid": clientUuid,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "x-twitter-active-user": "no",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/146.0",
      referer: "https://x.com/home",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`HomeTimeline failed (${response.status}): ${text}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`);
  }

  return parseHomeTimelineResponse(data, opts?.count);
}

export async function getHomeLatestTimeline(
  auth: AuthConfig,
  opts?: {
    count?: number;
    cursor?: string;
    enableRanking?: boolean;
    includePromotedContent?: boolean;
    requestContext?: string; // e.g. "launch"
    seenTweetIds?: string[];
  }
): Promise<HomeTimelineResult> {
  const variables: Record<string, any> = {
    count: opts?.count ?? 40,
    enableRanking: opts?.enableRanking ?? true,
    includePromotedContent: opts?.includePromotedContent ?? true,
    requestContext: opts?.requestContext ?? "launch",
    seenTweetIds: opts?.seenTweetIds ?? [],
    cursor: opts?.cursor,
  };

  // Avoid sending parameters that the API might reject (similar to HomeTimeline).
  if (!variables.cursor) delete variables.cursor;
  if (!variables.seenTweetIds || variables.seenTweetIds.length === 0) delete variables.seenTweetIds;

  const url = `${BASE_URL}/${HOME_LATEST_TIMELINE_QUERY_ID}/HomeLatestTimeline`;

  const clientUuid = randomUUID();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "ja,en-US;q=0.7,en;q=0.3",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      cookie: buildCookieHeader(auth),
      "x-csrf-token": auth.csrfToken,
      "x-client-uuid": clientUuid,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "x-twitter-active-user": "yes",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/146.0",
      referer: "https://x.com/home",
      origin: "https://x.com",
    },
    body: JSON.stringify({
      queryId: HOME_LATEST_TIMELINE_QUERY_ID,
      variables,
      features: FEATURES,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `HomeLatestTimeline failed (${response.status}): ${text}`
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`);
  }

  // The response structure is home.home_timeline_urt.instructions, so reuse the existing parser.
  return parseHomeTimelineResponse(data, opts?.count);
}

export function parseHomeTimelineResponse(
  data: any,
  count?: number,
): HomeTimelineResult {
  const instructions = data?.data?.home?.home_timeline_urt?.instructions ?? [];
  const entries: any[] = [];

  for (const ins of instructions) {
    if (ins?.type === "TimelineAddEntries" && Array.isArray(ins.entries)) {
      entries.push(...ins.entries);
    }
  }

  const tweets: Tweet[] = [];
  for (const entry of entries) {
    const entryId = entry?.entryId ?? "";
    if (entryId.startsWith("tweet-") || entryId.startsWith("promoted-tweet-")) {
      const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
      const tweet = extractTweetFromResult(tweetResult);
      if (tweet) tweets.push(tweet);
      if (count && tweets.length >= count) break;
    }
  }

  // Pick up the next page cursor (best-effort as the location may change)
  const cursor = findCursor(entries);

  // Deduplication (to prevent duplicates between promoted and regular tweets, and on re-fetch)
  const uniq = new Map<string, Tweet>();
  for (const t of tweets) uniq.set(t.id, t);

  return { tweets: [...uniq.values()], cursor };
}

export function findCursor(entries: any[]): string | undefined {
  // The cursor for HomeTimeline may appear in entry.content.value / entry.content.itemContent.value, etc.
  for (const e of entries) {
    const c1 = e?.content?.value;
    if (typeof c1 === "string" && c1.length > 10) return c1;

    const c2 = e?.content?.itemContent?.value;
    if (typeof c2 === "string" && c2.length > 10) return c2;

    const c3 = e?.content?.cursorType && e?.content?.value;
    if (typeof c3 === "string" && c3.length > 10) return c3;
  }
  return undefined;
}

async function initTransactionClient(): Promise<ClientTransaction> {
  if (!transactionClient) {
    const document = await handleXMigration();
    transactionClient = await ClientTransaction.create(document);
  }
  return transactionClient;
}

export async function getTweetAsGuest(tweetId: string): Promise<Tweet> {
  // Initialize transaction client and get guest token
  const [client, guestToken] = await Promise.all([
    initTransactionClient(),
    getGuestToken(),
  ]);

  const variables = {
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
    fieldToggles: JSON.stringify(FIELD_TOGGLES),
  });

  const path = `/graphql/${TWEET_BY_REST_ID_QUERY_ID}/TweetResultByRestId`;
  const transactionId = await client.generateTransactionId("GET", path);

  const url = `${GUEST_BASE_URL}/${TWEET_BY_REST_ID_QUERY_ID}/TweetResultByRestId?${params}`;

  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      origin: "https://x.com",
      referer: "https://x.com/",
      "x-guest-token": guestToken,
      "x-client-transaction-id": transactionId,
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Guest API request failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`);
  }

  const result = data?.data?.tweetResult?.result;
  if (!result) {
    throw new Error("Tweet not found or not accessible");
  }

  const tweet = extractTweetFromResult(result);
  if (!tweet) {
    throw new Error("Failed to parse tweet data");
  }

  return tweet;
}

export function extractTweetId(input: string): string {
  const urlMatch = input.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  if (/^\d+$/.test(input)) {
    return input;
  }

  throw new Error(
    `Invalid tweet ID or URL: "${input}"\n` +
      "Expected a tweet ID (e.g., \"1234567890\") or URL (e.g., \"https://x.com/user/status/1234567890\")"
  );
}

// ===== Notifications Timeline =====

const NOTIFICATIONS_TIMELINE_QUERY_ID = "c1Zz6Vb2QqYuFeafTqVjAQ";

export type NotificationsTimelineType = "All" | "Verified" | "Mentions";

export type NotificationKind =
  | "like"
  | "retweet"
  | "reply"
  | "mention"
  | "follow"
  | "quote"
  | "repost"
  | "unknown";

export interface NotificationActor {
  id?: string;
  name?: string;
  username?: string;
  profileImageUrl?: string;
}

export interface Notification {
  id: string; // entryId 等
  sortIndex?: string;
  unread?: boolean;
  kind: NotificationKind;
  actors: NotificationActor[];
  tweet?: Tweet;
  tweetId?: string;
  message?: string;
  raw: any;
}

export interface NotificationsPage {
  entries: any[];
  topCursor?: string;
  bottomCursor?: string;
  markUnreadGreaterThanSortIndex?: string;
  notifications: Notification[];
}

// ---- Deep helpers ----

function isObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object";
}

export function getByPath(obj: any, path: string): any {
  if (path === "") return obj;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!isObject(cur) || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function findFirstDeep(obj: any, predicate: (node: any) => boolean, maxDepth = 8): any | undefined {
  const seen = new Set<any>();

  function dfs(node: any, depth: number): any | undefined {
    if (depth > maxDepth) return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = dfs(item, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!isObject(node)) return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    if (predicate(node)) return node;

    for (const k of Object.keys(node)) {
      const found = dfs(node[k], depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  return dfs(obj, 0);
}

export function collectDeep(obj: any, predicate: (node: any) => boolean, maxDepth = 8, limit = 10): any[] {
  const results: any[] = [];
  const seen = new Set<any>();

  function dfs(node: any, depth: number) {
    if (results.length >= limit) return;
    if (depth > maxDepth) return;
    if (Array.isArray(node)) {
      for (const item of node) dfs(item, depth + 1);
      return;
    }
    if (!isObject(node)) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (predicate(node)) results.push(node);

    for (const k of Object.keys(node)) {
      dfs(node[k], depth + 1);
    }
  }

  dfs(obj, 0);
  return results;
}

// ---- Actors ----

export function extractActorFromUserResult(userResult: any): NotificationActor | null {
  if (!userResult || userResult.__typename !== "User") return null;

  const legacy = userResult.legacy || {};
  const core = userResult.core || {};
  return {
    id: userResult.rest_id,
    name: core.name || legacy.name,
    username: core.screen_name || legacy.screen_name,
    profileImageUrl: userResult.avatar?.image_url || legacy.profile_image_url_https,
  };
}

export function extractActors(entry: any): NotificationActor[] {
  const candidatePaths = [
    "content.itemContent.user_results.result",
    "content.itemContent.notification_results.result.user_results.result",
    "content.itemContent.notification.user_results.result",
    "content.itemContent.notification_results.result.actors",
  ];

  const actors: NotificationActor[] = [];

  for (const p of candidatePaths) {
    const v = getByPath(entry, p);
    if (!v) continue;

    if (Array.isArray(v)) {
      for (const item of v) {
        const maybeUser = item?.user_results?.result ?? item;
        const a = extractActorFromUserResult(maybeUser);
        if (a) actors.push(a);
      }
    } else {
      const maybeUser = v?.user_results?.result ?? v;
      const a = extractActorFromUserResult(maybeUser);
      if (a) actors.push(a);
    }
  }

  // fallback deep search
  const userNodes = collectDeep(
    entry,
    (n) => isObject(n) && n.user_results && n.user_results.result && isObject(n.user_results.result),
    7,
    10
  );

  for (const n of userNodes) {
    const a = extractActorFromUserResult(n.user_results.result);
    if (a) actors.push(a);
  }

  // dedupe
  const uniq = new Map<string, NotificationActor>();
  for (const a of actors) {
    const key = `${a.id ?? ""}:${a.username ?? ""}:${a.name ?? ""}`;
    if (!uniq.has(key)) uniq.set(key, a);
  }
  return [...uniq.values()];
}

// ---- Tweet extraction (re-use extractTweetFromResult) ----

export function extractTweetFromNotificationEntry(entry: any): { tweet?: Tweet; tweetId?: string } {
  const candidatePaths = [
    "content.itemContent.tweet_results.result",
    "content.itemContent.notification_results.result.tweet_results.result",
    "content.itemContent.notification.tweet_results.result",
    "content.itemContent.itemContent.tweet_results.result",
  ];

  for (const p of candidatePaths) {
    const tr = getByPath(entry, p);
    const t = extractTweetFromResult(tr);
    if (t) return { tweet: t, tweetId: t.id };
  }

  const tweetResultsNode = findFirstDeep(
    entry,
    (n) => isObject(n) && n.tweet_results && isObject(n.tweet_results) && ("result" in n.tweet_results),
    8
  );

  if (tweetResultsNode?.tweet_results?.result) {
    const t = extractTweetFromResult(tweetResultsNode.tweet_results.result);
    if (t) return { tweet: t, tweetId: t.id };

    const restId = tweetResultsNode.tweet_results.result?.rest_id;
    if (typeof restId === "string") return { tweetId: restId };
  }

  return {};
}

// ---- Kind/message ----

export function extractNotificationMessage(entry: any): string | undefined {
  const msg =
    getByPath(entry, "content.itemContent.rich_message.text") ??
    getByPath(entry, "content.itemContent.message.text") ??
    getByPath(entry, "content.itemContent.notification_results.result.message.text") ??
    getByPath(entry, "content.itemContent.notification.message.text");

  return typeof msg === "string" ? msg : undefined;
}

/**
 * Converts the 'element' string from an API response to a NotificationKind.
 * @param element The value of `clientEventInfo.element` from the JSON response.
 */
const ELEMENT_TO_KIND: Record<string, NotificationKind> = {
  users_liked_your_tweet: "like",
  users_liked_your_post: "like",
  users_liked_your_retweet: "like",
  user_liked_multiple_tweets: "like",
  users_retweeted_your_tweet: "retweet",
  users_retweeted_your_post: "retweet",
  user_reposted_your_tweet: "repost",
  user_replied_to_your_tweet: "reply",
  user_mentioned_you: "mention",
  user_followed_you: "follow",
  users_followed_you: "follow",
  follow_from_recommended_user: "follow",
  user_quoted_your_tweet: "quote",
};

/**
 * Converts the 'element' string from an API response to a NotificationKind.
 * @param element The value of `clientEventInfo.element` from the JSON response.
 */
export function mapElementToNotificationKind(element?: string): NotificationKind {
  if (!element) return "unknown";
  return ELEMENT_TO_KIND[element] ?? "unknown";
}

export function classifyNotificationKind(entry: any, tweet?: Tweet): NotificationKind {
  // --- New primary classification method ---
  const element = getByPath(entry, "content.clientEventInfo.element") as string | undefined;
  const kindFromElement = mapElementToNotificationKind(element);
  if (kindFromElement !== "unknown") {
    return kindFromElement;
  }

  // --- Icon fallback (observed: heart_icon for likes, person_icon for follows) ---
  const icon = getByPath(entry, "content.itemContent.notification_icon") as string | undefined;
  if (icon === "heart_icon") return "like";
  if (icon === "person_icon") return "follow";

  // --- Fallback to original logic ---
  const typenameNode = findFirstDeep(entry, (n) => isObject(n) && typeof n.__typename === "string", 6);
  const typename = (typenameNode?.__typename as string | undefined)?.toLowerCase() ?? "";

  const entryId = String(entry?.entryId ?? "").toLowerCase();
  const msg = (extractNotificationMessage(entry) ?? "").toLowerCase();
  const richMessageIconId = getByPath(entry, "content.rich_message.icon.id") as string | undefined;

  if (typename.includes("follow") || msg.includes("followed you") || entryId.includes("follow")) return "follow";
  if (typename.includes("favorite") || typename.includes("like") || msg.includes("liked your") || entryId.includes("like"))
    return "like";
  if (
    typename.includes("retweet") ||
    typename.includes("repost") ||
    msg.includes("reposted") ||
    msg.includes("retweeted") ||
    entryId.includes("retweet") ||
    richMessageIconId?.includes("retweet")
  )
    return "retweet";

  if (typename.includes("quote") || msg.includes("quoted") || entryId.includes("quote")) return "quote";
  if (typename.includes("mention") || msg.includes("mentioned you") || entryId.includes("mention")) return "mention";

  if (typename.includes("reply") || msg.includes("replied to") || entryId.includes("reply")) return "reply";
  if (tweet?.isReply) return "reply";

  return "unknown";
}

// ---- Entry -> Notification ----

export function normalizeNotificationEntry(entry: any): Notification | null {
  const entryId = String(entry?.entryId ?? "");
  if (!entryId) return null;
  if (entryId.startsWith("cursor-")) return null;

  const sortIndex = typeof entry?.sortIndex === "string" ? entry.sortIndex : undefined;

  const actors = extractActors(entry);
  const { tweet, tweetId } = extractTweetFromNotificationEntry(entry);
  const message = extractNotificationMessage(entry);
  const kind = classifyNotificationKind(entry, tweet);

  return {
    id: entryId,
    sortIndex,
    kind,
    actors,
    tweet,
    tweetId,
    message,
    raw: entry,
  };
}

// ---- Fetch NotificationsTimeline (auth required) ----

export async function getNotificationsTimeline(
  auth: AuthConfig,
  opts?: {
    timelineType?: NotificationsTimelineType;
    cursor?: string;
    count?: number;
  }
): Promise<NotificationsPage> {
  const variables: Record<string, any> = {
    timeline_type: opts?.timelineType ?? "All",
    count: opts?.count ?? 40,
  };
  if (opts?.cursor) variables.cursor = opts.cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
  });

  const url = `${BASE_URL}/${NOTIFICATIONS_TIMELINE_QUERY_ID}/NotificationsTimeline?${params}`;

  const clientUuid = randomUUID();

  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      cookie: buildCookieHeader(auth),
      "x-csrf-token": auth.csrfToken,
      "x-client-uuid": clientUuid,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Notifications API request failed (${response.status}): ${text}`) as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (data.errors) throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`);

  return parseNotificationsTimelineResponse(data);
}

/** Compares two numeric strings (e.g. sortIndex values) without precision loss. */
export function compareSortIndex(a: string, b: string): number {
  const na = a.replace(/^0+/, "") || "0";
  const nb = b.replace(/^0+/, "") || "0";
  if (na.length !== nb.length) return na.length - nb.length;
  return na < nb ? -1 : na > nb ? 1 : 0;
}

export function parseNotificationsTimelineResponse(data: any): NotificationsPage {
  const instructions =
    getByPath(data, "data.viewer_v2.user_results.result.notification_timeline.timeline.instructions") ?? [];

  const entries: any[] = [];
  let topCursor: string | undefined;
  let bottomCursor: string | undefined;
  let markUnreadGreaterThanSortIndex: string | undefined;

  for (const ins of instructions) {
    if (ins?.type === "TimelineAddEntries" && Array.isArray(ins.entries)) {
      for (const e of ins.entries) {
        entries.push(e);

        const entryId = e?.entryId ?? "";
        const content = e?.content;

        if (entryId.startsWith("cursor-top-") && content?.value) topCursor = content.value;
        if (entryId.startsWith("cursor-bottom-") && content?.value) bottomCursor = content.value;
      }
    }

    if (ins?.type === "TimelineMarkEntriesUnreadGreaterThanSortIndex" && ins?.sort_index) {
      markUnreadGreaterThanSortIndex = ins.sort_index;
    }
  }

  const notifications: Notification[] = [];
  for (const e of entries) {
    const n = normalizeNotificationEntry(e);
    if (n) notifications.push(n);
  }

  if (markUnreadGreaterThanSortIndex) {
    for (const n of notifications) {
      n.unread =
        n.sortIndex !== undefined &&
        compareSortIndex(n.sortIndex, markUnreadGreaterThanSortIndex) > 0;
    }
  }

  return {
    entries,
    topCursor,
    bottomCursor,
    markUnreadGreaterThanSortIndex,
    notifications,
  };
}

// ===== User stats (own profile + recent posts) =====

// Note: UserByRestId is deliberately not used. Verified 2026-11-16 from
// the production network: it was the only profile endpoint answered with
// a Cloudflare 403 block page, while UserByScreenName worked.
const USER_BY_SCREEN_NAME_QUERY_ID = "NimuplG1OB7Fd2btCLdBOw";
const USER_TWEETS_QUERY_ID = "QWF3SzpHmykQHsQMixG0cg";

export interface UserProfile {
  id: string;
  username: string | null;
  name: string | null;
  followers: number | null;
  following: number | null;
}

export interface StatsPost {
  id: string;
  posted_at: string | null; // ISO 8601
  text: string;
  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
}

export interface UserStats {
  collected_at: string; // ISO 8601
  username: string | null;
  followers: number | null;
  following: number | null;
  recent_posts: StatsPost[];
}

/** Absent metrics stay null (never 0), mirroring tweet-gas sns_snapshot. */
function metricOrNull(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseUserResult(userResult: any): UserProfile | null {
  if (!userResult || userResult.__typename === "UserUnavailable") return null;

  const id = userResult.rest_id;
  if (typeof id !== "string" || !id) return null;

  const legacy = userResult.legacy || {};
  const core = userResult.core || {};
  return {
    id,
    username: core.screen_name || legacy.screen_name || null,
    name: core.name || legacy.name || null,
    followers: metricOrNull(legacy.followers_count),
    following: metricOrNull(legacy.friends_count),
  };
}

/** The logged-in user as embedded in a NotificationsTimeline response. */
export function extractViewerProfile(data: any): UserProfile | null {
  return parseUserResult(getByPath(data, "data.viewer_v2.user_results.result"));
}

async function graphqlGet(
  auth: AuthConfig,
  queryId: string,
  operationName: string,
  variables: Record<string, any>
): Promise<any> {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
  });

  const url = `${BASE_URL}/${queryId}/${operationName}?${params}`;

  const clientUuid = randomUUID();

  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      cookie: buildCookieHeader(auth),
      "x-csrf-token": auth.csrfToken,
      "x-client-uuid": clientUuid,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`${operationName} failed (${response.status}): ${text}`) as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

export async function getUserByScreenName(
  auth: AuthConfig,
  username: string
): Promise<UserProfile> {
  const data = await graphqlGet(auth, USER_BY_SCREEN_NAME_QUERY_ID, "UserByScreenName", {
    screen_name: username,
    withSafetyModeUserFields: false,
  });
  const profile = parseUserResult(data?.data?.user?.result);
  if (!profile) {
    throw new Error("Could not load the user profile");
  }
  return profile;
}

async function fetchViewerProfile(auth: AuthConfig): Promise<UserProfile | null> {
  const data = await graphqlGet(auth, NOTIFICATIONS_TIMELINE_QUERY_ID, "NotificationsTimeline", {
    timeline_type: "All",
    count: 1,
  });
  return extractViewerProfile(data);
}

/**
 * Maps one tweet result to a stats post. Returns null for tombstones,
 * retweets and replies, mirroring the tweet-gas sns_snapshot query
 * (exclude=retweets,replies).
 */
export function statsPostFromResult(result: any): StatsPost | null {
  if (!result || result.__typename === "TweetTombstone") {
    return null;
  }

  const tweet = result.__typename === "TweetWithVisibilityResults" ? result.tweet : result;
  const legacy = tweet?.legacy;
  if (!legacy || typeof tweet?.rest_id !== "string" || !tweet.rest_id) {
    return null;
  }

  if (legacy.retweeted_status_result) return null;
  if (legacy.in_reply_to_status_id_str) return null;

  const created = typeof legacy.created_at === "string" ? new Date(legacy.created_at) : null;

  const viewsRaw = tweet.views?.count;
  let views: number | null = null;
  if (viewsRaw !== undefined && viewsRaw !== null && viewsRaw !== "") {
    const parsed = Number.parseInt(String(viewsRaw), 10);
    views = Number.isNaN(parsed) ? null : parsed;
  }

  return {
    id: tweet.rest_id,
    posted_at: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
    text: typeof legacy.full_text === "string" ? legacy.full_text : "",
    views,
    likes: metricOrNull(legacy.favorite_count),
    reposts: metricOrNull(legacy.retweet_count),
    replies: metricOrNull(legacy.reply_count),
  };
}

export function parseUserTweetsResponse(data: any): {
  posts: StatsPost[];
  bottomCursor?: string;
  authorUsername?: string;
} {
  const instructions =
    getByPath(data, "data.user.result.timeline_v2.timeline.instructions") ??
    getByPath(data, "data.user.result.timeline.timeline.instructions") ??
    [];

  const posts: StatsPost[] = [];
  let bottomCursor: string | undefined;
  let authorUsername: string | undefined;

  // Every entry on a user's own posts timeline is authored by that user,
  // so the first resolvable author is the timeline owner's screen name.
  const noteAuthor = (result: any) => {
    if (authorUsername) return;
    const tweet = result?.__typename === "TweetWithVisibilityResults" ? result.tweet : result;
    authorUsername = extractActorFromUserResult(tweet?.core?.user_results?.result)?.username;
  };

  for (const ins of instructions) {
    if (ins?.type !== "TimelineAddEntries" || !Array.isArray(ins.entries)) continue;

    for (const entry of ins.entries) {
      const entryId = entry?.entryId ?? "";

      if (entryId.startsWith("tweet-")) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        noteAuthor(result);
        const post = statsPostFromResult(result);
        if (post) posts.push(post);
      } else if (entryId.startsWith("profile-conversation-")) {
        // A self-thread: only the head post counts (the rest are replies).
        const items = entry?.content?.items;
        const head = Array.isArray(items) ? items[0] : null;
        const result = head?.item?.itemContent?.tweet_results?.result;
        noteAuthor(result);
        const post = statsPostFromResult(result);
        if (post) posts.push(post);
      } else if (entryId.startsWith("cursor-bottom-")) {
        const v = entry?.content?.value;
        if (typeof v === "string" && v) bottomCursor = v;
      }
    }
  }

  return { posts, bottomCursor, authorUsername };
}

export async function getUserTweetsPage(
  auth: AuthConfig,
  userId: string,
  opts?: { count?: number; cursor?: string }
): Promise<{ posts: StatsPost[]; bottomCursor?: string; authorUsername?: string }> {
  const variables: Record<string, any> = {
    userId,
    count: opts?.count ?? 50,
    includePromotedContent: true,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
  };
  if (opts?.cursor) variables.cursor = opts.cursor;

  const data = await graphqlGet(auth, USER_TWEETS_QUERY_ID, "UserTweets", variables);
  return parseUserTweetsResponse(data);
}

/**
 * Collects the account's follower count and newest posts with their
 * public metrics, in the same shape tweet-gas's sns_snapshot reports
 * (absent metrics are null, retweets and replies are excluded).
 */
export async function getUserStats(
  auth: AuthConfig,
  opts?: { count?: number }
): Promise<UserStats> {
  const count = opts?.count ?? 50;

  let profile: UserProfile | null = null;
  let userId: string | null = auth.userId ?? null;
  let firstPage: { posts: StatsPost[]; bottomCursor?: string; authorUsername?: string } | null =
    null;

  if (auth.username) {
    profile = await getUserByScreenName(auth, auth.username);
    userId = profile.id;
  }

  if (!userId) {
    // auth.json usually stores only the cookies. The viewer object in a
    // notifications response carries the account's rest_id (verified
    // 2026-11-16: nothing else, no counts), which is enough to fetch
    // the account's own posts timeline.
    const viewer = await fetchViewerProfile(auth);
    userId = viewer?.id ?? null;
  }

  if (!userId) {
    throw new Error(
      "Could not determine the logged-in user. Try 'x logout' then 'x login' again."
    );
  }

  if (!profile) {
    // The posts timeline is needed anyway; its first page also reveals
    // the screen name, which unlocks the profile counts.
    firstPage = await getUserTweetsPage(auth, userId, { count });
    if (!firstPage.authorUsername) {
      throw new Error("Could not determine the logged-in user's screen name.");
    }
    profile = await getUserByScreenName(auth, firstPage.authorUsername);
  }

  const byId = new Map<string, StatsPost>();
  let cursor: string | undefined;
  const MAX_PAGES = 6;

  for (let pageNo = 0; pageNo < MAX_PAGES && byId.size < count; pageNo++) {
    const page =
      pageNo === 0 && firstPage
        ? firstPage
        : await getUserTweetsPage(auth, userId, { count, cursor });
    for (const p of page.posts) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    if (!page.bottomCursor || page.bottomCursor === cursor) break;
    cursor = page.bottomCursor;
  }

  return {
    collected_at: new Date().toISOString(),
    username: profile.username,
    followers: profile.followers,
    following: profile.following,
    recent_posts: [...byId.values()].slice(0, count),
  };
}
