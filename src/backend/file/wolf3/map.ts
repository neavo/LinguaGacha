import assert from "node:assert/strict";
import { open_wolf_document, WolfReader, WolfProtocolError, type WolfDocument } from "./binary";
import { read_wolf_command, read_wolf_route, type WolfCommand } from "./commands";

const MAGIC = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x57, 0x4f, 0x4c, 0x46, 0x4d, 0, 0, 0, 0, 0];
const VERSIONS = [0x64, 0x65, 0x66, 0x67];
const COMPRESSED = [0x65, 0x66, 0x67];

/** 地图层数和指令附加区由布局标记决定。 */
export function read_wolf_map(input: Uint8Array): WolfDocument {
  const doc = open_wolf_document(input, MAGIC, 16, 20, VERSIONS, COMPRESSED, 25);
  const version = doc.bytes.readUInt32LE(20);
  if (!VERSIONS.includes(version))
    throw new WolfProtocolError("Unsupported WOLF map version: " + version);
  const reader = new WolfReader(doc.bytes, 25, doc.utf8);
  const name = reader.string(),
    tileset = reader.uint(),
    width = reader.uint(),
    height = reader.uint(),
    count = reader.count();
  let layers = 3;
  if (version >= 0x67) {
    reader.uint();
    layers = reader.uint();
  }
  assert(
    Number.isSafeInteger(width * height * layers) && width * height * layers < 10000000,
    "Invalid WOLF map dimensions",
  );
  if (reader.uint() !== 0xffffffff) {
    reader.at -= 4;
    reader.take(width * height * layers * 4);
  }
  const events = [];
  for (let event = 0; event < count; event++) {
    reader.expect(0x6f);
    assert.equal(reader.uint(), 12345);
    // 事件名称默认保护，字符串长度前缀不能证明引擎可接受同样长度。
    const id = reader.uint(),
      event_name = reader.string({ kind: "map_name", event }, "metadata", "Event " + id);
    reader.take(8);
    const pages_count = reader.count();
    assert.equal(reader.uint(), 0);
    const pages = [];
    for (let page = 0; page < pages_count; page++) {
      reader.expect(0x79);
      reader.uint();
      const graphic = reader.string({ kind: "map_graphic", event, page });
      reader.take(47);
      for (let n = reader.count(); n; n--) read_wolf_route(reader);
      const commands: WolfCommand[] = [];
      for (let n = reader.count(), command = 0; command < n; command++)
        commands.push(
          read_wolf_command(reader, { kind: "map_command", event, page, command }, version >= 0x67),
        );
      const features = reader.uint();
      reader.take(3);
      if (features > 3) reader.byte();
      reader.expect(0x7a);
      pages.push({ page, graphic, commands });
    }
    reader.expect(0x70);
    events.push({ event, id, name: event_name, pages });
  }
  reader.expect(0x66);
  reader.done();
  doc.slots = reader.slots;
  doc.details = { version, name, tileset, width, height, layers, events };
  return doc;
}
