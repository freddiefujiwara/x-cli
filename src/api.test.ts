import {
  getByPath,
  findFirstDeep,
  collectDeep,
  extractActorFromUserResult,
  extractActors,
  extractTweetFromNotificationEntry,
  extractNotificationMessage,
  classifyNotificationKind,
  normalizeNotificationEntry,
  parseNotificationsTimelineResponse,
  getNotificationsTimeline,
  extractTweetId,
} from "./api.js";
import { AuthConfig } from "./auth.js";
import { jest } from "@jest/globals";

describe("api helpers", () => {
  describe("getByPath", () => {
    const testObj = { a: { b: { c: 123 } }, x: [{ y: 456 }] };

    it("should get a nested property", () => {
      expect(getByPath(testObj, "a.b.c")).toBe(123);
    });

    it("should return undefined for a non-existent path", () => {
      expect(getByPath(testObj, "a.b.d")).toBeUndefined();
    });

    it("should return undefined for a path that goes through a non-object", () => {
      expect(getByPath(testObj, "a.b.c.d")).toBeUndefined();
    });

    it("should return the object itself for an empty path", () => {
      expect(getByPath(testObj, "")).toBe(testObj);
    });
  });

  describe("findFirstDeep", () => {
    const testObj = {
      a: 1,
      b: { c: "hello", d: { e: true, f: [1, { g: "found" }] } },
      h: { i: "not this one" },
    };

    it("should find the first node that matches the predicate", () => {
      const result = findFirstDeep(testObj, (node) => node.g === "found");
      expect(result).toEqual({ g: "found" });
    });

    it("should return undefined if no node matches", () => {
      const result = findFirstDeep(testObj, (node) => node.z === "not found");
      expect(result).toBeUndefined();
    });

    it("should handle circular references", () => {
      const circularObj: any = { x: { y: 1 } };
      circularObj.x.z = circularObj;
      const result = findFirstDeep(circularObj, (node) => node.y === 1);
      expect(result).toEqual({ y: 1, z: circularObj });
    });

    it("should respect maxDepth", () => {
      const result = findFirstDeep(testObj, (node) => node.g === "found", 3);
      expect(result).toBeUndefined();
    });
  });

  describe("collectDeep", () => {
    const testObj = {
      items: [
        { type: "A", value: 1 },
        { type: "B", value: 2 },
        {
          type: "A",
          nested: { type: "A", value: 3 },
        },
      ],
      other: { type: "C" },
    };

    it("should collect all nodes that match the predicate", () => {
      const results = collectDeep(testObj, (node) => node.type === "A");
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ type: "A", value: 1 });
      expect(results[1]).toEqual({ type: "A", nested: { type: "A", value: 3 } });
      expect(results[2]).toEqual({ type: "A", value: 3 });
    });

    it("should respect the limit", () => {
      const results = collectDeep(testObj, (node) => node.type === "A", 8, 2);
      expect(results).toHaveLength(2);
    });

    it("should return an empty array if no nodes match", () => {
      const results = collectDeep(testObj, (node) => node.type === "D");
      expect(results).toEqual([]);
    });
  });
});

