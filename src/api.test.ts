import { parseNotificationTimelineResponse, NotificationKind, extractTweetId } from "./api.js";

describe("api", () => {
  describe("parseNotificationTimelineResponse", () => {
    it("should correctly identify a retweet from a notification_result", () => {
      const mockJsonData = {
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
                          {
                            entryId: "notification-123",
                            content: {
                              itemContent: {
                                notification_result: {
                                  result: {
                                    id: "notif-1",
                                    timestamp_ms: "1678886400000",
                                    clientEventInfo: {
                                      element: "users_retweeted_your_tweet",
                                    },
                                    from_users_results: {
                                      results: [
                                        {
                                          result: {
                                            rest_id: "987",
                                            legacy: {
                                              name: "Retweeter",
                                              screen_name: "retweeter_user",
                                            },
                                          },
                                        },
                                      ],
                                    },
                                    tweet: {
                                      __typename: "Tweet",
                                      rest_id: "54321",
                                      core: { user_results: { result: { rest_id: "author1" } } },
                                      legacy: { full_text: "Original tweet", retweeted: false },
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
            },
          },
        },
      };

      const notifications = parseNotificationTimelineResponse(mockJsonData);
      expect(notifications.length).toBe(1);
      expect(notifications[0].kind).toBe(NotificationKind.Retweet);
      expect(notifications[0].users[0].name).toBe("Retweeter");
      expect(notifications[0].tweet?.id).toBe("54321");
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
