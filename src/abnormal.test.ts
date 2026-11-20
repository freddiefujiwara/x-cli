/**
 * Abnormal-case tests: deformed X API payloads must never crash a whole
 * feed/list, leak "[object Object]" / comma-joined arrays / NaN into shaped
 * output, invent numbers from non-numbers, or roll non-existent dates over.
 * All fixtures are synthetic.
 */
import {
  getHomeTimeline,
  getNotificationsTimeline,
  getTweetDetail,
  parseHomeTimelineResponse,
  parseNotificationsTimelineResponse,
  normalizeNotificationEntry,
  classifyNotificationKind,
  mapElementToNotificationKind,
  extractActorFromUserResult,
  extractActors,
  parseUserResult,
  statsPostFromResult,
} from "./api.js";
import { getGuestToken } from "./guest-token.js";
import { formatTweet } from "./format.js";
import type { AuthConfig } from "./auth.js";
import { jest } from "@jest/globals";

/** An object whose toString is not callable: String() / template coercion throws. */
const UNSTRINGIFIABLE: any = { toString: [] };

const mockAuth: AuthConfig = { authToken: "test-auth-token", csrfToken: "test-csrf-token" };

function mockResponse(data: any, ok: boolean = true, status: number = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function makeTweetResult(restId: any, legacyOverrides: Record<string, any> = {}, extra: Record<string, any> = {}): any {
  return {
    __typename: "Tweet",
    rest_id: restId,
    legacy: {
      full_text: "Hello world",
      created_at: "Wed Nov 19 01:01:00 +0000 2025",
      favorite_count: 7,
      retweet_count: 3,
      reply_count: 2,
      quote_count: 1,
      bookmark_count: 4,
      ...legacyOverrides,
    },
    core: {
      user_results: {
        result: {
          __typename: "User",
          rest_id: "u-1",
          core: { name: "Alice", screen_name: "alice" },
          legacy: { name: "Alice L", screen_name: "alice_l" },
          avatar: { image_url: "https://example.com/a.png" },
        },
      },
    },
    views: { count: "456" },
    ...extra,
  };
}

function homeData(results: any[]): any {
  const entries = results.map((result, i) => ({
    entryId: `tweet-${i + 1}`,
    content: { itemContent: { tweet_results: { result } } },
  }));
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [{ type: "TimelineAddEntries", entries }],
        },
      },
    },
  };
}

function notifData(instructions: any[]): any {
  return {
    data: {
      viewer_v2: {
        user_results: {
          result: {
            notification_timeline: { timeline: { instructions } },
          },
        },
      },
    },
  };
}

describe("abnormal: notification kind mapping", () => {
  it("maps prototype-chain names to 'unknown', never to inherited values", () => {
    for (const el of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(mapElementToNotificationKind(el)).toBe("unknown");
    }
  });

  it("classifies an entry whose element is 'toString' as unknown", () => {
    const kind = classifyNotificationKind({
      entryId: "notification-1",
      content: { clientEventInfo: { element: "toString" } },
    });
    expect(kind).toBe("unknown");
  });

  it("does not throw on an unstringifiable element value", () => {
    expect(() =>
      classifyNotificationKind({
        entryId: "notification-1",
        content: { clientEventInfo: { element: UNSTRINGIFIABLE } },
      })
    ).not.toThrow();
    expect(
      classifyNotificationKind({
        entryId: "notification-1",
        content: { clientEventInfo: { element: UNSTRINGIFIABLE } },
      })
    ).toBe("unknown");
  });

  it("does not throw when the rich_message icon id is not a string", () => {
    expect(() =>
      classifyNotificationKind({
        entryId: "notification-1",
        content: { rich_message: { icon: { id: 42 } } },
      })
    ).not.toThrow();
  });
});

