import {
  getHomeTimeline,
  findCursor,
  extractTweetId,
  parseHomeTimelineResponse,
  getHomeLatestTimeline,
  getByPath,
  findFirstDeep,
  collectDeep,
  extractActorFromUserResult,
  extractActors,
  extractTweetFromNotificationEntry,
  extractNotificationMessage,
  classifyNotificationKind,
  mapElementToNotificationKind,
  normalizeNotificationEntry,
  parseNotificationsTimelineResponse,
  getNotificationsTimeline,
  compareSortIndex,
  parseUserResult,
  extractViewerProfile,
  statsPostFromResult,
  parseUserTweetsResponse,
  getUserStats,
} from "./api.js";
import { AuthConfig } from "./auth.js";
import { jest } from "@jest/globals";

// Helper to create a mock Response object
function mockResponse(data: any, ok: boolean = true, status: number = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe("api", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    // Spy on global.fetch
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    // Restore the original implementation
    fetchSpy.mockRestore();
  });


  describe("getHomeTimeline", () => {
    const mockAuth: AuthConfig = {
      authToken: "test-auth-token",
      csrfToken: "test-csrf-token",
    };

    it("should fetch and parse the home timeline", async () => {
      const apiResponse = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [{
                type: "TimelineAddEntries",
                entries: [{
                  entryId: "tweet-123",
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "123",
                          legacy: { full_text: "Test tweet" },
                          core: { user_results: { result: { legacy: {} } } },
                          views: {},
                        },
                      },
                    },
                  },
                }],
              }],
            },
          },
        },
      };
      fetchSpy.mockResolvedValue(mockResponse(apiResponse));

      const result = await getHomeTimeline(mockAuth);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets[0].text).toBe("Test tweet");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should throw an error if the API request fails", async () => {
      fetchSpy.mockResolvedValue(mockResponse("Internal Server Error", false, 500));

      await expect(getHomeTimeline(mockAuth)).rejects.toThrow(
        "HomeTimeline failed (500): \"Internal Server Error\""
      );
    });

    it("should throw an error if the API returns errors", async () => {
      const errorResponse = {
        errors: [{ message: "Test API error" }],
      };
      fetchSpy.mockResolvedValue(mockResponse(errorResponse));

      await expect(getHomeTimeline(mockAuth)).rejects.toThrow(
        "API returned errors: [{\"message\":\"Test API error\"}]"
      );
    });
  });

  describe("getHomeLatestTimeline", () => {
    const mockAuth: AuthConfig = {
      authToken: "test-auth-token",
      csrfToken: "test-csrf-token",
    };

    it("should fetch and parse the latest home timeline", async () => {
      const apiResponse = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [{
                type: "TimelineAddEntries",
                entries: [{
                  entryId: "tweet-456",
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "456",
                          legacy: { full_text: "Latest tweet" },
                          core: { user_results: { result: { legacy: {} } } },
                          views: {},
                        },
                      },
                    },
                  },
                }],
              }],
            },
          },
        },
      };
      fetchSpy.mockResolvedValue(mockResponse(apiResponse));

      const result = await getHomeLatestTimeline(mockAuth);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets[0].text).toBe("Latest tweet");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(requestBody.variables.count).toBe(40); // Check default count
    });

    it("should throw an error if the API request fails", async () => {
      fetchSpy.mockResolvedValue(mockResponse("Server Error", false, 500));

      await expect(getHomeLatestTimeline(mockAuth)).rejects.toThrow(
        "HomeLatestTimeline failed (500): \"Server Error\""
      );
    });

    it("should throw an error if the API returns errors", async () => {
      const errorResponse = {
        errors: [{ message: "Latest timeline error" }],
      };
      fetchSpy.mockResolvedValue(mockResponse(errorResponse));

      await expect(getHomeLatestTimeline(mockAuth)).rejects.toThrow(
        "API returned errors: [{\"message\":\"Latest timeline error\"}]"
      );
    });
  });

  describe("parseHomeTimelineResponse", () => {
    it("should parse a typical home timeline response", () => {
      const data = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "tweet-123",
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              __typename: "Tweet",
                              rest_id: "123",
                              legacy: {
                                full_text: "Hello world",
                                created_at: "now",
                                favorite_count: 1,
                                retweet_count: 2,
                                reply_count: 3,
                                quote_count: 4,
                                bookmark_count: 5,
                              },
                              core: {
                                user_results: {
                                  result: {
                                    rest_id: "u1",
                                    legacy: {
                                      name: "Test User",
                                      screen_name: "testuser",
                                    },
                                  },
                                },
                              },
                              views: {
                                count: "100",
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      };

      const result = parseHomeTimelineResponse(data);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets[0].id).toBe("123");
      expect(result.tweets[0].text).toBe("Hello world");
      expect(result.cursor).toBeUndefined();
    });

    it("should handle an empty response", () => {
      const data = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [],
            },
          },
        },
      };

      const result = parseHomeTimelineResponse(data);
      expect(result.tweets).toHaveLength(0);
      expect(result.cursor).toBeUndefined();
    });

    it("should respect the count parameter", () => {
      const data = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "tweet-1",
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              __typename: "Tweet",
                              rest_id: "1",
                              legacy: {
                                full_text: "First tweet",
                              },
                              core: { user_results: { result: { legacy: {} } } },
                              views: {},
                            },
                          },
                        },
                      },
                    },
                    {
                      entryId: "tweet-2",
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              __typename: "Tweet",
                              rest_id: "2",
                              legacy: {
                                full_text: "Second tweet",
                              },
                              core: { user_results: { result: { legacy: {} } } },
                              views: {},
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      };

      const result = parseHomeTimelineResponse(data, 1);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets[0].id).toBe("1");
    });
  });

  describe("findCursor", () => {
    it("should find cursor in entry.content.value", () => {
      const entries = [{ content: { value: "long-cursor-123" } }];
      expect(findCursor(entries)).toBe("long-cursor-123");
    });

    it("should find cursor in entry.content.itemContent.value", () => {
      const entries = [{ content: { itemContent: { value: "long-cursor-abc" } } }];
      expect(findCursor(entries)).toBe("long-cursor-abc");
    });

    it("should find cursor in entry.content.cursorType and entry.content.value", () => {
      const entries = [{ content: { cursorType: "Bottom", value: "long-cursor-xyz" } }];
      expect(findCursor(entries)).toBe("long-cursor-xyz");
    });

    it("should return undefined if no cursor is found", () => {
      const entries = [{ content: { item: "no-cursor" } }];
      expect(findCursor(entries)).toBeUndefined();
    });

    it("should return undefined for empty entries", () => {
      expect(findCursor([])).toBeUndefined();
    });
  });

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

