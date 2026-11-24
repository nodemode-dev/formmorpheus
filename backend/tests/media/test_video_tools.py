import pytest

from app.routers import video_tools
from app.services import ffmpeg_fetch
from app.services.ffmpeg import FfmpegInfo

BASE = "/api/video-tools"


@pytest.fixture
def tools(monkeypatch):
    state = {"info": None, "installed": None, "cancelled": 0}
    monkeypatch.setattr(video_tools.ff, "probe", lambda refresh=False: state["info"])
    monkeypatch.setattr(ffmpeg_fetch, "describe", lambda: {"release": "r"})
    monkeypatch.setattr(ffmpeg_fetch, "installed", lambda: state["installed"])
    monkeypatch.setattr(ffmpeg_fetch, "task", lambda: {"state": "idle"})
    monkeypatch.setattr(ffmpeg_fetch, "cancel", lambda: state.__setitem__("cancelled", state["cancelled"] + 1))
    return state


def test_state_without_ffmpeg_offers_no_formats(client, tools):
    body = client.get(BASE).json()
    assert body["ffmpeg"] == {"found": False, "path": "", "version": "", "source": "", "gpl": False, "encoders": []}
    assert not any(body["formats"].values())
    assert body["family"] == {"release": "r"}
    assert body["task"] == {"state": "idle"}


def test_state_maps_encoders_to_formats(client, tools):
    tools["info"] = FfmpegInfo(path="/bin/ffmpeg", version="7.1", encoders=["prores_ks", "libmp3lame", "libx265"], gpl=True)
    body = client.get(BASE).json()
    assert body["ffmpeg"]["source"] == "computer"
    assert body["ffmpeg"]["gpl"] is True
    assert body["formats"] == {"prores": True, "hevc": True, "hevcAlpha": False, "h264": False, "mp3": True, "aac": False, "opus": False}


def test_alpha_hevc_needs_the_hardware_encoder_and_a_downloaded_build_is_named(client, tools):
    tools["info"] = FfmpegInfo(path="/data/ffmpeg", version="7.1", encoders=["hevc_videotoolbox"])
    tools["installed"] = "/data/ffmpeg"
    body = client.get(BASE).json()
    assert body["formats"]["hevcAlpha"] is True
    assert body["ffmpeg"]["source"] == "download"


def test_download_maps_a_refusal_to_400_and_a_running_download_to_409(client, tools, monkeypatch):
    def refuse():
        raise ValueError("no build here")

    def running():
        raise RuntimeError("already running")

    monkeypatch.setattr(ffmpeg_fetch, "start", refuse)
    reply = client.post(BASE + "/download")
    assert (reply.status_code, reply.json()["detail"]) == (400, "no build here")
    monkeypatch.setattr(ffmpeg_fetch, "start", running)
    assert client.post(BASE + "/download").status_code == 409


def test_download_starts_once_and_returns_the_state(client, tools, monkeypatch):
    started = []
    monkeypatch.setattr(ffmpeg_fetch, "start", lambda: started.append(1))
    reply = client.post(BASE + "/download")
    assert reply.status_code == 200
    assert started == [1]
    assert "formats" in reply.json()


def test_cancel_asks_the_download_to_stop(client, tools):
    assert client.post(BASE + "/cancel").status_code == 200
    assert tools["cancelled"] == 1


def test_remove_maps_a_build_in_use_to_409(client, tools, monkeypatch):
    def in_use():
        raise RuntimeError("in use")

    monkeypatch.setattr(ffmpeg_fetch, "remove", in_use)
    assert client.delete(BASE + "/download").status_code == 409
    removed = []
    monkeypatch.setattr(ffmpeg_fetch, "remove", lambda: removed.append(1))
    assert client.delete(BASE + "/download").status_code == 200
    assert removed == [1]


def test_the_routes_need_the_window_key(anon_client, tools, monkeypatch):
    started = []
    monkeypatch.setattr(ffmpeg_fetch, "start", lambda: started.append(1))
    assert anon_client.post(BASE + "/download").status_code in (401, 403)
    assert started == []
