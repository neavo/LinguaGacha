import compression.zstd


class ZstdTool:
    """Zstd 压缩/解压工具类。"""

    # 压缩级别（1-22，默认 3 是速度与压缩率的平衡点）
    COMPRESSION_LEVEL = 3

    @classmethod
    def compress(cls, data: bytes) -> bytes:
        """压缩数据"""
        return compression.zstd.compress(data, level=cls.COMPRESSION_LEVEL)

    @classmethod
    def decompress(cls, data: bytes) -> bytes:
        """解压数据"""
        return compression.zstd.decompress(data)
