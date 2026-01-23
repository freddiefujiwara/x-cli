#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { getTweetDetail, getTweetAsGuest, extractTweetId, getNotificationTimeLine } from "./api.js";
import { loadAuth, clearAuth } from "./storage.js";
import { formatThreadPretty, formatThreadJson, formatNotificationsJson, formatNotificationsPretty } from "./format.js";
import { getCompletionScript } from "./completions.js";
import { installCompletions } from "./setup.js";

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
        .option("pretty", {
          alias: "p",
          describe: "Pretty print output with colors",
          type: "boolean",
          default: false,
        });
    },
    async (argv) => {
      try {
        const tweetId = extractTweetId(argv.url);
        const auth = await loadAuth();

        if (auth) {
          // Authenticated mode: get full thread with replies
          try {
            const thread = await getTweetDetail(tweetId, auth);
            if (argv.pretty) {
              console.log(formatThreadPretty(thread));
            } else {
              console.log(formatThreadJson(thread));
            }
          } catch (apiError: any) {
            // If auth failed (401/403), fall back to guest mode
            if (apiError.status === 401 || apiError.status === 403) {
              console.log("Auth expired, falling back to guest mode (no replies)...\n");
              await clearAuth();
              const tweet = await getTweetAsGuest(tweetId);
              const thread = { mainTweet: tweet, parentTweets: [], replies: [] };
              if (argv.pretty) {
                console.log(formatThreadPretty(thread));
              } else {
                console.log(formatThreadJson(thread));
              }
            } else {
              throw apiError;
            }
          }
        } else {
          // Guest mode: single tweet only (no replies)
          console.log("Not logged in, using guest mode (no replies). Run 'x login' to authenticate.\n");
          const tweet = await getTweetAsGuest(tweetId);
          const thread = { mainTweet: tweet, parentTweets: [], replies: [] };
          if (argv.pretty) {
            console.log(formatThreadPretty(thread));
          } else {
            console.log(formatThreadJson(thread));
          }
        }
      } catch (error) {
        console.error(
          "Error:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  )
  .command(
    "notify",
    "View notifications (login required)",
    (yargs) => {
      return yargs
        .option("pretty", {
          alias: "p",
          describe: "Pretty print output with colors",
          type: "boolean",
          default: false,
        });
    },
    async (argv) => {
      try {
        const auth = await loadAuth();
        if (!auth) {
          console.error("Login required. Please run 'x login' first.");
          process.exit(1);
          return;
        }

        const page = await getNotificationTimeLine(auth!);

        if (argv.pretty) {
          console.log(formatNotificationsPretty(page));
        } else {
          console.log(formatNotificationsJson(page));
        }

      } catch (error) {
        console.error(
          "Error:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
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
        console.error(
          "Error:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
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
        console.error(
          "Error:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
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
        console.error(
          "Error:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
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
        console.error(
          "Error:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
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
