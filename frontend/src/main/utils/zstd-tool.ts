import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

// 固定 .lg asset 压缩等级，避免新旧工程物理格式参数漂移。
const COMPRESSION_LEVEL = 3;

export class ZstdTool {
  public static readonly COMPRESSION_LEVEL = COMPRESSION_LEVEL;

  public static isRuntimeAvailable(): boolean {
    return (
      typeof zstdCompressSync === "function" &&
      typeof zstdDecompressSync === "function" &&
      typeof constants.ZSTD_c_compressionLevel === "number"
    );
  }

  public static compress(data: Buffer): Buffer {
    return zstdCompressSync(data, {
      params: {
        [constants.ZSTD_c_compressionLevel]: this.COMPRESSION_LEVEL,
      },
    });
  }

  public static decompress(data: Buffer): Buffer {
    return zstdDecompressSync(data);
  }
}
