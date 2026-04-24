import compression.zstd

import pytest

from module.Utils.ZstdTool import ZstdTool


def test_compress_and_decompress_roundtrip() -> None:
    original = (b"LinguaGacha " * 256) + b"end"

    compressed = ZstdTool.compress(original)
    restored = ZstdTool.decompress(compressed)

    assert restored == original


def test_compress_and_decompress_empty_payload() -> None:
    compressed = ZstdTool.compress(b"")

    assert ZstdTool.decompress(compressed) == b""


def test_decompress_invalid_data_raises_zstd_error() -> None:
    with pytest.raises(compression.zstd.ZstdError):
        ZstdTool.decompress(b"not-a-zstd-payload")
