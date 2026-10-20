import assert from "node:assert/strict";

// 成员在内存中解析和写回，共用上限约束原文与解压载荷。
export const GODOT_RESOURCE_MAX_BYTES = 256 * 1024 * 1024;
/** Godot 的小端整数按无符号位模式写入，保留负数哨兵。 */
export const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
/** 文件偏移须在 JavaScript 可精确表示的整数范围内。 */
export const u64 = (n: number): Buffer => {
  assert(Number.isSafeInteger(n) && n >= 0);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
/** Godot 字符串与包成员按字节数对齐。 */
export const pad = (n: number, alignment = 4): number => (alignment - (n % alignment)) % alignment;
// 损坏的 UTF-8 必须由成员边界报告，避免替换字符改变持久定位。
export const utf8 = new TextDecoder("utf-8", { fatal: true });
/** 解析游标以当前缓冲区为原点，所有读取先检查完整区间。 */
export class Reader {
  at = 0;
  /** 内存资源与解压输出共用处理上限。 */
  constructor(readonly b: Buffer) {
    assert(b.length <= GODOT_RESOURCE_MAX_BYTES, "Godot resource exceeds processing limit");
  }
  /** 返回原字节视图，截断或非法坐标在推进游标前失败。 */
  take(n: number): Buffer {
    assert(
      Number.isSafeInteger(this.at) &&
        this.at >= 0 &&
        Number.isSafeInteger(n) &&
        n >= 0 &&
        this.at + n <= this.b.length,
      `Truncated data at ${this.at}, need ${n}/${this.b.length}`,
    );
    const b = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return b;
  }
  /** Godot 二进制整数使用小端序。 */
  u32(): number {
    return this.take(4).readUInt32LE();
  }
  /** 大于安全整数范围的偏移不能进入后续区间计算。 */
  u64(): number {
    const n = Number(this.take(8).readBigUInt64LE());
    assert(Number.isSafeInteger(n), "Unsafe 64-bit offset");
    return n;
  }
  /** 集合长度的最高位承载共享标记，长度同时受资源大小限制。 */
  count(): number {
    const n = this.u32() & 0x7fffffff;
    assert(n <= 1000000 && n <= this.b.length, "Invalid collection size");
    return n;
  }
  /** 长度含可选 NUL，Marshal 字符串还需跳过四字节对齐填充。 */
  string(nul = false, aligned = false): string {
    const n = this.u32();
    assert(n <= GODOT_RESOURCE_MAX_BYTES);
    const b = this.take(n);
    if (nul && n) assert(b[n - 1] === 0, "Missing string terminator");
    const s = utf8.decode(nul && n ? b.subarray(0, -1) : b);
    if (aligned) this.take(pad(n));
    return s;
  }
}
/** 资源字符串带 NUL，Marshal 字符串按四字节对齐。 */
export function string(s: string, nul = false, aligned = false): Buffer {
  const b = Buffer.from(s + (nul ? "\0" : ""));
  return Buffer.concat([u32(b.length), b, Buffer.alloc(aligned ? pad(b.length) : 0)]);
}
export type Edit = { start: number; end: number; bytes: Buffer };
/** 基于原稿坐标合并编辑，重叠编辑在写出结果前失败。 */
export function splice(b: Buffer, edits: readonly Edit[]): Buffer {
  let at = 0;
  const parts: Buffer[] = [];
  // 追加常量与首个 token 可以共用起点，零长度插入必须排在该位置的替换之前。
  for (const e of [...edits].sort((a, z) => a.start - z.start || a.end - z.end)) {
    assert(e.start >= at && e.end >= e.start && e.end <= b.length, "Overlapping/invalid edits");
    parts.push(b.subarray(at, e.start), e.bytes);
    at = e.end;
  }
  parts.push(b.subarray(at));
  return Buffer.concat(parts);
}
