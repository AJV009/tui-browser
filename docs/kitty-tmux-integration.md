# Kitty + tmux Integration Fixes

When every Kitty window runs inside tmux (via `tmux-kitty-shell`), several Kitty features break because Kitty can no longer see the shell process directly. These are the workarounds.

## New tab inherits current directory

**Problem:** `new_tab_with_cwd` always opens in `$HOME` because Kitty sees the tmux client's CWD, not the shell inside tmux.

**Fix:** A script (`~/.config/kitty/new-tab-cwd.sh`) queries tmux for the real CWD and uses `kitty @` remote control to launch the tab:

```sh
#!/bin/sh
cwd=$(tmux display-message -p '#{pane_current_path}' 2>/dev/null)
socket=$(ls /tmp/kitty-socket-* 2>/dev/null | head -1)
kitty @ --to="unix:$socket" launch --type=tab --location=neighbor --cwd="${cwd:-$HOME}"
```

The socket glob is needed because `launch --type=background` processes don't inherit `KITTY_LISTEN_ON`, and the socket path includes Kitty's PID (e.g., `/tmp/kitty-socket-12345`).

Kitty keybinding:
```
map kitty_mod+t launch --type=background ~/.config/kitty/new-tab-cwd.sh
```

## Tab titles show "tmux-kitty-shell"

**Problem:** Kitty shows the process name of its direct child (`tmux-kitty-shell`) instead of what the shell/program sets (e.g., "Claude Code").

**Fix:** Tell tmux to forward pane titles to the outer terminal. In `~/.tmux.conf`:

```
set -g set-titles on
set -g set-titles-string '#T'
```

`#T` is the pane title — whatever the program inside tmux sets via OSC 2 escape sequences.

## Shift+Enter inserts backslash

**Problem:** Kitty's default `shift+enter` mapping sends `\` + newline (`\\\n`). Pre-tmux this worked, but with tmux the backslash appears literally in apps like Claude Code.

**Fix:** Change the mapping to send just a newline (`\n`) without the backslash:

```
map shift+enter send_text normal,application \n
```
