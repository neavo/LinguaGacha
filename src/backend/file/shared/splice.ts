import assert from "node:assert/strict";

export type Edit = { start: number; end: number; bytes: Buffer };
/** 基于原稿坐标合并编辑，重叠编辑在写出结果前失败。 */
export function splice(b: Buffer, edits: readonly Edit[]): Buffer {
  let at = 0;
  const parts: Buffer[] = [];
  // 追加常量与首个 token 可以共用起点，零长度插入必须排在该位置的替换之前。
  for (const e of [...edits].sort((a, z) => a.start - z.start || a.end - z.end)) {
    assert(
      Number.isSafeInteger(e.start) &&
        Number.isSafeInteger(e.end) &&
        e.start >= at &&
        e.end >= e.start &&
        e.end <= b.length,
      "Overlapping/invalid edits",
    );
    parts.push(b.subarray(at, e.start), e.bytes);
    at = e.end;
  }
  parts.push(b.subarray(at));
  return Buffer.concat(parts);
}
