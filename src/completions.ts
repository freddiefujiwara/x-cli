export const BASH_COMPLETION = `###-begin-x-completions-###
#
# x CLI completion script for Bash
#
# Installation: x completion bash >> ~/.bashrc
#

_x_completions() {
    local cur prev commands opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    commands="tweet home notify stats login logout whoami completion setup"

    case "\${prev}" in
        x)
            COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
            return 0
            ;;
        tweet)
            # No specific completions for tweet URL/ID
            return 0
            ;;
        login)
            return 0
            ;;
        logout)
            return 0
            ;;
        whoami)
            return 0
            ;;
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
            return 0
            ;;
        setup)
            return 0
            ;;
        *)
            ;;
    esac

    # Handle options
    case "\${cur}" in
        -*)
            case "\${COMP_WORDS[1]}" in
                tweet)
                    opts="--pretty -p --help -h"
                    ;;
                login)
                    opts="--help -h"
                    ;;
                setup)
                    opts="--shell -s --help -h"
                    ;;
                *)
                    opts="--help -h --version -v"
                    ;;
            esac
            COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
            return 0
            ;;
    esac
}

complete -F _x_completions x
###-end-x-completions-###`;

export const ZSH_COMPLETION = `#compdef x

# x CLI completion script for Zsh
#
# Installation: x completion zsh > ~/.zsh/completions/_x
#               (ensure ~/.zsh/completions is in your $fpath)

_x() {
    local -a commands
    commands=(
        'tweet:View a tweet and its replies'
        'home:View your home timeline (login required)'
        'notify:View notifications (login required)'
        'stats:View your own stats (login required)'
        'login:Log in to X (Twitter)'
        'logout:Log out and clear stored credentials'
        'whoami:Show current logged-in user'
        'completion:Output shell completion script'
        'setup:Install shell completions'
    )

    _arguments -C \\
        '1: :->command' \\
        '*: :->args'

    case "$state" in
        command)
            _describe -t commands 'x commands' commands
            ;;
        args)
            case "\${words[2]}" in
                tweet)
                    _arguments \\
                        '1:url or tweet ID:' \\
                        '(-p --pretty)'{-p,--pretty}'[Pretty print output with colors]' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                login)
                    _arguments \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                completion)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
                setup)
                    _arguments \\
                        '(-s --shell)'{-s,--shell}'[Override shell detection]:shell:(bash zsh fish)' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
            esac
            ;;
    esac
}

_x "$@"`;

export const FISH_COMPLETION = `# x CLI completion script for Fish
#
# Installation: x completion fish > ~/.config/fish/completions/x.fish

# Disable file completions for the first argument
complete -c x -f

# Commands
complete -c x -n "__fish_use_subcommand" -a "tweet" -d "View a tweet and its replies"
complete -c x -n "__fish_use_subcommand" -a "home" -d "View your home timeline (login required)"
complete -c x -n "__fish_use_subcommand" -a "notify" -d "View notifications (login required)"
complete -c x -n "__fish_use_subcommand" -a "stats" -d "View your own stats (login required)"
complete -c x -n "__fish_use_subcommand" -a "login" -d "Log in to X (Twitter)"
complete -c x -n "__fish_use_subcommand" -a "logout" -d "Log out and clear stored credentials"
complete -c x -n "__fish_use_subcommand" -a "whoami" -d "Show current logged-in user"
complete -c x -n "__fish_use_subcommand" -a "completion" -d "Output shell completion script"
complete -c x -n "__fish_use_subcommand" -a "setup" -d "Install shell completions"

# Global options
complete -c x -s h -l help -d "Show help"
complete -c x -s v -l version -d "Show version number"

# tweet command options
complete -c x -n "__fish_seen_subcommand_from tweet" -s p -l pretty -d "Pretty print output with colors"
complete -c x -n "__fish_seen_subcommand_from tweet" -s h -l help -d "Show help"

# login command options
complete -c x -n "__fish_seen_subcommand_from login" -s h -l help -d "Show help"

# completion command arguments
complete -c x -n "__fish_seen_subcommand_from completion" -a "bash zsh fish" -d "Shell type"

# setup command options
complete -c x -n "__fish_seen_subcommand_from setup" -s s -l shell -d "Override shell detection" -a "bash zsh fish"`;

export function getCompletionScript(shell: string): string {
  switch (shell) {
    case "bash":
      return BASH_COMPLETION;
    case "zsh":
      return ZSH_COMPLETION;
    case "fish":
      return FISH_COMPLETION;
    default:
      throw new Error(`Unknown shell: ${shell}. Supported shells: bash, zsh, fish`);
  }
}
