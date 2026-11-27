---
name: ai-voice
description: "Giving a FormMorpheus movie a spoken voice as an agent: list_voices to see which of the three engines is ready (built-in, a voice app on this computer, an online voice), add_voice to speak a text onto the Timeline, placing several lines in a row, what each not-ready answer means, and the sentence timing kept for subtitles. Use when adding narration, a voice-over or text to speech to a movie, or when changing backend/app/routers/voice.py or the voice services."
---

# AI Voice

## The three engines

`list_voices` says, for each engine, whether it is ready and lists its voices when it is.

| Engine | What it is | Who sets it up |
| --- | --- | --- |
| `builtin` | The built-in voice, run in its own program inside the data folder | The person, once, in the AI Voice card's Offline tab |
| `local` | A voice app on this computer that answers the common speech API at a loopback address (127.0.0.1, localhost or [::1]); this is how a cloned voice is used | The person, in the same tab: the address, and a key if the app wants one |
| `online` | An online voice with the person's own key | The person, in the card's Online tab |

An agent can never set up the built-in voice, store a key or change the local address. Only the person can, in the card. Do not ask for a key in the chat.

## A good session

1. `get_context`: is the window open, are outside agents allowed.
2. `list_voices` (optional `engine`). Pick an engine that says ready and copy a voice id from its list.
3. `add_voice {text, engine, voice, speed?, movie?, at?}`. `engine` defaults to `builtin`. `speed` runs from 0.5 to 2. `movie` is a name (the window opens it); without it the open movie is used. `at` is a movie frame; without it the Playhead is used.
4. The tool asks the person in the window first (deny or once). Then the window speaks the text, places the sound on the Timeline and saves the movie. It can take minutes, so wait for the answer.
5. The answer gives where the sound landed and its length in `seconds`. Check with `get_movie`.

Limits: any text is at most 10000 characters, an online text at most 2000. Split a long script into lines.

## Several lines in a row

1. `get_movie` gives the frame rate (`fps`).
2. Place the first line at `at`. The answer gives `seconds`.
3. The next `at` is the last `at` plus `ceil(seconds * fps)`, plus a few frames if you want a pause.
4. Repeat. When a voice app gives no `seconds`, read the new sound's length with `get_movie`.

## Not ready

Every refusal is one plain sentence. Pass it to the person as it is.

- The built-in voice is not set up: ask the person to open the AI Voice card, choose Offline, and set it up there. It downloads a model, so tell them it takes a while.
- No voice app answers: ask the person to start it and check the address in the Offline tab. Only a loopback address is accepted.
- No online key: ask the person to add theirs in the Online tab.
- Open FormMorpheus first: the window carries the work out. The other refusals are in `sub-skills/mcp-tools`.

Never retry around a refusal.

## Subtitles

Each spoken sound remembers its words in the movie file: `Asset.spoken` has `text`, `engine`, `voice` and `cues`, one cue per sentence with `start` and `end` in seconds inside the sound. The built-in voice gives cues; a voice app or online voice gives none. `set_subtitles` with `from_voices` true does the placing now: it offsets each cue by the sound's place on the Timeline and saves the lines as the movie's subtitles. See `sub-skills/subtitles`.

## Working in the source

- Routes under `/api/voice`, in `backend/app/routers/voice.py`: `GET /status`, `POST /builtin/setup`, `GET` and `DELETE /builtin/job`, `DELETE /builtin`, `GET /builtin/voices`, `PUT /local`, `POST /local/probe`, `PUT` and `DELETE /online/key`, `GET /online/voices`, `POST /speak`, `GET` and `DELETE /audio/{sid}`. `speak_now` is also what the MCP tools call.
- Services: `backend/app/services/voice_runtime.py` (the built-in voice: setup, voices, speak) and `voice_remote.py` (the voice app and the online voice). The router itself keeps the sounds (`out_dir`, `sweep`).
- The data folder's `voice` folder holds `runtime`, `models` and `out`. A spoken sound waits in `out` until the window fetches it and is swept after an hour.
- The engine process never imports the built-in voice's packages (`kokoro_onnx`, `numpy`, `onnxruntime`): they stay in the separate runtime, because their loader brings a GPL part. The runtime is called as a separate program.
- The window's client is `frontend/src/io/voice-api.ts`; the tool side is `backend/app/routers/mcp.py` and the bridge kind `add_voice` in `frontend/src/app/agent-bridge.ts`.
