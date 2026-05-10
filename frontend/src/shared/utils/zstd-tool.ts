import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

/**
 * 固定 .lg asset 压缩等级，避免新旧工程物理格式参数漂移。
 */
const COMPRESSION_LEVEL = 3;

/**
 * 集中 .lg asset 的 Zstd 压缩等级、压缩和解压规则。
 */
export class ZstdTool {
  /**
   * 对外暴露当前压缩等级，便于迁移和测试确认物理格式参数。
   */
  public static readonly COMPRESSION_LEVEL = COMPRESSION_LEVEL;

  /**
   * 检查当前 Node 运行时是否具备 Zstd 压缩能力。
   */
  public static isRuntimeAvailable(): boolean {
    return (
      typeof zstdCompressSync === "function" &&
      typeof zstdDecompressSync === "function" &&
      typeof constants.ZSTD_c_compressionLevel === "number"
    );
  }

  /**
   * 使用固定参数压缩 asset bytes，保持 .lg 物理格式稳定。
   */
  public static compress(data: Buffer): Buffer {
    return zstdCompressSync(data, {
      params: {
        [constants.ZSTD_c_compressionLevel]: this.COMPRESSION_LEVEL,
      },
    });
  }

  /**
   * 解压 asset bytes，隐藏调用方对 Zstd 细节的感知。
   */
  public static decompress(data: Buffer): Buffer {
    return zstdDecompressSync(data);
  }
}
