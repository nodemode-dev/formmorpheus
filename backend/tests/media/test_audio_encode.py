import pytest

from app.routers import audio_encode
from app.services.ffmpeg import FfmpegInfo

WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 32


class FakeProc:
    def __init__(self, code, err):
        self.returncode = code
        self._err = err

    async def communicate(self):
        return b"", self._err


@pytest.fixture
def ffmpeg(monkeypatch):
    state = {"calls": [], "code": 0, "err": b"", "write": b"encoded"}
    info = FfmpegInfo(path="/fake/ffmpeg", version="7", encoders=["libmp3lame", "libopus", "aac"])
    monkeypatch.setattr(audio_encode.ff, "probe", lambda *a, **k: info)

    async def spawn(*argv, **kwargs):
        state["calls"].append(list(argv))
        if state["write"]:
            with open(argv[-1], "wb") as out:
                out.write(state["write"])
        return FakeProc(state["code"], state["err"])

    monkeypatch.setattr(audio_encode.asyncio, "create_subprocess_exec", spawn)
    state["info"] = info
    return state


def leftovers(data_dir):
    return [p for p in data_dir.rglob("*") if p.name.startswith(("mp3-", "lossy-"))]


def test_an_mp3_rate_off_the_list_is_refused(client, ffmpeg):
    assert client.post("/api/audio-encode/mp3?kbps=100", content=WAV).status_code == 400
    assert ffmpeg["calls"] == []


def test_mp3_without_ffmpeg_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(audio_encode.ff, "probe", lambda *a, **k: None)
    assert client.post("/api/audio-encode/mp3", content=WAV).status_code == 503


def test_mp3_without_the_encoder_is_unavailable(client, ffmpeg):
    ffmpeg["info"].encoders = ["aac"]
    assert client.post("/api/audio-encode/mp3", content=WAV).status_code == 503
    assert ffmpeg["calls"] == []


def test_mp3_refuses_a_body_that_is_not_a_wav(client, ffmpeg, data_dir):
    reply = client.post("/api/audio-encode/mp3", content=b"ID3 not a wav file at all")
    assert reply.status_code == 400
    assert ffmpeg["calls"] == []
    assert leftovers(data_dir) == []


def test_mp3_returns_the_encoded_file_and_builds_safe_arguments(client, ffmpeg):
    reply = client.post("/api/audio-encode/mp3?kbps=256", content=WAV)
    assert reply.status_code == 200
    assert reply.content == b"encoded"
    assert reply.headers["content-type"] == "audio/mpeg"
    argv = ffmpeg["calls"][0]
    assert argv[0] == "/fake/ffmpeg"
    assert "-nostdin" in argv
    assert argv[argv.index("-protocol_whitelist") + 1] == "file"
    assert argv[argv.index("-c:a") + 1] == "libmp3lame"
    assert argv[argv.index("-b:a") + 1] == "256k"
    assert argv[argv.index("-i") + 1].endswith("in.wav")
    assert argv[-1].endswith("out.mp3")


def test_mp3_maps_an_ffmpeg_failure_to_a_server_error_and_cleans_up(client, ffmpeg, data_dir):
    ffmpeg["code"], ffmpeg["err"] = 1, b"bad stream\n"
    reply = client.post("/api/audio-encode/mp3", content=WAV)
    assert reply.status_code == 500
    assert "bad stream" in reply.json()["detail"]
    assert leftovers(data_dir) == []


def test_mp3_treats_an_empty_output_as_a_failure(client, ffmpeg):
    ffmpeg["write"] = b""
    assert client.post("/api/audio-encode/mp3", content=WAV).status_code == 500


def test_lossy_refuses_an_unknown_kind(client, ffmpeg):
    assert client.post("/api/audio-encode/lossy?kind=flac", content=WAV).status_code == 400


@pytest.mark.parametrize("kbps", [31, 513, 0, -5])
def test_lossy_refuses_a_rate_outside_the_range(client, ffmpeg, kbps):
    assert client.post(f"/api/audio-encode/lossy?kind=opus-ogg&kbps={kbps}", content=WAV).status_code == 400
    assert ffmpeg["calls"] == []


def test_lossy_without_the_codec_is_unavailable(client, ffmpeg):
    ffmpeg["info"].encoders = ["libmp3lame"]
    assert client.post("/api/audio-encode/lossy?kind=aac-m4a", content=WAV).status_code == 503


@pytest.mark.parametrize(
    "kind,codec,ext,media,container",
    [("opus-webm", "libopus", "webm", "audio/webm", "webm"), ("opus-ogg", "libopus", "ogg", "audio/ogg", "ogg"), ("aac-m4a", "aac", "m4a", "audio/mp4", "mp4")],
)
def test_lossy_picks_codec_container_and_media_type(client, ffmpeg, kind, codec, ext, media, container):
    reply = client.post(f"/api/audio-encode/lossy?kind={kind}&kbps=64", content=WAV)
    assert reply.status_code == 200
    assert reply.headers["content-type"] == media
    argv = ffmpeg["calls"][0]
    assert argv[argv.index("-c:a") + 1] == codec
    assert argv[argv.index("-b:a") + 1] == "64k"
    assert argv[argv.index("-f") + 1] == container
    assert argv[-1].endswith(f"out.{ext}")


def test_lossy_refuses_a_body_that_is_not_a_wav(client, ffmpeg):
    assert client.post("/api/audio-encode/lossy?kind=opus-ogg", content=b"OggS" + b"\x00" * 40).status_code == 400
    assert ffmpeg["calls"] == []
