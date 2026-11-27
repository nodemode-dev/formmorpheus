# Agents

FormMorpheus has an MCP server for outside agents such as Claude Code, Codex, Cursor and Antigravity, and a terminal panel that runs a shell and those four programs beside the Stage and the Timeline. Both are for the desktop: on iPad there is no terminal panel and no Agents page in Preferences. The manual's Agents section is the person's guide; this page maps the parts.

## What an agent can do

The server is `POST /mcp` on the engine: Streamable HTTP in stateless JSON, protocol revisions 2026-07-28 and 2025-11-25. `agents/manifest.json` lists the tools and commands; `./formmorpheus agents sync` writes it from the code.

| Class | Tools | What happens |
|---|---|---|
| Reads | `get_context`, `list_movies`, `get_movie`, `get_movie_picture`, `list_characters`, `list_voices`, `list_commands`, and through `run_command` the commands `list_deleted`, `list_exports`, `list_stacks`, `export_capabilities`, `list_fonts` | run at once; refused only when agents are blocked |
| Changes the library | `manage_movie` (create, rename, duplicate, delete, restore) and, through `run_command`, `set_tags` and `set_stack` | ask in the window under Ask; go ahead under Allowed |
| Asks first | `export_movie`, `import_file`, `add_character`, `add_voice` | ask every time, then the open window carries them out |

- A movie is found by name inside the library folder only. Delete moves a movie to Recently Deleted; nothing is erased.
- `import_file` takes an absolute path inside the library folder, a picture, video, sound, font or layered image file, up to 2 GB. The window opens the movie, imports the file and saves the movie.
- `export_movie` is carried out by the window, which renders the movie and writes the file to the Exports folder. Formats the browser cannot encode go through the person's ffmpeg.
- `list_characters` reads the Characters library (one `.fmo` per character in `Characters/` of the data folder). `add_character {character, movie?, at?}` is carried out by the window: it opens `movie` (or uses the open one), places a copy of the character with fresh ids at `at` or the Playhead through the Characters panel's Add to Movie, and saves the movie.
- `list_voices {engine?}` reads, for `builtin`, `local` and `online`, whether each is ready, why not when it is not, and its voices when it is. `add_voice {text, engine?, voice?, language?, speed?, model?, movie?, at?}` is carried out by the window: it speaks the text (at most 10000 characters, 2000 online, and online sends the text to that service), places the sound on the Timeline of `movie` (or the open movie) at `at` or the Playhead, and saves the movie.
- The server waits 2 minutes for an answer to a question, 10 minutes for an export or a spoken line and 2 minutes for an import or an added character.
- No tool reads another file or folder on the computer, and none returns the window key, a socket ticket or a tab's token.

## The Outside agents choice

| Choice | What happens |
|---|---|
| Ask | The default. Reads work. A change asks in the window. With no window open, a change is refused with a sentence that says to open FormMorpheus. |
| Allowed | Changes to the library go ahead. An export or an import still asks. |
| Blocked | Every agent is refused, reads included, and so are the agents in the terminal panel. Questions that were waiting are answered Deny. |

The choice is kept in `settings.json` beside the library setting. Where the system has a keychain, it is sealed with a key kept there; a change made outside the app that allows agents is ignored, the app asks again, and Preferences says so. An agent in one of the panel's own tabs carries a token for that tab: its library changes are not asked about, and an export or an import still is.

## Connecting a client

1. Start FormMorpheus: the app, or `./formmorpheus`. An export or an import needs the window open.
2. Open Preferences, Agents. Connect a Client shows the MCP address, `http://127.0.0.1:<port>/mcp`, and the command `./formmorpheus mcp`. The desktop app's engine tries port 9496 first; `./formmorpheus` serves it on 9494 (or `FORMMORPHEUS_PORT`).
3. Give a client that connects by address the MCP address. Give a client that starts its own server the command, run in the FormMorpheus folder. Or let `./formmorpheus agents install` write the entries (below).

`./formmorpheus mcp` (`formmorpheus.bat mcp` on Windows) runs `setup/mcp_stdio.py`. It sends each line from the client to the running engine's `/mcp` and each answer back; anything that is not protocol goes to stderr. It looks for the engine at `FORMMORPHEUS_MCP_URL`, else `FORMMORPHEUS_PORT`, else 9494 and 9496. When none answers, it starts the engine of its own source folder once (log: `formmorpheus-engine.log` in the system's temporary folder), unless `FORMMORPHEUS_MCP_AUTOSTART=0`.

`./formmorpheus agents install [--dry-run]` writes these entries. In the FormMorpheus folder they find the script relative to the project; in the folder you ran it from, when that is another, they point at this copy.

| Client | File | Entry |
|---|---|---|
| Claude Code | `.mcp.json` | `formmorpheus` over HTTP at `http://127.0.0.1:9494/mcp` (the `FORMMORPHEUS_PORT` set when it ran, if any), and `formmorpheus-stdio` |
| Codex | `.codex/config.toml` | `formmorpheus` running `setup/mcp_stdio.py` |
| Cursor | `.cursor/mcp.json` | `formmorpheus` running `setup/mcp_stdio.py` |
| Antigravity | `~/.gemini/config/mcp_config.json` | `formmorpheus` running `setup/mcp_stdio.py` |

