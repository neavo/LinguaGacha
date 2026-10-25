/*!
 *  Copyright (c) 2024-2026 Sinflower
 *
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 *
 */
// Port of UberWolf f4191375d289171b1f29dbc5ca320133b2b4b96a.
import { BINARY_COMPUTE_STEP_BYTES } from "../shared/binary";
import { setImmediate } from "node:timers/promises";
/** 已扩展的轮密钥与初始计数器。 */
export type WolfAesKeys = { key: Uint8Array; iv: Uint8Array };

const CHACHA_CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // RFC 8439 常量。
const CHACHA_BLOCK_BYTES = 64;

/** Electron 的 BoringSSL 不提供 `chacha20`，两种宿主共用同一协议实现。 */
export function chacha20_xor(
  bytes: Buffer,
  key: Uint8Array,
  nonce: Uint8Array,
  start: number,
): Buffer {
  const state = new Uint32Array(16),
    block = new Uint32Array(16),
    stream = Buffer.alloc(CHACHA_BLOCK_BYTES);
  state.set(CHACHA_CONSTANTS);
  const key_bytes = Buffer.from(key),
    nonce_bytes = Buffer.from(nonce);
  for (let i = 0; i < 8; i++) state[i + 4] = key_bytes.readUInt32LE(i * 4);
  for (let i = 0; i < 3; i++) state[i + 13] = nonce_bytes.readUInt32LE(i * 4);
  state[12] = 1 + Math.floor(start / CHACHA_BLOCK_BYTES);
  const rotate = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits)); // 32 位循环左移。
  /** 原地执行 ChaCha20 的一组四分之一轮。 */
  const quarter = (a: number, b: number, c: number, d: number) => {
    block[a]! += block[b]!;
    block[d] = rotate(block[d]! ^ block[a]!, 16);
    block[c]! += block[d]!;
    block[b] = rotate(block[b]! ^ block[c]!, 12);
    block[a]! += block[b]!;
    block[d] = rotate(block[d]! ^ block[a]!, 8);
    block[c]! += block[d]!;
    block[b] = rotate(block[b]! ^ block[c]!, 7);
  };
  let skip = start % CHACHA_BLOCK_BYTES; // 首块可能从密钥流中部开始。
  for (let at = 0; at < bytes.length;) {
    block.set(state);
    for (let round = 0; round < 10; round++) {
      quarter(0, 4, 8, 12);
      quarter(1, 5, 9, 13);
      quarter(2, 6, 10, 14);
      quarter(3, 7, 11, 15);
      quarter(0, 5, 10, 15);
      quarter(1, 6, 11, 12);
      quarter(2, 7, 8, 13);
      quarter(3, 4, 9, 14);
    }
    for (let i = 0; i < 16; i++) stream.writeUInt32LE((block[i]! + state[i]!) >>> 0, i * 4);
    const size = Math.min(CHACHA_BLOCK_BYTES - skip, bytes.length - at);
    for (let i = 0; i < size; i++) bytes[at + i]! ^= stream[skip + i]!;
    at += size;
    skip = 0;
    state[12]!++;
    if (!state[12]) state[13]!++;
  }
  return bytes;
}
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
/** 复现引擎的 32 位整数溢出，密钥派生依赖该随机序列。 */
export function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
    return (seed >>> 16) & 32767;
  };
}
/** 修改版 AES 密钥扩展供归档和核心保护共用。 */
export function expand_aes_key(raw: Uint8Array): Uint8Array {
  const key = new Uint8Array(176);
  key.set(raw.subarray(0, 16));
  const rc = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
  for (let i = 4; i < 44; i++) {
    let a = Array.from(key.subarray((i - 1) * 4, i * 4));
    // WOLF 改写了 SubWord 的移位、取反和旋转，保留原协议运算顺序。
    if (i % 4 === 0)
      a = [
        AES_SBOX[a[1]!]! ^ rc[i / 4]!,
        AES_SBOX[a[2]!]! >>> 4,
        ~AES_SBOX[a[3]!]! & 255,
        ((AES_SBOX[a[0]!]! >>> 7) | (AES_SBOX[a[0]!]! << 1)) & 255,
      ];
    for (let j = 0; j < 4; j++) key[i * 4 + j] = key[(i - 4) * 4 + j]! ^ a[j]!;
  }
  return key;
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
    if (at % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    const block = cipher(iv, keys.key);
    for (let i = 0; i < 16 && at + i < data.length; i++) data[at + i]! ^= block[i]!;
    increment();
  }
  return data;
}

