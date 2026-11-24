#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  getTweetDetail,
  getTweetAsGuest,
  extractTweetId,
  getHomeTimeline,
  getHomeLatestTimeline,
  getNotificationsTimeline,
  getUserStats,
  type TweetThread,
} from "./api.js";

import { loadAuth, clearAuth, type StoredAuth } from "./storage.js";
import { formatThreadPretty, formatThreadJson, formatTweet, formatNotificationsJson, formatNotificationsPretty, formatStatsJson, formatStatsPretty } from "./format.js";
import { getCompletionScript } from "./completions.js";
import { installCompletions } from "./setup.js";

const PRETTY_OPTION = {
  alias: "p",
  describe: "Pretty print output with colors",
  type: "boolean",
  default: false,
} as const;

const CURSOR_OPTION = {
  alias: "c",
  describe: "Cursor for pagination (from previous response)",
  type: "string",
} as const;

/** Prints an error and exits, as every command handler does on failure. */
function fail(error: unknown): never {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/**
 * Loads the stored auth for commands that require login. When absent it
 * prints the login hint and exits; it still returns null afterwards so
 * callers stop even when process.exit is mocked (as in tests).
 */
async function requireAuth(): Promise<StoredAuth | null> {
  const auth = await loadAuth();
  if (!auth) {
    console.log("Not logged in. Run 'x login' to authenticate.\n");
    process.exit(1);
    return null;
  }
  return auth;
}

function printThread(thread: TweetThread, pretty: boolean): void {
  console.log(pretty ? formatThreadPretty(thread) : formatThreadJson(thread));
}

const cli = yargs(hideBin(process.argv))
  .scriptName("x")
  .usage("$0 <command> [options]")
  .command(
    "tweet <url>",
    "View a tweet (login required for replies)",
    (yargs) => {
      return yargs
        .positional("url", {
          describe: "Tweet URL or ID",
          type: "string",
          demandOption: true,
        })
        .option("pretty", PRETTY_OPTION);
    },
    async (argv) => {
      try {
        const tweetId = extractTweetId(argv.url);
        const auth = await loadAuth();

        let thread: TweetThread | null = null;
        if (auth) {
          // Authenticated mode: get full thread with replies
          try {
            thread = await getTweetDetail(tweetId, auth);
          } catch (apiError: any) {
            // If auth failed (401/403), fall back to guest mode
            if (apiError.status !== 401 && apiError.status !== 403) {
              throw apiError;
            }
            console.log("Auth expired, falling back to guest mode (no replies)...\n");
            await clearAuth();
          }
        } else {
          // Guest mode: single tweet only (no replies)
          console.log("Not logged in, using guest mode (no replies). Run 'x login' to authenticate.\n");
        }

        if (!thread) {
          const tweet = await getTweetAsGuest(tweetId);
          thread = { mainTweet: tweet, parentTweets: [], replies: [] };
        }
        printThread(thread, argv.pretty);
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "home",
    "View your home timeline (login required)",
    (yargs) => {
      return yargs
        .option("count", {
          alias: "n",
          describe: "Number of tweets to fetch",
          type: "number",
          default: 40,
        })
        .option("cursor", CURSOR_OPTION)
        .option("following", {
          alias: "f",
          describe: "Show following (latest) timeline",
          type: "boolean",
          default: false,
        })
        .option("pretty", PRETTY_OPTION);
    },
    async (argv) => {
      try {
        const auth = await requireAuth();
        if (!auth) return;
        const result = argv.following
          ? await getHomeLatestTimeline(auth, {
            count: argv.count,
            cursor: argv.cursor,
          })
          : await getHomeTimeline(auth, {
            count: argv.count,
            cursor: argv.cursor,
            includePromotedContent: true,
            withCommunity: true,
          });
        if (argv.pretty) {
          for (const t of result.tweets) {
            console.log(formatTweet(t));
            console.log("----");
          }
          if (result.cursor) {
            console.log(`cursor: ${result.cursor}`);
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "notify",
    "View notifications (login required)",
    (yargs) => {
      return yargs
        .option("count", {
          alias: "n",
          describe: "Number of notifications to fetch",
          type: "number",
          default: 40,
        })
        .option("cursor", CURSOR_OPTION)
        .option("type", {
          describe: "Timeline type to fetch",
          type: "string",
          choices: ["All", "Verified", "Mentions"],
          default: "All",
        })
        .option("pretty", PRETTY_OPTION);
    },
    async (argv) => {
      try {
        const auth = await requireAuth();
        if (!auth) return;
        const page = await getNotificationsTimeline(auth, {
          count: argv.count,
          cursor: argv.cursor,
          timelineType: argv.type as "All" | "Verified" | "Mentions",
        });
        if (argv.pretty) {
          console.log(formatNotificationsPretty(page));
        } else {
          console.log(formatNotificationsJson(page));
        }
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "stats",
    "View your own stats (login required)",
    (yargs) => {
      return yargs
        .option("count", {
          alias: "n",
          describe: "Number of recent posts to fetch",
          type: "number",
          default: 50,
        })
        .option("pretty", PRETTY_OPTION);
    },
    async (argv) => {
      try {
        const auth = await requireAuth();
        if (!auth) return;
        const stats = await getUserStats(auth, { count: argv.count });
        if (argv.pretty) {
          console.log(formatStatsPretty(stats));
        } else {
          console.log(formatStatsJson(stats));
        }
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "login",
    "Set up authentication with X (Twitter)",
    () => {},
    async () => {
      const existing = await loadAuth();
      if (existing) {
        console.log(
          `Already logged in${existing.username ? ` as @${existing.username}` : ""}.`
        );
        console.log("Run 'x logout' first if you want to re-authenticate.\n");
      }

      console.log(`To authenticate, extract cookies from your browser:

1. Log in to x.com in your browser
2. Open DevTools (F12) → Application → Cookies → https://x.com
3. Copy these cookie values:
   - auth_token
   - ct0

4. Create ~/.config/x-cli/auth.json with:
   {
     "authToken": "<your auth_token value>",
     "csrfToken": "<your ct0 value>"
   }

Without authentication, you can still view public tweets (but not replies).`);
    }
  )
  .command(
    "logout",
    "Log out and clear stored credentials",
    () => {},
    async () => {
      try {
        await clearAuth();
        console.log("Logged out successfully.");
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "whoami",
    "Show current logged-in user",
    () => {},
    async () => {
      try {
        const auth = await loadAuth();
        if (!auth) {
          console.log("Not logged in. Run 'x login' to authenticate.");
          return;
        }

        if (auth.username) {
          console.log(`@${auth.username}`);
        } else {
          console.log("Logged in (username unknown)");
        }

        if (auth.userId) {
          console.log(`User ID: ${auth.userId}`);
        }
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "completion [shell]",
    "Output shell completion script",
    (yargs) => {
      return yargs.positional("shell", {
        describe: "Shell type",
        type: "string",
        choices: ["bash", "zsh", "fish"],
        default: "bash",
      });
    },
    (argv) => {
      try {
        console.log(getCompletionScript(argv.shell));
      } catch (error) {
        fail(error);
      }
    }
  )
  .command(
    "setup",
    "Install shell completions (auto-detects shell)",
    (yargs) => {
      return yargs.option("shell", {
        alias: "s",
        describe: "Override shell detection",
        type: "string",
        choices: ["bash", "zsh", "fish"] as const,
      });
    },
    (argv) => {
      try {
        const shell = argv.shell as "bash" | "zsh" | "fish" | undefined;
        const result = installCompletions(shell);

        if (result.action === "already_installed") {
          console.log(`Completions for ${result.shell} already installed at ${result.completionPath}`);
        } else {
          console.log(`Installed ${result.shell} completions to ${result.completionPath}`);
          console.log(`\nTo activate, run:\n  ${result.reloadCommand}\n\nOr restart your terminal.`);
        }
      } catch (error) {
        fail(error);
      }
    }
  )
  .demandCommand(1, "You need to specify a command")
  .strict()
  .help()
  .alias("h", "help")
  .version()
  .alias("v", "version");

cli.parse();
