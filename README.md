# @hafez/x-cli

[![npm version](https://img.shields.io/npm/v/@hafez/x-cli.svg)](https://www.npmjs.com/package/@hafez/x-cli)
[![npm downloads](https://img.shields.io/npm/dm/@hafez/x-cli.svg)](https://www.npmjs.com/package/@hafez/x-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@hafez/x-cli.svg)](https://nodejs.org/)
[![Tests](https://github.com/AbdelrahmanHafez/x-cli/actions/workflows/test.yml/badge.svg)](https://github.com/AbdelrahmanHafez/x-cli/actions/workflows/test.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

> View X (Twitter) posts and their replies right from your terminal

## Features

- **Guest Mode** - View public tweets without authentication
- **Thread Context** - See parent tweets and full reply chains (requires auth)
- **Dual Output** - JSON for scripting, pretty-print for humans
- **Shell Completions** - First-class support for bash, zsh, and fish

## Quick Start

```bash
npm install -g @hafez/x-cli
```

```bash
# View any public tweet (no login required)
x tweet https://x.com/Google/status/2001322381533409733

# Or just use the ID
x tweet 2001322381533409733

# Pretty output for readability
x tweet 2001322381533409733 --pretty

# View your home timeline (login required)
x home --pretty --count 10
```

## Authentication (Optional)

Guest mode works for public tweets but won't show replies. For full access:

```bash
# See setup instructions
x login

# Check auth status
x whoami

# Clear credentials
x logout
```

### Manual Setup

1. Log into [x.com](https://x.com)
2. Open DevTools (`F12`) → Application → Cookies → x.com
3. Copy `auth_token` and `ct0` values
4. Create config:

```bash
mkdir -p ~/.config/x-cli
cat > ~/.config/x-cli/auth.json << EOF
{
  "authToken": "YOUR_AUTH_TOKEN",
  "csrfToken": "YOUR_CT0_TOKEN"
}
EOF
```

## Output Formats

### JSON (default)

Perfect for piping to `jq` or other tools:

```json
{
  "mainTweet": {
    "id": "1234567890",
    "text": "Hello world!",
    "author": { "name": "User", "username": "user" },
    "metrics": { "likes": 10, "retweets": 5, "replies": 2 }
  },
  "parentTweets": [],
  "replies": [...]
}
```

### Pretty (`--pretty`)

Human-friendly terminal output:

```
User @username 2h ago
Hello world!
2 replies  5 retweets  10 likes  1.2K views

--- Replies (2) ---

  Reply Author @reply_user 1h ago
  Nice post!
```

## Shell Completions

Auto-install for your shell:

```bash
x setup
```

Or install manually:

```bash
# Bash
x completion bash >> ~/.bashrc

# Zsh
mkdir -p ~/.zsh/completions
x completion zsh > ~/.zsh/completions/_x
# Add to ~/.zshrc: fpath=(~/.zsh/completions $fpath)

# Fish
x completion fish > ~/.config/fish/completions/x.fish
```

## Commands

| Command | Description |
|---------|-------------|
| `x tweet <url>` | View a tweet (guest mode if not logged in) |
| `x home` | View your home timeline (login required) |
| `x notify` | View notifications (login required) |
| `x stats` | View your own stats: follower count and recent post metrics (login required) |
| `x login` | Show authentication setup instructions |
| `x logout` | Clear stored credentials |
| `x whoami` | Show current auth status |
| `x setup` | Install shell completions |
| `x completion <shell>` | Output completion script |

## Development

```bash
git clone https://github.com/AbdelrahmanHafez/x-cli.git
cd x-cli
npm install
npm run build
npm link
```

## License

MIT