describe("abnormal: notification entry normalization", () => {
  it("drops an entry whose entryId cannot be stringified instead of throwing", () => {
    expect(() => normalizeNotificationEntry({ entryId: UNSTRINGIFIABLE, content: {} })).not.toThrow();
    expect(normalizeNotificationEntry({ entryId: UNSTRINGIFIABLE, content: {} })).toBeNull();
  });

  it("drops an entry whose entryId is an array instead of leaking 'a,b' as the id", () => {
    expect(normalizeNotificationEntry({ entryId: ["a", "b"], content: {} })).toBeNull();
  });

  it("keeps an entry with a numeric entryId, stringified", () => {
    const n = normalizeNotificationEntry({ entryId: 123, content: {} });
    expect(n?.id).toBe("123");
  });

  it("ignores a mark-unread instruction whose sort_index is not a string", () => {
    const data = notifData([
      {
        type: "TimelineAddEntries",
        entries: [{ entryId: "notification-1", sortIndex: "100", content: {} }],
      },
      { type: "TimelineMarkEntriesUnreadGreaterThanSortIndex", sort_index: 50 },
    ]);
    let page: ReturnType<typeof parseNotificationsTimelineResponse> | undefined;
    expect(() => {
      page = parseNotificationsTimelineResponse(data);
    }).not.toThrow();
    expect(page?.notifications).toHaveLength(1);
    expect(page?.notifications[0].unread).toBeUndefined();
  });

  it("reads non-array instructions as an empty page", () => {
    const data = notifData({ type: "TimelineAddEntries" } as any);
    expect(() => parseNotificationsTimelineResponse(data)).not.toThrow();
    expect(parseNotificationsTimelineResponse(data).notifications).toEqual([]);
  });

  it("keeps valid notifications when a sibling entry is deformed", () => {
    const data = notifData([
      {
        type: "TimelineAddEntries",
        entries: [
          { entryId: UNSTRINGIFIABLE, content: {} },
          { entryId: "notification-2", sortIndex: "5", content: {} },
        ],
      },
    ]);
    const page = parseNotificationsTimelineResponse(data);
    expect(page.notifications.map((n) => n.id)).toEqual(["notification-2"]);
  });
});

describe("abnormal: home timeline shaping", () => {
  it("does not collapse tweets whose results carry no rest_id into one phantom tweet", () => {
    const data = homeData([
      makeTweetResult(undefined, { full_text: "first" }),
      makeTweetResult(undefined, { full_text: "second" }),
      makeTweetResult("900", { full_text: "kept" }),
    ]);
    const { tweets } = parseHomeTimelineResponse(data);
    expect(tweets.map((t) => t.text)).toEqual(["kept"]);
    expect(tweets[0].id).toBe("900");
  });

  it("keeps string and array metric counts out of the numeric metric fields", () => {
    const tr = makeTweetResult("111", { favorite_count: "5", retweet_count: [3], reply_count: true });
    const { tweets } = parseHomeTimelineResponse(homeData([tr]));
    expect(tweets[0].metrics.likes).toBe(0);
    expect(tweets[0].metrics.retweets).toBe(0);
    expect(tweets[0].metrics.replies).toBe(0);
  });

  it("reads a non-numeric view count as 0, never NaN", () => {
    const tr = makeTweetResult("111", {}, { views: { count: "abc" } });
    const { tweets } = parseHomeTimelineResponse(homeData([tr]));
    expect(tweets[0].metrics.views).toBe(0);
  });

  it("survives an unstringifiable view count", () => {
    const tr = makeTweetResult("111", {}, { views: { count: UNSTRINGIFIABLE } });
    let tweets: ReturnType<typeof parseHomeTimelineResponse>["tweets"] = [];
    expect(() => {
      tweets = parseHomeTimelineResponse(homeData([tr])).tweets;
    }).not.toThrow();
    expect(tweets[0].metrics.views).toBe(0);
  });

  it("reads non-string text and created_at as empty strings", () => {
    const tr = makeTweetResult("111", { full_text: ["a", "b"], created_at: 20251119 });
    const { tweets } = parseHomeTimelineResponse(homeData([tr]));
    expect(tweets[0].text).toBe("");
    expect(tweets[0].createdAt).toBe("");
  });

  it("falls back to the legacy author name when the core name is not a string", () => {
    const tr = makeTweetResult("111");
    tr.core.user_results.result.core.name = ["Alice", "Alicia"];
    const { tweets } = parseHomeTimelineResponse(homeData([tr]));
    expect(tweets[0].author.name).toBe("Alice L");
    expect(typeof tweets[0].author.id).toBe("string");
  });

  it("reads non-array instructions as an empty timeline", () => {
    const data = { data: { home: { home_timeline_urt: { instructions: { type: "x" } } } } };
    expect(() => parseHomeTimelineResponse(data)).not.toThrow();
    expect(parseHomeTimelineResponse(data).tweets).toEqual([]);
  });
});

