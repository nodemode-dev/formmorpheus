"""The MCP server at /mcp (Streamable HTTP, stateless JSON, revision 2026-07-28 and 2025-11-25 clients), and the routes
the open window polls to carry out what the engine cannot do alone. The handler and the consent rules follow FormDeck
0.46.3's routers/mcp.py; the window queue follows FormVis 2.8.1's bridge."""
import asyncio
import base64
import json
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from app.core import config, window_key
from app.routers import characters, exports, fonts, jobs, library, trash, voice
from app.services import agent_access, bridge, claude_code, movies, voice_remote, voice_runtime
from app.services import ffmpeg as ff

router = APIRouter()
VERSIONS = ["2026-07-28", "2025-11-25"]
LEGACY = ["2025-06-18", "2025-03-26", "2024-11-05"]
SERVER = {"name": "formmorpheus", "title": "FormMorpheus", "version": config.VERSION}
CAPS = {"tools": {}}
LIST_CACHE = {"ttlMs": 60_000, "cacheScope": "private"}
MAX_BODY = 4 * 1024 * 1024
CONSENT_WAIT = 120.0
DECLINE_PAUSE = 120.0
EXPORT_WAIT = 600.0
IMPORT_WAIT = 120.0
VOICE_WAIT = 600.0
SUBTITLE_WAIT = 120.0
MAX_SUBTITLE_LINES = 2000
MAX_SUBTITLE_TEXT = 500
MAX_SRT = 400_000
LISTED_SUBTITLES = 500
MAX_IMPORT = 2 * 1024 * 1024 * 1024
EXPORT_FORMATS = ["mp4", "webm", "mov", "gif", "apng", "webp-anim", "png-frames", "jpg-frames", "webp-frames", "tiff-frames", "tga-frames", "bmp-frames",
                  "png-still", "psd", "prores-mov", "prores4444-mov", "hevc-mp4", "hevc-mov", "h264-mp4", "h264-mov"]
IMPORTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff", ".tga", ".heic", ".heif", ".svg",
           ".mp4", ".webm", ".mov", ".m4v", ".mkv", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".aif", ".aiff", ".caf",
           ".otf", ".ttf", ".ttc", ".woff", ".woff2", ".psd", ".psb", ".ora", ".kra"}
INSTRUCTIONS = ("FormMorpheus is an animation studio on this computer; its movies are .fmo files in the person's library folder. "
                "Start with get_context. list_movies, get_movie and get_movie_picture read; manage_movie creates, renames, duplicates, "
                "deletes (to Recently Deleted) and restores movies; list_characters reads the saved characters; list_voices reads the AI voices and "
                "whether each is ready; list_subtitles reads a movie's subtitles; export_movie, import_file, add_character, add_voice and set_subtitles are carried out by the open "
                "FormMorpheus window after the person agrees there. list_commands lists the other commands and run_command runs one. Changes need the "
                "person's yes: outside agents are off until they allow them in the window.")
NO_WINDOW = "Open FormMorpheus first: the FormMorpheus window does this ({what}), and none is open. Ask the person to open FormMorpheus, then retry."
CHOICE_WORDS = {"ask": "off until the person allows them (a change asks in the window when it is open)", "allowed": "allowed", "blocked": "blocked"}
OFF = ("Outside agents are off in FormMorpheus, so nothing was changed. Ask the person to open FormMorpheus and allow outside agents "
       "(the question in its window, or Preferences), then retry.")
BLOCKED = "The person has blocked agents in FormMorpheus, so nothing was done. They can change it in Preferences."
DECLINED = "The person did not allow this in FormMorpheus just now. Ask them first, then retry."


class ToolError(Exception):
    pass


class Agent:
    def __init__(self, name: str, inapp: bool) -> None:
        self.name = name
        self.inapp = inapp


SESSIONS: dict[str, str] = {}
_declined = [0.0]


def _tool(name: str, kind: str, description: str, props: dict, required: list[str] | None = None, destructive: bool = False) -> dict:
    return {"name": name, "description": description, "inputSchema": {"type": "object", "properties": props, "required": required or []},
            "annotations": {"readOnlyHint": kind == "reads", "destructiveHint": destructive, "openWorldHint": False}, "_kind": kind}


def _command(name: str, kind: str, description: str, props: dict, required: list[str] | None = None) -> dict:
    return {"id": name, "kind": kind, "description": description, "params": {"type": "object", "properties": props, "required": required or []}}


