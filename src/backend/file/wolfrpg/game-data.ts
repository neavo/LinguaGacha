import assert from "node:assert/strict";
import { open_wolf_document, WolfReader, type WolfDocument } from "./binary";

const MAGIC = [0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x4d, 0];
const COUNTS = [8, 9, 13, 14]; // 已知版本的字符串槽位数量。
const TEXT_FIELDS = new Set([8, 11, 12]); // 默认参与翻译的槽位，其余槽位作为元数据。

/** 主标题参与存档身份，魔数与密钥不是可编辑字符串。 */
export function read_wolf_game(input: Uint8Array): WolfDocument {
  const doc = open_wolf_document(input, MAGIC, 9, null, [], [], 10);
  const reader = new WolfReader(doc.bytes, 10, doc.utf8);
  reader.take(reader.count());
  const count = reader.count();
  assert(COUNTS.includes(count), "Unsupported WOLF Game.dat string count: " + count);
  const fields: Record<number, string> = {};
  for (let string = 0; string < count; string++) {
    if (string === 2) {
      reader.take(reader.count());
      continue;
    }
    const text = reader.string(
      string === 1 || string === 13 ? undefined : { kind: "game_string", string },
      TEXT_FIELDS.has(string) ? "text" : "metadata",
    );
    if (string === 1) assert(text === "0000-0000", "Unsupported WOLF game identity: " + text);
    else fields[string] = text;
  }
  const size_at = reader.at,
    size = reader.uint();
  assert(size === doc.bytes.length - 1, "Invalid WOLF Game.dat file size");
  reader.uint();
  reader.take(reader.count() * 2);
  const offset_at = reader.at,
    first = reader.uint(),
    second = reader.uint();
  assert(first <= doc.bytes.length && second <= doc.bytes.length, "Invalid WOLF Game.dat offsets");
  doc.offsets = [size_at, offset_at, offset_at + 4];
  doc.slots = reader.slots;
  doc.details = { fields };
  return doc;
}
