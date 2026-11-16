import type { Tweet, TweetThread, NotificationsPage, Notification, NotificationActor, UserStats } from "./api.js";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function formatTweet(tweet: Tweet, indent: string = ""): string {
  const { author, text, metrics, createdAt } = tweet;

  const header = `${COLORS.bold}${author.name}${COLORS.reset} ${COLORS.gray}@${author.username}${COLORS.reset} ${COLORS.dim}${formatDate(createdAt)}${COLORS.reset}`;

  const stats = [
    metrics.replies > 0 ? `${COLORS.cyan}${formatNumber(metrics.replies)} replies${COLORS.reset}` : null,
    metrics.retweets > 0 ? `${COLORS.green}${formatNumber(metrics.retweets)} retweets${COLORS.reset}` : null,
    metrics.likes > 0 ? `${COLORS.yellow}${formatNumber(metrics.likes)} likes${COLORS.reset}` : null,
    metrics.views > 0 ? `${COLORS.gray}${formatNumber(metrics.views)} views${COLORS.reset}` : null,
  ]
    .filter(Boolean)
    .join("  ");

  const textLines = text.split("\n").map((line) => indent + line).join("\n");

  return [
    indent + header,
    textLines,
    stats ? indent + stats : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatThreadPretty(thread: TweetThread): string {
  const lines: string[] = [];

  if (thread.parentTweets.length > 0) {
    lines.push(`${COLORS.dim}--- Parent tweets ---${COLORS.reset}`);
    for (const tweet of thread.parentTweets) {
      lines.push(formatTweet(tweet));
      lines.push(`${COLORS.dim}  |${COLORS.reset}`);
    }
    lines.push(`${COLORS.dim}  v${COLORS.reset}`);
    lines.push("");
  }

  lines.push(formatTweet(thread.mainTweet));

  if (thread.replies.length > 0) {
    lines.push("");
    lines.push(`${COLORS.dim}--- Replies (${thread.replies.length}) ---${COLORS.reset}`);
    for (const reply of thread.replies) {
      lines.push("");
      lines.push(formatTweet(reply, "  "));
    }
  }

  return lines.join("\n");
}

function highlightJson(json: string): string {
  return json
    // Strings (keys and values) - must do keys first
    .replace(/"([^"]+)":/g, `${COLORS.cyan}"$1"${COLORS.reset}:`)
    // String values
    .replace(/: "([^"]*)"/g, `: ${COLORS.green}"$1"${COLORS.reset}`)
    // Numbers
    .replace(/: (\d+)/g, `: ${COLORS.yellow}$1${COLORS.reset}`)
    // Booleans and null
    .replace(/: (true|false|null)/g, `: ${COLORS.blue}$1${COLORS.reset}`);
}

export function formatThreadJson(thread: TweetThread, options?: { color?: boolean }): string {
  const json = JSON.stringify(thread, null, 2);
  const useColor = options?.color ?? process.stdout.isTTY;
  return useColor ? highlightJson(json) : json;
}

// ===== Notifications =====

function formatActors(actors: NotificationActor[]): string {
  if (actors.length === 0) return "";
  const firstActor = actors[0];
  const first = `${COLORS.bold}${firstActor.name || firstActor.username}${COLORS.reset} ${COLORS.gray}@${firstActor.username}${COLORS.reset}`;

  if (actors.length === 1) return first;
  if (actors.length === 2) {
    const secondActor = actors[1];
    const second = `${COLORS.bold}${secondActor.name || secondActor.username}${COLORS.reset} ${COLORS.gray}@${secondActor.username}${COLORS.reset}`;
    return `${first} and ${second}`;
  }
  return `${first} and ${actors.length - 1} others`;
}

