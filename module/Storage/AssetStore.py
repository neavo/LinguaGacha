import zstandard as zstd
from pathlib import Path


class AssetStore:
    """资产存储工具类（Zstd 压缩/解压）"""

    # 压缩级别（1-22，默认 3 是速度与压缩率的平衡点）
    COMPRESSION_LEVEL = 3

    @classmethod
    def compress(cls, data: bytes) -> bytes:
        """压缩数据"""
        compressor = zstd.ZstdCompressor(level=cls.COMPRESSION_LEVEL)
        return compressor.compress(data)

    @classmethod
    def decompress(cls, data: bytes) -> bytes:
        """解压数据"""
        decompressor = zstd.ZstdDecompressor()
        return decompressor.decompress(data)

    @classmethod
    def compress_file(cls, file_path: str) -> tuple[bytes, int]:
        """压缩文件，返回 (压缩后的数据, 原始大小)"""
        with open(file_path, "rb") as f:
            original_data = f.read()
        compressed_data = cls.compress(original_data)
        return compressed_data, len(original_data)

    @classmethod
    def decompress_to_file(cls, data: bytes, file_path: str) -> None:
        """解压数据并写入文件"""

        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        decompressed_data = cls.decompress(data)
        with open(file_path, "wb") as f:
            f.write(decompressed_data)
