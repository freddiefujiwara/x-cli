import { jest } from "@jest/globals";
import type { AuthConfig } from "./auth.js";
import type { Notification, NotificationKind } from "./api.js";

// Mocks
const mockLoadAuth = jest.fn<() => Promise<AuthConfig | null>>();
const mockGetNotificationTimeLine = jest.fn<() => Promise<{ notifications: Notification[] }>>();
const mockFormatNotificationsPretty = jest.fn<() => string>();
const mockFormatNotificationsJson = jest.fn<() => string>();

// Mock dependencies before they are imported by cli.ts
jest.unstable_mockModule("./storage.js", () => ({
  loadAuth: mockLoadAuth,
  clearAuth: jest.fn(),
}));
jest.unstable_mockModule("./api.js", () => ({
  getNotificationTimeLine: mockGetNotificationTimeLine,
  getTweetDetail: jest.fn(),
  getTweetAsGuest: jest.fn(),
  extractTweetId: jest.fn((id) => id),
}));
jest.unstable_mockModule("./format.js", () => ({
  formatNotificationsPretty: mockFormatNotificationsPretty,
  formatNotificationsJson: mockFormatNotificationsJson,
  formatThreadPretty: jest.fn(),
  formatThreadJson: jest.fn(),
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
    expect(consoleErrorSpy).toHaveBeenCalledWith("Login required. Please run 'x login' first.");
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockGetNotificationTimeLine).not.toHaveBeenCalled();
  });

  it("should call getNotificationTimeLine and default formatter when logged in", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const mockPage = { notifications: [{ id: "1", kind: "like" as NotificationKind, fromUsers: [], timestamp: "2024-01-01T00:00:00.000Z" }] };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationTimeLine.mockResolvedValue(mockPage);
    mockFormatNotificationsJson.mockReturnValue("json output");

    await runCli(["notify"]);

    expect(mockLoadAuth).toHaveBeenCalledTimes(1);
    expect(mockGetNotificationTimeLine).toHaveBeenCalledWith(mockAuth);
    expect(mockFormatNotificationsJson).toHaveBeenCalledWith(mockPage);
    expect(consoleLogSpy).toHaveBeenCalledWith("json output");
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("should use pretty formatter with --pretty flag", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const mockPage = { notifications: [{ id: "1", kind: "like" as NotificationKind, fromUsers: [], timestamp: "2024-01-01T00:00:00.000Z" }] };
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationTimeLine.mockResolvedValue(mockPage);
    mockFormatNotificationsPretty.mockReturnValue("pretty output");

    await runCli(["notify", "--pretty"]);

    expect(mockGetNotificationTimeLine).toHaveBeenCalledWith(mockAuth);
    expect(mockFormatNotificationsPretty).toHaveBeenCalledWith(mockPage);
    expect(mockFormatNotificationsJson).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith("pretty output");
  });

  it("should handle API errors gracefully", async () => {
    const mockAuth = { authToken: "test-auth", csrfToken: "test-csrf" };
    const error = new Error("API request failed");
    mockLoadAuth.mockResolvedValue(mockAuth);
    mockGetNotificationTimeLine.mockRejectedValue(error);

    await runCli(["notify"]);

    expect(mockGetNotificationTimeLine).toHaveBeenCalledWith(mockAuth);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "API request failed");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