function formatNotification(notification: Notification): string {
  const { kind, actors, tweet, message } = notification;

  let icon = "";
  let actionText = "";
  switch (kind) {
    case "like":
      icon = `${COLORS.yellow}❤️${COLORS.reset}`;
      actionText = "liked your tweet";
      break;
    case "retweet":
    case "repost":
      icon = `${COLORS.green}🔁${COLORS.reset}`;
      actionText = "reposted your tweet";
      break;
    case "follow":
      icon = `${COLORS.blue}👤${COLORS.reset}`;
      actionText = "followed you";
      break;
    case "reply":
      icon = `${COLORS.cyan}💬${COLORS.reset}`;
      actionText = "replied to your tweet";
      break;
    case "mention":
      icon = `${COLORS.cyan}🔔${COLORS.reset}`;
      actionText = "mentioned you";
      break;
    case "quote":
      icon = `${COLORS.cyan}📝${COLORS.reset}`;
      actionText = "quoted your tweet";
      break;
    default:
      icon = "ℹ️";
      break;
  }

  const actorStr = formatActors(actors);
  const messageStr = message ? `"${message}"` : actionText;

  const unreadMark = notification.unread ? `${COLORS.blue}●${COLORS.reset} ` : "";
  const header = `${unreadMark}${icon} ${actorStr} ${messageStr}`;
  const tweetStr = tweet ? formatTweet(tweet, "  ") : null;

  return [header, tweetStr].filter(Boolean).join("\n");
}


export function formatNotificationsPretty(page: NotificationsPage): string {
  const lines = page.notifications.map(formatNotification);
  return lines.join(`\n\n${COLORS.dim}---${COLORS.reset}\n\n`);
}

export function formatNotificationsJson(page: NotificationsPage, options?: { color?: boolean }): string {
  const simplifiedNotifications = page.notifications.map((n) => ({
    id: n.id,
    kind: n.kind,
    unread: n.unread,
    actors: n.actors,
    tweet: n.tweet,
    tweetId: n.tweetId,
    message: n.message,
  }));
  const json = JSON.stringify(simplifiedNotifications, null, 2);
  const useColor = options?.color ?? process.stdout.isTTY;
  return useColor ? highlightJson(json) : json;
}

// ===== User stats =====

/** Snapshot-shaped JSON, matching the x section of tweet-gas sns_snapshot. */
export function formatStatsJson(stats: UserStats, options?: { color?: boolean }): string {
  const doc = {
    ok: true,
    collected_at: stats.collected_at,
    x: {
      username: stats.username,
      followers: stats.followers,
      following: stats.following,
      recent_posts: stats.recent_posts,
    },
  };
  const json = JSON.stringify(doc, null, 2);
  const useColor = options?.color ?? process.stdout.isTTY;
  return useColor ? highlightJson(json) : json;
}

export function formatStatsPretty(stats: UserStats): string {
  const lines: string[] = [];

  const followers = stats.followers != null ? formatNumber(stats.followers) : "unknown";
  const following = stats.following != null ? formatNumber(stats.following) : "unknown";
  lines.push(
    `${COLORS.bold}@${stats.username ?? "?"}${COLORS.reset} ${COLORS.dim}— ${followers} followers · ${following} following${COLORS.reset}`
  );

  for (const post of stats.recent_posts) {
    const when = post.posted_at ? formatDate(post.posted_at) : "";
    const metrics = [
      post.replies != null && post.replies > 0
        ? `${COLORS.cyan}${formatNumber(post.replies)} replies${COLORS.reset}`
        : null,
      post.reposts != null && post.reposts > 0
        ? `${COLORS.green}${formatNumber(post.reposts)} reposts${COLORS.reset}`
        : null,
      post.likes != null && post.likes > 0
        ? `${COLORS.yellow}${formatNumber(post.likes)} likes${COLORS.reset}`
        : null,
      post.views != null ? `${COLORS.gray}${formatNumber(post.views)} views${COLORS.reset}` : null,
    ]
      .filter(Boolean)
      .join("  ");

    lines.push("");
    lines.push(`${COLORS.dim}${when}${COLORS.reset}  ${post.text.split("\n")[0]}`);
    if (metrics) lines.push(`  ${metrics}`);
  }

  return lines.join("\n");
}
