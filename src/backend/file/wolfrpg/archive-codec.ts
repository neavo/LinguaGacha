import { WOLF_MAX_DATA_BYTES } from "./lz4";
import { BINARY_COMPUTE_STEP_BYTES } from "../shared/binary";
// Port of UberWolf f4191375d289171b1f29dbc5ca320133b2b4b96a.
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
/** 按差分频率重建 Huffman 树，头部和正文使用不同的位序。 */
export async function decompress_huffman(src: Buffer, signal?: AbortSignal): Promise<Buffer> {
  let bits = 0;
  /** 头部按高位到低位读取，保留大于 32 位的安全整数。 */
  function read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      assert(bits < src.length * 8, "truncated Huffman header");
      v = v * 2 + ((src[bits >>> 3]! >>> (7 - (bits & 7))) & 1);
      bits++;
    }
    assert(Number.isSafeInteger(v));
    return v;
  }
  const size = read(read(6) + 1),
    packed = read(read(6) + 1);
  assert(size <= WOLF_MAX_DATA_BYTES);
  let prev = 0;
  const nodes: Array<{ weight: number; parent: number; children?: [number, number] }> = [];
  for (let i = 0; i < 256; i++) {
    const n = (read(3) + 1) * 2,
      negative = read(1),
      v = read(n);
    prev = i === 0 ? v : (negative ? prev - v : prev + v) & 65535;
    nodes.push({ weight: prev, parent: -1 });
  }
  const body = Math.ceil(bits / 8);
  assert(body + packed <= src.length + 1, "truncated Huffman body");
  for (let n = 256; n < 511; n++) {
    const active = [];
    for (let i = 0; i < n; i++) if (nodes[i]!.parent === -1) active.push(i);
    // 同频节点按原始索引排序，否则重建的编码树会改变。
    active.sort((a, b) => nodes[a]!.weight - nodes[b]!.weight || a - b);
    const a = active[0]!,
      b = active[1]!;
    nodes[a]!.parent = n;
    nodes[b]!.parent = n;
    nodes.push({ weight: nodes[a]!.weight + nodes[b]!.weight, parent: -1, children: [a, b] });
  }
  const out = Buffer.alloc(size);
  bits = body * 8; // 正文改为从每个字节的低位开始读取。
  for (let i = 0; i < size; i++) {
    if (i % BINARY_COMPUTE_STEP_BYTES === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    let n = 510;
    while (n >= 256) {
      assert(bits < src.length * 8, "truncated Huffman data");
      n = nodes[n]!.children![(src[bits >>> 3]! >>> (bits & 7)) & 1]!;
      bits++;
    }
    out[i] = n;
  }
  return out;
}
/** DX LZ 使用转义字节和回溯距离，重叠匹配按字节复制。 */
export async function decompress_dx_lz(src: Buffer, signal?: AbortSignal): Promise<Buffer> {
  assert(src.length >= 9);
  const size = src.readUInt32LE(0),
    end = src.readUInt32LE(4),
    key = src[8]!;
  assert(end <= src.length && end >= 9 && size <= WOLF_MAX_DATA_BYTES);
  const out = Buffer.alloc(size);
  let at = 9,
    pos = 0;
  let checkpoint = 0;
  while (at < end) {
    if (pos >= checkpoint) {
      await setImmediate();
      signal?.throwIfAborted();
      checkpoint = pos + BINARY_COMPUTE_STEP_BYTES;
    }
    let c = src[at++]!;
    if (c !== key) {
      assert(pos < size);
      out[pos++] = c;
      continue;
    }
    assert(at < end);
    c = src[at++]!;
    if (c === key) {
      assert(pos < size);
      out[pos++] = key;
      continue;
    }
    if (c > key) c--;
    let n = c >>> 3;
    if (c & 4) {
      assert(at < end);
      n |= src[at++]! << 5;
    }
    n += 4;
    const width = (c & 3) + 1;
    assert(width <= 3 && at + width <= end);
    const back = src.readUIntLE(at, width) + 1;
    at += width;
    assert(back <= pos && pos + n <= size);
    for (let i = 0; i < n; i++) {
      out[pos] = out[pos - back]!;
      pos++;
    }
  }
  assert.equal(pos, size);
  return out;
}
