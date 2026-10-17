import { inflateRawSync } from "node:zlib";
import vectors from "./wolf-crypt-vectors.json";

// 测试自有字节由仓库外 UberWolf 固定提交 f4191375 的 C++ 参考实现复核。
// Base64 保存 DEFLATE 压缩的固定向量，运行测试不调用参考程序或读取外部样本。
export const wolf_crypt_vectors = vectors;
export function wolf_vector(encoded: string): Buffer {
  return inflateRawSync(Buffer.from(encoded, "base64"));
}
