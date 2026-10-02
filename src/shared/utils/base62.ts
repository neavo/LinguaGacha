export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const RANDOM_ACCEPT_LIMIT = 248; // 字节范围内最大的 62 整倍数，拒绝余数区间以保证均匀分布。
const RANDOM_BATCH_MAX_BYTES = 65_536; // `getRandomValues` 单次调用的字节上限。

/** 生成均匀分布的短标识，调用方选择长度并处理碰撞。 */
export function random_id(length: number): string {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive safe integer.");
  }
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(
      new Uint8Array(Math.min(length - result.length, RANDOM_BATCH_MAX_BYTES)),
    );
    for (const byte of bytes) {
      if (byte < RANDOM_ACCEPT_LIMIT) result += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
    }
  }
  return result;
}

/** 生成固定长度的完整匹配规则，供读取边界与 JSON Schema 共用。 */
export function base62_pattern(length: number): RegExp {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive safe integer.");
  }
  return new RegExp(`^[${BASE62_ALPHABET}]{${length}}$`, "u");
}
