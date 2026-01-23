import { extractTweetId, parseNotificationTimelineResponse } from "./api.js";
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
  describe("parseNotificationTimelineResponse", () => {
    it("should parse a single like notification", () => {
      const mockData = createMockApiResponse("like");
      const result = parseNotificationTimelineResponse(mockData);
      expect(result.notifications).toHaveLength(1);
      const notification = result.notifications[0];
      expect(notification.kind).toBe("like");
      expect(notification.fromUsers).toHaveLength(1);
      expect(notification.fromUsers[0].name).toBe("Test User");
    });

    it("should parse a reply notification", () => {
      const mockData = createMockApiResponse("reply");
      const result = parseNotificationTimelineResponse(mockData);
      expect(result.notifications).toHaveLength(1);
      const notification = result.notifications[0];
      expect(notification.kind).toBe("reply");
      expect(notification.fromUsers).toHaveLength(1);
      expect(notification.sourceTweet).toBeDefined();
      expect(notification.sourceTweet?.id).toBe("22222");
    });

    it("should handle multiple notifications and a cursor", () => {
      const mockData = createMockApiResponse("like", "reply");
      const result = parseNotificationTimelineResponse(mockData);
      expect(result.notifications).toHaveLength(2);
      expect(result.nextCursor).toBe("bottom-cursor-123");
    });

    it("should handle an empty timeline", () => {
      const mockData = {
        data: {
          viewer_v2: {
            user_results: {
              result: {
                notification_timeline: {
                  timeline: {
                    instructions: [],
                  },
                },
              },
            },
          },
        },
      };
      const result = parseNotificationTimelineResponse(mockData);
      expect(result.notifications).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });
});

// Helper to create mock API responses
function createMockApiResponse(...notificationTypes: ("like" | "reply")[]) {
  const entries: any[] = notificationTypes.map((type, index) => {
    if (type === "like") {
      return {
        entryId: `notification-${index}`,
        content: {
          entryType: "TimelineTimelineItem",
          itemContent: {
            itemType: "TimelineNotification",
            notificationResult: {
              result: {
                id: `notification-id-${index}`,
                timestamp_ms: "1672531200000",
                clientEventInfo: { element: "like" },
                message: { text: "Test User liked your tweet" },
                from_users: [
                  {
                    user_results: {
                      result: {
                        rest_id: "101",
                        legacy: { name: "Test User", screen_name: "testuser" },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      };
    } else {
      // reply
      return {
        entryId: `notification-${index}`,
        content: {
          entryType: "TimelineTimelineItem",
          itemContent: {
            itemType: "TimelineTweet",
            clientEventInfo: { element: "reply" },
            tweet_results: {
              result: {
                rest_id: "22222",
                legacy: {
                  full_text: "This is a reply",
                  created_at: "Sun Jan 01 00:00:00 +0000 2023",
                },
                core: {
                  user_results: {
                    result: {
                      rest_id: "102",
                      legacy: { name: "Reply Guy", screen_name: "replyguy" },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }
  });

  // Add a cursor entry
  entries.push({
    entryId: "cursor-bottom-1",
    content: {
      entryType: "TimelineTimelineCursor",
      cursorType: "Bottom",
      value: "bottom-cursor-123",
    },
  });

  return {
    data: {
      viewer_v2: {
        user_results: {
          result: {
            notification_timeline: {
              timeline: {
                instructions: [
                  {
                    type: "TimelineAddEntries",
                    entries: entries,
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}
