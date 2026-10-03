import { createHash } from "node:crypto";
import { BASE62_ALPHABET } from "../../shared/utils/identifier";

const BASE62_RADIX = BigInt(BASE62_ALPHABET.length);

/** 对 UTF-8 文本或原始字节计算指纹，调用方负责业务投影与序列化。 */
export function fingerprint(content: string | Uint8Array, length: number): string {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive safe integer.");
  }
  let digest = BigInt(`0x${createHash("sha256").update(content).digest("hex")}`);
  let result = "";
  // 固定取低位 Base62 数字。摘要耗尽后自然补零，避免变长编码的高位偏斜。
  while (result.length < length) {
    result = BASE62_ALPHABET[Number(digest % BASE62_RADIX)] + result;
    digest /= BASE62_RADIX;
  }
  return result;
}
