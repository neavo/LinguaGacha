import { expect, it } from "vitest";
import JSZip from "jszip";
import { godot_reference_fixture, create_godot_fixture } from "../../../test/godot-fixture";
import { read_game_container } from "../shared/game/format";
import { create_godot_adapter } from "./godot-format";
import { read_godot_metadata } from "./item";
import { read_godot_projections } from "./readable";

type Projection = {
  error?: string;
  selected?: boolean;
  nodes?: { path: string; groups: string[] }[];
  connections?: unknown[];
  resources?: { path: string; properties: Record<string, unknown> }[];
  strings?: { location: unknown; text: string; context: string | null }[];
};

/** 夹具游戏加一个坏场景，按适配器与视图各自读取同一容器。 */
async function read_fixture(engine: string, extra: ReadonlyMap<string, Buffer> = new Map()) {
  const files = new Map([...create_godot_fixture(engine), ...extra]),
    zip = new JSZip();
  files.set("broken.scn", Buffer.from("RSRCbroken"));
  for (const [name, content] of files) zip.file(name, content);
  const { members } = await read_game_container(
    await zip.generateAsync({ type: "uint8array" }),
    "game.zip",
  );
  const outputs = new Map<string, Buffer>();
  for await (const [name, bytes] of read_godot_projections(members))
    outputs.set(name, Buffer.from(bytes));
  for (const name of members.keys()) expect(outputs.has(name)).toBe(false);
  const projection = (name: string) =>
    JSON.parse(outputs.get(name + ".reference.json")!.toString()) as Projection;
  return { files, members, outputs, projection };
}

it.each(["4.3", "4.6"])("%s 条目坐标都能在投影中找到同一原文", async (engine) => {
  const { files, members, projection } = await read_fixture(engine);
  const handler = await create_godot_adapter().create_members(members);
  let checked = 0;
  for (const [name, bytes] of files) {
    if (name === "broken.scn") continue;
    for (const item of (await handler.read_file(bytes, name)).items) {
      const { location } = read_godot_metadata(item.extra_field);
      expect(projection(name).strings).toContainEqual(
        expect.objectContaining({ location, text: item.src }),
      );
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

it("场景投影给出节点路径、分组和信号连接", async () => {
  const { projection } = await read_fixture("4.6");
  const scene = projection("scene.scn");
  expect(scene.nodes!.map((node) => node.path)).toEqual([
    ".",
    "Display",
    "Unchanged",
    "Display/Inner",
  ]);
  expect(scene.nodes![3]!.groups).toEqual(["ui"]);
  expect(scene.connections).toEqual([
    { from: "Display/Inner", signal: "pressed", to: ".", method: "_on_pressed" },
  ]);
  expect(scene.strings).toContainEqual(expect.objectContaining({ context: "Display:text" }));
});

it.each(["4.3", "4.6"])(
  "%s 优化表按其他成员和语言表中的字符串反查消息键，selected 与选中 locale 一致",
  async (engine) => {
    const { projection } = await read_fixture(engine);
    const table = projection("messages.translation");
    expect(table.selected).toBe(true);
    expect(table.strings).toContainEqual(
      expect.objectContaining({ text: "Shared message", context: "Shared" }),
    );
    expect(table.strings).toContainEqual(
      expect.objectContaining({ text: "Translated message", context: null }),
    );
    const other = projection("po.translation");
    expect(other.selected).toBe(false);
    // 消息键是 msgid，msgctxt 与 msgid 本身都不是译文。
    expect(other.strings!.map(({ text, context }) => [text, context])).toEqual([
      ["old", "key"],
      ["one", "apple"],
      ["many", "apple"],
    ]);
    const { projection: with_po } = await read_fixture(
      engine,
      new Map([["extra.po", Buffer.from('msgid "KEY"\nmsgstr "x"\n')]]),
    );
    expect(with_po("messages.translation").strings).toContainEqual(
      expect.objectContaining({ text: "Translated message", context: "KEY" }),
    );
  },
);

it("坏成员与坏语言表写出错误投影", async () => {
  const { outputs } = await read_fixture(
    "4.6",
    new Map([["broken.translation", Buffer.from("RSCCbroken")]]),
  );
  for (const file of ["broken.scn", "broken.translation"]) {
    expect(JSON.parse(outputs.get(file + ".error.reference.json")!.toString()).error).toEqual(
      expect.any(String),
    );
  }
});

it("内部资源引用指向投影 resources 中的目标", async () => {
  const { projection } = await read_fixture(
    "4.6",
    new Map([["refs.res", godot_reference_fixture(true)]]),
  );
  const resources = projection("refs.res").resources!;
  expect(resources[1]!.properties.target).toEqual({ $sub_resource: 0 });
  expect(resources[0]!.properties.text).toBe("Target");
});
