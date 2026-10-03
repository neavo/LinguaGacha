const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const DEFAULT_ID_LENGTH = 8;

const RANDOM_ACCEPT_LIMIT = 252; // 字节范围内最大的 36 整倍数，拒绝余数区间以保证均匀分布。
const RANDOM_BATCH_MAX_BYTES = 65_536; // `getRandomValues` 单次调用的字节上限。

/** 生成均匀分布的 Base36 短标识，默认 8 位，调用方负责处理碰撞。 */
export function random_id(length: number = DEFAULT_ID_LENGTH): string {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive safe integer.");
  }
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(
      new Uint8Array(Math.min(length - result.length, RANDOM_BATCH_MAX_BYTES)),
    );
    for (const byte of bytes) {
      if (byte < RANDOM_ACCEPT_LIMIT) result += BASE36_ALPHABET[byte % BASE36_ALPHABET.length];
    }
  }
  return result;
}
