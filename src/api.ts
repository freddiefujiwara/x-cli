import { randomUUID } from "node:crypto";
import { AuthConfig, buildCookieHeader } from "./auth.js";
import { ClientTransaction, handleXMigration } from "x-client-transaction-id";
import { getGuestToken } from "./guest-token.js";

const TWEET_DETAIL_QUERY_ID = "_8aYOgEDz35BrBcBal1-_w";
const TWEET_BY_REST_ID_QUERY_ID = "aFvUsJm2c-oDkJV75blV6g";
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
  responsive_web_grok_annotations_enabled: true,
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
    if (!isObject(node)) return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    if (predicate(node)) return node;

    for (const k of Object.keys(node)) {
      const v = node[k];
      if (isObject(v)) {
        const found = dfs(v, depth + 1);
        if (found !== undefined) return found;
      } else if (Array.isArray(v)) {
        for (const item of v) {
          const found = dfs(item, depth + 1);
          if (found !== undefined) return found;
        }
      }
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
    if (!isObject(node)) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (predicate(node)) results.push(node);

    for (const k of Object.keys(node)) {
      const v = node[k];
      if (isObject(v)) dfs(v, depth + 1);
      else if (Array.isArray(v)) for (const item of v) dfs(item, depth + 1);
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

  const restIdNode = findFirstDeep(
    entry,
    (n) => isObject(n) && typeof n.rest_id === "string" && /^\d+$/.test(n.rest_id),
    6
  );
  if (restIdNode?.rest_id) return { tweetId: restIdNode.rest_id };

  return {};
}

// ---- Kind/message ----

export function extractNotificationMessage(entry: any): string | undefined {
  const msg =
    getByPath(entry, "content.itemContent.message.text") ??
    getByPath(entry, "content.itemContent.notification_results.result.message.text") ??
    getByPath(entry, "content.itemContent.notification.message.text");

  return typeof msg === "string" ? msg : undefined;
}

export function classifyNotificationKind(entry: any, tweet?: Tweet): NotificationKind {
  const typenameNode = findFirstDeep(entry, (n) => isObject(n) && typeof n.__typename === "string", 6);
  const typename = (typenameNode?.__typename as string | undefined)?.toLowerCase() ?? "";

  const entryId = String(entry?.entryId ?? "").toLowerCase();
  const msg = (extractNotificationMessage(entry) ?? "").toLowerCase();

  if (typename.includes("follow") || msg.includes("followed you") || entryId.includes("follow")) return "follow";
  if (typename.includes("favorite") || typename.includes("like") || msg.includes("liked your") || entryId.includes("like"))
    return "like";
  if (typename.includes("retweet") || typename.includes("repost") || msg.includes("reposted") || msg.includes("retweeted") || entryId.includes("retweet"))
    return "retweet";

  if (tweet?.isReply) return "reply";
  if (typename.includes("reply") || msg.includes("replied to") || entryId.includes("reply")) return "reply";

  if (typename.includes("mention") || msg.includes("mentioned you") || entryId.includes("mention")) return "mention";
  if (typename.includes("quote") || msg.includes("quoted") || entryId.includes("quote")) return "quote";

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

export function parseNotificationsTimelineResponse(data: any): NotificationsPage {
  const instructions =
    data?.data?.viewer_v2?.user_results?.result?.notification_timeline?.timeline?.instructions ?? [];

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

  return {
    entries,
    topCursor,
    bottomCursor,
    markUnreadGreaterThanSortIndex,
    notifications,
  };
}
