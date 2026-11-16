import { jest } from "@jest/globals";
import type { AuthConfig } from "./auth.js";
import type { NotificationsPage, NotificationKind, UserStats } from "./api.js";

// Mocks
const mockLoadAuth = jest.fn<() => Promise<AuthConfig | null>>();
const mockGetNotificationsTimeline = jest.fn<() => Promise<NotificationsPage>>();
const mockFormatNotificationsPretty = jest.fn<() => string>();
const mockFormatNotificationsJson = jest.fn<() => string>();
const mockGetUserStats = jest.fn<() => Promise<UserStats>>();
const mockFormatStatsPretty = jest.fn<() => string>();
const mockFormatStatsJson = jest.fn<() => string>();

// Mock dependencies before they are imported by cli.ts
jest.unstable_mockModule("./storage.js", () => ({
  loadAuth: mockLoadAuth,
  clearAuth: jest.fn(),
}));
jest.unstable_mockModule("./api.js", () => ({
  getNotificationsTimeline: mockGetNotificationsTimeline,
  getUserStats: mockGetUserStats,
  getTweetDetail: jest.fn(),
  getTweetAsGuest: jest.fn(),
  extractTweetId: jest.fn((id) => id),
  getHomeTimeline: jest.fn(),
  getHomeLatestTimeline: jest.fn(),
}));
jest.unstable_mockModule("./format.js", () => ({
  formatNotificationsPretty: mockFormatNotificationsPretty,
  formatNotificationsJson: mockFormatNotificationsJson,
  formatStatsPretty: mockFormatStatsPretty,
  formatStatsJson: mockFormatStatsJson,
  formatThreadPretty: jest.fn(),
  formatThreadJson: jest.fn(),
  formatTweet: jest.fn(),
}));
jest.unstable_mockModule("./completions.js", () => ({
  getCompletionScript: jest.fn(),
}));
jest.unstable_mockModule("./setup.js", () => ({
  installCompletions: jest.fn(),
}));

/**
 * Helper function to run the CLI with specified arguments.
 * It sets `process.argv` and then dynamically imports the CLI module
 * to trigger its execution.
 * @param args - Array of command-line arguments.
 */
const runCli = async (args: string[]) => {
  const originalArgv = process.argv;
  process.argv = ["node", "x-cli", ...args];
  // Dynamically import to execute the CLI script after argv is set
  await import("./cli.js");
  process.argv = originalArgv;
};

describe("x-cli notify command", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    // Reset modules to ensure cli.js is re-evaluated with fresh mocks for each test
    jest.resetModules();
    // Clear mock function history
    jest.clearAllMocks();

    // Spy on console methods and process.exit
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as (code?: any) => never);
  });

  afterAll(() => {
    // Restore original implementations after all tests are done
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("should show error and exit if not logged in", async () => {
    mockLoadAuth.mockResolvedValue(null);

    await runCli(["notify"]);

    expect(mockLoadAuth).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("Not logged in. Run 'x login' to authenticate.\n");
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockGetNotificationsTimeline).not.toHaveBeenCalled();
  });

  it("should call getNotificationsTimeline and default formatter when logged in", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const mockPage = { notifications: [{ id: "1", kind: "like" as NotificationKind, actors: [], raw: {} }], entries: [] };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationsTimeline.mockResolvedValue(mockPage);
    mockFormatNotificationsJson.mockReturnValue("json output");

    await runCli(["notify"]);

    expect(mockLoadAuth).toHaveBeenCalledTimes(1);
    expect(mockGetNotificationsTimeline).toHaveBeenCalledWith(mockAuth, {
      count: 40,
      cursor: undefined,
      timelineType: "All",
    });
    expect(mockFormatNotificationsJson).toHaveBeenCalledWith(mockPage);
    expect(consoleLogSpy).toHaveBeenCalledWith("json output");
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("should use pretty formatter with --pretty flag", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const mockPage = { notifications: [{ id: "1", kind: "like" as NotificationKind, actors: [], raw: {} }], entries: [] };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationsTimeline.mockResolvedValue(mockPage);
    mockFormatNotificationsPretty.mockReturnValue("pretty output");

    await runCli(["notify", "--pretty"]);

    expect(mockGetNotificationsTimeline).toHaveBeenCalledWith(mockAuth, {
      count: 40,
      cursor: undefined,
      timelineType: "All",
    });
    expect(mockFormatNotificationsPretty).toHaveBeenCalledWith(mockPage);
    expect(mockFormatNotificationsJson).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith("pretty output");
  });

  it("should pass count and type options through", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const mockPage = { notifications: [], entries: [] };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationsTimeline.mockResolvedValue(mockPage);
    mockFormatNotificationsJson.mockReturnValue("json output");

    await runCli(["notify", "--count", "5", "--type", "Mentions"]);

    expect(mockGetNotificationsTimeline).toHaveBeenCalledWith(mockAuth, {
      count: 5,
      cursor: undefined,
      timelineType: "Mentions",
    });
  });

  it("should handle API errors gracefully", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const error = new Error("API request failed");
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationsTimeline.mockRejectedValue(error);

    await runCli(["notify"]);

    expect(mockGetNotificationsTimeline).toHaveBeenCalledWith(mockAuth, {
      count: 40,
      cursor: undefined,
      timelineType: "All",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "API request failed");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

describe("x-cli stats command", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  const mockStats: UserStats = {
    collected_at: "2026-11-16T00:00:00.000Z",
    username: "testuser",
    followers: 123,
    following: 45,
    recent_posts: [],
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as (code?: any) => never);
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("should show error and exit if not logged in", async () => {
    mockLoadAuth.mockResolvedValue(null);

    await runCli(["stats"]);

    expect(mockLoadAuth).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("Not logged in. Run 'x login' to authenticate.\n");
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockGetUserStats).not.toHaveBeenCalled();
  });

  it("should call getUserStats and default formatter when logged in", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetUserStats.mockResolvedValue(mockStats);
    mockFormatStatsJson.mockReturnValue("json output");

    await runCli(["stats"]);

    expect(mockGetUserStats).toHaveBeenCalledWith(mockAuth, { count: 50 });
    expect(mockFormatStatsJson).toHaveBeenCalledWith(mockStats);
    expect(consoleLogSpy).toHaveBeenCalledWith("json output");
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("should use pretty formatter with --pretty flag", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetUserStats.mockResolvedValue(mockStats);
    mockFormatStatsPretty.mockReturnValue("pretty output");

    await runCli(["stats", "--pretty"]);

    expect(mockFormatStatsPretty).toHaveBeenCalledWith(mockStats);
    expect(mockFormatStatsJson).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith("pretty output");
  });

  it("should pass the count option through", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetUserStats.mockResolvedValue(mockStats);
    mockFormatStatsJson.mockReturnValue("json output");

    await runCli(["stats", "--count", "5"]);

    expect(mockGetUserStats).toHaveBeenCalledWith(mockAuth, { count: 5 });
  });

  it("should handle API errors gracefully", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetUserStats.mockRejectedValue(new Error("API request failed"));

    await runCli(["stats"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "API request failed");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
