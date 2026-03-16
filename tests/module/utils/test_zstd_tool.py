import compression.zstd
from pathlib import Path

import pytest

from module.Utils.ZstdTool import ZstdTool


def test_compress_and_decompress_roundtrip() -> None:
    original = (b"LinguaGacha " * 256) + b"end"

    compressed = ZstdTool.compress(original)
    restored = ZstdTool.decompress(compressed)

    assert restored == original


def test_compress_file_and_decompress_to_file(fs) -> None:
    source_path = Path("/workspace/source.bin")
    output_path = Path("/workspace/nested/restored.bin")
    source_path.parent.mkdir(parents=True, exist_ok=True)
    content = b"\x00\x01\x02abc123" * 100
    source_path.write_bytes(content)

    compressed, original_size = ZstdTool.compress_file(str(source_path))
    ZstdTool.decompress_to_file(compressed, str(output_path))

    assert original_size == len(content)
    assert output_path.read_bytes() == content


def test_compress_file_and_decompress_to_file_supports_empty_file(fs) -> None:
    source_path = Path("/workspace/empty.bin")
    output_path = Path("/workspace/output/empty.bin")
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(b"")

    compressed, original_size = ZstdTool.compress_file(str(source_path))
    ZstdTool.decompress_to_file(compressed, str(output_path))

    assert original_size == 0
    assert output_path.read_bytes() == b""


def test_decompress_invalid_data_raises_zstd_error() -> None:
    with pytest.raises(compression.zstd.ZstdError):
        ZstdTool.decompress(b"not-a-zstd-payload")
