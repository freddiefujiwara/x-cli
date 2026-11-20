/**
 * Property-based tests (fast-check) over the X API shaping layer.
 * The parsers consume outside JSON, so the properties pin totality
 * (never throws), codomains (kinds, string fields, finite-or-null metrics),
 * determinism (same payload -> same shaped output, regardless of key
 * order), conservation (dedupe keeps exactly the first occurrence of each
 * id) and calendar existence (non-existent dates never roll over).
 * All generated fixtures are synthetic.
 */
import fc from "fast-check";
import {
  compareSortIndex,
  mapElementToNotificationKind,
  normalizeNotificationEntry,
  parseNotificationsTimelineResponse,
  parseHomeTimelineResponse,
  statsPostFromResult,
  extractTweetId,
  findFirstDeep,
  collectDeep,
} from "./api.js";
import { formatStatsJson, formatNotificationsJson, formatNotificationsPretty } from "./format.js";

const KINDS = new Set([
  "like",
  "retweet",
  "reply",
  "mention",
  "follow",
  "quote",
  "repost",
  "unknown",
]);

/** An object whose toString is not callable: String() coercion throws. */
const UNSTRINGIFIABLE: any = { toString: [] };

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
          legacy: {},
          avatar: {},
        },
      },
    },
    views: { count: "456" },
    ...extra,
  };
}

describe("property: compareSortIndex", () => {
  it("agrees with the BigInt oracle on numeric strings of any length", () => {
    const numericString = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 25 })
      .map((ds) => ds.join(""));
    fc.assert(
      fc.property(numericString, numericString, (a, b) => {
        // compareSortIndex is a comparator: its contract is the SIGN of the
        // result (it returns the length difference for unequal lengths),
        // so the oracle compares signs, not exact -1/0/1 values.
        const diff = BigInt(a) - BigInt(b);
        const expected = diff < 0n ? -1 : diff > 0n ? 1 : 0;
        return Math.sign(compareSortIndex(a, b)) === expected;
      }),
      { numRuns: 100 }
    );
  });
});

describe("property: notification kind mapping", () => {
  it("maps every string to one of the known kinds and never throws", () => {
    fc.assert(
      fc.property(fc.string(), (s) => KINDS.has(mapElementToNotificationKind(s))),
      { numRuns: 100 }
    );
  });
});

describe("property: notification entry normalization", () => {
  const deformedEntry = fc.oneof(
    fc.record(
      {
        entryId: fc.oneof(
          fc.string(),
          fc.integer(),
          fc.array(fc.string(), { maxLength: 3 }),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(UNSTRINGIFIABLE)
        ),
        sortIndex: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
        content: fc.constant({}),
      },
      { requiredKeys: ["entryId", "content"] }
    ),
    fc.constant(null),
    fc.constant(42)
  );

  it("never throws and only yields well-shaped notifications", () => {
    fc.assert(
      fc.property(deformedEntry, (entry) => {
        let out: ReturnType<typeof normalizeNotificationEntry>;
        try {
          out = normalizeNotificationEntry(entry);
        } catch {
          return false;
        }
        if (out === null) return true;
        return (
          typeof out.id === "string" &&
          out.id.length > 0 &&
          KINDS.has(out.kind) &&
          Array.isArray(out.actors) &&
          out.actors.every((a) =>
            [a.id, a.name, a.username, a.profileImageUrl].every(
              (v) => v === undefined || typeof v === "string"
            )
          )
        );
      }),
      { numRuns: 100 }
    );
  });
});