_S = {"type": "string"}
_INT = {"type": "integer"}
_MOVIE = {"type": "string", "description": "A movie's name, as list_movies gives it"}
_CHARACTER = {"type": "string", "description": "A saved character's name, as list_characters gives it"}
TOOLS = [
    _tool("get_context", "reads", "Reads what FormMorpheus is and how it stands: the version, the library folder, whether the window is open, "
          "whether outside agents are allowed, and whether ffmpeg is found and which encoders it has.", {}),
    _tool("list_movies", "reads", "Reads the movie library: each movie's name, last change, file size, tags and stack. query narrows by words in the name.",
          {"query": _S, "stack": {"type": "string", "description": "Only the movies in this stack"}}),
    _tool("get_movie", "reads", "Reads one movie's metadata from its file without loading its media: size, frame rate, length, tracks with their content, "
          "counts by kind, assets, and whether it has a poster, a preview and saved history.", {"movie": _MOVIE}, ["movie"]),
    _tool("get_movie_picture", "reads", "Reads a movie's poster, and its preview frame when the file carries one, as PNG pictures.",
          {"movie": _MOVIE, "which": {"type": "string", "enum": ["poster", "preview", "both"], "description": "Default both"}}, ["movie"]),
    _tool("list_characters", "reads", "Reads the saved characters (the Characters library): each character's name, last change and file size. "
          "query narrows by words in the name.", {"query": _S}),
    _tool("manage_movie", "changes", "Changes the library: create makes an empty movie (name, width, height, fps, seconds), rename gives a movie a new name (to), "
          "duplicate copies it, delete moves it to Recently Deleted (it is never erased here), restore brings a deleted movie back (movie is its name or "
          "the id list_deleted gives). The first change asks the person in the FormMorpheus window unless they allowed outside agents.",
          {"action": {"type": "string", "enum": ["create", "rename", "duplicate", "delete", "restore"]}, "movie": _MOVIE,
           "to": {"type": "string", "description": "rename: the new name"}, "name": {"type": "string", "description": "create: the new movie's name"},
           "width": {"type": "integer", "minimum": 16, "maximum": 3840}, "height": {"type": "integer", "minimum": 16, "maximum": 3840},
           "fps": {"type": "number", "minimum": 1, "maximum": 120}, "seconds": {"type": "number", "minimum": 0.05, "maximum": 3600}},
          ["action"], destructive=True),
    _tool("export_movie", "asks", "Asks first: the person approves in the FormMorpheus window, which then renders the movie and writes the file to the app's "
          "Exports folder. Formats the browser cannot encode go through the person's ffmpeg (get_context says which it has). from and to are movie "
          "frames, to not included; size, range, quality and sound default to the movie's own. Waits up to 2 minutes for the answer and 10 minutes for the export.",
          {"movie": _MOVIE, "format": {"type": "string", "enum": EXPORT_FORMATS}, "width": _INT, "height": _INT, "from": _INT, "to": _INT,
           "quality": {"type": "string", "enum": ["low", "medium", "high", "very-high"]}, "audio": {"type": "boolean"},
           "name": {"type": "string", "description": "The file's name without its extension (default the movie's)"}},
          ["movie", "format"]),
    _tool("import_file", "asks", "Asks first: the person approves in the FormMorpheus window, which then imports a picture, video, sound or font file into "
          "a movie and saves it. path is absolute and must be inside the library folder (get_context gives it). at is the movie frame to place it at. "
          "Waits up to 2 minutes for the answer and 2 minutes for the import.",
          {"path": _S, "movie": _MOVIE, "at": {"type": "integer", "minimum": 0}, "track": {"type": "string", "description": "A track's name (default the top track when it has room there, else a new track)"}},
          ["path", "movie"]),
    _tool("add_character", "asks", "Asks first: the person approves in the FormMorpheus window, which then adds a saved character to the movie open "
          "there (or to movie, which it opens) at the playhead, as one group with its own copy of every part, and saves the movie. character is a name "
          "from list_characters; at is the movie frame to place it at instead of the playhead. Waits up to 2 minutes for the answer and 2 minutes for the work.",
          {"character": _CHARACTER, "movie": {"type": "string", "description": "A movie's name, as list_movies gives it (default the movie open in the window)"},
           "at": {"type": "integer", "minimum": 0}},
          ["character"]),
    _tool("list_voices", "reads", "Reads the AI voices: for each engine (builtin, the built-in voice; local, a voice app on this computer; online, an online voice "
          "with the person's own key) whether it is ready, why not when it is not, and its voices when it is. engine narrows to one.",
          {"engine": {"type": "string", "enum": ["builtin", "local", "online"], "description": "Default all three"}}),
    _tool("add_voice", "asks", "Asks first: the person approves in the FormMorpheus window, which then speaks text with an AI voice, places the sound on "
          "the Timeline of the movie open there (or of movie, which it opens) at the playhead, and saves the movie. engine is builtin (default), local or "
          "online; voice is an id from list_voices; language (the built-in voice, default en-us) and speed (0.5 to 2, not online) shape the speech; model "
          "picks the local or online model; at is the movie frame to place it at instead of the playhead. text is at most 10000 characters, 2000 online, "
          "and online sends it to the online service. Waits up to 2 minutes for the answer and 10 minutes for the work.",
          {"text": {"type": "string", "maxLength": 10000, "description": "The words to speak"}, "engine": {"type": "string", "enum": ["builtin", "local", "online"]},
           "voice": {"type": "string", "description": "A voice's id, as list_voices gives it (default the engine's own)"},
           "language": {"type": "string", "description": "The built-in voice's language, as list_voices gives it (default en-us)"},
           "speed": {"type": "number", "minimum": 0.5, "maximum": 2}, "model": _S,
           "movie": {"type": "string", "description": "A movie's name, as list_movies gives it (default the movie open in the window)"},
           "at": {"type": "integer", "minimum": 0}},
          ["text"]),
    _tool("list_subtitles", "reads", "Reads a movie's subtitles from its file without the window: whether the video shows them, their look (font, size as a percent "
          "of the movie's height, position, color, band behind the words) and each line with its id, start and end in seconds and in movie frames "
          "(end not included), and its text. At most 500 lines, with a count of the rest.", {"movie": _MOVIE}, ["movie"]),
    _tool("set_subtitles", "asks", "Asks first: the person approves in the FormMorpheus window, which then changes the subtitles of the movie open there "
          "(or of movie, which it opens) and saves the movie. lines (start and end in seconds) or srt (the text of a .srt or .vtt file) give the lines; mode "
          "replace (default) puts them in place of every line, add keeps the others. from_voices makes lines from every sound an AI voice spoke. show "
          "turns them on or off in the video; style sets their look. Give at least one of lines, srt, show, from_voices or style. At most 2000 lines. "
          "Waits up to 2 minutes for the answer and 2 minutes for the work.",
          {"movie": {"type": "string", "description": "A movie's name, as list_movies gives it (default the movie open in the window)"},
           "lines": {"type": "array", "maxItems": MAX_SUBTITLE_LINES, "items": {"type": "object", "properties": {
               "start": {"type": "number", "minimum": 0, "description": "Seconds"}, "end": {"type": "number", "description": "Seconds, after start"},
               "text": {"type": "string", "maxLength": 500}}, "required": ["start", "end", "text"]}},
           "srt": {"type": "string", "maxLength": MAX_SRT, "description": "The text of a .srt or .vtt file, instead of lines"},
           "mode": {"type": "string", "enum": ["replace", "add"], "description": "Default replace"},
           "show": {"type": "boolean", "description": "Show the subtitles in the video and in every export"},
           "from_voices": {"type": "boolean", "description": "Make lines from every sound an AI voice spoke"},
           "style": {"type": "object", "properties": {"font": {"type": "string", "description": "A font family, as list_fonts or the Text card names it"},
                     "size": {"type": "number", "minimum": 2, "maximum": 15, "description": "Percent of the movie's height"},
                     "position": {"type": "string", "enum": ["top", "middle", "bottom"]}, "color": {"type": "string", "description": "#rrggbb"},
                     "band": {"type": "boolean", "description": "A dark band behind the words"}}}}),
    _tool("list_commands", "reads", "Reads the commands that are not tools: id, class (reads, changes the library) and what each does; id returns one with its parameters.",
          {"id": _S}),
    _tool("run_command", "changes", "Changes the library or reads, as the command's class says: runs one command from list_commands with its params. "
          "A command that changes the library asks the person first unless they allowed outside agents.",
          {"id": _S, "params": {"type": "object"}}, ["id"], destructive=True),
]
COMMANDS = [
    _command("list_deleted", "reads", "Reads Recently Deleted: each item's id, name, kind (movie, character or export), when it was deleted and the days left before it goes.", {}),
    _command("list_exports", "reads", "Reads the Exports folder: each file's name, kind, size and last change.", {}),
    _command("list_stacks", "reads", "Reads the stacks of the library and the movies in each.", {}),
    _command("export_capabilities", "reads", "Reads what the person's ffmpeg can encode for the engine's export jobs: H.264, ProRes, ProRes 4444 and HEVC, each with the reason when it cannot.", {}),
    _command("list_fonts", "reads", "Reads the fonts added to FormMorpheus: file name and family.", {}),
    _command("set_tags", "changes", "Changes the library: sets a movie's tags (at most 12, each at most 32 characters); an empty list removes them.",
             {"movie": _MOVIE, "tags": {"type": "array", "items": _S}}, ["movie", "tags"]),
    _command("set_stack", "changes", "Changes the library: puts a movie into a stack (made when it does not exist yet), or takes it out with an empty stack.",
             {"movie": _MOVIE, "stack": _S}, ["movie", "stack"]),
]
NAMES = {t["name"]: t for t in TOOLS}
CMDS = {c["id"]: c for c in COMMANDS}
LISTED = [{k: v for k, v in t.items() if k != "_kind"} for t in TOOLS]


