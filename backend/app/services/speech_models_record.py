"""The pinned files of the two speech model sets: served path, address, size, SHA-256 and licence.

Nothing here is bundled. The engine downloads a set only when the person asks, and takes a file only when it
matches this record. Sizes were read once when the record was written; the engine never asks the network for them.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Pin:
    path: str      # as served and as stored under the set's folder, forward slashes
    url: str
    size: int
    sha256: str


@dataclass(frozen=True)
class SpeechSet:
    licence: str
    sources: tuple[str, ...]
    files: tuple[Pin, ...]

    @property
    def total(self) -> int:
        return sum(pin.size for pin in self.files)


VOICE_MODEL = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231"
VOICE_DICTIONARIES = "https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data"
LISTEN_MODEL = "https://huggingface.co/onnx-community/whisper-base/resolve/1846881b6b3a3024392c1eea3ad983695bc23925"


def _pins(base: str, rows: tuple[tuple[str, str, int, str], ...]) -> tuple[Pin, ...]:
    return tuple(Pin(path=served, url=f"{base}/{upstream}", size=size, sha256=digest) for served, upstream, size, digest in rows)


# (served path, path at the source, size, SHA-256)
_VOICE_MODEL_ROWS = (
    ("model.onnx", "onnx/model_quantized.onnx", 92361116, "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478"),
    ("tokenizer.json", "tokenizer.json", 3497, "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34"),
    ("voices/af_alloy.bin", "voices/af_alloy.bin", 522240, "c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45"),
    ("voices/af_aoede.bin", "voices/af_aoede.bin", 522240, "4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361"),
    ("voices/af_bella.bin", "voices/af_bella.bin", 522240, "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b"),
    ("voices/af_heart.bin", "voices/af_heart.bin", 522240, "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"),
    ("voices/af_jessica.bin", "voices/af_jessica.bin", 522240, "a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8"),
    ("voices/af_kore.bin", "voices/af_kore.bin", 522240, "9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e"),
    ("voices/af_nicole.bin", "voices/af_nicole.bin", 522240, "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a"),
    ("voices/af_nova.bin", "voices/af_nova.bin", 522240, "18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f"),
    ("voices/af_river.bin", "voices/af_river.bin", 522240, "00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30"),
    ("voices/af_sarah.bin", "voices/af_sarah.bin", 522240, "4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a"),
    ("voices/af_sky.bin", "voices/af_sky.bin", 522240, "4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9"),
    ("voices/am_adam.bin", "voices/am_adam.bin", 522240, "162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716"),
    ("voices/am_echo.bin", "voices/am_echo.bin", 522240, "3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3"),
    ("voices/am_eric.bin", "voices/am_eric.bin", 522240, "e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832"),
    ("voices/am_fenrir.bin", "voices/am_fenrir.bin", 522240, "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43"),
    ("voices/am_liam.bin", "voices/am_liam.bin", 522240, "52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade"),
    ("voices/am_michael.bin", "voices/am_michael.bin", 522240, "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1"),
    ("voices/am_onyx.bin", "voices/am_onyx.bin", 522240, "da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6"),
    ("voices/am_puck.bin", "voices/am_puck.bin", 522240, "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0"),
    ("voices/am_santa.bin", "voices/am_santa.bin", 522240, "61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a"),
    ("voices/bf_alice.bin", "voices/bf_alice.bin", 522240, "08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573"),
    ("voices/bf_emma.bin", "voices/bf_emma.bin", 522240, "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73"),
    ("voices/bf_isabella.bin", "voices/bf_isabella.bin", 522240, "3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f"),
    ("voices/bf_lily.bin", "voices/bf_lily.bin", 522240, "5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335"),
    ("voices/bm_daniel.bin", "voices/bm_daniel.bin", 522240, "6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8"),
    ("voices/bm_fable.bin", "voices/bm_fable.bin", 522240, "f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1"),
    ("voices/bm_george.bin", "voices/bm_george.bin", 522240, "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc"),
    ("voices/bm_lewis.bin", "voices/bm_lewis.bin", 522240, "b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97"),
)

_VOICE_DICTIONARY_ROWS = (
    ("dict/us_gold.json", "us_gold.json", 3000469, "dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f"),
    ("dict/us_silver.json", "us_silver.json", 3099517, "de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475"),
    ("dict/gb_gold.json", "gb_gold.json", 2838552, "29e62f4b60261c88f7f3c2c7811ca3825978948090b72d2b27d565b729282f71"),
    ("dict/gb_silver.json", "gb_silver.json", 3663898, "48131e2d92ccc41655f4543e87e0f938e71463eb5a54be7f0693bb712ebb6bce"),
)

_LISTEN_ROWS = (
    ("config.json", "config.json", 2243, "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"),
    ("generation_config.json", "generation_config.json", 3832, "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"),
    ("preprocessor_config.json", "preprocessor_config.json", 339, "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"),
    ("tokenizer.json", "tokenizer.json", 2480466, "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"),
    ("tokenizer_config.json", "tokenizer_config.json", 282682, "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"),
    ("onnx/encoder_model_quantized.onnx", "onnx/encoder_model_quantized.onnx", 23201314, "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"),
    ("onnx/decoder_model_merged_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx", 53693315, "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"),
)

SETS: dict[str, SpeechSet] = {
    "voice": SpeechSet(
        licence="Apache-2.0",
        sources=(VOICE_MODEL, VOICE_DICTIONARIES),
        files=_pins(VOICE_MODEL, _VOICE_MODEL_ROWS) + _pins(VOICE_DICTIONARIES, _VOICE_DICTIONARY_ROWS),
    ),
    "listen": SpeechSet(
        # what the model card of the files downloaded here states; the model's author publishes it under MIT (see NOTICE.md)
        licence="Apache-2.0",
        sources=(LISTEN_MODEL,),
        files=_pins(LISTEN_MODEL, _LISTEN_ROWS),
    ),
}
