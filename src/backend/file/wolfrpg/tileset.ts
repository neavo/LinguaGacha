import assert from "node:assert/strict";
import { open_wolf_document, WolfReader, type WolfDocument } from "./binary";

const MAGIC = [0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x4d, 0];
const TILESET_STRINGS = 33; // 每条图块记录固定的字符串数量。

/** 图块名称与资源字段均保留人工编辑资格，通行和属性区原字节保留。 */
export function read_wolf_tileset(input: Uint8Array): WolfDocument {
  const doc = open_wolf_document(input, MAGIC, 6, 10, [0xd2, 0xd3], [], 11);
  const reader = new WolfReader(doc.bytes, 11, doc.utf8),
    records = [];
  for (let n = reader.count(), record = 0; record < n; record++) {
    const fields = [];
    for (let string = 0; string < TILESET_STRINGS; string++)
      fields.push(reader.string({ kind: "tileset_string", record, string }));
    reader.expect(0xff);
    const size = reader.count();
    reader.take(size);
    reader.expect(0xff);
    assert.equal(reader.uint(), size);
    reader.take(size * 4);
    records.push(fields);
  }
  reader.expect(0xcf);
  reader.done();
  doc.slots = reader.slots;
  doc.details = { records };
  return doc;
}