def _ok(text: str, data: dict | None = None, extra: list | None = None) -> dict:
    out = {"content": [{"type": "text", "text": text}, *(extra or [])]}
    if data is not None:
        out["structuredContent"] = data
    return out


def _fail(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": True}


def _inside(path: Path, folder: Path) -> bool:
    try:
        real, root = path.resolve(), folder.resolve()
    except OSError:
        return False
    return real == root or root in real.parents


def _movie(raw) -> Path:
    name = str(raw or "").strip()
    if not name:
        raise ToolError("Give movie, a movie's name from list_movies.")
    try:
        stem = library.clean_name(name)
    except HTTPException:
        raise ToolError(f"{name} cannot be a movie's name.") from None
    found = library.find_movie(stem)
    if found is None or not _inside(found, config.library_dir()):
        raise ToolError(f"There is no movie named {stem} in the library. list_movies gives the names.")
    return found


def _character(raw) -> Path:
    name = str(raw or "").strip()
    if not name:
        raise ToolError("Give character, a saved character's name from list_characters.")
    try:
        path = characters.character_path(name)
    except HTTPException:
        raise ToolError(f"{name} cannot be a character's name.") from None
    if not path.is_file():
        raise ToolError(f"There is no saved character named {path.stem}. list_characters gives the names.")
    return path


def _when(t: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(t))


def _size(n: int) -> str:
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{max(1, n // 1024)} KB"


async def _gate(a: Agent, kind: str, what: str) -> str | None:
    choice = agent_access.choice()
    if choice == "blocked":
        return BLOCKED
    if kind == "reads":
        return None
    live = bridge.live()
    if kind == "asks" and not live:
        return NO_WINDOW.format(what=what)
    if kind == "changes" and (a.inapp or choice == "allowed"):
        return None
    if not live:
        return OFF
    if time.monotonic() < _declined[0]:
        return DECLINED
    offers = ["deny", "once"] if kind == "asks" else ["deny", "once", "always"]
    said = await bridge.ask("" if a.inapp else a.name, what, offers, CONSENT_WAIT)
    if said is None:
        return f"Nobody answered in the FormMorpheus window within {int(CONSENT_WAIT // 60)} minutes, so nothing was done. Ask the person to answer there, then retry."
    if said == "deny":
        _declined[0] = time.monotonic() + DECLINE_PAUSE
        return "The person said no in the FormMorpheus window, so nothing was done."
    if said == "always" and kind == "changes":
        agent_access.set_choice("allowed")
    return None


async def _window(a: Agent, kind: str, payload: dict, what: str, wait: float, file: str | None = None) -> dict:
    refused = await _gate(a, "asks", what)
    if refused:
        raise ToolError(refused)
    if not bridge.live():
        raise ToolError(NO_WINDOW.format(what=what))
    out = await bridge.call(kind, payload, wait, file)
    if out is None:
        raise ToolError(f"The FormMorpheus window did not finish within {int(wait // 60)} minutes, so the request was dropped. Check the window, then retry.")
    if not out.get("ok"):
        raise ToolError(str(out.get("error") or "The FormMorpheus window could not do it."))
    return out


async def t_get_context(a: Agent, args: dict) -> dict:
    info = await asyncio.to_thread(ff.probe)
    access = agent_access.state()
    count = len(await asyncio.to_thread(lambda: library.list_projects()["items"]))
    data = {"app": "FormMorpheus", "version": config.VERSION, "library": str(config.library_dir()), "exports": str(config.exports_dir()), "movies": count,
            "window": bridge.live(), "outsideAgents": access["choice"], "inApp": a.inapp, "client": a.name,
            "ffmpeg": {"found": info is not None, "version": info.version if info else "", "encoders": info.encoders if info else []}}
    lines = [f"FormMorpheus {config.VERSION}, an animation studio. Movies are .fmo files.",
             f"Library: {data['library']} ({count} movie{'s' if count != 1 else ''}). Exports go to {data['exports']}.",
             "Window: open." if data["window"] else "Window: not open (export_movie and import_file need it).",
             f"Outside agents: {CHOICE_WORDS[access['choice']]}" + ("; you are the window's own agent tab." if a.inapp else "."),
             f"ffmpeg {info.version}: {', '.join(info.encoders) or 'none of the encoders the engine uses'}." if info else "ffmpeg: not found, so ProRes, HEVC and engine H.264 exports are not available."]
    return _ok("\n".join(lines), data)


async def t_list_movies(a: Agent, args: dict) -> dict:
    items = (await asyncio.to_thread(library.list_projects))["items"]
    tags = await asyncio.to_thread(library._tags_read)
    words = str(args.get("query") or "").lower().split()
    stack = str(args.get("stack") or "").strip()
    rows = []
    for e in items:
        if words and not all(w in e["name"].lower() for w in words):
            continue
        if stack and e.get("stack") != stack:
            continue
        rows.append({"name": e["name"], "modified": e["modified"], "size": e["size"], "tags": tags.get(e["name"], []), **({"stack": e["stack"]} if e.get("stack") else {})})
    lines = [f"{r['name']} · {_when(r['modified'])} · {_size(r['size'])}" + (f" · tags {', '.join(r['tags'])}" if r["tags"] else "") + (f" · stack {r['stack']}" if r.get("stack") else "") for r in rows]
    return _ok(f"{len(rows)} movie{'s' if len(rows) != 1 else ''}" + (":\n" + "\n".join(lines) if lines else "."), {"movies": rows})


async def t_list_characters(a: Agent, args: dict) -> dict:
    items = (await asyncio.to_thread(characters.list_characters))["items"]
    words = str(args.get("query") or "").lower().split()
    rows = [{"name": e["name"], "modified": e["modified"], "size": e["size"]} for e in items if not words or all(w in e["name"].lower() for w in words)]
    lines = [f"{r['name']} · {_when(r['modified'])} · {_size(r['size'])}" for r in rows]
    return _ok(f"{len(rows)} character{'s' if len(rows) != 1 else ''}" + (":\n" + "\n".join(lines) if lines else "."), {"characters": rows})


def _track_lines(tracks: list, depth: int = 0) -> list[str]:
    out = []
    for t in tracks:
        out.append(f"{'  ' * depth}{t['name']}{' (hidden)' if t['hidden'] else ''}: {t['content']} item{'s' if t['content'] != 1 else ''}")
        for c in t["items"]:
            out.append(f"{'  ' * depth}  {c['name']} · {c['kind']} · frames {c['start']} to {c['start'] + c['duration']}")
            if c.get("tracks"):
                out.extend(_track_lines(c["tracks"], depth + 2))
    return out


async def t_get_movie(a: Agent, args: dict) -> dict:
    path = _movie(args.get("movie"))
    try:
        meta = await asyncio.to_thread(movies.read_meta, path)
    except movies.NotAMovie as exc:
        raise ToolError(str(exc)) from None
    c, f = meta["counts"], meta["file"]
    lines = [f"{meta['name']}: {meta['width']} x {meta['height']}, {meta['fps']:g} fps, {meta['frames']} frames ({meta['seconds']:g} s), playback {meta['playback']}.",
             f"{c['tracks']} track{'s' if c['tracks'] != 1 else ''}, {c['content']} item{'s' if c['content'] != 1 else ''}"
             + (f" ({', '.join(f'{v} {k}' for k, v in c['byKind'].items())})" if c["byKind"] else "") + f", {c['assets']} asset{'s' if c['assets'] != 1 else ''}.",
             f"File: {_size(f['size'])}, changed {_when(f['modified'])}; poster {'yes' if f['poster'] else 'no'}, preview {'yes' if f['preview'] else 'no'}, history {'yes' if f['history'] else 'no'}."]
    return _ok("\n".join(lines + _track_lines(meta["tracks"])), meta)


async def t_get_movie_picture(a: Agent, args: dict) -> dict:
    path = _movie(args.get("movie"))
    which = args.get("which") or "both"
    if which not in ("poster", "preview", "both"):
        raise ToolError("which is poster, preview or both.")
    wanted = ["poster", "preview"] if which == "both" else [which]
    images, found = [], []
    for member in wanted:
        data = await asyncio.to_thread(movies.picture, path, f"{member}.png")
        if data:
            images.append({"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": "image/png"})
            found.append(member)
    if not images:
        return _ok(f"{path.stem} has no {' or '.join(wanted)} picture in its file. The window writes the poster when it saves the movie.", {"pictures": []})
    return _ok(f"{path.stem}: {' and '.join(found)}.", {"pictures": found}, images)


def _create(args: dict) -> dict:
    stem = library.clean_name(str(args.get("name") or args.get("movie") or "Untitled Movie"))
    for _ in range(100):
        dst = library.unique_path(stem)
        data = movies.empty_movie(dst.stem, int(args.get("width") or 1920), int(args.get("height") or 1080), float(args.get("fps") or 24), float(args.get("seconds") or 10))
        tmp = dst.with_name(f".{dst.name}.{uuid.uuid4().hex[:8]}.part")
        try:
            tmp.write_bytes(data)
            library._publish(tmp, dst)
            return library.entry(dst)
        except FileExistsError:
            continue
        finally:
            tmp.unlink(missing_ok=True)
    raise ToolError("No free name for the new movie.")


def _restore(raw) -> dict:
    key = str(raw or "").strip()
    if not key:
        raise ToolError("Give movie: the deleted movie's name, or its id from list_deleted.")
    items = trash.list_trash()["items"]
    hit = next((i for i in items if i["id"] == key), None) or next((i for i in items if i["kind"] == "movie" and i["name"] == key), None)
    if hit is None:
        raise ToolError(f"Nothing named {key} is in Recently Deleted. run_command list_deleted shows what is there.")
    return trash.restore(hit["id"])


def _what(action: str, args: dict) -> str:
    movie = str(args.get("movie") or "").strip()
    return {"create": f"create the empty movie {str(args.get('name') or movie or 'Untitled Movie').strip()}", "rename": f"rename the movie {movie} to {str(args.get('to') or '').strip()}",
            "duplicate": f"duplicate the movie {movie}", "delete": f"delete the movie {movie} (it goes to Recently Deleted)",
            "restore": f"restore {movie} from Recently Deleted"}.get(action, "change the movie library")


async def t_manage_movie(a: Agent, args: dict) -> dict:
    action = str(args.get("action") or "")
    if action not in ("create", "rename", "duplicate", "delete", "restore"):
        raise ToolError("action is create, rename, duplicate, delete or restore.")
    if action in ("rename", "duplicate", "delete"):
        stem = _movie(args.get("movie")).stem
    if action == "rename" and not str(args.get("to") or "").strip():
        raise ToolError("rename needs to, the new name.")
    refused = await _gate(a, "changes", _what(action, args))
    if refused:
        raise ToolError(refused)
    if action == "create":
        e = await asyncio.to_thread(_create, args)
        return _ok(f"Created the empty movie {e['name']} in the library.", {"movie": e["name"], "size": e["size"], "modified": e["modified"]})
    if action == "rename":
        e = await asyncio.to_thread(library.rename_project, stem, library.RenameBody(to=str(args["to"]).strip()))
        return _ok(f"Renamed {stem} to {e['name']}.", {"movie": e["name"], "was": stem})
    if action == "duplicate":
        e = await asyncio.to_thread(library.duplicate_project, stem)
        return _ok(f"Duplicated {stem} as {e['name']}.", {"movie": e["name"], "from": stem})
    if action == "delete":
        out = await asyncio.to_thread(library.delete_project, stem)
        item = Path(out["kept"]).name
        return _ok(f"Moved {stem} to Recently Deleted (id {item}); restore brings it back.", {"deleted": stem, "id": item})
    out = await asyncio.to_thread(_restore, args.get("movie"))
    name = out["restored"][: -len(config.PROJECT_EXT)] if out["restored"].endswith(config.PROJECT_EXT) else out["restored"]
    where = {"movie": "to the library.", "character": "to Characters."}.get(out["kind"], "to the Exports folder.")
    return _ok(f"Restored {name} {where}", {"restored": name, "kind": out["kind"]})


async def t_export_movie(a: Agent, args: dict) -> dict:
    path = _movie(args.get("movie"))
    fmt = str(args.get("format") or "")
    if fmt not in EXPORT_FORMATS:
        raise ToolError(f"format is one of {', '.join(EXPORT_FORMATS)}.")
    payload = {"movie": path.stem, "format": fmt}
    for key, kind in (("width", int), ("height", int), ("from", int), ("to", int), ("quality", str), ("audio", bool), ("name", str)):
        if args.get(key) is not None:
            payload[key] = kind(args[key])
    if "name" in payload:
        try:
            payload["name"] = exports.clean_name(payload["name"])
        except HTTPException:
            raise ToolError(f"{payload['name']} cannot be a file name.") from None
    out = await _window(a, "export_movie", payload, f"export the movie {path.stem} as {fmt}", EXPORT_WAIT)
    try:
        written = exports.export_path(str(out.get("file") or ""))
    except HTTPException:
        raise ToolError("The window reported an export with a file name the Exports folder cannot hold.") from None
    if not written.is_file():
        raise ToolError("The window reported the export as done, but its file is not in the Exports folder.")
    size = written.stat().st_size
    warnings = [str(w) for w in out.get("warnings") or [] if isinstance(w, str)]
    return _ok(f"Exported {path.stem} as {fmt} to {written} ({_size(size)})." + "".join(f"\n{w}" for w in warnings),
               {"path": str(written), "file": written.name, "size": size, "warnings": warnings})


async def t_import_file(a: Agent, args: dict) -> dict:
    raw = str(args.get("path") or "").strip()
    src = Path(raw).expanduser()
    if not raw or not src.is_absolute():
        raise ToolError(f"Give path as an absolute path inside the library folder ({config.library_dir()}).")
    if not _inside(src, config.library_dir()):
        raise ToolError(f"{src} is outside the library folder ({config.library_dir()}); agents may import only files inside it. Copy the file there first.")
    src = src.resolve()
    if not src.is_file():
        raise ToolError(f"There is no file at {src}.")
    if src.suffix.lower() not in IMPORTS:
        raise ToolError(f"FormMorpheus does not import {src.suffix or 'files without an extension'} files this way.")
    if src.stat().st_size > MAX_IMPORT:
        raise ToolError("That file is over 2 GB.")
    movie = _movie(args.get("movie"))
    payload = {"movie": movie.stem, "file": src.name, "size": src.stat().st_size}
    if args.get("at") is not None:
        payload["at"] = max(0, int(args["at"]))
    if args.get("track"):
        payload["track"] = str(args["track"])[:120]
    out = await _window(a, "import_file", payload, f"import the file {src.name} into the movie {movie.stem}", IMPORT_WAIT, str(src))
    added = str(out.get("content") or src.name)
    return _ok(f"Imported {src.name} into {movie.stem} as {added}" + (", and the movie was saved." if out.get("saved") else "; the movie is not saved yet."),
               {"movie": movie.stem, "content": added, "kind": out.get("kind"), "saved": bool(out.get("saved"))})


async def t_add_character(a: Agent, args: dict) -> dict:
    stem = _character(args.get("character")).stem
    payload = {"character": stem}
    movie = str(args.get("movie") or "").strip()
    if movie:
        payload["movie"] = _movie(movie).stem
    if args.get("at") is not None:
        payload["at"] = max(0, int(args["at"]))
    where = f"the movie {payload['movie']}" if movie else "the movie open in the window"
    out = await _window(a, "add_character", payload, f"add the character {stem} to {where}", IMPORT_WAIT)
    added = str(out.get("content") or stem)
    into = str(out.get("movie") or payload.get("movie") or "")
    return _ok(f"Added the character {stem} as {added}" + (f" in {into}" if into else "") + (", and the movie was saved." if out.get("saved") else "; the movie is not saved yet."),
               {"character": stem, "movie": into or None, "content": added, "saved": bool(out.get("saved"))})


VOICE_WORDS = {"builtin": "the built-in voice", "local": "the voice app on this computer", "online": "the online voice"}
ONLINE_TEXT = 2000
MAX_VOICES = 100


def _voice_state(engine: str, listing: bool) -> dict:
    """Whether one engine can speak now and, when listing, its voices. Blocks: the local probe and the online list go out."""
    if engine == "builtin":
        st = voice_runtime.status()
        if not st.get("ready"):
            busy = (st.get("job") or {}).get("state") == "running"
            return {"engine": engine, "ready": False, "reason": "The built-in voice is being set up in FormMorpheus right now. Retry when the setup has finished." if busy
                    else "The built-in voice is not set up yet. The person sets it up once in FormMorpheus, in the AI Voice card on its Offline tab."}
        if not listing:
            return {"engine": engine, "ready": True}
        try:
            rows = voice_runtime.voices()
        except voice_runtime.VoiceError as exc:
            return {"engine": engine, "ready": False, "reason": str(exc)}
        return {"engine": engine, "ready": True, "voices": [{"id": v.get("id"), "name": v.get("name"), "language": v.get("language"), "group": v.get("group")} for v in rows]}
    if engine == "local":
        base = str(voice_remote.local_settings().get("base") or "")
        try:
            probe = voice_remote.probe_local(base)
        except voice_remote.VoiceError as exc:
            probe = {"ok": False, "error": str(exc)}
        if not probe.get("ok"):
            why = str(probe.get("error") or "").strip().rstrip(".")
            return {"engine": engine, "ready": False, "base": base, "reason": f"The voice app on this computer at {base or 'no address'} is not ready. {why or 'It did not answer'}. "
                    "The person starts it, or sets its address in the AI Voice card (Offline tab, Voice app on this computer)."}
        found = {"engine": engine, "ready": True, "base": base}
        if not listing:
            return found
        return {**found, "models": [str(m) for m in probe.get("models") or []], "voices": [{"id": v.get("id"), "name": v.get("name")} for v in probe.get("voices") or []]}
    if not voice_remote.online_status().get("hasKey"):
        return {"engine": engine, "ready": False, "reason": "There is no online voice key in FormMorpheus. The person adds their own key in the AI Voice card, on its Online tab."}
    if not listing:
        return {"engine": engine, "ready": True}
    try:
        rows = voice_remote.online_voices()
    except voice_remote.VoiceError as exc:
        return {"engine": engine, "ready": False, "reason": str(exc)}
    return {"engine": engine, "ready": True, "voices": [{"id": v.get("id"), "name": v.get("name")} for v in rows[:MAX_VOICES]], "more": max(0, len(rows) - MAX_VOICES)}


def _voice_lines(s: dict) -> list[str]:
    title = {"builtin": "Built-in voice", "local": "Voice app on this computer" + (f" at {s.get('base')}" if s["ready"] else ""), "online": "Online voice"}[s["engine"]]
    if not s["ready"]:
        return [f"{title}: not ready. {s['reason']}"]
    voices = s.get("voices") or []
    more = f" (the first {MAX_VOICES}; {s['more']} more)" if s.get("more") else ""
    if not voices:
        head = f"{title}: ready; it gives no list of voices, so voice is any name it knows." if s["engine"] == "local" else f"{title}: ready, no voices."
    else:
        head = f"{title}: ready, {len(voices)} voice{'s' if len(voices) != 1 else ''}{more}:"
    lines = [head] + ([f"  models: {', '.join(s['models'])}"] if s.get("models") else [])
    return lines + [f"  {v['id']} · {v['name']}" + (f" · {v['group']}" if v.get("group") else "") for v in voices]


async def t_list_voices(a: Agent, args: dict) -> dict:
    engine = str(args.get("engine") or "").strip()
    if engine and engine not in voice.ENGINES:
        raise ToolError("engine is builtin, local or online.")
    states = [await asyncio.to_thread(_voice_state, e, True) for e in ([engine] if engine else voice.ENGINES)]
    return _ok("\n".join(line for s in states for line in _voice_lines(s)), {"engines": states})


async def t_add_voice(a: Agent, args: dict) -> dict:
    engine = str(args.get("engine") or "builtin").strip()
    if engine not in voice.ENGINES:
        raise ToolError("engine is builtin, local or online.")
    words = str(args.get("text") or "").strip()
    if not words:
        raise ToolError("Give text, the words the voice speaks.")
    limit = ONLINE_TEXT if engine == "online" else voice.MAX_TEXT
    if len(words) > limit:
        raise ToolError(f"text is at most {limit} characters" + (" for the online voice." if engine == "online" else "."))
    payload = {"text": words, "engine": engine}
    for key in ("voice", "language", "model"):
        if args.get(key) is not None:
            if not isinstance(args[key], str):
                raise ToolError(f"{key} is a name, as list_voices gives it.")
            if args[key].strip():
                payload[key] = args[key].strip()[:120]
    if args.get("speed") is not None:
        try:
            speed = float(args["speed"])
        except (TypeError, ValueError):
            speed = 0.0
        if not 0.5 <= speed <= 2:
            raise ToolError("speed is a number from 0.5 to 2 (1 is the voice's own pace).")
        payload["speed"] = speed
    movie = str(args.get("movie") or "").strip()
    if movie:
        payload["movie"] = _movie(movie).stem
    if args.get("at") is not None:
        payload["at"] = max(0, int(args["at"]))
    state = await asyncio.to_thread(_voice_state, engine, False)
    if not state["ready"]:
        raise ToolError(f"Nothing was added. {state['reason']}")
    flat = " ".join(words.split())
    said = flat if len(flat) <= 60 else flat[:57].rstrip() + "..."
    where = f"the movie {payload['movie']}" if movie else "the movie open in the window"
    out = await _window(a, "add_voice", payload, f'speak "{said}" with {VOICE_WORDS[engine]} and add the sound to {where}', VOICE_WAIT)
    name = str(out.get("content") or "")
    try:
        seconds = round(float(out.get("seconds") or 0), 2)
    except (TypeError, ValueError):
        seconds = 0.0
    into = str(out.get("movie") or payload.get("movie") or "")
    return _ok(f"Added the spoken sound {name} ({seconds:.1f} s)" + (f" to {into}" if into else "") + (", and the movie was saved." if out.get("saved") else "; the movie is not saved yet."),
               {"sound": name, "seconds": seconds, "movie": into or None, "engine": engine, "saved": bool(out.get("saved"))})


def _seconds(v) -> float | None:
    # abs() < 1e9 also turns away NaN and the infinities json.loads lets through.
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e9 else None


async def t_list_subtitles(a: Agent, args: dict) -> dict:
    path = _movie(args.get("movie"))
    try:
        found = await asyncio.to_thread(movies.read_subtitles, path)
    except movies.NotAMovie as exc:
        raise ToolError(str(exc)) from None
    subs, fps = found["subtitles"], found["fps"]
    if subs is None:
        return _ok(f"{path.stem} has no subtitles.", {"movie": path.stem, "subtitles": None})
    st, cues = subs["style"], subs["cues"]
    rows = [{**c, "startSeconds": round(c["start"] / fps, 3), "endSeconds": round(c["end"] / fps, 3)} for c in cues[:LISTED_SUBTITLES]]
    more = max(0, len(cues) - LISTED_SUBTITLES)
    lines = [f"{path.stem}: {len(cues)} subtitle line{'s' if len(cues) != 1 else ''}; the video {'shows' if subs['show'] else 'does not show'} them.",
             f"Look: font {st['font']}, size {st['size']:g} percent of the height, {st['position']}, color {st['color']}, band {'on' if st['band'] else 'off'}."]
    lines += [f"{r['id']} · {r['startSeconds']:.3f} s to {r['endSeconds']:.3f} s (frames {r['start']} to {r['end']}) · {r['text']}" for r in rows]
    if more:
        lines.append(f"The first {LISTED_SUBTITLES} lines are shown; {more} more.")
    return _ok("\n".join(lines), {"movie": path.stem, "fps": fps, "show": subs["show"], "style": st, "count": len(cues), "lines": rows, "more": more})


def _subtitle_style(raw) -> dict:
    if not isinstance(raw, dict):
        raise ToolError("style is an object with any of font, size, position, color and band.")
    out = {}
    if raw.get("font") is not None:
        if not isinstance(raw["font"], str) or not raw["font"].strip() or len(raw["font"].strip()) > 120:
            raise ToolError("style.font is a font family's name, as list_fonts or the Text card gives it.")
        out["font"] = raw["font"].strip()
    if raw.get("size") is not None:
        size = _seconds(raw["size"])
        if size is None or not 2 <= size <= 15:
            raise ToolError("style.size is a number from 2 to 15, a percent of the movie's height.")
        out["size"] = size
    if raw.get("position") is not None:
        if raw["position"] not in ("top", "middle", "bottom"):
            raise ToolError("style.position is top, middle or bottom.")
        out["position"] = raw["position"]
    if raw.get("color") is not None:
        color = raw["color"]
        if not isinstance(color, str) or len(color) != 7 or color[0] != "#" or any(ch not in "0123456789abcdefABCDEF" for ch in color[1:]):
            raise ToolError("style.color is a color as #rrggbb.")
        out["color"] = color.lower()
    if raw.get("band") is not None:
        if not isinstance(raw["band"], bool):
            raise ToolError("style.band is true or false.")
        out["band"] = raw["band"]
    if not out:
        raise ToolError("style gives at least one of font, size, position, color or band.")
    return out


def _subtitle_lines(raw) -> list[dict]:
    if not isinstance(raw, list):
        raise ToolError("lines is a list of {start, end, text}, start and end in seconds.")
    if len(raw) > MAX_SUBTITLE_LINES:
        raise ToolError(f"lines holds at most {MAX_SUBTITLE_LINES} lines.")
    out = []
    for i, line in enumerate(raw, 1):
        if not isinstance(line, dict):
            raise ToolError(f"Line {i} is not an object with start, end and text.")
        start, end = _seconds(line.get("start")), _seconds(line.get("end"))
        if start is None or end is None or not end > start >= 0:
            raise ToolError(f"Line {i}: start and end are numbers of seconds, start at 0 or later and end after start.")
        words = line.get("text")
        if not isinstance(words, str) or not words.strip():
            raise ToolError(f"Line {i} has no text.")
        if len(words) > MAX_SUBTITLE_TEXT:
            raise ToolError(f"Line {i}: text is at most {MAX_SUBTITLE_TEXT} characters.")
        out.append({"start": round(start, 3), "end": round(end, 3), "text": words.strip()})
    return out


async def t_set_subtitles(a: Agent, args: dict) -> dict:
    if not any(args.get(k) is not None for k in ("lines", "srt", "show", "from_voices", "style")):
        raise ToolError("Give at least one of lines, srt, show, from_voices or style.")
    if args.get("lines") is not None and args.get("srt") is not None:
        raise ToolError("Give lines or srt, not both.")
    mode = args.get("mode") if args.get("mode") is not None else "replace"
    if mode not in ("replace", "add"):
        raise ToolError("mode is replace or add.")
    payload: dict = {"mode": mode}
    doing = []
    if args.get("lines") is not None:
        payload["lines"] = _subtitle_lines(args["lines"])
        n = len(payload["lines"])
        doing.append(f"{'put' if mode == 'replace' else 'add'} {n} line{'s' if n != 1 else ''}" + (" in place of its lines" if mode == "replace" else ""))
    if args.get("srt") is not None:
        if not isinstance(args["srt"], str) or not args["srt"].strip() or len(args["srt"]) > MAX_SRT:
            raise ToolError(f"srt is the text of a .srt or .vtt file, at most {MAX_SRT} characters.")
        payload["srt"] = args["srt"]
        doing.append("put the lines of a subtitle file in place of its lines" if mode == "replace" else "add the lines of a subtitle file")
    for key in ("show", "from_voices"):
        if args.get(key) is not None:
            if not isinstance(args[key], bool):
                raise ToolError(f"{key} is true or false.")
            payload[key] = args[key]
    if payload.get("from_voices"):
        doing.insert(0, "make lines from its AI voices")
    if args.get("style") is not None:
        payload["style"] = _subtitle_style(args["style"])
        doing.append("set their look")
    if "show" in payload:
        doing.append("show them in the video" if payload["show"] else "hide them in the video")
    if not doing:
        raise ToolError("Give at least one of lines, srt, show, from_voices or style.")
    movie = str(args.get("movie") or "").strip()
    if movie:
        payload["movie"] = _movie(movie).stem
    where = f"the movie {payload['movie']}" if movie else "the movie open in the window"
    out = await _window(a, "set_subtitles", payload, f"change the subtitles of {where}: {', '.join(doing)}", SUBTITLE_WAIT)
    try:
        count = max(0, int(out.get("lines") or 0))
    except (TypeError, ValueError):
        count = 0
    shown = bool(out.get("show"))
    into = str(out.get("movie") or payload.get("movie") or "")
    return _ok((into or "The movie") + f" now has {count} subtitle line{'s' if count != 1 else ''}, {'shown' if shown else 'not shown'} in the video"
               + (", and the movie was saved." if out.get("saved") else "; the movie is not saved yet."),
               {"movie": into or None, "lines": count, "show": shown, "saved": bool(out.get("saved"))})


async def t_list_commands(a: Agent, args: dict) -> dict:
    cid = str(args.get("id") or "").strip()
    if cid:
        if cid not in CMDS:
            raise ToolError(f"No command has the id {cid}. list_commands without id lists them.")
        return _ok(json.dumps(CMDS[cid], ensure_ascii=False), CMDS[cid])
    lines = [f"{c['id']} · {c['kind']} · {c['description']}" for c in COMMANDS]
    return _ok(f"{len(COMMANDS)} commands (run_command {{id, params}} runs one):\n" + "\n".join(lines), {"commands": [{"id": c["id"], "kind": c["kind"]} for c in COMMANDS]})


def _set_stack(stem: str, stack: str) -> dict:
    stack = stack.strip()
    with library._lock:
        current = library.find_movie(stem)
        here = current.parent.name if current is not None and current.parent != config.library_dir() else ""
        if stack == here:
            return {"movie": stem, "stack": stack or None}
        if not stack:
            others = [p.stem for p in current.parent.glob(f"*{config.PROJECT_EXT}") if p.stem != stem]
            library.update_stack(here, library.StackBody(items=others))
            return {"movie": stem, "stack": None}
        found = {s["id"]: s for s in library.list_stacks()["stacks"]}
        if stack in found:
            library.update_stack(stack, library.StackBody(items=[*found[stack]["items"], stem]))
            return {"movie": stem, "stack": stack}
        return {"movie": stem, "stack": library.create_stack(library.StackBody(name=stack, items=[stem]))["id"]}


async def _run(cid: str, params: dict) -> dict:
    if cid == "list_deleted":
        items = (await asyncio.to_thread(trash.list_trash))["items"]
        rows = [{k: i[k] for k in ("id", "name", "kind", "deleted", "daysLeft", "size")} for i in items]
        return _ok(f"{len(rows)} item{'s' if len(rows) != 1 else ''} in Recently Deleted" + (":\n" + "\n".join(f"{r['id']} · {r['name']} · {r['kind']} · deleted {_when(r['deleted'])} · {r['daysLeft']} days left" for r in rows) if rows else "."), {"items": rows})
    if cid == "list_exports":
        items = (await asyncio.to_thread(exports.list_exports))["items"]
        rows = [{k: i[k] for k in ("name", "kind", "size", "modified")} for i in items]
        return _ok(f"{len(rows)} file{'s' if len(rows) != 1 else ''} in Exports" + (":\n" + "\n".join(f"{r['name']} · {r['kind']} · {_size(r['size'])} · {_when(r['modified'])}" for r in rows) if rows else "."), {"exports": rows})
    if cid == "list_stacks":
        stacks = (await asyncio.to_thread(library.list_stacks))["stacks"]
        rows = [{"name": s["name"], "movies": s["items"]} for s in stacks]
        return _ok(f"{len(rows)} stack{'s' if len(rows) != 1 else ''}" + (":\n" + "\n".join(f"{r['name']}: {', '.join(r['movies'])}" for r in rows) if rows else "."), {"stacks": rows})
    if cid == "export_capabilities":
        caps = await asyncio.to_thread(jobs.capabilities)
        caps = {k: v for k, v in caps.items() if k != "path"}
        lines = [f"{t}: {'yes, ' + v['encoder'] if v['available'] else 'no, ' + v['reason']}" for t, v in caps["targets"].items()]
        return _ok(("ffmpeg " + caps["version"] if caps["ffmpeg"] else "No ffmpeg") + ":\n" + "\n".join(lines), caps)
    if cid == "list_fonts":
        found = await asyncio.to_thread(fonts.list_fonts)
        rows = [{"file": i.get("file"), "family": i.get("family")} for i in found.get("items", [])]
        return _ok(f"{len(rows)} font{'s' if len(rows) != 1 else ''}" + (":\n" + "\n".join(f"{r['file']} · {r['family']}" for r in rows) if rows else "."), {"fonts": rows})
    if cid == "set_tags":
        stem = _movie(params.get("movie")).stem
        tags = params.get("tags")
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            raise ToolError("tags is a list of words.")
        out = await asyncio.to_thread(library.set_tags, stem, library.TagsBody(tags=tags))
        return _ok(f"{stem} has the tags {', '.join(out['tags'])}." if out["tags"] else f"{stem} has no tags now.", {"movie": stem, "tags": out["tags"]})
    if cid == "set_stack":
        stem = _movie(params.get("movie")).stem
        if not isinstance(params.get("stack"), str):
            raise ToolError("stack is a stack's name, or empty to take the movie out of its stack.")
        out = await asyncio.to_thread(_set_stack, stem, params["stack"])
        return _ok(f"{stem} is in the stack {out['stack']}." if out["stack"] else f"{stem} is in no stack now.", out)
    raise ToolError(f"No command has the id {cid}.")


async def t_run_command(a: Agent, args: dict) -> dict:
    cid = str(args.get("id") or "").strip()
    if cid not in CMDS:
        raise ToolError(f"No command has the id {cid or '(none)'}. list_commands lists them.")
    params = args.get("params") if isinstance(args.get("params"), dict) else {}
    refused = await _gate(a, CMDS[cid]["kind"], f"run the command {cid}" + (f" on the movie {params.get('movie')}" if params.get("movie") else ""))
    if refused:
        raise ToolError(refused)
    return await _run(cid, params)


HANDLERS = {name[2:]: fn for name, fn in globals().items() if name.startswith("t_") and callable(fn)}


async def call_tool(a: Agent, name: str, args: dict) -> dict:
    if agent_access.choice() == "blocked":
        return _fail(BLOCKED)
    try:
        return await HANDLERS[name](a, args)
    except ToolError as exc:
        return _fail(str(exc))
    except HTTPException as exc:
        return _fail(str(exc.detail))
    except (ValueError, TypeError, KeyError) as exc:
        return _fail(f"{name}: the arguments were not understood ({type(exc).__name__}).")
    except Exception as exc:
        return _fail(f"{name} failed: {type(exc).__name__}.")


def _agent(request: Request, params: dict) -> Agent:
    token = request.headers.get(claude_code.INAPP_HEADER, "")
    if claude_code.is_inapp(token):
        return Agent(claude_code.inapp_name(token), True)
    info = (params.get("_meta") or {}).get("io.modelcontextprotocol/clientInfo") or {}
    name = info.get("name") if isinstance(info, dict) else None
    return Agent(str(name or SESSIONS.get(request.headers.get("mcp-session-id") or "") or "")[:80], False)


async def _until_gone(request: Request, task: asyncio.Future) -> bool:
    while not task.done():
        await asyncio.wait({task}, timeout=0.5)
        if not task.done() and await request.is_disconnected():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            return True
    return False


def _json(body: dict, status: int = 200, headers: dict | None = None) -> Response:
    return Response(content=json.dumps(body, ensure_ascii=False), media_type="application/json", status_code=status, headers=headers or {})


@router.post("/mcp")
async def mcp(request: Request) -> Response:
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        return _json(_err(None, -32600, "The request is too large."), 413)
    body = await request.body()
    try:
        msg = json.loads(body) if len(body) <= MAX_BODY else None
    except ValueError:
        return _json(_err(None, -32700, "Parse error"), 400)
    if isinstance(msg, list):
        return _json(_err(None, -32600, "Batches are not supported"), 400)
    if not isinstance(msg, dict):
        return _json(_err(None, -32600, "Invalid request"), 400)
    req_id, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if req_id is None:
        return Response(status_code=202)
    if not isinstance(params, dict) or not isinstance(params.get("_meta") or {}, dict):
        return _json(_err(req_id, -32602, "params and params._meta must be objects"), 400)
    meta = params.get("_meta") or {}
    version = meta.get("io.modelcontextprotocol/protocolVersion") or request.headers.get("mcp-protocol-version") or "2025-11-25"
    modern = version == "2026-07-28"
    headers = {}
    if method == "initialize":
        asked = params.get("protocolVersion")
        sid = uuid.uuid4().hex
        while len(SESSIONS) > 500:
            SESSIONS.pop(next(iter(SESSIONS)))
        SESSIONS[sid] = str((params.get("clientInfo") or {}).get("name") or "")[:80]
        headers["Mcp-Session-Id"] = sid
        out = _res(req_id, {"protocolVersion": asked if asked in VERSIONS + LEGACY else VERSIONS[1], "capabilities": CAPS, "serverInfo": SERVER, "instructions": INSTRUCTIONS}, False)
    elif version not in VERSIONS + LEGACY:
        out = _err(req_id, -32602, f"Unsupported protocol version {version}; supported: {', '.join(VERSIONS)}")
    elif method == "server/discover":
        out = _res(req_id, {"supportedVersions": VERSIONS, "capabilities": CAPS, "_meta": {"io.modelcontextprotocol/serverInfo": SERVER}, "instructions": INSTRUCTIONS, **LIST_CACHE}, True)
    elif method == "ping":
        out = _res(req_id, {}, modern)
    elif method == "tools/list":
        out = _res(req_id, {"tools": LISTED, **(LIST_CACHE if modern else {})}, modern)
    elif method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in NAMES or not isinstance(args, dict):
            out = _err(req_id, -32602, f"No tool named {name}: tools/list gives the names.")
        else:
            task = asyncio.ensure_future(call_tool(_agent(request, params), name, {k: v for k, v in args.items() if v is not None}))
            if await _until_gone(request, task):
                return Response(status_code=499)
            out = _res(req_id, task.result(), modern)
    else:
        out = _err(req_id, -32601, f"Method not found: {method}")
    return _json(out, headers=headers)


@router.get("/mcp")
def mcp_get() -> Response:
    return Response(status_code=405, headers={"Allow": "POST, DELETE"})


@router.delete("/mcp")
def mcp_delete(request: Request) -> Response:
    SESSIONS.pop(request.headers.get("mcp-session-id") or "", None)
    return Response(status_code=204)


def _res(req_id, result: dict, modern: bool) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": {**result, **({"resultType": "complete"} if modern else {})}}


def _err(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


@router.get("/api/mcp/bridge/next")
async def bridge_next(request: Request) -> Response:
    window_key.require(request)
    item = await bridge.next_item(request.is_disconnected)
    return Response(status_code=204) if item is None else _json(item)


@router.post("/api/mcp/bridge/result")
async def bridge_result(request: Request) -> dict:
    window_key.require(request)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Send {id, result} as JSON.") from None
    if not isinstance(body, dict) or not bridge.result(str(body.get("id") or ""), body.get("result")):
        raise HTTPException(404, "That request is no longer waiting.")
    return {"ok": True}


@router.get("/api/mcp/bridge/file/{rid}")
def bridge_file(rid: str, request: Request) -> FileResponse:
    window_key.require(request)
    raw = bridge.file_for(rid)
    path = Path(raw) if raw else None
    if path is None or not _inside(path, config.library_dir()) or not path.is_file():
        raise HTTPException(404, "No file waits for that request.")
    return FileResponse(path, filename=path.name, headers={"Cache-Control": "no-store"})
