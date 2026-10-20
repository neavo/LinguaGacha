import assert from "node:assert/strict";
import { Reader, string, u32 } from "./binary";
import { read_variant, type Value } from "./variant";
export type Setting = { name: string; bytes: Buffer; value: Value };
/** ECFG 中每项配置含独立 Variant 长度，解析须完全消费该区间。 */
export function read_project(bytes: Buffer): Setting[] {
  const r = new Reader(bytes);
  assert.equal(r.take(4).toString(), "ECFG");
  const count = r.count(),
    settings: Setting[] = [];
  for (let i = 0; i < count; i++) {
    const name = r.string(),
      size = r.u32(),
      b = r.take(size),
      v = new Reader(b);
    const value = read_variant(v);
    assert.equal(v.at, b.length, "Variant length: " + name);
    settings.push({ name, bytes: b, value });
  }
  assert.equal(r.at, bytes.length);
  return settings;
}
/** 配置写回保留未修改 Variant 的原字节，新增项加入同一 ECFG 目录。 */
export function patch_project(bytes: Buffer, changes: ReadonlyMap<string, Buffer>): Buffer {
  const r = new Reader(bytes);
  assert.equal(r.take(4).toString(), "ECFG");
  const count = r.count(),
    settings = new Map<string, Buffer>();
  // 未修改配置保持原始 Variant 字节，未知对象也不实例化。
  for (let i = 0; i < count; i++) {
    const name = r.string(),
      size = r.u32();
    assert(!settings.has(name));
    settings.set(name, r.take(size));
  }
  assert.equal(r.at, bytes.length);
  for (const [name, b] of changes) settings.set(name, b);
  return Buffer.concat([
    Buffer.from("ECFG"),
    u32(settings.size),
    ...[...settings].flatMap(([name, b]) => [string(name), u32(b.length), b]),
  ]);
}
