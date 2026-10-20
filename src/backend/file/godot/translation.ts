import { godot_member_kind } from "./member";
import assert from "node:assert/strict";
import { read_resource, patch_resource } from "./resource";
import { smaz_decode } from "./smaz";
import { u32, pad, utf8 } from "./binary";
import { read_project, patch_project } from "./project";
import { all_values, variant_string, type Value } from "./variant";
import { read_po } from "./po";
const DICTIONARY = 26,
  ARRAY = 30; // 资源文件编号。
/** `texts` 是该消息的全部译文字符串，空译文由调用者按用途过滤。 */
export type TranslationMessage = Readonly<{ key: string; texts: readonly Value[] }>;
/**
 * 非优化语言表的 `messages` 有三种形状：
 * 旧版 `Translation` 为「msgid → 译文」；当前 `Translation` 为「[msgctxt, msgid] → 译文数组」；
 * `TranslationPO` 为「msgctxt → { msgid → 译文数组 }」。msgctxt 只区分同名消息，不是消息键。
 */
export function read_messages(doc: ReturnType<typeof read_resource>): TranslationMessage[] {
  const pairs = (v: Value | undefined): [Value, Value][] => {
    const c = v?.children ?? [];
    return Array.from({ length: c.length >> 1 }, (_, i) => [c[i * 2]!, c[i * 2 + 1]!]);
  };
  const message = (key: Value | undefined, value: Value): TranslationMessage => {
    assert(typeof key?.value === "string", "Invalid translation message key");
    return {
      key: key.value,
      texts: [...all_values(value)].filter((v) => typeof v.value === "string"),
    };
  };
  return pairs(doc.properties.find((p) => p.name === "messages")?.value).flatMap(([key, value]) =>
    value.type === DICTIONARY
      ? pairs(value).map(([id, texts]) => message(id, texts))
      : [message(key.type === ARRAY ? key.children?.[1] : key, value)],
  );
}
/** Godot 以 UTF-8 字节计算桶哈希，零 seed 使用协议初值。 */
export function translation_hash(s: string, seed = 0): number {
  let h = seed || 0x1000193;
  for (const b of Buffer.from(s)) {
    if (!b) break;
    h = (Math.imul(h, 0x1000193) ^ b) >>> 0;
  }
  return h;
}
/** 优化表通过两级桶定位字符串，解码后保留槽位坐标与哈希身份。 */
export function read_translation(bytes: Buffer) {
  const doc = read_resource(bytes);
  assert.equal(doc.type, "OptimizedTranslation");
  const prop = (n: string) => doc.properties.find((p) => p.name === n)!.value;
  const hash = prop("hash_table"),
    bucket = prop("bucket_table"),
    strings = prop("strings");
  assert(
    Buffer.isBuffer(hash.value) && Buffer.isBuffer(bucket.value) && Buffer.isBuffer(strings.value),
  );
  const buckets = bucket.value,
    slots: {
      index: number;
      bucket: number;
      seed: number;
      key: number;
      offset: number;
      compressed: number;
      size: number;
      text: string;
    }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < hash.value.length; i += 4) {
    const offset = hash.value.readUInt32LE(i);
    if (offset === 0xffffffff) continue;
    assert(!seen.has(offset));
    seen.add(offset);
    assert((offset + 2) * 4 <= buckets.length);
    const count = buckets.readUInt32LE(offset * 4),
      seed = buckets.readUInt32LE((offset + 1) * 4);
    assert((offset + 2 + count * 4) * 4 <= buckets.length);
    for (let j = 0; j < count; j++) {
      const index = offset + 2 + j * 4,
        key = buckets.readUInt32LE(index * 4),
        at = buckets.readUInt32LE((index + 1) * 4),
        compressed = buckets.readUInt32LE((index + 2) * 4),
        size = buckets.readUInt32LE((index + 3) * 4);
      assert(at + compressed <= strings.value.length);
      const b = strings.value.subarray(at, at + compressed),
        decoded = compressed === size ? b : smaz_decode(b, size);
      assert(decoded.length > 0 && decoded.at(-1) === 0);
      slots.push({
        index,
        bucket: i / 4,
        seed,
        key,
        offset: at,
        compressed,
        size,
        text: utf8.decode(decoded.subarray(0, -1)),
      });
    }
  }
  return {
    doc,
    hash,
    bucket,
    strings,
    slots,
    locale: String(doc.properties.find((p) => p.name === "locale")?.value.value ?? "en"),
  };
}
/** 译文追加到字符串池，仅更新对应槽位的位置和长度。 */
export function patch_translation(
  bytes: Buffer,
  changes: ReadonlyMap<number, { original: string; text: string }>,
): Buffer {
  if (!changes.size) return bytes;
  const t = read_translation(bytes),
    buckets = Buffer.from(t.bucket.value as Buffer),
    parts = [t.strings.value as Buffer];
  let offset = parts[0]!.length;
  for (const [index, c] of changes) {
    const slot = t.slots.find((s) => s.index === index);
    assert(slot);
    assert.equal(slot.text, c.original);
    const b = Buffer.from(c.text + "\0");
    parts.push(b);
    buckets.writeUInt32LE(offset, (index + 1) * 4);
    buckets.writeUInt32LE(b.length, (index + 2) * 4);
    buckets.writeUInt32LE(b.length, (index + 3) * 4);
    offset += b.length;
  }
  const strings = Buffer.concat(parts);
  return patch_resource(bytes, [
    {
      start: t.bucket.start,
      end: t.bucket.end,
      bytes: Buffer.concat([u32(32), u32(buckets.length / 4), buckets]),
    },
    {
      start: t.strings.start,
      end: t.strings.end,
      bytes: Buffer.concat([
        u32(31),
        u32(strings.length),
        strings,
        Buffer.alloc(pad(strings.length)),
      ]),
    },
  ]);
}
/** 优化表只存哈希，按 Godot 的一级桶与二级 seed 查找消息键所在槽位，不是本表消息键时返回 `undefined`。 */
export function translation_slot(bytes: Buffer): (key: string) => number | undefined {
  const t = read_translation(bytes),
    hashes = t.hash.value as Buffer,
    buckets = t.bucket.value as Buffer,
    slots = new Map<number, Map<number, number>>();
  for (const s of t.slots)
    slots.set(s.bucket, (slots.get(s.bucket) ?? new Map()).set(s.key, s.index));
  return (key) => {
    if (!hashes.length) return undefined; // 空表没有消息键，不能按零个桶取模。
    const bucket = translation_hash(key) % (hashes.length / 4),
      offset = hashes.readUInt32LE(bucket * 4);
    if (offset === 0xffffffff) return undefined;
    const seed = buckets.readUInt32LE((offset + 1) * 4);
    return slots.get(bucket)?.get(translation_hash(key, seed));
  };
}
/** 语言表计划只采用能完整解析的配置与语言表，返回成员是否参与计划，坏成员抛出原错误供成员边界报告。 */
export function check_locale_member(file: string, bytes: Buffer): boolean {
  const kind = godot_member_kind(file, bytes);
  if (kind === "project") read_project(bytes);
  else if (kind === "po") read_po(bytes.toString("utf8"));
  else if (kind === "translation") {
    const doc = read_resource(bytes);
    if (doc.type === "OptimizedTranslation") read_translation(bytes);
    else read_messages(doc);
  } else return false;
  return true;
}
export type LocalePlan = Readonly<{
  fallback: string; // 项目当前 fallback，未配置时为引擎默认 en。
  locale: string | null; // 本次翻译的语言表 locale，项目没有登记语言表时为 null。
  tables: ReadonlySet<string>; // 参与翻译的语言表成员路径。
}>;
const FALLBACK_SETTING = "internationalization/locale/fallback",
  TRANSLATIONS_SETTING = "internationalization/locale/translations";