It also copies the `formmorpheus` skill to `~/.claude/skills`, `~/.agents/skills`, `.agents/skills` here and the same two inside the folder you ran it from. Other servers in those files are kept, and a file it changes is first copied to a `.bak-` file with the date. `./formmorpheus agents sync [--check]` mirrors `.claude/skills` to `.agents/skills`, writes `agents/manifest.json`, and checks that `frontend/src/dock/` and `backend/app/services/agent_lookup.py` are the family's files; `--check` changes nothing and exits 1 when anything is stale.

## The question in the window

The engine queues the question, the window polls `/api/mcp/bridge/next` with its key and shows a box in the middle of the window: the agent's name (the client name it gave when it connected, empty for a tab's own agent), what it asked to do, and a note that the person can turn this off in Preferences, Agents. The answers are Deny, Allow once and Always allow all outside agents; the last, which sets the choice to Allowed, is not offered for an export or an import. Escape denies. After a Deny, requests that need a question are refused for 2 minutes without asking. A question nobody answers within 2 minutes closes and nothing is done. Only the window can answer, and a question still waiting after the window reloads is shown again.

## The terminal panel

- Open it with View, Terminal or Ctrl+` (Cmd+` on macOS). New Terminal opens a shell; Claude Code opens with Shift+Ctrl+`. The panel sits at the bottom or the right (right needs a window of 900 pixels or more), is resized by dragging its edge, and keeps its side, size and open state.
- A tab is a program in a pseudo-terminal: `ptyprocess` on macOS and Linux, `pywinpty` on Windows. On a system without one, opening a tab fails with a sentence that says so. Every terminal route needs the window's key.
- A shell tab starts the login shell (`$SHELL -l`; `cmd.exe` on Windows) in the home folder. From source, the FormMorpheus folder is first on its PATH.
- FormMorpheus neither installs nor signs in to Claude Code, Codex, Cursor or Antigravity. Each is found, in order, at its `FORMMORPHEUS_*_BIN` path, on the engine's PATH, in the usual install folders for the system, and on the PATH of the person's own shell. A missing program shows the line to install it, to run in a terminal.
- Each agent tab is connected to `/mcp` with a token that works only while the tab is open. Claude Code gets a generated config file in `AgentTokens/` of the data folder (readable by the person only, removed when the tab closes) and the server name `formmorpheus_tab`. Codex and Cursor get a `formmorpheus_tab` entry in `.codex/config.toml` or `.cursor/mcp.json` of the working folder, which reads the token from `FORMMORPHEUS_INAPP_TOKEN`; a file there that FormMorpheus did not write is left alone. Antigravity works in `agent-tabs/antigravity` of the data folder, with its entry in `.agents/mcp_config.json` there, removed when the tab closes. The Claude Code, Codex and Cursor tabs work in `Agent` of the data folder, or `FORMMORPHEUS_AGENT_DIR`.
- Closing FormMorpheus ends every tab and drops every token.

## Configuration

| Variable | What it does |
|---|---|
| `FORMMORPHEUS_CLAUDE_BIN`, `FORMMORPHEUS_CODEX_BIN`, `FORMMORPHEUS_CURSOR_BIN`, `FORMMORPHEUS_ANTIGRAVITY_BIN` | the path of that agent program, tried first |
| `FORMMORPHEUS_AGENT_DIR` | the working folder of the Claude Code, Codex and Cursor tabs (default `Agent` in the data folder) |
| `FORMMORPHEUS_MCP_URL` | for `./formmorpheus mcp`: the engine's `/mcp` address; no engine is started then |
| `FORMMORPHEUS_MCP_AUTOSTART` | for `./formmorpheus mcp`: `0` never starts an engine |

The engine sets `FORMMORPHEUS_TERMINAL`, `FORMMORPHEUS_URL` and `FORMMORPHEUS_MCP_URL` in every tab, and `FORMMORPHEUS_INAPP_TOKEN` in the Codex, Cursor and Antigravity tabs. The launcher sets `FORMMORPHEUS_CALLER_DIR`. None of these is set by hand.

## Source

| File | Role |
|---|---|
| `backend/app/routers/mcp.py` | the MCP server, the consent rules, the window's queue routes |
| `backend/app/routers/agents.py`, `terminal.py` | the choice and the questions, the tabs, for the window |
| `backend/app/services/agent_access.py`, `backend/app/core/seal.py` | the choice and its seal |
| `backend/app/services/bridge.py` | the queue between agent calls and the window |
| `backend/app/services/terminal.py`, `claude_code.py`, `agent_programs.py`, `agent_lookup.py` | tabs, tokens, the four programs and the finder |
| `setup/agents.py`, `setup/mcp_stdio.py` | `./formmorpheus agents` and `./formmorpheus mcp` |
| `frontend/src/dock/`, `dock-adapter.ts`, `app/agent-bridge.ts` | the shared dock module, this app's adapter, the window's side of the queue |
