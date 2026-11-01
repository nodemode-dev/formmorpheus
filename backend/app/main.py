import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import config, partsweep
from app.core.guard import GuardMiddleware
from app import penlink
from app.routers import audio_encode, proxy, brushes, exports, files, ideas, jobs, library, recovery, system, trash, transcode

app = FastAPI(title=config.APP_NAME, version=config.VERSION)
app.add_middleware(CORSMiddleware, allow_origins=config.window_origins(), allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GuardMiddleware)   # added last, so it runs first on every request

app.include_router(system.router, prefix="/api")
app.include_router(library.router, prefix="/api/library")
app.include_router(exports.router, prefix="/api/exports")
app.include_router(brushes.router, prefix="/api/brushes")
app.include_router(jobs.router, prefix="/api/jobs")
app.include_router(transcode.router, prefix="/api/transcode")
app.include_router(audio_encode.router, prefix="/api/audio-encode")
app.include_router(proxy.router, prefix="/api/proxy")
app.on_event("startup")(jobs.sweep)
app.include_router(files.router, prefix="/api/files")
app.include_router(trash.router, prefix="/api/trash")
app.include_router(recovery.router, prefix="/api/recovery")
app.include_router(ideas.router, prefix="/api/ideas")
app.include_router(penlink.router, prefix="/api/penlink")
app.on_event("shutdown")(penlink.shutdown)


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
            pass
        await asyncio.sleep(3600)


_dist = config.dist_dir()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
