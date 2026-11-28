---
name: subtitles
description: "Reading and writing the subtitles of a FormMorpheus movie as an agent: list_subtitles to see the lines and the look, set_subtitles to replace or add lines (in seconds or as .srt or .vtt text), set the font, size, position, color and band, and turn subtitles on after add_voice. Use when adding subtitles or captions to a movie, timing lines to a voice-over, or when changing the Subtitles feature in engine/subtitles.ts, io/subtitle-files.ts, ui/subtitles-panel.ts or services/voice_transcribe.py."
---

# Subtitles

A movie keeps one set of subtitles: whether the video shows them, one look for every line, and the lines. They are drawn on the Stage and into every export while "Show subtitles in the video" is on.

## Read

`list_subtitles {movie}` reads the movie's file and changes nothing. It answers with `show`, the look (`font`, `size`, `position`, `color`, `band`) and the lines. Each line has `start` and `end` in seconds and in frames (`end` is not included), its `text`, and which sound block it came from when one did.

## Change

`set_subtitles` asks the person in the window first (deny or once), then the window changes the open movie (or `movie`, which it opens) and saves. With no window open it is refused with "Open FormMorpheus first". Fields, all optional but one of them is needed:

- `lines`: a list of `{start, end, text}` in seconds.
- `srt`: the same lines as .srt or .vtt text; the form is told apart by its content.
- `mode`: `replace` (default) swaps every line for the new ones, `add` keeps the old ones and puts the new ones among them.
- `show`: true or false, whether the video shows subtitles.
- `from_voices`: true takes the lines from the AI voices already on the Timeline.
- `style`: any of `font`, `size` (2 to 15, a percent of the movie's height; 5 when unset), `position` (`top`, `middle` or `bottom`), `color` (`#rrggbb`) and `band` (true: a dark band behind the words; false: a dark outline instead).

Limits: 2000 lines, 500 characters a line, 400000 characters of `srt`. A refusal is one plain sentence; pass it to the person.

## After add_voice

Each AI voice's sound remembers its words and, for the built-in voice, its sentence timing. So the usual flow is:

1. Add every voice with `add_voice` (see `sub-skills/ai-voice`).
2. Call `set_subtitles {from_voices: true, show: true}` once. It places each sound's lines at the sound's place on the Timeline, through its start, trim and speed.
3. Check with `list_subtitles`. A voice app or an online voice gives no timing, so its lines are shared out over the sound by sentence length; adjust them with `lines` if the person wants it exact.

Running `from_voices` again replaces only the lines that came from voices; lines you wrote stay.

## Writing good lines

- At most about 42 characters a line; split longer sentences into two lines.
- Each line stays on screen 1 to 7 seconds.
- No overlap: the next `start` is the last `end` or later.
- Break at sentence ends and pauses, not mid-phrase.
- Plain text only; tags are stripped from .srt and .vtt.

## What an agent cannot do

An agent cannot listen to a recording or a sound file. The person does that in the Subtitles card: select the sound's block on the Timeline and press "Subtitles from this sound". It needs the built-in voice's runtime set up in the AI Voice card and a one-time download of the listening model, so tell the person that. If you have the words (a script, a transcript), send them as `lines` or `srt` instead.

## Working in the source

- The model: `Movie.subtitles` and its three types `SubtitleCue` (frames), `SubtitleStyle` and `Subtitles` in `frontend/src/engine/types.ts`.
- `frontend/src/engine/subtitles.ts`: pure operations and `drawSubtitles`, no DOM. The renderer calls `drawSubtitles` after each frame, for the Stage and every export.
- `frontend/src/io/subtitle-files.ts`: `parseSubtitles` and `writeSubtitles` for .srt and .vtt.
- `frontend/src/media/speech-pcm.ts`: a block's sound as a 16 kHz mono WAV for listening.
- `frontend/src/ui/subtitles-panel.ts`: the Subtitles card.
- The routes `/api/voice/transcribe` (`status`, `setup`, `job`, and a post of the WAV) are in `backend/app/routers/voice.py`; the listening itself is `backend/app/services/voice_transcribe.py`, run in the built-in voice's runtime so the engine never imports its packages.
- The tool side is `backend/app/routers/mcp.py`; the bridge kind is `set_subtitles` in `frontend/src/app/agent-bridge.ts`.
- Units: a cue in the movie is in frames with `end` not included; everything from a voice, a listening or a file (`TimedLine`, `VoiceCue`) is in seconds. `linesToCues` converts.
