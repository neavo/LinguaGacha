import { expect, it } from "vitest";
import { read_renpy_metadata, renpy_default_status, type RenpyMetadata } from "./item";

it("持久坐标拒绝非法区间，默认状态只取决于用途", () => {
  const metadata: RenpyMetadata = {
    internal_file_path: "game/script.rpyc",
    digest: "a".repeat(64),
    usage: "code",
    key: "candidate",
    coordinates: [{ slot: 1, edge: 12, field: "code", start: 0, end: 5 }],
  };
  const item = { extra_field: { renpy_game: metadata } };
  expect(read_renpy_metadata(item.extra_field)).toEqual(metadata);
  expect(renpy_default_status(item)).toBe("RULE_SKIPPED");
  metadata.usage = "display";
  expect(renpy_default_status(item)).toBe("NONE");
  metadata.coordinates[0]!.end = 0;
  expect(() => read_renpy_metadata(item.extra_field)).toThrow("Invalid Ren'Py code span");
});