/**
 * 首期只翻译一种 locale 的语言表，并让 fallback 指向它：
 * fallback 已有语言表时沿用；否则取项目登记顺序中的第一张表，导出时把 fallback 改为该表 locale。
 * 这样系统语言、游戏内语言菜单选到没有语言表的 locale 时都回落到译文，无需新增克隆表或加载器。
 */
export function plan_translation_locale(files: ReadonlyMap<string, Buffer>): LocalePlan {
  const project = files.get("project.binary"),
    settings = project ? read_project(project) : [],
    setting = (name: string) => settings.find((s) => s.name === name)?.value;
  const fallback = String(setting(FALLBACK_SETTING)?.value ?? "en"),
    tables: { file: string; locale: string }[] = [];
  for (const entry of setting(TRANSLATIONS_SETTING)?.children ?? []) {
    const file = String(entry.value).replace(/^res:\/\//u, ""),
      bytes = files.get(file);
    if (!bytes) continue; // 项目登记但未随包发布的语言表不参与翻译，也不改变 fallback。
    tables.push({ file, locale: translation_locale(file, bytes) });
  }
  const locale = tables.some((t) => t.locale === fallback) ? fallback : (tables[0]?.locale ?? null);
  return {
    fallback,
    locale,
    tables: new Set(tables.filter((t) => t.locale === locale).map((t) => t.file)),
  };
}
/** 导出时只在选定 locale 与原 fallback 不同时改写这一项配置。 */
export function patch_translation_fallback(project: Buffer, plan: LocalePlan): Buffer {
  if (plan.locale === null || plan.locale === plan.fallback) return project;
  return patch_project(project, new Map([[FALLBACK_SETTING, variant_string(plan.locale)]]));
}
/** PO 从 header 读取语言，其余表使用资源属性，缺省沿用引擎的 `en`。 */
export function translation_locale(file: string, bytes: Buffer): string {
  if (godot_member_kind(file, bytes) === "po") {
    const header = read_po(bytes.toString("utf8")).find(
      (field) => field.kind === "msgstr" && /^Language:/mu.test(field.text),
    );
    return /^Language:\s*([^\r\n]+)/mu.exec(header?.text ?? "")?.[1]?.trim() ?? "en";
  }
  const doc = read_resource(bytes);
  return String(doc.properties.find((p) => p.name === "locale")?.value.value ?? "en");
}
