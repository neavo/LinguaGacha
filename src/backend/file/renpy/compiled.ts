import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { PICKLE_MAX_BYTES, unframe_pickle, read_pickle, type PickleGraph } from "./pickle";

const MAGIC = "RENPY RPC2",
  HEADER_SIZE = 46,
  DIGEST_SIZE = 16;
export type CompiledSlot = { slot: number; data: Buffer; graph: PickleGraph };
/** 旧文件只有压缩流，RPC2 先校验完整槽位表再读取内容。 */
function compressed_slots(input: Uint8Array): { slot: number; compressed: Buffer }[] {
  const bytes = Buffer.from(input),
    slots: { slot: number; compressed: Buffer }[] = [];
  if (bytes.subarray(0, 10).toString() !== MAGIC) slots.push({ slot: 1, compressed: bytes });
  else {
    assert(bytes.length >= HEADER_SIZE + DIGEST_SIZE, "Truncated RPC2 header");
    const ranges: { start: number; end: number }[] = [];
    let terminated = false;
    for (let at = 10; at < HEADER_SIZE; at += 12) {
      const slot = bytes.readUInt32LE(at);
      if (slot === 0) {
        terminated = true;
        break;
      }
      assert(
        (slot === 1 || slot === 2) && !slots.some((value) => value.slot === slot),
        "Invalid RPC2 slot",
      );
      const start = bytes.readUInt32LE(at + 4),
        length = bytes.readUInt32LE(at + 8),
        end = start + length;
      assert(
        start >= HEADER_SIZE && length > 0 && end <= bytes.length - DIGEST_SIZE,
        "Invalid RPC2 slot range",
      );
      assert(
        !ranges.some((range) => start < range.end && end > range.start),
        "Overlapping RPC2 slots",
      );
      ranges.push({ start, end });
      slots.push({ slot, compressed: bytes.subarray(start, end) });
    }
    assert(terminated && slots.length > 0, "Invalid RPC2 slot table");
  }
  return slots;
}
/** 解压器在分配期间限制输出大小。 */
function inflate_slot(compressed: Buffer): Buffer {
  return inflateSync(compressed, { maxOutputLength: PICKLE_MAX_BYTES });
}
/** 统一返回未分帧坐标，协议 5 的后续写回无需维护帧长度。解析期间处理取消消息。 */
export async function read_compiled(
  input: Uint8Array,
  signal?: AbortSignal,
): Promise<CompiledSlot[]> {
  const result: CompiledSlot[] = [];
  for (const { slot, compressed } of compressed_slots(input)) {
    const inflated = inflate_slot(compressed),
      graph = await read_pickle(inflated, signal);
    const data = unframe_pickle(inflated, graph.frames);
    result.push({
      slot,
      data,
      graph: graph.frames.length ? await read_pickle(data, signal) : graph,
    });
  }
  return result;
}
/** 只读取最后一个槽位的协议图，不去帧也不建立写回坐标，供只消费节点内容的读取使用。 */
export async function read_compiled_values(
  input: Uint8Array,
  signal?: AbortSignal,
): Promise<PickleGraph> {
  return read_pickle(inflate_slot(compressed_slots(input).at(-1)!.compressed), signal);
}
/** 新尾部摘要使引擎丢弃基于旧编译内容建立的界面缓存。 */
export function write_compiled(
  original: Buffer,
  slots: readonly { slot: number; data: Buffer }[],
): Buffer {
  if (original.subarray(0, 10).toString() !== MAGIC) return deflateSync(slots[0]!.data);
  const header = Buffer.alloc(HEADER_SIZE),
    pieces = [header],
    digest = createHash("md5");
  header.write(MAGIC);
  let start = HEADER_SIZE;
  slots.forEach(({ slot, data }, index) => {
    const compressed = deflateSync(data),
      at = 10 + index * 12;
    header.writeUInt32LE(slot, at);
    header.writeUInt32LE(start, at + 4);
    header.writeUInt32LE(compressed.length, at + 8);
    pieces.push(compressed);
    start += compressed.length;
    digest.update(data);
  });
  return Buffer.concat([...pieces, digest.digest()]);
}
/** 源码审计遵循目标引擎的换行处理和摘要盐值。 */
export function source_digest(source: Buffer, mode: "universal" | "raw", salt: string): Buffer {
  const bytes =
    mode === "universal"
      ? Buffer.from(source.toString("latin1").replace(/\r\n?/gu, "\n"), "latin1")
      : source;
  return createHash("md5").update(bytes).update(salt).digest();
}
