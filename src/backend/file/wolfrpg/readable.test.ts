import { expect, it } from "vitest";
import JSZip from "jszip";
import { wolf_files, wolf_common, wolf_command } from "../../../test/wolf-fixture";
import { FileFormatService } from "../file-format-service";
import { read_game_container } from "../shared/game/format";
import { read_wolf_sources } from "./readable";
import { read_wolf_common } from "./common-events";
import { read_wolf_map } from "./map";
import { read_wolf_metadata, wolf_location_key } from "./item";
import type { WolfSlot } from "./binary";

it("地图登记资格在条目和 Agent 投影中一致", async () => {
  const files = wolf_files(),
    zip = new JSZip();
  const common_path = "Data/BasicData/CommonEvent.dat",
    registered = "Data/MapData/Map001.mps",
    unregistered = "Data/MapData/Unregistered.mps";
  files.set(common_path, wolf_common(0x91, [wolf_command(101, ["原文"]), wolf_command(101, [""])]));
  for (const [name, content] of files) zip.file(name, content);
  const content = await zip.generateAsync({ type: "uint8array" });
  const service = new FileFormatService({ target_language: "ZH" }, async () => null);
  const parsed = await service.parse_asset("game.zip", content, "WOLFRPG");
  if (parsed.kind !== "items") throw new Error("Expected items");
  const projections = new Map<
    string,
    Pick<WolfSlot, "text" | "location" | "usage" | "context">[]
  >();
  for await (const [name, bytes] of read_wolf_sources(
    (await read_game_container(content, "game.zip")).members,
  )) {
    if ([registered, unregistered, common_path].some((file) => name === file + ".json"))
      projections.set(
        name.slice(0, -5),
        (
          JSON.parse(Buffer.from(bytes).toString()) as {
            strings: Pick<WolfSlot, "text" | "location" | "usage" | "context">[];
          }
        ).strings,
      );
  }
  for (const file of [registered, unregistered, common_path]) {
    const original =
      file === common_path ? read_wolf_common(files.get(file)!) : read_wolf_map(files.get(file)!);
    const projection = projections.get(file)!;
    for (const slot of original.slots) {
      const projected = projection.find(
        (value) => wolf_location_key(value.location) === wolf_location_key(slot.location),
      );
      const usage = file === unregistered ? "metadata" : slot.usage;
      expect(projected).toEqual({
        text: slot.text,
        location: slot.location,
        context: slot.context,
        usage,
      });
      if (slot.text === "") continue; // 可读原稿保留空槽位，工程条目只比较实际提取目标。
      const item = parsed.items.find((item) => {
        const metadata = read_wolf_metadata(item.extra_field);
        return (
          metadata.internal_file_path === file &&
          wolf_location_key(metadata.location) === wolf_location_key(slot.location)
        );
      })!;
      expect(item.src).toBe(slot.text);
      expect(read_wolf_metadata(item.extra_field)).toMatchObject({
        location: slot.location,
        usage,
      });
      expect(item.status).toBe(usage === "text" ? "NONE" : "RULE_SKIPPED");
    }
  }
  expect(
    projections.get(registered)!.find((slot) => slot.location.kind === "map_command")!.usage,
  ).toBe("text");
  expect(
    projections.get(registered)!.find((slot) => slot.location.kind === "map_graphic")!.usage,
  ).toBe("metadata");
  expect(projections.get(common_path)!.some((slot) => slot.text === "")).toBe(true);
  for (const [name, member] of (await read_game_container(content, "game.zip")).members)
    expect((await member.async("nodebuffer")).equals(files.get(name)!)).toBe(true);
});
