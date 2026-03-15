from pathlib import Path

import pytest

from module.Data.ZstdCodec import ZstdCodec


def test_compress_and_decompress_roundtrip() -> None:
    original = (b"LinguaGacha " * 256) + b"end"

    compressed = ZstdCodec.compress(original)
    restored = ZstdCodec.decompress(compressed)

    assert restored == original


def test_compress_file_and_decompress_to_file(fs) -> None:
    del fs
    source_path = Path("/workspace/source.bin")
    output_path = Path("/workspace/nested/restored.bin")
    source_path.parent.mkdir(parents=True, exist_ok=True)
    content = b"\x00\x01\x02abc123" * 100
    source_path.write_bytes(content)

    compressed, original_size = ZstdCodec.compress_file(str(source_path))
    ZstdCodec.decompress_to_file(compressed, str(output_path))

    assert original_size == len(content)
    assert output_path.read_bytes() == content


def test_decompress_invalid_data_raises() -> None:
    with pytest.raises(Exception):
        ZstdCodec.decompress(b"not-a-zstd-payload")