// WOLF 改写后的 SHA512 初值。
const WOLF_SHA_INITIAL = [
  0x123456789abcdef0n,
  0xfedcba9876543210n,
  0x0f1e2d3c4b5a6978n,
  0x89abcdef01234567n,
  0x13579bdf02468acen,
  0xf0e1d2c3b4a59687n,
  0x5a6b7c8d9e0f1a2bn,
  0x1a2b3c4d5e6f7890n,
];

// WOLF 改写后的 SHA512 轮常量。
const WOLF_SHA_ROUNDS = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];

/** WOLF 改写了 SHA512 的初值、轮常量、选择函数和最终累加。 */
export function wolf_sha512(input: Buffer): string {
  const mask = (1n << 64n) - 1n;
  const rotate = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & mask; // 64 位循环右移。
  const hash = [...WOLF_SHA_INITIAL];
  const size = Math.ceil((input.length + 17) / 128) * 128,
    bytes = Buffer.alloc(size);
  input.copy(bytes);
  bytes[input.length] = 128;
  bytes.writeBigUInt64BE(BigInt(input.length) * 8n, size - 8);
  for (let at = 0; at < size; at += 128) {
    const words = Array<bigint>(80).fill(0n);
    for (let i = 0; i < 16; i++) words[i] = bytes.readBigUInt64BE(at + i * 8);
    for (let i = 16; i < 80; i++) {
      const x = words[i - 15]!,
        y = words[i - 2]!;
      words[i] =
        (words[i - 16]! +
          (rotate(x, 1n) ^ rotate(x, 8n) ^ (x >> 7n)) +
          words[i - 7]! +
          (rotate(y, 19n) ^ rotate(y, 61n) ^ (y >> 6n))) &
        mask;
    }
    let [a, b, c, d, e, f, g, h] = hash as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    for (let i = 0; i < 80; i++) {
      const t1 =
        (h +
          (rotate(e, 14n) ^ rotate(e, 18n) ^ rotate(e, 41n)) +
          ((e >> 3n) ^ ((e & f) ^ (~e & g))) +
          WOLF_SHA_ROUNDS[i]! +
          words[i]!) &
        mask;
      const t2 =
        ((rotate(a, 28n) ^ rotate(a, 34n) ^ rotate(a, 39n)) + ((a & b) ^ (a & c) ^ (b & c))) & mask;
      [a, b, c, d, e, f, g, h] = [(t1 + t2) & mask, a, b, c, (d + t1) & mask, e, f, g];
    }
    const result = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) hash[i] = (hash[i]! + (result[i]! ^ 0x123456789abcdef0n)) & mask;
  }
  return hash.map((x) => x.toString(16).padStart(16, "0")).join("");
}

