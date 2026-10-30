from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import config
from app.routers import exports, library, system

app = FastAPI(title=config.APP_NAME, version=config.VERSION)
app.add_middleware(CORSMiddleware, allow_origins=config.window_origins(), allow_methods=["*"], allow_headers=["*"])

app.include_router(system.router, prefix="/api")
app.include_router(library.router, prefix="/api/library")
app.include_router(exports.router, prefix="/api/exports")

_dist = config.dist_dir()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
