---
name: mcp-tools
description: "Driving FormMorpheus as an agent through its MCP server: connecting over HTTP or stdio, the tool classes (reads, changes the library, asks first), consent in the window, and what to do with each refusal. Use when an agent should list, read, create, rename, duplicate, delete, restore, export or import movies, list saved characters or add one to a movie, or when changing backend/app/routers/mcp.py."
---

# The MCP tools

## Connecting

- HTTP: `http://127.0.0.1:9494/mcp` when started with `./formmorpheus`; the desktop app's engine prefers port 9496. Streamable HTTP in stateless JSON mode; protocol revisions are `VERSIONS` in `backend/app/routers/mcp.py`. A 2026-07-28 client sends the revision in `params._meta["io.modelcontextprotocol/protocolVersion"]` (or the `MCP-Protocol-Version` header) and may start with `server/discover`; a 2025-11-25 client starts with `initialize`.
- stdio: `./formmorpheus mcp` (`formmorpheus.bat mcp` on Windows) runs `setup/mcp_stdio.py`, which forwards each line to the running engine and starts this copy's engine when none answers.
- `./formmorpheus agents install` writes the entries for Claude Code (`.mcp.json`), Codex (`.codex/config.toml`), Cursor (`.cursor/mcp.json`) and Antigravity, and copies this skill pack. `--dry-run` shows what it would write.
- The generated list of tools and commands is `agents/manifest.json` (`mcp.tools`, `mcp.read_only`, `mcp.approval_gated`, `mcp.asks_first`, `mcp.commands`). Read it rather than counting.

## The classes

Each tool's description starts with its class, and its annotations say it too (`readOnlyHint`).

| Class | Tools | What happens |
| --- | --- | --- |
| Reads | `get_context`, `list_movies`, `get_movie`, `get_movie_picture`, `list_characters`, `list_voices`, `list_commands` | runs at once; refused only when the person blocked agents |
| Changes the library | `manage_movie`, and `run_command` for a command of that class | runs when the person allowed outside agents; otherwise asks in the window (deny, once, always), and with no window open it is refused |
| Asks first | `export_movie`, `import_file`, `add_character`, `add_voice` | always asks the person in the window (deny, once), then the window carries it out; with no window open it is refused at once with "Open FormMorpheus first" |

The rules live in `_gate` in `backend/app/routers/mcp.py`. The person's standing choice (ask, allowed, blocked) is `backend/app/services/agent_access.py`. An agent tab the person opened in the app's own dock carries an in-app token and is not asked for library changes; it is still asked before an export or an import.

## A good session

1. `get_context`: the version, the library folder, whether the window is open, whether outside agents are allowed, and what ffmpeg can encode.
2. `list_movies`, then `get_movie {movie}` for one movie's size, frame rate, length, tracks and content. `get_movie_picture {movie}` shows the poster and the preview.
3. Changes: `manage_movie {action: create, name, width, height, fps, seconds}`, `{action: rename, movie, to}`, `{action: duplicate, movie}`, `{action: delete, movie}` (to Recently Deleted, never erased), `{action: restore, movie}` (a name, or the id `run_command {id: list_deleted}` gives). Check each with `list_movies`.
4. `export_movie {movie, format}` (optional `width`, `height`, `from`, `to` in movie frames with `to` not included, `quality`, `audio`, `name`). The file lands in the app's Exports folder and the answer gives its path.
5. `import_file {path, movie, at?, track?}`: `path` must be inside the library folder; copy the file there first.
6. `list_characters {query?}` reads the Characters library (one `.fmo` per character in the data folder's `Characters` folder). `add_character {character, movie?, at?}` asks first, then the window opens `movie` (or uses the open one), places a copy of the character with fresh ids at `at` or the Playhead, and saves the movie; the answer gives `content`, `movie` and `saved`.
7. `list_voices {engine?}` reads which voice engines are ready (`builtin`, `local`, `online`) and their voices. `add_voice {text, engine?, voice?, language?, speed?, model?, movie?, at?}` asks first, then the window speaks the text, places the sound on the Timeline at `at` or the Playhead, and saves the movie. See `sub-skills/ai-voice`.
8. `list_commands` shows the commands that are not tools (Recently Deleted, Exports, stacks, tags, fonts, ffmpeg's encoders); `run_command {id, params}` runs one.

## Refusals

Every refusal is one plain sentence. Pass it to the person as it is.

- Outside agents are off: ask the person to open FormMorpheus and allow outside agents.
- Blocked: the person turned agents off in Preferences; do not retry.
- Open FormMorpheus first: export, import, add_character and add_voice need the window.
- The person said no: do not ask again at once; a repeat within `DECLINE_PAUSE` seconds is refused without asking.
- Nobody answered within the wait: the question expired; ask the person to answer in the window.

## Limits

The waits are `CONSENT_WAIT`, `EXPORT_WAIT` and `IMPORT_WAIT` in `routers/mcp.py`. A file name, a movie name or a path outside the library folder is refused with what to do instead. No tool returns the window key, a ticket or a token.
