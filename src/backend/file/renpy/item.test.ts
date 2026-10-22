import { expect, it } from "vitest";
import { read_renpy_metadata, renpy_default_status, type RenpyMetadata } from "./item";

it("持久身份拒绝非法摘要，默认状态只取决于用途", () => {
  const metadata: RenpyMetadata = {
    internal_file_path: "game/script.rpyc",
    digest: "a".repeat(64),
    usage: "code",
    key: "candidate",
  };
  const item = { extra_field: { renpy: metadata } };
  expect(read_renpy_metadata(item.extra_field)).toEqual(metadata);
  expect(renpy_default_status(item)).toBe("RULE_SKIPPED");
  metadata.usage = "display";
  expect(renpy_default_status(item)).toBe("NONE");
  metadata.digest = "invalid";
  expect(() => read_renpy_metadata(item.extra_field)).toThrow("Invalid Ren'Py digest");
});
