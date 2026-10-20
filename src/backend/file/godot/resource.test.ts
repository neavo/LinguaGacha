import { randomBytes } from "node:crypto";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  build_resource,
  create_godot_fixture,
  godot_reference_fixture,
} from "../../../test/godot-fixture";
import {
  read_resource,
  patch_resource,
  resource_string,
  decode_resource,
  encode_resource,
  read_resource_type,
} from "./resource";
import { string, u32, u64 } from "./binary";

it.each([false, true])("改写前置子资源时修正后续内部资源指针，压缩：%s", (compressed) => {
  const bodies = ["first", "second"].map((text) =>
    Buffer.concat([string("Resource", true), u32(1), u32(0), resource_string(text)]),
  );
  const header = Buffer.concat([
    u32(0),
    u32(0),
    u32(4),
    u32(0),
    u32(3),
    string("Resource", true),
    u64(0),
    u32(0),
    Buffer.alloc(8, 255),
    Buffer.alloc(44),
    u32(1),
    string("text", true),
    u32(0),
    u32(2),
  ]);
  const names = [string("local://1", true), string("local://2", true)];
  const first =
    header.length + names.reduce((size, name) => size + name.length + 8, 0) + (compressed ? 0 : 4);
  const bytes = encode_resource(
    Buffer.concat([
      header,
      names[0]!,
      u64(first),
      names[1]!,
      u64(first + bodies[0]!.length),
      ...bodies,
      Buffer.from("RSRC"),
    ]),
    compressed,
  );
  const before = read_resource(bytes),
    target = before.properties[0]!.value,
    replacement = resource_string("更长的第一个资源🙂");
  const after = read_resource(
    patch_resource(bytes, [{ start: target.start, end: target.end, bytes: replacement }]),
  );
  expect(after.internal[1]!.offset).toBe(
    before.internal[1]!.offset + replacement.length - (target.end - target.start),
  );
  expect(after.properties.map((property) => property.value.value)).toEqual([
    "更长的第一个资源🙂",
    "second",
  ]);
});

it.each([false, true])("资源往返修正内部位置并保留未修改属性，压缩：%s", (compressed) => {
  const raw = build_resource(
    "Resource",
    new Map([
      ["text", resource_string("before")],
      ["other", resource_string("keep")],
    ]),
  );
  const body = Buffer.from(decode_resource(raw).body);
  if (compressed)
    for (const entry of read_resource(raw).internal)
      body.writeBigUInt64LE(BigInt(entry.offset - 4), entry.at);
  const bytes = encode_resource(body, compressed),
    before = read_resource(bytes);
  const text = before.properties[0]!.value;
  const after = read_resource(
    patch_resource(bytes, [
      {
        start: text.start,
        end: text.end,
        bytes: resource_string("更长的译文🙂"),
      },
    ]),
  );
  expect(after.properties.map((property) => property.value.value)).toEqual([
    "更长的译文🙂",
    "keep",
  ]);
  expect(after.internal.map((entry) => entry.offset)).toEqual(
    before.internal.map((entry) => entry.offset),
  );
  expect(patch_resource(bytes, [])).toBe(bytes);
  expect(() =>
    patch_resource(bytes, [
      { start: text.start, end: text.end, bytes: Buffer.alloc(0) },
      { start: text.start + 1, end: text.end, bytes: Buffer.alloc(0) },
    ]),
  ).toThrow();
});

it.each([0, 1, 2, 3, 4])("RSCC 模式 %s 解压及有界长度检查", (mode) => {
  const body = Buffer.from("0123456789abcdef"),
    block = 64;
  const compressed =
    mode === 0
      ? Buffer.concat([Buffer.from([body.length - 1]), body])
      : [deflateSync, zstdCompressSync, gzipSync, brotliCompressSync][mode - 1]!(body);
  const bytes = Buffer.concat([
    Buffer.from("RSCC"),
    u32(mode),
    u32(block),
    u32(body.length),
    u32(compressed.length),
    compressed,
    Buffer.from("RSCC"),
  ]);
  expect(decode_resource(bytes).body).toEqual(body);
  const invalid = Buffer.from(bytes);
  invalid.writeUInt32LE(body.length + 1, 12);
  expect(() => decode_resource(invalid)).toThrow();
});

it.each([false, true])("只读前缀即可取得顶层类型，压缩：%s", (compressed) => {
  const body = Buffer.concat([
      decode_resource(create_godot_fixture().get("scene.scn")!).body,
      randomBytes(300000),
    ]),
    bytes = encode_resource(body, compressed),
    requested: number[] = [];
  const type = read_resource_type((length) => {
    requested.push(length);
    return bytes.subarray(0, length);
  });
  expect(type).toBe("PackedScene");
  expect(Math.max(...requested)).toBeLessThan(bytes.length / 2);
});

it.each([3, 4, 5, 6])("资源版本 %s 将旧 ID 与命名 ID 归一化为内部表下标", (version) => {
  for (const named of [false, true]) {
    const bytes = godot_reference_fixture(named, version);
    const doc = read_resource(bytes);
    expect(doc.properties[1]!.value.ref).toEqual({ internal: 0 });
    expect(doc.internal[0]!.path).toBe(named ? "local://Resource_target" : "local://42");
    const target = doc.properties[0]!.value;
    const patched = read_resource(
      patch_resource(bytes, [
        { start: target.start, end: target.end, bytes: resource_string("更长的目标") },
      ]),
    );
    expect(patched.properties[1]!.value.ref).toEqual({ internal: 0 });
    const invalid = Buffer.from(bytes);
    invalid.writeUInt32LE(999, doc.origin + doc.properties[1]!.value.start + 8);
    expect(() => read_resource(invalid)).toThrow("Invalid internal resource reference");
  }
});
