import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { NativeFs } from "../../../native/native-fs";
import { wolf_command, wolf_common, wolf_files } from "../../../test/wolf-fixture";
import { wolf_archive_fixture } from "../../../test/wolf-archive-fixture";
import { FileFormatService } from "../file-format-service";
import { read_wolf_common } from "./common-events";
import { read_wolf_map } from "./map";
import { read_wolf_metadata } from "./item";
import { create_wolf_context } from "./wolf-format";

it("游戏根目录、EXE 和 Data 去重为一个资产，解包覆盖散装文件并可离线重建和导出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-format-"));
  const root = path.join(temp.path, "game"),
    native = new NativeFs(),
    files = wolf_files();
  native.write_file_sync(path.join(root, "GamePro.exe"), "fixture");
  native.write_file_sync(path.join(root, "Data/BasicData/CommonEvent.dat"), "old loose file");
  native.write_file_sync(
    path.join(root, "Data.wolf"),
    await wolf_archive_fixture(
      new Map([...files].map(([name, bytes]) => [name.slice(5), bytes])),
      0,
    ),
  );
  const service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
  const sources = [root, path.join(root, "GamePro.exe"), path.join(root, "Data")];
  const entries = await service.collect_source_file_entries(sources);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.file_type).toBe("WOLFRPG");
  expect((await service.summarize_source_files(sources)).format_hit_counts.wolfrpg).toBe(1);
  const asset = await service.prepare_source(entries[0]!);
  expect(fs.existsSync(path.join(root, "Data.wolf"))).toBe(false);
  for (const [name, bytes] of files)
    expect(fs.readFileSync(path.join(root, name)).equals(bytes)).toBe(true);
  const repeat = await service.collect_source_file_entries([root]);
  await expect(service.prepare_source(repeat[0]!)).resolves.toBeDefined();
  const parsed = await service.parse_asset("game.zip", asset.content, "WOLFRPG");
  if (parsed.kind !== "items") throw new Error("Expected items");
  expect(parsed.warnings).toEqual([]);
  const common = parsed.items.find(
    (item) => read_wolf_metadata(item.extra_field).location.kind === "common_command",
  )!;
  common.status = "PROCESSED";
  common.dst = "中文𠮷\n\\cdb[0:1:2]";
  const released = parsed.items.find((item) => {
    const metadata = read_wolf_metadata(item.extra_field);
    return (
      metadata.internal_file_path.endsWith("Unregistered.mps") &&
      metadata.location.kind === "map_command"
    );
  })!;
  released.status = "PROCESSED";
  released.dst = "人工放行译文";
  fs.renameSync(root, root + "-moved");
  const context = {
    paths: {
      translated_path: path.join(temp.path, "output"),
      bilingual_path: path.join(temp.path, "bilingual"),
    },
    asset_reader: async () => Buffer.from(asset.content),
    source_files: [{ path: "game.zip", file_type: "WOLFRPG" }],
  };
  await service.write_items(parsed.items.toReversed(), context);
  for (const [name, bytes] of files) {
    const actual = fs.readFileSync(path.join(context.paths.translated_path, "game", name));
    if (name.endsWith("CommonEvent.dat"))
      expect(read_wolf_common(actual).slots.at(-1)!.text).toBe(common.dst);
    else if (name.endsWith("Unregistered.mps"))
      expect(read_wolf_map(actual).slots.some((slot) => slot.text === released.dst)).toBe(true);
    else expect(actual.equals(bytes)).toBe(true);
  }
});

it.each([
  ["按名称读取", ["", "地图登记", "", "显示名称"], [9, 0, 9, 0x11100, 1600005], "metadata"],
  ["按编号读取", [], [0, 0, 1, 0x11100, 1600005], "metadata"],
  ["写回数据库", ["", "地图登记", "", "显示名称"], [9, 0, 9, 0x10100, 1600005], "text"],
  ["读入其他变量", ["", "地图登记", "", "显示名称"], [9, 0, 9, 0x11100, 1600006], "text"],
])("公共事件%s拼入资源路径的字段时决定该字段的默认用途", async (_, strings, integers, usage) => {
  const files = wolf_files();
  files.set(
    "Data/BasicData/CommonEvent.dat",
    wolf_common(0x91, [
      wolf_command(250, strings, integers),
      wolf_command(122, ["BGM/\\cself[05].ogg"], [1600007, 0, 0]),
    ]),
  );
  const context = await create_wolf_context(
    new Map([...files].map(([name, bytes]) => [name, { async: async () => bytes }])),
  );
  const system = await context.read("Data/BasicData/SysDatabase.dat", new Uint8Array());
  expect(system!.slots.map((slot) => [slot.text, slot.usage])).toEqual([
    ["MapData/Map001.mps", "metadata"],
    ["城镇", usage],
  ]);
});

it("缺少核心配对整项失败，损坏的独立地图保留警告和零条目原稿", async () => {
  const service = new FileFormatService({ target_language: "ZH" }, async () => null),
    zip = new JSZip();
  for (const [name, bytes] of wolf_files()) zip.file(name, bytes);
  zip.file("Data/MapData/Broken.mps", Buffer.from([1]));
  const parsed = await service.parse_asset(
    "game.zip",
    await zip.generateAsync({ type: "uint8array" }),
    "WOLFRPG",
  );
  if (parsed.kind !== "items") throw new Error("Expected items");
  expect(parsed.warnings).toMatchObject([{ internal_file_path: "Data/MapData/Broken.mps" }]);
  zip.remove("Data/BasicData/SysDatabase.project");
  await expect(
    service.parse_asset("game.zip", await zip.generateAsync({ type: "uint8array" }), "WOLFRPG"),
  ).rejects.toThrow("Missing WOLF companion");
});
