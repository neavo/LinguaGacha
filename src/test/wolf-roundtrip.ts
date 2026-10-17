import assert from "node:assert/strict";
import { replace_wolf_slots, type WolfDocument } from "../backend/file/wolfrpg/binary";

/** 各布局共用字节守恒契约，调用者仍负责自己的结构预期。 */
export function assert_wolf_roundtrip(
  bytes: Buffer,
  parse: (bytes: Uint8Array) => WolfDocument,
): WolfDocument {
  const doc = parse(bytes),
    slot = doc.slots[0]!;
  assert.strictEqual(replace_wolf_slots(doc, new Map()), bytes);
  for (const text of ["", "译文𠮷\n\\cdb[0:1:2]".repeat(15)]) {
    const changed = parse(replace_wolf_slots(doc, new Map([[slot, text]])));
    assert.deepEqual(
      changed.slots.map((value) => value.text),
      [text, ...doc.slots.slice(1).map((value) => value.text)],
    );
    if (!doc.offsets)
      assert.deepEqual(changed.bytes.subarray(changed.slots[0]!.end), doc.bytes.subarray(slot.end));
  }
  return doc;
}
