import assert from "node:assert/strict";
import type { Item } from "../../../domain/item";
import { replace_wolf_slots, type WolfDocument, type WolfSlot } from "./binary";
import { read_wolf_metadata, wolf_location_key } from "./item";

/** 完成译文必须匹配原稿和指令码，冲突不依赖条目顺序解决。 */
export function write_wolf_items(
  document: WolfDocument,
  file: string,
  items: readonly Item[],
): Uint8Array {
  const slots = new Map(document.slots.map((slot) => [wolf_location_key(slot.location), slot])),
    edits = new Map<WolfSlot, string>();
  for (const item of items) {
    if (item.status !== "PROCESSED") continue;
    const metadata = read_wolf_metadata(item.extra_field);
    assert.equal(metadata.internal_file_path, file, "WOLF item belongs to another member");
    const slot = slots.get(wolf_location_key(metadata.location));
    assert(
      slot && slot.text === item.src,
      "Stale WOLF location/source: " + wolf_location_key(metadata.location),
    );
    assert(
      !edits.has(slot) || edits.get(slot) === item.dst,
      "Conflicting WOLF translations: " + wolf_location_key(metadata.location),
    );
    edits.set(slot, item.dst);
  }
  for (const [slot, text] of edits) if (slot.text === text) edits.delete(slot);
  return replace_wolf_slots(document, edits);
}