describe("notification fixes", () => {
  describe("compareSortIndex", () => {
    it("compares numeric strings by value", () => {
      expect(compareSortIndex("100", "99")).toBeGreaterThan(0);
      expect(compareSortIndex("99", "100")).toBeLessThan(0);
      expect(compareSortIndex("9", "10")).toBeLessThan(0);
      expect(compareSortIndex("42", "42")).toBe(0);
      expect(compareSortIndex("0100", "100")).toBe(0);
    });
  });

  describe("mapElementToNotificationKind", () => {
    it("returns unknown for missing or unmapped elements", () => {
      expect(mapElementToNotificationKind(undefined)).toBe("unknown");
      expect(mapElementToNotificationKind("some_future_element")).toBe("unknown");
    });
  });

  describe("classifyNotificationKind precedence", () => {
    it("classifies a quote before falling back to reply heuristics", () => {
      const entry = {
        entryId: "notification-quote",
        content: {
          itemContent: {
            notification: { __typename: "TimelineQuoteNotification" },
          },
        },
      };
      const tweet = { isReply: true } as any;
      expect(classifyNotificationKind(entry, tweet)).toBe("quote");
    });
  });

  describe("extractTweetFromNotificationEntry safety", () => {
    it("does not mistake a user rest_id for a tweet id", () => {
      const entry = {
        entryId: "notification-follow",
        content: {
          itemContent: {
            user_results: {
              result: { __typename: "User", rest_id: "111222333" },
            },
          },
        },
      };
      const result = extractTweetFromNotificationEntry(entry);
      expect(result.tweet).toBeUndefined();
      expect(result.tweetId).toBeUndefined();
    });
  });

  describe("parseNotificationsTimelineResponse unread flags", () => {
    it("marks notifications above the unread sort index as unread", () => {
      const data = {
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
                          { entryId: "notification-new", sortIndex: "200", content: {} },
                          { entryId: "notification-old", sortIndex: "100", content: {} },
                        ],
                      },
                      {
                        type: "TimelineMarkEntriesUnreadGreaterThanSortIndex",
                        sort_index: "150",
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      };
      const page = parseNotificationsTimelineResponse(data);
      expect(page.markUnreadGreaterThanSortIndex).toBe("150");
      expect(page.notifications).toHaveLength(2);
      expect(page.notifications[0].unread).toBe(true);
      expect(page.notifications[1].unread).toBe(false);
    });
  });
});

