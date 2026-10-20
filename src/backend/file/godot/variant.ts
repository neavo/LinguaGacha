import assert from "node:assert/strict";
import { Reader, string, u32, pad } from "./binary";
/** `type` 沿用各自协议编号，`start` / `end` 相对所属解析缓冲区。 */
export type Value = {
  type: number;
  start: number;
  end: number;
  value?: string | number | boolean | null | Buffer;
  children?: Value[];
  encoding?: "resource_string";
};
/** Marshal Variant 用于项目配置和 GDSC，类型编号与资源文件协议分别解释。 */
export function read_variant(r: Reader, depth = 0): Value {
  assert(depth < 64, "Variant depth exceeded");
  const start = r.at,
    header = r.u32(),
    type = header & 0xffff;
  assert(type <= 38);
  const wide = !!(header & 0x10000);
  let value: Value["value"];
  let children: Value[] | undefined;
  const child = () => read_variant(r, depth + 1);
  const containerType = (kind: number) => {
    if (kind === 1) r.u32();
    else if (kind === 2 || kind === 3) r.string(false, true);
  };
  if (type === 0) value = null;
  else if (type === 1) value = !!r.u32();
  else if (type === 2) {
    const b = r.take(wide ? 8 : 4);
    value = wide ? Number(b.readBigInt64LE()) : b.readInt32LE();
  } else if (type === 3) {
    const b = r.take(wide ? 8 : 4);
    value = wide ? b.readDoubleLE() : b.readFloatLE();
  } else if (type === 4 || type === 21) value = r.string(false, true);
  else if (type === 22) {
    const n = r.u32();
    assert(n & 0x80000000, "Old NodePath unsupported");
    const sub = r.u32(),
      flags = r.u32();
    for (let i = 0; i < (n & 0x7fffffff) + sub + (flags & 2 ? 1 : 0); i++) r.string(false, true);
  } else if (type === 23) r.take(8);
  else if (type === 24) {
    if (wide) r.take(8);
    else {
      const className = r.string(false, true);
      if (className) {
        const n = r.count();
        children = [];
        for (let i = 0; i < n; i++) {
          r.string(false, true);
          children.push(child());
        }
      }
    }
  } else if (type === 25) {
  } // Callable 没有序列化载荷。
  else if (type === 26) {
    r.string(false, true);
    r.take(8);
  } else if (type === 27 || type === 28) {
    containerType((header >>> 16) & 3);
    if (type === 27) containerType((header >>> 18) & 3);
    const count = r.count() * (type === 27 ? 2 : 1);
    children = [];
    for (let i = 0; i < count; i++) children.push(child());
  } else if (type === 34) {
    const n = r.count();
    children = [];
    for (let i = 0; i < n; i++) {
      const at = r.at,
        s = r.string(false, true).replace(/\0$/u, "");
      children.push({ type: 4, start: at, end: r.at, value: s });
    }
  } else if (type >= 29) {
    const n = r.u32(),
      widths: Record<number, number> = {
        29: 1,
        30: 4,
        31: 8,
        32: 4,
        33: 8,
        35: (wide ? 8 : 4) * 2,
        36: (wide ? 8 : 4) * 3,
        37: 16,
        38: (wide ? 8 : 4) * 4,
      };
    assert(widths[type]);
    value = r.take(n * widths[type]!);
    if (type === 29) r.take(pad(n));
  } else {
    const reals: Record<number, number> = {
      5: 2,
      7: 4,
      9: 3,
      11: 6,
      12: 4,
      13: 4,
      15: 6,
      16: 9,
      17: 12,
      18: 4,
      19: 16,
    };
    const ints: Record<number, number> = { 6: 2, 8: 4, 10: 3, 14: 4 };
    if (reals[type]) r.take(reals[type]! * (wide ? 8 : 4));
    else if (ints[type]) r.take(ints[type]! * 4);
    else if (type === 20) r.take(16);
    else throw Error("Unsupported Variant " + type);
  }
  return {
    type,
    start,
    end: r.at,
    ...(value === undefined ? {} : { value }),
    ...(children === undefined ? {} : { children }),
  };
}
/** Marshal String 省略 NUL，以 UTF-8 字节数补齐四字节对齐。 */
export const variant_string = (s: string): Buffer =>
  Buffer.concat([u32(4), string(s, false, true)]);
/** PackedStringArray 的元素包含 NUL，与独立 String 编码不同。 */
export const variant_strings = (values: readonly string[]): Buffer =>
  Buffer.concat([u32(34), u32(values.length), ...values.map((s) => string(s, true, true))]);
/** 按序遍历嵌套值，使原稿中的字符串坐标可直接用于写回。 */
export function* all_values(n: Value): Generator<Value> {
  yield n;
  for (const child of n.children ?? []) yield* all_values(child);
}
