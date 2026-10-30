import os
import sys

from fastapi import APIRouter

from app.core import config

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "app": config.APP_NAME, "version": config.VERSION}


@router.get("/capabilities")
def capabilities() -> dict:
    return {
        "app": config.APP_NAME,
        "version": config.VERSION,
        "platform": sys.platform,
        "desktop": os.environ.get("FORMMORPHEUS_DESKTOP") == "1",
        "dataDir": str(config.data_dir()),
        "dataDirSource": config.data_dir_source(),
        "libraryDir": str(config.library_dir()),
        "projectExt": config.PROJECT_EXT,
    }