describe("notification production shapes", () => {
  describe("mapElementToNotificationKind production values", () => {
    it("maps element values observed in production responses", () => {
      expect(mapElementToNotificationKind("users_followed_you")).toBe("follow");
      expect(mapElementToNotificationKind("follow_from_recommended_user")).toBe("follow");
      expect(mapElementToNotificationKind("users_liked_your_retweet")).toBe("like");
      expect(mapElementToNotificationKind("user_liked_multiple_tweets")).toBe("like");
    });
  });

  describe("extractNotificationMessage rich_message", () => {
    it("reads the message from rich_message.text", () => {
      const entry = {
        entryId: "notification-1",
        content: {
          itemContent: {
            rich_message: { text: "Alice followed you" },
          },
        },
      };
      expect(extractNotificationMessage(entry)).toBe("Alice followed you");
    });
  });
});

describe("user stats", () => {
  const makeUserResult = (overrides: any = {}) => ({
    __typename: "User",
    rest_id: "386573",
    core: { screen_name: "freddiefujiwara", name: "Fumikazu Fujiwara" },
    legacy: { followers_count: 1841, friends_count: 120 },
    ...overrides,
  });

  const makeTweetResult = (id: string, legacyOverrides: any = {}, overrides: any = {}) => ({
    __typename: "Tweet",
    rest_id: id,
    legacy: {
      full_text: `Post ${id}`,
      created_at: "Mon Nov 10 03:00:00 +0000 2026",
      favorite_count: 7,
      retweet_count: 3,
      reply_count: 2,
      ...legacyOverrides,
    },
    views: { count: "456" },
    ...overrides,
  });

  const userTweetsData = (entries: any[]) => ({
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [{ type: "TimelineAddEntries", entries }],
            },
          },
        },
      },
    },
  });

  const tweetEntry = (result: any) => ({
    entryId: `tweet-${result.rest_id}`,
    content: { itemContent: { tweet_results: { result } } },
  });

  describe("parseUserResult", () => {
    it("parses id, names and counts", () => {
      expect(parseUserResult(makeUserResult())).toEqual({
        id: "386573",
        username: "freddiefujiwara",
        name: "Fumikazu Fujiwara",
        followers: 1841,
        following: 120,
      });
    });

    it("falls back to legacy screen_name and name", () => {
      const profile = parseUserResult({
        __typename: "User",
        rest_id: "42",
        legacy: { screen_name: "legacy_user", name: "Legacy Name", followers_count: 1, friends_count: 2 },
      });
      expect(profile?.username).toBe("legacy_user");
      expect(profile?.name).toBe("Legacy Name");
    });

    it("keeps absent counts null instead of 0", () => {
      const profile = parseUserResult({ __typename: "User", rest_id: "42", legacy: {} });
      expect(profile?.followers).toBeNull();
      expect(profile?.following).toBeNull();
    });

    it("returns null for unavailable or malformed results", () => {
      expect(parseUserResult({ __typename: "UserUnavailable", rest_id: "42" })).toBeNull();
      expect(parseUserResult({ __typename: "User" })).toBeNull();
      expect(parseUserResult(null)).toBeNull();
    });
  });

  describe("extractViewerProfile", () => {
    it("reads the viewer from a notifications response", () => {
      const data = { data: { viewer_v2: { user_results: { result: makeUserResult() } } } };
      expect(extractViewerProfile(data)?.followers).toBe(1841);
    });

    it("returns null when the viewer is missing", () => {
      expect(extractViewerProfile({ data: {} })).toBeNull();
      expect(extractViewerProfile(null)).toBeNull();
    });
  });

  describe("statsPostFromResult", () => {
    it("maps metrics and converts the date to ISO", () => {
      expect(statsPostFromResult(makeTweetResult("1001"))).toEqual({
        id: "1001",
        posted_at: "2026-11-10T03:00:00.000Z",
        text: "Post 1001",
        views: 456,
        likes: 7,
        reposts: 3,
        replies: 2,
      });
    });

    it("unwraps TweetWithVisibilityResults", () => {
      const wrapped = { __typename: "TweetWithVisibilityResults", tweet: makeTweetResult("1002") };
      expect(statsPostFromResult(wrapped)?.id).toBe("1002");
    });

    it("excludes retweets and replies", () => {
      expect(
        statsPostFromResult(makeTweetResult("1003", { retweeted_status_result: { result: {} } }))
      ).toBeNull();
      expect(
        statsPostFromResult(makeTweetResult("1004", { in_reply_to_status_id_str: "999" }))
      ).toBeNull();
    });

    it("keeps absent metrics null", () => {
      const post = statsPostFromResult(
        makeTweetResult("1005", { favorite_count: undefined }, { views: {} })
      );
      expect(post?.views).toBeNull();
      expect(post?.likes).toBeNull();
    });

    it("returns null for tombstones", () => {
      expect(statsPostFromResult({ __typename: "TweetTombstone" })).toBeNull();
    });

    it("returns null for malformed results without legacy or id", () => {
      expect(statsPostFromResult({})).toBeNull();
      expect(statsPostFromResult(null)).toBeNull();
      expect(statsPostFromResult({ __typename: "Tweet", legacy: {} })).toBeNull();
    });

    it("keeps an unparseable date null instead of throwing", () => {
      const post = statsPostFromResult(makeTweetResult("1006", { created_at: "not a date" }));
      expect(post?.posted_at).toBeNull();
    });

    it("parses a zero view count as 0, not null", () => {
      const post = statsPostFromResult(makeTweetResult("1007", {}, { views: { count: "0" } }));
      expect(post?.views).toBe(0);
    });

    it("keeps a non-numeric view count null", () => {
      const post = statsPostFromResult(makeTweetResult("1008", {}, { views: { count: "abc" } }));
      expect(post?.views).toBeNull();
    });
  });

  describe("parseUserTweetsResponse", () => {
    it("collects posts, skips replies and reads the bottom cursor", () => {
      const data = userTweetsData([
        tweetEntry(makeTweetResult("1001")),
        tweetEntry(makeTweetResult("1002", { in_reply_to_status_id_str: "999" })),
        {
          entryId: "profile-conversation-1003",
          content: {
            items: [
              { item: { itemContent: { tweet_results: { result: makeTweetResult("1003") } } } },
              {
                item: {
                  itemContent: {
                    tweet_results: {
                      result: makeTweetResult("1004", { in_reply_to_status_id_str: "1003" }),
                    },
                  },
                },
              },
            ],
          },
        },
        { entryId: "cursor-bottom-0", content: { value: "CURSOR123" } },
      ]);

      const { posts, bottomCursor } = parseUserTweetsResponse(data);
      expect(posts.map((p) => p.id)).toEqual(["1001", "1003"]);
      expect(bottomCursor).toBe("CURSOR123");
    });

    it("reads the legacy timeline path as a fallback", () => {
      const data = {
        data: {
          user: {
            result: {
              timeline: {
                timeline: {
                  instructions: [
                    {
                      type: "TimelineAddEntries",
                      entries: [tweetEntry(makeTweetResult("2001"))],
                    },
                  ],
                },
              },
            },
          },
        },
      };
      const { posts, bottomCursor } = parseUserTweetsResponse(data);
      expect(posts.map((p) => p.id)).toEqual(["2001"]);
      expect(bottomCursor).toBeUndefined();
    });

    it("returns an empty page for missing instructions", () => {
      expect(parseUserTweetsResponse({})).toEqual({ posts: [], bottomCursor: undefined });
      expect(parseUserTweetsResponse(null)).toEqual({ posts: [], bottomCursor: undefined });
    });
  });

  describe("getUserStats", () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    const profileData = { data: { user: { result: makeUserResult() } } };

    it("uses the stored userId when present", async () => {
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("UserByRestId")) return mockResponse(profileData);
        if (u.includes("UserTweets")) {
          return mockResponse(userTweetsData([tweetEntry(makeTweetResult("1001"))]));
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      const stats = await getUserStats(auth, { count: 50 });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(stats.username).toBe("freddiefujiwara");
      expect(stats.followers).toBe(1841);
      expect(stats.following).toBe(120);
      expect(stats.recent_posts).toHaveLength(1);
      expect(stats.recent_posts[0].id).toBe("1001");
      expect(typeof stats.collected_at).toBe("string");
    });

    it("resolves the profile from the notifications viewer when no userId is stored", async () => {
      const viewerData = {
        data: { viewer_v2: { user_results: { result: makeUserResult() } } },
      };
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("NotificationsTimeline")) return mockResponse(viewerData);
        if (u.includes("UserTweets")) {
          return mockResponse(userTweetsData([tweetEntry(makeTweetResult("1001"))]));
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c" };
      const stats = await getUserStats(auth);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(stats.followers).toBe(1841);
      expect(stats.recent_posts).toHaveLength(1);
    });

    it("paginates until the requested count is collected and dedupes", async () => {
      let tweetsCalls = 0;
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("UserByRestId")) return mockResponse(profileData);
        if (u.includes("UserTweets")) {
          tweetsCalls++;
          if (tweetsCalls === 1) {
            return mockResponse(
              userTweetsData([
                tweetEntry(makeTweetResult("1001")),
                tweetEntry(makeTweetResult("1002")),
                { entryId: "cursor-bottom-0", content: { value: "C2" } },
              ])
            );
          }
          return mockResponse(
            userTweetsData([
              tweetEntry(makeTweetResult("1002")),
              tweetEntry(makeTweetResult("1003")),
            ])
          );
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      const stats = await getUserStats(auth, { count: 3 });

      expect(tweetsCalls).toBe(2);
      expect(stats.recent_posts.map((p) => p.id)).toEqual(["1001", "1002", "1003"]);
    });

    it("propagates API errors", async () => {
      fetchSpy.mockResolvedValue(mockResponse("Internal Server Error", false, 500));

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      await expect(getUserStats(auth)).rejects.toThrow("UserByRestId failed (500)");
    });

    it("falls back to UserByRestId when the viewer has no follower count", async () => {
      const viewerNoCounts = {
        data: {
          viewer_v2: {
            user_results: {
              result: { __typename: "User", rest_id: "386573", legacy: {} },
            },
          },
        },
      };
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("NotificationsTimeline")) return mockResponse(viewerNoCounts);
        if (u.includes("UserByRestId")) return mockResponse(profileData);
        if (u.includes("UserTweets")) {
          return mockResponse(userTweetsData([tweetEntry(makeTweetResult("1001"))]));
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c" };
      const stats = await getUserStats(auth);

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(stats.followers).toBe(1841);
    });

    it("throws when the logged-in user cannot be determined", async () => {
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("NotificationsTimeline")) return mockResponse({ data: {} });
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c" };
      await expect(getUserStats(auth)).rejects.toThrow("Could not determine the logged-in user");
    });

    it("throws when the profile result is missing", async () => {
      fetchSpy.mockResolvedValue(mockResponse({ data: { user: {} } }));

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      await expect(getUserStats(auth)).rejects.toThrow("Could not load the user profile");
    });

    it("throws when the API returns a GraphQL errors array", async () => {
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("UserByRestId")) return mockResponse(profileData);
        if (u.includes("UserTweets")) {
          return mockResponse({ errors: [{ message: "boom" }] });
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      await expect(getUserStats(auth)).rejects.toThrow("API returned errors");
    });

    it("passes the bottom cursor to the next page request", async () => {
      const seenVariables: any[] = [];
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("UserByRestId")) return mockResponse(profileData);
        if (u.includes("UserTweets")) {
          const variables = JSON.parse(new URL(u).searchParams.get("variables") || "{}");
          seenVariables.push(variables);
          if (seenVariables.length === 1) {
            return mockResponse(
              userTweetsData([
                tweetEntry(makeTweetResult("1001")),
                { entryId: "cursor-bottom-0", content: { value: "C2" } },
              ])
            );
          }
          return mockResponse(userTweetsData([tweetEntry(makeTweetResult("1002"))]));
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      const stats = await getUserStats(auth, { count: 2 });

      expect(seenVariables).toHaveLength(2);
      expect(seenVariables[0].cursor).toBeUndefined();
      expect(seenVariables[0].userId).toBe("386573");
      expect(seenVariables[1].cursor).toBe("C2");
      expect(stats.recent_posts.map((p) => p.id)).toEqual(["1001", "1002"]);
    });

    it("stops paginating at the page cap even if cursors keep coming", async () => {
      let tweetsCalls = 0;
      fetchSpy.mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes("UserByRestId")) return mockResponse(profileData);
        if (u.includes("UserTweets")) {
          tweetsCalls++;
          return mockResponse(
            userTweetsData([
              tweetEntry(makeTweetResult(`300${tweetsCalls}`)),
              { entryId: "cursor-bottom-0", content: { value: `C${tweetsCalls + 1}` } },
            ])
          );
        }
        throw new Error(`Unexpected URL: ${u}`);
      });

      const auth: AuthConfig = { authToken: "t", csrfToken: "c", userId: "386573" };
      const stats = await getUserStats(auth, { count: 50 });

      expect(tweetsCalls).toBe(6);
      expect(stats.recent_posts).toHaveLength(6);
    });
  });

  describe("classifyNotificationKind production aggregates", () => {
    const aggregateEntry = (element: string, icon: string, text: string) => ({
      entryId: "notification-aggregate",
      content: {
        itemContent: {
          __typename: "TimelineNotification",
          notification_icon: icon,
          rich_message: { text },
          clientEventInfo: { element },
          template: { __typename: "TimelineNotificationAggregateUserActions" },
        },
        clientEventInfo: { element },
      },
    });

    it("classifies recommended follows as follow", () => {
      const entry = aggregateEntry("follow_from_recommended_user", "person_icon", "Alice followed you");
      expect(classifyNotificationKind(entry)).toBe("follow");
    });

    it("classifies grouped follows as follow", () => {
      const entry = aggregateEntry("users_followed_you", "person_icon", "Alice and Bob followed you");
      expect(classifyNotificationKind(entry)).toBe("follow");
    });

    it("classifies likes of a repost as like", () => {
      const entry = aggregateEntry("users_liked_your_retweet", "heart_icon", "Alice liked your repost");
      expect(classifyNotificationKind(entry)).toBe("like");
    });

    it("classifies multi-tweet likes as like", () => {
      const entry = aggregateEntry("user_liked_multiple_tweets", "heart_icon", "Alice liked 2 of your posts");
      expect(classifyNotificationKind(entry)).toBe("like");
    });

    it("falls back to the notification icon when the element is unmapped", () => {
      const entry = aggregateEntry("some_future_element", "heart_icon", "Alice liked your post");
      expect(classifyNotificationKind(entry)).toBe("like");
    });
  });
});