describe("abnormal: stats shaping", () => {
  it("reads an unstringifiable view count as null instead of throwing", () => {
    const tr = makeTweetResult("111", {}, { views: { count: UNSTRINGIFIABLE } });
    expect(() => statsPostFromResult(tr)).not.toThrow();
    expect(statsPostFromResult(tr)?.views).toBeNull();
  });

  it("does not invent a view count from an array or a boolean", () => {
    const arr = makeTweetResult("111", {}, { views: { count: [123] } });
    expect(statsPostFromResult(arr)?.views).toBeNull();
    const bool = makeTweetResult("111", {}, { views: { count: true } });
    expect(statsPostFromResult(bool)?.views).toBeNull();
  });

  it("keeps a February 30 post date null instead of rolling over to March", () => {
    const tr = makeTweetResult("111", { created_at: "Sun Feb 30 12:00:00 +0000 2026" });
    expect(statsPostFromResult(tr)?.posted_at).toBeNull();
  });

  it("keeps a non-leap February 29 null but accepts a leap one", () => {
    const nonLeap = makeTweetResult("111", { created_at: "Sat Feb 29 12:00:00 +0000 2026" });
    expect(statsPostFromResult(nonLeap)?.posted_at).toBeNull();
    const leap = makeTweetResult("111", { created_at: "Tue Feb 29 12:00:00 +0000 2028" });
    expect(statsPostFromResult(leap)?.posted_at).toBe("2028-02-29T12:00:00.000Z");
  });

  it("keeps an ISO February 30 null instead of rolling over", () => {
    const tr = makeTweetResult("111", { created_at: "2026-02-30T12:00:00.000Z" });
    expect(statsPostFromResult(tr)?.posted_at).toBeNull();
  });

  it("keeps non-string profile names out of the profile fields", () => {
    const profile = parseUserResult({
      __typename: "User",
      rest_id: "42",
      core: { name: ["a", "b"], screen_name: { odd: true } },
      legacy: { name: "Legacy Name", screen_name: "legacy_user" },
    });
    expect(profile?.name).toBe("Legacy Name");
    expect(profile?.username).toBe("legacy_user");

    const noFallback = parseUserResult({
      __typename: "User",
      rest_id: "42",
      core: { name: ["a", "b"], screen_name: ["x"] },
      legacy: {},
    });
    expect(noFallback?.name).toBeNull();
    expect(noFallback?.username).toBeNull();
  });
});

describe("abnormal: actors", () => {
  it("extracts an actor whose name cannot be stringified without throwing", () => {
    const entry = {
      entryId: "notification-1",
      content: {
        itemContent: {
          user_results: {
            result: {
              __typename: "User",
              rest_id: "7",
              core: { name: UNSTRINGIFIABLE, screen_name: "bob" },
              legacy: {},
            },
          },
        },
      },
    };
    let actors: ReturnType<typeof extractActors> = [];
    expect(() => {
      actors = extractActors(entry);
    }).not.toThrow();
    expect(actors).toHaveLength(1);
    expect(actors[0].username).toBe("bob");
    expect(actors[0].name).toBeUndefined();
  });

  it("falls back to the legacy actor name when the core name is an array", () => {
    const actor = extractActorFromUserResult({
      __typename: "User",
      rest_id: "7",
      core: { name: ["a", "b"], screen_name: "bob" },
      legacy: { name: "Bob Legacy", screen_name: "bob_l" },
    });
    expect(actor?.name).toBe("Bob Legacy");
    expect(actor?.username).toBe("bob");
  });
});

describe("abnormal: fetch boundary", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("resolves an empty home timeline for a JSON null body instead of a TypeError", async () => {
    fetchSpy.mockResolvedValue(mockResponse(null));
    await expect(getHomeTimeline(mockAuth)).resolves.toEqual({ tweets: [], cursor: undefined });
  });

  it("resolves an empty notifications page for a JSON null body", async () => {
    fetchSpy.mockResolvedValue(mockResponse(null));
    const page = await getNotificationsTimeline(mockAuth);
    expect(page.notifications).toEqual([]);
  });

  it("skips null entries in a tweet detail response and still finds the tweet", async () => {
    const focal = {
      entryId: "tweet-999",
      content: { itemContent: { tweet_results: { result: makeTweetResult("999") } } },
    };
    const data = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [{ type: "TimelineAddEntries", entries: [null, focal, null] }],
        },
      },
    };
    fetchSpy.mockResolvedValue(mockResponse(data));
    const thread = await getTweetDetail("999", mockAuth);
    expect(thread.mainTweet.id).toBe("999");
  });

  it("reports a JSON null guest-token body as a clean error, not a TypeError", async () => {
    fetchSpy.mockResolvedValue(mockResponse(null));
    await expect(getGuestToken()).rejects.toThrow("No guest_token in response");
  });
});

describe("abnormal: formatting", () => {
  it("never prints the 'Invalid Date' sentinel for an unparseable createdAt", () => {
    const tweet: any = {
      id: "1",
      text: "hi",
      createdAt: "not a date",
      author: { id: "u1", name: "Alice", username: "alice", profileImageUrl: "" },
      metrics: { likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 },
      isReply: false,
    };
    expect(formatTweet(tweet)).not.toContain("Invalid Date");
  });
});
