import assert from "node:assert/strict";
import { open_wolf_document, WolfReader, type WolfDocument } from "./binary";
import { read_wolf_command, type WolfCommand } from "./commands";

const MAGIC = [0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x43, 0];
const VERSIONS = [0x90, 0x91, 0x93, 0xcc];
const COMPRESSED = [0x93, 0xcc];

/** 事件 ID 用作上下文，写回使用原稿数组中的物理位置。 */
export function read_wolf_common(input: Uint8Array): WolfDocument {
  const doc = open_wolf_document(input, MAGIC, 6, 10, VERSIONS, COMPRESSED, 11);
  const reader = new WolfReader(doc.bytes, 11, doc.utf8),
    events = [];
  for (let count = reader.count(), event = 0; event < count; event++) {
    reader.expect(0x8e);
    const id = reader.uint();
    reader.take(11);
    const name = reader.string({ kind: "common_name", event }, "metadata", "Event " + id),
      commands: WolfCommand[] = [];
    for (let n = reader.count(), command = 0; command < n; command++)
      commands.push(
        read_wolf_command(
          reader,
          { kind: "common_command", event, command },
          doc.compression !== null,
        ),
      );
    const description = reader.string();
    reader.string();
    reader.expect(0x8f);
    for (let n = reader.count(); n; n--) reader.string();
    reader.take(reader.count());
    for (let n = reader.count(); n; n--) for (let m = reader.count(); m; m--) reader.string();
    for (let n = reader.count(); n; n--) reader.take(reader.count() * 4);
    reader.take(29);
    for (let i = 0; i < 100; i++) reader.string();
    reader.expect(0x91);
    reader.string();
    const end = reader.byte();
    if (end === 0x92) {
      reader.string();
      reader.uint();
      reader.expect(0x92);
    } else assert.equal(end, 0x91, "Unsupported WOLF common event tail");
    events.push({ event, id, name, description, commands });
  }
  assert(reader.byte() >= 0x89, "Invalid WOLF common file terminator");
  reader.done();
  doc.slots = reader.slots;
  doc.details = { version: doc.bytes[10], events };
  return doc;
}