/** 核心 `0x55/0x56` 与 `A1/A2` 共用自定义 RNG 链，状态归当前派生调用。 */
export async function pro_key_aes(seeds: Uint8Array, signal?: AbortSignal): Promise<WolfAesKeys> {
  let seed1 = seeds[0]!,
    seed2 = seeds[1]!,
    counter = 0;
  const data = Array.from({ length: 32 }, () => new Uint32Array(256));
  /** 第一种递推更新 `seed1`，后续链继续消费其状态。 */
  const next1 = () => {
    const part = seed1 ^ (((seed1 << 11) ^ seed1) >>> 8);
    let state = (Math.imul(1664525, (seed1 << 11) ^ part) + 1013904223) >>> 0;
    state ^= ((13 * part + 95) & 1) === 0 ? state >>> 3 : state << 2;
    if (state & 0x400) {
      state ^= state << 21;
      state ^= state >>> 9;
    } else {
      state ^= state << 2;
      state ^= state >>> 22;
    }
    if ((state & 0xfffff) === 0) state += 256;
    return (seed1 = state >>> 0);
  };
  /** 第二种递推与第一种共用 `seed1`，调用顺序属于派生协议。 */
  const next2 = () => {
    let state = (Math.imul(1664525, seed1) + 1013904223) >>> 0;
    const shift = (seed1 & 7) + 1;
    if (state % 3 === 1) state ^= state >>> shift;
    else if (state % 3 === 2) state = ~state + (state << shift);
    else state ^= state << shift;
    state >>>= 0;
    if (!state) state = 0x173bef;
    else if (!(state & 65535)) state ^= 0x55aa55aa;
    return (seed1 = state >>> 0);
  };
  /** 独立推进 `seed2`，为链混合提供另一条随机序列。 */
  const next3 = () => {
    let state = Math.imul(1566083941, seed2) ^ Math.imul(292331520, seed2);
    state ^= (state >>> 17) ^ ((state ^ (state >>> 17)) << 5);
    state = Math.imul(69069, state ^ ((state ^ (state >>> 11)) & 0x3fffffff)) >>> 0;
    if (!state) state = 1566083941;
    else {
      if (!(state & 65535)) state ^= 0x59a6f141;
      if (!(state & 0xfffff)) state += 256;
    }
    return (seed2 = state >>> 0);
  };
  /** 原地改写状态行，跨行保留随机状态和调用计数。 */
  const chain = (row: Uint32Array) => {
    for (let i = 0; i < row.length; i++) {
      const rn = next2();
      let value = (rn ^ next3()) >>> 0;
      counter = (counter + 1) >>> 0;
      if (!(counter & 1)) value = (value + next3()) >>> 0;
      if (!(counter % 3)) value = (value ^ (next1() + 3)) >>> 0;
      if (!(counter % 7)) value = (value + next3() + 1) >>> 0;
      if (!(counter & 7)) value = Math.imul(value, next1()) >>> 0;
      if (!(((i + seed1) >>> 0) % 5)) value = (value ^ next1()) >>> 0;
      if (!(counter % 9)) value = (value + next2() + 4) >>> 0;
      if (!(counter % 24)) value = (value + next2() + 7) >>> 0;
      if (!(counter % 31)) value = (value + Math.imul(3, next3())) >>> 0;
      if (!(counter % 61)) value = (value + next3() + 1) >>> 0;
      if (!(counter % 161)) value = (value + next2()) >>> 0;
      if ((rn & 65535) === 256) value = (value + Math.imul(3, next3())) >>> 0;
      row[i] = value;
    }
  };
  for (const row of data) {
    await setImmediate();
    signal?.throwIfAborted();
    chain(row);
  }
  const crypt = new Uint8Array(48);
  for (let idx = 0; idx < crypt.length; idx++) {
    await setImmediate();
    signal?.throwIfAborted();
    let a2 = (idx + seeds[3]!) >>> 0,
      a3 = (seeds[2]! - idx) >>> 0;
    for (let i = 0, iterations = 20; i < iterations; i++) {
      const row = (a2 ^ next1()) & 31,
        column = (a3 ^ next2()) & 255;
      a3 = data[row]![column]!;
      switch (((a2 + counter) >>> 0) % 20) {
        case 1:
          chain(data[(a2 + 5) & 31]!);
          break;
        case 2:
          a3 = (a3 ^ next1()) >>> 0;
          break;
        case 5:
          if (!(a2 & 0xfffff)) crypt[idx]! ^= next3();
          break;
        case 9:
        case 14:
          crypt[next2() % 48]! += a3;
          break;
        case 11:
          crypt[idx]! ^= next1();
          break;
        case 17:
          iterations++;
          break;
        case 19:
          if (!(a2 & 65535)) crypt[idx]! ^= next2();
          break;
      }
      a2 = (a2 + next3()) >>> 0;
      iterations = Math.min(iterations, 50);
    }
    crypt[idx]! += a3;
  }
  const indexes = Uint8Array.from({ length: 48 }, (_, i) => i),
    random = rng(seeds[1]! ^ seeds[2]!);
  for (let i = 0; i < indexes.length; i++) {
    const j = random() % 48;
    [indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
  }
  const result = Uint8Array.from(indexes, (i) => crypt[i]!);
  return {
    key: expand_aes_key(result.subarray(0, 16)),
    iv: result.subarray(16, 32),
  };
}

/** 标准 MT19937，核心 0x55/0x56 使用完整的无符号 32 位输出。 */
export function mt19937(seed: number): () => number {
  const size = 624,
    period = 397;
  const state = new Uint32Array(size);
  state[0] = seed >>> 0;
  for (let i = 1; i < size; i++)
    state[i] = (Math.imul(1812433253, state[i - 1]! ^ (state[i - 1]! >>> 30)) + i) >>> 0;
  let index = size;
  return () => {
    if (index === size) {
      for (let i = 0; i < size; i++) {
        const value = (state[i]! & 0x80000000) | (state[(i + 1) % size]! & 0x7fffffff);
        state[i] = state[(i + period) % size]! ^ (value >>> 1) ^ (value & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let value = state[index++]!;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  };
}
