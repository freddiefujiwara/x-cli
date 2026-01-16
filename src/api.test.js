import { describe, it, expect } from '@jest/globals';
import { extractTweetId } from "./api.js";

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