describe("property: notifications page determinism", () => {
  function reverseKeys(v: any): any {
    if (Array.isArray(v)) return v.map(reverseKeys);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v)
          .reverse()
          .map(([k, val]) => [k, reverseKeys(val)])
      );
    }
    return v;
  }

  const entryGen = fc.record({
    suffix: fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/),
    sort: fc.nat({ max: 1_000_000 }),
    element: fc.constantFrom(
      "user_liked_your_tweet",
      "user_followed_you",
      "user_mentioned_you",
      "something_unmapped"
    ),
  });

  it("produces identical shaped output regardless of payload key order", () => {
    fc.assert(
      fc.property(fc.array(entryGen, { maxLength: 8 }), fc.nat({ max: 1_000_000 }), (specs, threshold) => {
        const entries = specs.map((s) => ({
          entryId: `notification-${s.suffix}`,
          sortIndex: String(s.sort),
          content: { clientEventInfo: { element: s.element } },
        }));
        const data = {
          data: {
            viewer_v2: {
              user_results: {
                result: {
                  notification_timeline: {
                    timeline: {
                      instructions: [
                        { type: "TimelineAddEntries", entries },
                        {
                          type: "TimelineMarkEntriesUnreadGreaterThanSortIndex",
                          sort_index: String(threshold),
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        };
        const project = (page: ReturnType<typeof parseNotificationsTimelineResponse>) =>
          page.notifications.map((n) => ({
            id: n.id,
            sortIndex: n.sortIndex,
            kind: n.kind,
            unread: n.unread,
            message: n.message,
            tweetId: n.tweetId,
          }));
        const first = project(parseNotificationsTimelineResponse(data));
        const second = project(parseNotificationsTimelineResponse(reverseKeys(data)));
        const repeat = project(parseNotificationsTimelineResponse(data));
        return (
          JSON.stringify(first) === JSON.stringify(second) &&
          JSON.stringify(first) === JSON.stringify(repeat)
        );
      }),
      { numRuns: 100 }
    );
  });
});

describe("property: home timeline dedupe", () => {
  // First-occurrence wins is the dedupe contract used by getUserStats'
  // byId map in this same file; the home timeline's Map.set overwrite
  // kept the LAST duplicate's text instead (see the abnormal report).
  it("keeps exactly the first occurrence of each id, in order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("1", "2", "3"), { maxLength: 10 }),
        (ids) => {
          const results = ids.map((id, i) => makeTweetResult(id, { full_text: `post-${i}` }));
          const entries = results.map((result, i) => ({
            entryId: `tweet-${i + 1}`,
            content: { itemContent: { tweet_results: { result } } },
          }));
          const data = {
            data: {
              home: {
                home_timeline_urt: {
                  instructions: [{ type: "TimelineAddEntries", entries }],
                },
              },
            },
          };
          const { tweets } = parseHomeTimelineResponse(data);
          const expectedIds = [...new Set(ids)];
          const expectedTexts = expectedIds.map(
            (id) => `post-${ids.indexOf(id)}`
          );
          return (
            JSON.stringify(tweets.map((t) => t.id)) === JSON.stringify(expectedIds) &&
            JSON.stringify(tweets.map((t) => t.text)) === JSON.stringify(expectedTexts)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("property: stats metrics", () => {
  const metricValue = fc.oneof(
    fc.integer(),
    fc.double(),
    fc.string(),
    fc.boolean(),
    fc.array(fc.integer(), { maxLength: 3 }),
    fc.constant(null),
    fc.constant(undefined)
  );

  it("passes finite numbers through and reads everything else as null", () => {
    fc.assert(
      fc.property(metricValue, (v) => {
        const post = statsPostFromResult(makeTweetResult("111", { favorite_count: v }));
        if (!post) return false;
        const expected =
          typeof v === "number" && Number.isFinite(v) ? v : null;
        return post.likes === expected;
      }),
      { numRuns: 100 }
    );
  });

  it("parses view counts only from strings and numbers, never inventing from other shapes", () => {
    const countValue = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.array(fc.integer(), { maxLength: 3 }),
      fc.constant(null),
      fc.constant(UNSTRINGIFIABLE)
    );
    fc.assert(
      fc.property(countValue, (v) => {
        let post: ReturnType<typeof statsPostFromResult>;
        try {
          post = statsPostFromResult(makeTweetResult("111", {}, { views: { count: v } }));
        } catch {
          return false;
        }
        if (!post) return false;
        if (typeof v !== "string" && typeof v !== "number") return post.views === null;
        if (v === "") return post.views === null;
        const parsed = Number.parseInt(String(v), 10);
        return post.views === (Number.isNaN(parsed) ? null : parsed);
      }),
      { numRuns: 100 }
    );
  });
});

describe("property: stats dates", () => {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Years stay in 1970-2100: X posts cannot predate the service, and the
  // range avoids Date.UTC's 0-99 two-digit-year quirk in the oracle.
  it("accepts exactly the dates that exist on the calendar", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (year, month, day) => {
          const rolled = new Date(Date.UTC(year, month - 1, day));
          const exists =
            rolled.getUTCFullYear() === year &&
            rolled.getUTCMonth() === month - 1 &&
            rolled.getUTCDate() === day;
          const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
          const createdAt = `${weekday} ${MONTH_NAMES[month - 1]} ${String(day).padStart(2, "0")} 12:00:00 +0000 ${year}`;
          const post = statsPostFromResult(makeTweetResult("111", { created_at: createdAt }));
          if (!post) return false;
          const expected = exists
            ? new Date(Date.UTC(year, month - 1, day, 12)).toISOString()
            : null;
          return post.posted_at === expected;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("property: JSON output", () => {
  it("formatStatsJson round-trips through JSON.parse with the snapshot shape", () => {
    const statsGen = fc.record({
      collected_at: fc.constant("2026-11-20T00:00:00.000Z"),
      username: fc.oneof(fc.string(), fc.constant(null)),
      followers: fc.oneof(fc.nat(), fc.constant(null)),
      following: fc.oneof(fc.nat(), fc.constant(null)),
      recent_posts: fc.constant([] as never[]),
    });
    fc.assert(
      fc.property(statsGen, (stats) => {
        const parsed = JSON.parse(formatStatsJson(stats as any, { color: false }));
        return (
          parsed.ok === true &&
          parsed.collected_at === stats.collected_at &&
          parsed.x.username === stats.username &&
          parsed.x.followers === stats.followers &&
          parsed.x.following === stats.following &&
          Array.isArray(parsed.x.recent_posts)
        );
      }),
      { numRuns: 100 }
    );
  });

  it("formats normalized notifications as valid JSON with valid kinds, and pretty output without [object Object]", () => {
    const safeText = fc
      .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 ".split("")), {
        minLength: 0,
        maxLength: 12,
      })
      .map((cs) => cs.join(""));
    const entryGen = fc.record({
      suffix: fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/),
      name: fc.oneof(safeText, fc.array(safeText, { maxLength: 2 }), fc.constant(UNSTRINGIFIABLE)),
      element: fc.constantFrom("user_liked_your_tweet", "user_followed_you", "something_unmapped"),
    });
    fc.assert(
      fc.property(fc.array(entryGen, { maxLength: 5 }), (specs) => {
        const entries = specs.map((s) => ({
          entryId: `notification-${s.suffix}`,
          sortIndex: "1",
          content: {
            clientEventInfo: { element: s.element },
            itemContent: {
              user_results: {
                result: {
                  __typename: "User",
                  rest_id: "7",
                  core: { name: s.name, screen_name: "bob" },
                  legacy: {},
                },
              },
            },
          },
        }));
        const data = {
          data: {
            viewer_v2: {
              user_results: {
                result: {
                  notification_timeline: {
                    timeline: {
                      instructions: [{ type: "TimelineAddEntries", entries }],
                    },
                  },
                },
              },
            },
          },
        };
        let page: ReturnType<typeof parseNotificationsTimelineResponse>;
        try {
          page = parseNotificationsTimelineResponse(data);
        } catch {
          return false;
        }
        const json = formatNotificationsJson(page, { color: false });
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return false;
        if (!parsed.every((n: any) => KINDS.has(n.kind))) return false;
        const pretty = formatNotificationsPretty(page);
        return !pretty.includes("[object Object]") && !json.includes("[object Object]");
      }),
      { numRuns: 100 }
    );
  });
});

describe("property: extractTweetId", () => {
  it("round-trips ids through x.com status URLs and bare ids", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{1,19}$/),
        fc.stringMatching(/^[a-z0-9_]{1,15}$/),
        (id, user) =>
          extractTweetId(`https://x.com/${user}/status/${id}`) === id &&
          extractTweetId(id) === id
      ),
      { numRuns: 100 }
    );
  });
});

describe("property: deep helpers", () => {
  it("findFirstDeep and collectDeep never throw on arbitrary values and respect the limit", () => {
    const isMarker = (n: any): boolean =>
      n !== null && typeof n === "object" && (n as any).marker === true;
    fc.assert(
      fc.property(fc.anything(), (v) => {
        try {
          const found = findFirstDeep(v, isMarker);
          if (found !== undefined && !isMarker(found)) return false;
          const collected = collectDeep(v, isMarker, 8, 3);
          return collected.length <= 3 && collected.every(isMarker);
        } catch {
          return false;
        }
      }),
      { numRuns: 100 }
    );
  });
});
