PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
WAV = b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE" + b"\x00" * 32


class FakeInfo:
    path = "/fake/ffmpeg"
    version = "7.0"
    gpl = False

    def __init__(self, encoders=("prores_ks", "libx264", "aac"), hevc=("libx265",)):
        self.encoders = set(encoders)
        self.hevc = list(hevc)

    def has(self, name):
        return name in self.encoders

    def hevc_candidates(self):
        return list(self.hevc)


def body(**over):
    base = {"target": "h264", "fps": 30, "width": 64, "height": 36, "frames": 2}
    base.update(over)
    return base
