import { expect, it } from "vitest";
import { wolf_game } from "../../../test/wolf-fixture";
import { read_wolf_game } from "./game-data";
import {
  extract_wolf_items,
  read_wolf_metadata,
  wolf_default_status,
  wolf_location_key,
} from "./item";

it("条目生成和重置共用用途，跳过空槽位并保留物理定位", () => {
  const document = read_wolf_game(wolf_game()),
    items = extract_wolf_items(document, "Data/BasicData/Game.dat");
  expect(items.some((item) => item.src === "")).toBe(false);
  expect(items.find((item) => item.src === "主标题")!.status).toBe("RULE_SKIPPED");
  expect(items.find((item) => item.src === "副标题")!.status).toBe("NONE");
  for (const item of items) {
    expect(wolf_default_status(item)).toBe(item.status);
    const metadata = read_wolf_metadata(item.extra_field);
    expect(
      document.slots.find(
        (slot) => wolf_location_key(slot.location) === wolf_location_key(metadata.location),
      )!.text,
    ).toBe(item.src);
  }
});
