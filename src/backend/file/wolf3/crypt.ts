// Port of UberWolf f4191375d289171b1f29dbc5ca320133b2b4b96a.
import { crc32 } from "node:zlib";
import { BINARY_CHUNK_BYTES } from "../shared/binary";
import { setImmediate } from "node:timers/promises";
/** 模式标志随当前归档的密钥保存，分块处理共用同一上下文。 */
export type WolfKey = Uint8Array & { v35?: boolean };
export type WolfAesKeys = { key: Uint8Array; iv: Uint8Array };
const AES_SBOX = Uint8Array.from([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);
const SALT_PASSWORD_331 = Uint8Array.from([
  0xca, 0x08, 0x4c, 0x5d, 0x17, 0x0d, 0xda, 0xa1, 0xd7, 0x27, 0xc8, 0x41, 0x54, 0x38, 0x82, 0x32,
  0x54, 0xb7, 0xf9, 0x46, 0x8e, 0x13, 0x6b, 0xca, 0xd0, 0x5c, 0x95, 0x95, 0xe2, 0xdc, 0x03, 0x53,
  0x60, 0x9b, 0x4a, 0x38, 0x17, 0xf3, 0x69, 0x59, 0xa4, 0xc7, 0x9a, 0x43, 0x63, 0xe6, 0x54, 0xaf,
  0xdb, 0xbb, 0x43, 0x58,
]);
export const OLD_PASSWORDS: Readonly<Record<number, Buffer>> = {
  300: Buffer.from([
    0x0f, 0x53, 0xe1, 0x3e, 0x8e, 0xb5, 0x41, 0x91, 0x52, 0x16, 0x55, 0xae, 0x34, 0xc9, 0x8f, 0x79,
    0x59, 0x2f, 0x59, 0x6b, 0x95, 0x19, 0x9b, 0x1b, 0x35, 0x9a, 0x2f, 0xde, 0xc9, 0x7c, 0x12, 0x96,
    0xc3, 0x14, 0xb5, 0x0f, 0x53, 0xe1, 0x3e, 0x8e,
  ]),
  314: Buffer.from([
    0x31, 0xf9, 0x01, 0x36, 0xa3, 0xe3, 0x8d, 0x3c, 0x7b, 0xc3, 0x7d, 0x25, 0xad, 0x63, 0x28, 0x19,
    0x1b, 0xf7, 0x8e, 0x6c, 0xc4, 0xe5, 0xe2, 0x76, 0x82, 0xea, 0x4f, 0xed, 0x61, 0xda, 0xe0, 0x44,
    0x5b, 0xb6, 0x46, 0x3b, 0x06, 0xd5, 0xce, 0xb6, 0x78, 0x58, 0xd0, 0x7c, 0x82,
  ]),
};
/** 旧版密钥由交错字节的两个 CRC32 拼成七字节。 */
export function old_key(source: Uint8Array): Buffer {
  const a: number[] = [],
    b: number[] = [];
  for (let i = 0; i < source.length; i++) (i % 2 ? b : a).push(source[i]!);
  const key = Buffer.alloc(7);
  key.writeUInt32LE(crc32(Uint8Array.from(a)), 0);
  key.writeUIntLE(crc32(Uint8Array.from(b)) & 0xffffff, 4, 3);
  return key;
}
/** 复现引擎的 32 位整数溢出，密钥派生依赖该随机序列。 */
export function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
    return (seed >>> 16) & 32767;
  };
}
/** 按单字节循环右移并截断高位。 */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (8 - n))) & 255;
}
/** 分别派生外层归档流与内层成员流的 XOR 密钥。 */
export function generate_key(seed_bytes: Uint8Array, outer: boolean, version: number): WolfKey {
  let s = 0;
  for (let i = 0; i < Math.floor(seed_bytes[outer ? 8 : 11]! / (outer ? 4 : 3)); i++)
    s = i ^ rotr(s ^ seed_bytes[i % 15]!, outer ? 2 : 3);
  const next = rng(seed_bytes[2]! * seed_bytes[5]! + seed_bytes[12]! + s);
  const f = [0, 0, 0];
  f[s % 3] = next() % 256;
  if (!outer && version >= 350) f[1] = next() % 251;
  const k: WolfKey = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const rn = next();
    k[i] = f[0]! ^ next();
    k[i + 256] = f[1]! ^ (rn >> 8);
    k[i + 512] = f[2]! ^ rn;
  }
  if (outer) {
    const saltKey = version >= 350 ? Buffer.from("958") : SALT_PASSWORD_331;
    const salt = Uint8Array.from(
      { length: 128 },
      (_, i) => Math.floor(i / saltKey.length) + saltKey[i % saltKey.length]!,
    );
    if (version >= 350) s = (s + 34) & 255;
    for (let i = 0; i < 3; i++) {
      let t = s;
      for (let j = 0; j < 256; j++) {
        const a = salt[j & 127]!,
          b = salt[(j + i) % 128]!,
          c = k[i * 256 + j]!,
          x = a ^ c,
          round = (b | (a << 8)) % (version >= 350 ? 16 : 7);
        let n = x,
          skip = false;
        switch (round) {
          case 1:
            if (b % 11 === 0) n = c;
            break;
          case 2:
            if (a % 29 === 0) n = ~x;
            break;
          case 3:
            if ((round + j) % 37 === 0) n = b ^ x;
            break;
          case 4:
            if ((a + b) % 97 === 0) n = a + x;
            break;
          case 5:
            if ((j * round) % 123 === 0) n = x ^ t;
            break;
          case 6:
            if (a === 255 && b === 0) {
              n = 0;
              skip = true;
            }
            break;
          case 7:
            if ((round + j) % 51 === 0) n ^= a;
            break;
          case 8:
            if (a % 29 === 0) n ^= a;
            break;
        }
        if ((j + i) % ((a % 5) + 1) === 0) n ^= t;
        else if (skip) n = ~x;
        k[i * 256 + j] = n;
        t += i;
      }
    }
  }
  k.v35 = version >= 350;
  return k;
}
/** 按流中的绝对位置异或，分块边界不重置密钥位置。 */
export function xor(data: Buffer, key: WolfKey | null, start: number): Buffer {
  if (key === null) return data;
  if (key.length === 7) {
    for (let i = 0; i < data.length; i++) data[i]! ^= key[(start + i) % 7]!;
    return data;
  }
  if (key.v35) {
    const modified = Uint8Array.from({ length: 512 }, (_, i) => key[i % 256]! ^ (7 * i));
    for (let i = 0; i < data.length; i++) {
      const p = start + i;
      data[i]! ^= modified[p & 255]! ^ modified[(Math.floor(p / 256) & 255) + 256]!;
    }
    return data;
  }
  for (let i = 0; i < data.length; i++) {
    const p = start + i;
    data[i]! ^=
      key[p & 255]! ^ key[((p >>> 8) & 255) + 256]! ^ key[(Math.floor(p / 65536) & 255) + 512]!;
  }
  return data;
}
/** 派生计数器初值与修改版 AES 轮密钥，不能替换为标准密钥扩展。 */
export function aes_keys(seed_bytes: Uint8Array, version: number): WolfAesKeys {
  const key = new Uint8Array(176),
    iv = new Uint8Array(16);
  for (let i = 0; i < 15; i++) {
    key[i] = (seed_bytes[(i * 7) % 15]! + i * i) & 255;
    iv[i] = (seed_bytes[(i * 11) % 15]! - i * i) & 255;
    key[15]! ^= (seed_bytes[i]! + i * 3) & 255;
    iv[15]! ^= (seed_bytes[i]! + i * 5) & 255;
  }
  if (version >= 350) {
    key.fill(0);
    iv.fill(0);
    for (let i = 0; i < 15; i++) {
      key[i] = ((i + (seed_bytes[((i * 7) ^ (3 * seed_bytes[i]!)) % 15]! << (i % 3))) % 251) & 255;
      iv[i] =
        ((seed_bytes[((i * 11) ^ (5 * seed_bytes[(i + 3) % 15]!)) % 15]! >> (i % 2)) + i * i) % 246;
      key[15]! ^= (7 * (seed_bytes[i]! + (i + 1))) % 253;
      iv[15]! ^= (11 * ((seed_bytes[i]! - i * 2) & 65535)) % 256;
    }
  }
  const rc = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
  for (let i = 4; i < 44; i++) {
    let a = Array.from(key.subarray((i - 1) * 4, i * 4));
    // WOLF 改写了 SubWord 的移位、取反和旋转，保留原协议运算顺序。
    if (i % 4 === 0)
      a = [
        AES_SBOX[a[1]!]! ^ rc[i / 4]!,
        AES_SBOX[a[2]!]! >>> 4,
        ~AES_SBOX[a[3]!]! & 255,
        rotr(AES_SBOX[a[0]!]!, 7),
      ];
    for (let j = 0; j < 4; j++) key[i * 4 + j] = key[(i - 4) * 4 + j]! ^ a[j]!;
  }
  return { key, iv };
}
/** CTR 使用 AES 正向轮，轮密钥由修改版扩展提供。 */
function cipher(block: Uint8Array, key: Uint8Array): Uint8Array {
  const s = Uint8Array.from(block);
  /** 叠加本轮的十六字节密钥。 */
  function add(round: number) {
    for (let i = 0; i < 16; i++) s[i]! ^= key[round * 16 + i]!;
  }
  add(0);
  // 在 AES 的有限域中乘二。
  const xt = (x: number) => ((x << 1) ^ ((x >>> 7) * 27)) & 255;
  for (let r = 1; r <= 10; r++) {
    for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]!]!;
    const old = Uint8Array.from(s);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) s[col * 4 + row] = old[((col + row) % 4) * 4 + row]!;
    if (r < 10)
      for (let c = 0; c < 16; c += 4) {
        const a = s[c]!,
          b = s[c + 1]!,
          d = s[c + 2]!,
          e = s[c + 3]!,
          t = a ^ b ^ d ^ e;
        s[c]! ^= t ^ xt(a ^ b);
        s[c + 1]! ^= t ^ xt(b ^ d);
        s[c + 2]! ^= t ^ xt(d ^ e);
        s[c + 3]! ^= t ^ xt(e ^ a);
      }
    add(r);
  }
  return s;
}
/** 跳过已消耗的前缀块，并按大端计数器解密当前区间。 */
export async function aes_ctr(
  data: Buffer,
  keys: WolfAesKeys,
  skipBlocks = 0,
  signal?: AbortSignal,
): Promise<Buffer> {
  const iv = Uint8Array.from(keys.iv);
  /** 计数器从末字节向前进位。 */
  function increment() {
    for (let i = 15; i >= 0; i--) {
      iv[i]!++;
      if (iv[i]!) break;
    }
  }
  for (let i = 0; i < skipBlocks; i++) increment();
  for (let at = 0; at < data.length; at += 16) {
    if (at % BINARY_CHUNK_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    const block = cipher(iv, keys.key);
    for (let i = 0; i < 16 && at + i < data.length; i++) data[at + i]! ^= block[i]!;
    increment();
  }
  return data;
}
