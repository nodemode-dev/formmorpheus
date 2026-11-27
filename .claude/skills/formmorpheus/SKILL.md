---
name: formmorpheus
description: "Works with FormMorpheus, the Form family's animation studio (Vite interface in frontend/, FastAPI engine in backend/, Tauri 2 shell in src-tauri/, iPad build in ios/). Use when driving FormMorpheus through its MCP server (list, read, create, rename, duplicate, delete, restore, export, import), when reading or writing .fmo movie files or calling the engine's routes, when a question is about which exports the browser encodes or need the person's ffmpeg, when adding an AI voice (voice-over, text to speech, narration), when adding subtitles or captions, when building the iPad app, or when cutting a release (version sites, changelog, release commit). Trigger on FormMorpheus, formmorpheus, .fmo, ./formmorpheus, port 9494 or 5194, the formmorpheus MCP tools (get_context, list_movies, get_movie, get_movie_picture, manage_movie, export_movie, import_file, list_characters, add_character, list_voices, add_voice, list_subtitles, set_subtitles, list_commands, run_command), the window key, the dock, or ios/project.yml."
license: Apache-2.0
metadata:
  author: nodemode-ai
  version: "0.1.0"
---

# FormMorpheus

FormMorpheus is an animation studio: a Stage over a Timeline, drawn frame by frame or performed live. The interface (`frontend/`) holds the movie model and does all drawing, rendering and encoding it can; the engine (`backend/app/`) keeps the movie library of `.fmo` files, exports, export jobs through the person's own ffmpeg, Recently Deleted, crash recovery and fonts, and serves the MCP server at `/mcp`. The engine listens on 127.0.0.1 only.

Read `CLAUDE.md` at the repository root before changing code: it holds the laws (hand-made single-region edits, no emoji, no em dash, tokens only, no self-written tests, generic words, HASHOUT_LOG routing) and the configuration variables.

## Routing

Load the one sub-skill that matches the task. Each folder holds a `SUB-SKILL.md`.

| Task | Sub-skill folder |
| --- | --- |
| The `.fmo` file, the engine's routes, the window key and the library on disk | `sub-skills/fmo-and-engine` |
| Driving the app as an agent through the MCP tools, consent and the window bridge | `sub-skills/mcp-tools` |
| Export: what the browser encodes, what needs ffmpeg, where files land | `sub-skills/export` |
| Giving a movie a spoken voice: list_voices, add_voice, the three engines, `/api/voice` | `sub-skills/ai-voice` |
| Subtitles on a movie: list_subtitles, set_subtitles, lines from AI voices, .srt and .vtt, the style | `sub-skills/subtitles` |
| Building and running the iPad app | `sub-skills/ipad-build` |
| Cutting a release: version sites, changelog, commits | `sub-skills/releasing` |

## Always

- Facts here point at files; when a file and this pack disagree, the file is right, and `./formmorpheus agents sync` regenerates `agents/manifest.json` from the code.
- An agent never asks for the window key, a socket ticket or an in-app token, and no tool returns one.
- Outside agents are off until the person allows them in the FormMorpheus window. Do not try to get around a refusal; tell the person what the message says.