describe("notification data extraction", () => {
  describe("extractActorFromUserResult", () => {
    it("should extract actor from a valid user result", () => {
      const userResult = {
        __typename: "User",
        rest_id: "123",
        legacy: {
          name: "Test User",
          screen_name: "testuser",
          profile_image_url_https: "https://example.com/profile.jpg",
        },
      };
      expect(extractActorFromUserResult(userResult)).toEqual({
        id: "123",
        name: "Test User",
        username: "testuser",
        profileImageUrl: "https://example.com/profile.jpg",
      });
    });

    it("should return null for invalid input", () => {
      expect(extractActorFromUserResult(null)).toBeNull();
      expect(extractActorFromUserResult({})).toBeNull();
      expect(extractActorFromUserResult({ __typename: "Tweet" })).toBeNull();
    });
  });

  describe("extractActors", () => {
    it("should extract a single actor from a simple follow notification", () => {
      const entry = {
        content: {
          itemContent: {
            user_results: {
              result: {
                __typename: "User",
                rest_id: "1001",
                legacy: { name: "Follower", screen_name: "follower1" },
              },
            },
          },
        },
      };
      const actors = extractActors(entry);
      expect(actors).toHaveLength(1);
      expect(actors[0].username).toBe("follower1");
    });
  });

  describe("extractTweetFromNotificationEntry", () => {
    it("should extract a tweet from a standard notification entry", () => {
      const entry = {
        content: {
          itemContent: {
            tweet_results: {
              result: {
                __typename: "Tweet",
                rest_id: "12345",
                legacy: { full_text: "Hello world" },
                core: { user_results: { result: { __typename: "User", legacy: {} } } },
              },
            },
          },
        },
      };
      const { tweet, tweetId } = extractTweetFromNotificationEntry(entry);
      expect(tweet).toBeDefined();
      expect(tweet?.id).toBe("12345");
      expect(tweetId).toBe("12345");
    });
  });

  describe("extractNotificationMessage", () => {
    it("should extract a message from a notification", () => {
      const entry = {
        content: {
          itemContent: {
            notification_results: {
              result: {
                message: { text: "This is a test notification" },
              },
            },
          },
        },
      };
      expect(extractNotificationMessage(entry)).toBe("This is a test notification");
    });
  });

  describe("classifyNotificationKind", () => {
    // New tests for classification based on clientEventInfo.element
    it.each([
      ["users_liked_your_tweet", "like"],
      ["user_replied_to_your_tweet", "reply"],
      ["user_mentioned_you", "mention"],
      ["users_retweeted_your_tweet", "retweet"],
      ["user_followed_you", "follow"],
      ["user_quoted_your_tweet", "quote"],
      ["user_reposted_your_tweet", "repost"],
      ["some_unknown_event", "unknown"],
    ])("should classify kind based on element '%s' as '%s'", (element, expectedKind) => {
      const entry = {
        content: {
          clientEventInfo: {
            element: element,
          },
        },
      };
      expect(classifyNotificationKind(entry)).toBe(expectedKind);
    });

    it("should use fallback logic if element is missing", () => {
      const entry = { entryId: "notification-like-123" };
      expect(classifyNotificationKind(entry)).toBe("like");
    });

    it("should return 'unknown' if element is unknown and fallback fails", () => {
      const entry = {
        content: {
          clientEventInfo: {
            element: "new_unhandled_event",
          },
        },
        entryId: "some-random-id",
      };
      expect(classifyNotificationKind(entry)).toBe("unknown");
    });

    // Existing tests as fallback validation
    it("should classify a like notification by fallback", () => {
      const entry = { entryId: "notification-like-123" };
      expect(classifyNotificationKind(entry)).toBe("like");
    });

    it("should classify a retweet notification by fallback", () => {
      const entry = {
        content: { itemContent: { __typename: "TimelineTimelineItemContentTweet" } },
        entryId: "notification-retweet-456",
      };
      expect(classifyNotificationKind(entry)).toBe("retweet");
    });

    it("should classify a retweet by rich_message icon id", () => {
      const entry = {
        content: {
          rich_message: {
            icon: {
              id: "shared-صفحات-لل-retweet-v1-0",
            },
          },
        },
      };
      expect(classifyNotificationKind(entry)).toBe("retweet");
    });

    it("should classify a follow notification by fallback", () => {
      const entry = {
        content: {
          itemContent: {
            __typename: "TimelineTimelineItemContentUser",
            notification_results: {
              result: {
                message: { text: "Followed you" },
              },
            },
          },
        },
      };
      expect(classifyNotificationKind(entry)).toBe("follow");
    });
  });

  describe("normalizeNotificationEntry", () => {
    it("should normalize a follow notification", () => {
      const entry = {
        entryId: "follow-123",
        sortIndex: "100",
        content: {
          itemContent: {
            user_results: {
              result: {
                __typename: "User",
                rest_id: "1001",
                legacy: { name: "Follower", screen_name: "follower1" },
              },
            },
            notification_results: {
              result: {
                message: { text: "Followed you" },
              },
            },
          },
        },
      };

      const notification = normalizeNotificationEntry(entry);
      expect(notification).not.toBeNull();
      expect(notification?.kind).toBe("follow");
      expect(notification?.actors).toHaveLength(1);
      expect(notification?.actors[0].username).toBe("follower1");
    });

    it("should normalize a like notification with a tweet", () => {
      const entry = {
        entryId: "like-456",
        content: {
          itemContent: {
            tweet_results: {
              result: {
                __typename: "Tweet",
                rest_id: "987",
                legacy: { full_text: "A tweet that was liked" },
                core: { user_results: { result: { __typename: "User", legacy: {} } } },
              },
            },
          },
        },
      };

      const notification = normalizeNotificationEntry(entry);
      expect(notification).not.toBeNull();
      expect(notification?.kind).toBe("like");
      expect(notification?.tweetId).toBe("987");
      expect(notification?.tweet?.text).toBe("A tweet that was liked");
    });

    it("should return null for cursor entries", () => {
      const entry = { entryId: "cursor-top-1" };
      expect(normalizeNotificationEntry(entry)).toBeNull();
    });
  });

  describe("parseNotificationsTimelineResponse", () => {
    it("should parse a valid notifications timeline response", () => {
      const mockResponse = {
        data: {
          viewer_v2: {
            user_results: {
              result: {
                notification_timeline: {
                  timeline: {
                    instructions: [
                      {
                        type: "TimelineAddEntries",
                        entries: [
                          { entryId: "notification-1", content: {} },
                          { entryId: "cursor-top-2", content: { value: "top_cursor" } },
                          { entryId: "cursor-bottom-3", content: { value: "bottom_cursor" } },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      };

      const page = parseNotificationsTimelineResponse(mockResponse);
      expect(page.notifications).toHaveLength(1);
      expect(page.topCursor).toBe("top_cursor");
      expect(page.bottomCursor).toBe("bottom_cursor");
    });
  });

  describe("getNotificationsTimeline", () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("should fetch and parse the notifications timeline", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: {
            viewer_v2: {
              user_results: {
                result: {
                  notification_timeline: {
                    timeline: {
                      instructions: [
                        {
                          type: "TimelineAddEntries",
                          entries: [{ entryId: "notification-1", content: {} }],
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        }),
      };
      fetchSpy.mockResolvedValue(mockResponse as any);

      const auth: AuthConfig = {
        authToken: "test_auth_token",
        csrfToken: "test_csrf_token",
      };
      const page = await getNotificationsTimeline(auth);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(page.notifications).toHaveLength(1);
    });

    it("should throw an error if the API request fails", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      };
      fetchSpy.mockResolvedValue(mockResponse as any);

      const auth: AuthConfig = {
        authToken: "test_auth_token",
        csrfToken: "test_csrf_token",
      };

      await expect(getNotificationsTimeline(auth)).rejects.toThrow(
        "Notifications API request failed (500): Internal Server Error"
      );
    });
  });
});
describe("api", () => {
  describe("extractTweetId", () => {
    it("should extract tweet ID from x.com URL", () => {
      const url = "https://x.com/user/status/1234567890";
      expect(extractTweetId(url)).toBe("1234567890");
    });

    it("should extract tweet ID from twitter.com URL", () => {
      const url = "https://twitter.com/user/status/9876543210";
      expect(extractTweetId(url)).toBe("9876543210");
    });

    it("should extract tweet ID from URL with query params", () => {
      const url = "https://x.com/user/status/1234567890?s=20";
      expect(extractTweetId(url)).toBe("1234567890");
    });

    it("should return raw tweet ID if numeric string provided", () => {
      expect(extractTweetId("1234567890")).toBe("1234567890");
    });

    it("should handle long tweet IDs", () => {
      const longId = "2003093331522535458";
      expect(extractTweetId(longId)).toBe(longId);
    });

    it("should throw error for invalid URL", () => {
      expect(() => extractTweetId("https://example.com/something")).toThrow(
        "Invalid tweet ID or URL"
      );
    });

    it("should throw error for non-numeric non-URL input", () => {
      expect(() => extractTweetId("not-a-tweet")).toThrow(
        "Invalid tweet ID or URL"
      );
    });

    it("should throw error for empty string", () => {
      expect(() => extractTweetId("")).toThrow("Invalid tweet ID or URL");
    });

    it("should handle URL with www prefix", () => {
      const url = "https://www.x.com/user/status/1234567890";
      expect(extractTweetId(url)).toBe("1234567890");
    });
  });
});
