import asyncio
import logging
import mimetypes

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import config, partsweep, window_key
from app.core.guard import GuardMiddleware
from app.core.page_policy import PagePolicy
from app import penlink
from app.routers import save_to, fonts,audio_encode, proxy, brushes, characters, exports, files, ideas, jobs, library, recovery, system, trash, transcode
from app.routers import agents, mcp, terminal
from app.routers import video_tools
from app.routers import voice
from app.routers import scenes
from app.services import claude_code
from app.services import terminal as terminals

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

log = logging.getLogger("formmorpheus")

app = FastAPI(title=config.APP_NAME, version=config.VERSION)
app.add_middleware(PagePolicy)
app.add_middleware(window_key.WindowKeyGuard)
app.add_middleware(CORSMiddleware, allow_origins=config.window_origins(), allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GuardMiddleware)   # added last, so it runs first on every request

app.include_router(window_key.router)
app.include_router(system.router, prefix="/api")
app.include_router(library.router, prefix="/api/library")
app.include_router(characters.router, prefix="/api/characters")
app.include_router(scenes.router, prefix="/api/scenes")
app.include_router(exports.router, prefix="/api/exports")
app.include_router(brushes.router, prefix="/api/brushes")
app.include_router(fonts.router, prefix="/api/fonts")
app.include_router(save_to.router, prefix="/api/save-to")
app.include_router(jobs.router, prefix="/api/jobs")
app.include_router(transcode.router, prefix="/api/transcode")
app.include_router(audio_encode.router, prefix="/api/audio-encode")
app.include_router(proxy.router, prefix="/api/proxy")
app.include_router(video_tools.router, prefix="/api/video-tools")
app.include_router(voice.router, prefix="/api/voice")
app.on_event("startup")(jobs.sweep)
app.include_router(files.router, prefix="/api/files")
app.include_router(trash.router, prefix="/api/trash")
app.include_router(recovery.router, prefix="/api/recovery")
app.include_router(ideas.router, prefix="/api/ideas")
app.include_router(penlink.router, prefix="/api/penlink")
app.on_event("shutdown")(penlink.shutdown)
app.include_router(agents.router)
app.include_router(terminal.router)
app.include_router(mcp.router)
app.on_event("startup")(claude_code.sweep)
app.on_event("shutdown")(terminals.close_all)
app.on_event("shutdown")(claude_code.revoke_all)


@app.on_event("startup")
async def _start_trash_sweep() -> None:
    # sweeps now, then once a day while the engine runs
    app.state.trash_sweep = asyncio.create_task(trash.sweep_daily())
    # abandoned export-job folders are swept while the engine runs, not only at start
    app.state.job_sweep = asyncio.create_task(jobs.sweep_loop())
    app.state.part_sweep = asyncio.create_task(_part_sweep_loop())


async def _part_sweep_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(partsweep.sweep)
        except Exception:
            log.exception("the hourly sweep of leftover part files failed; it runs again in an hour")
        await asyncio.sleep(3600)


_dist = config.dist_dir()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
