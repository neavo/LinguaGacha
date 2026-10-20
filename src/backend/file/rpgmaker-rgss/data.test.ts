import { expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";
import {
  ruby_array as a,
  ruby_string as s,
  ruby_integer as n,
  ruby_command as c,
  ruby_object as o,
} from "../../../test/rgss-fixture";
import { decode, encode, field, base } from "./marshal";
import { array, text, integer, bytes } from "./value";
import { read_rgss_data, write_rgss_data } from "./data";
import { read_rgss_metadata } from "./item";
import type { RGSSVersion } from "./source";

it.each<RGSSVersion>(["xp", "vx", "ace"])(
  "%s 多行对白分页与嵌套选项按原始定位写回",
  async (version) => {
    const list = a([
      c(101, version === "xp" ? [s("first")] : [s("face"), n(0), n(0), n(2)]),
      c(401, [s("second")]),
      c(102, [a([s("outer A"), s("outer B")])]),
      c(402, [n(0), s("outer A")]),
      c(102, [a([s("inner")])], 1),
      c(402, [n(0), s("inner")], 1),
      c(404, [], 1),
      c(402, [n(1), s("outer B")]),
      c(404, []),
      c(0, []),
    ]);
    const root = decode(encode(o("RPG::Event::Page", { "@list": list })));
    const parsed = await read_rgss_data(root, "Data/Map001.rvdata2", version, false);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.items[0]!.src).toBe(version === "xp" ? "first\nsecond" : "second");
    const changes = parsed.items.filter((item) =>
      ["first\nsecond", "second", "outer B"].includes(item.src),
    );
    for (const item of changes) item.dst = item.src === "outer B" ? "外二" : "一\n二\n三\n四\n五";
    await write_rgss_data(root, changes.reverse(), version);
    const output = decode(encode(root)),
      commands = array(field(output, "@list")!);
    expect(
      commands.slice(0, version === "xp" ? 5 : 7).map((node) => integer(field(node, "@code")!)),
    ).toEqual(version === "xp" ? [101, 401, 401, 401, 101] : [101, 401, 401, 401, 401, 101, 401]);
    const reparsed = await read_rgss_data(output, "Data/Map001.rvdata2", version, false);
    expect(
      reparsed.items.filter((item) => ["外二", "inner"].includes(item.src)).map((item) => item.src),
    ).toEqual(["外二", "inner"]);
    const branch = commands.find(
      (node) =>
        integer(field(node, "@code")!) === 402 &&
        integer(array(field(node, "@parameters")!)[0]!) === 1,
    )!;
    expect(text(array(field(branch, "@parameters")!)[1]!)).toBe("外二");
  },
);
it("脚本归档修改合并，失败脚本和未修改压缩载荷保持原样", async () => {
  const compressed = (source: string) => ({ t: '"', data: deflateSync(Buffer.from(source)) });
  const root = a([
    a([n(1), s("name"), compressed('puts "one", "two"')]),
    a([n(2), s("broken"), compressed('puts "broken')]),
    a([n(3), s("keep"), compressed('puts "keep"')]),
  ]);
  const original = bytes(array(array(root)[2]!)[2]!);
  const parsed = await read_rgss_data(root, "Data/Scripts.rvdata2", "ace", true);
  expect(parsed.warnings).toHaveLength(1);
  const changes = parsed.items.filter((item) => item.src !== "keep");
  for (const item of changes) item.dst = "译" + item.src;
  await write_rgss_data(root, changes, "ace");
  expect(inflateSync(bytes(array(array(root)[0]!)[2]!)).toString()).toBe('puts "译one", "译two"');
  expect(bytes(array(array(root)[2]!)[2]!)).toBe(original);
  expect(text(array(array(root)[0]!)[1]!)).toBe("name");
});
it.each<RGSSVersion>(["xp", "vx", "ace"])(
  "%s 脚本来源默认排除，变量操作数按版本解释，正文仍可翻译",
  async (version) => {
    const root = o("Fixture", {
      "@list": a([
        c(355, [s('table = {"key" => "value"}; puts table["key"]')]),
        c(111, [n(12), s('name == "condition"')]),
        c(122, [n(1), n(1), n(0), n(4), version === "ace" ? s('"variable"') : n(1), n(0)]),
        c(101, version === "xp" ? [s("dialogue")] : [s(""), n(0), n(0), n(2)]),
        ...(version === "xp" ? [] : [c(401, [s("dialogue")])]),
        c(102, [a([s("choice")])]),
      ]),
      "@route": a([
        o("RPG::MoveCommand", { "@code": n(45), "@parameters": a([s('puts "move"')]) }),
      ]),
    });
    const result = await read_rgss_data(root, "Data/Map001.rvdata2", version, false);
    expect(result.warnings).toEqual([]);
    expect(result.items.map((item) => [item.src, item.status])).toEqual([
      ["key", "RULE_SKIPPED"],
      ["value", "RULE_SKIPPED"],
      ["key", "RULE_SKIPPED"],
      ["condition", "RULE_SKIPPED"],
      ...(version === "ace" ? [["variable", "RULE_SKIPPED"]] : []),
      ["dialogue", "NONE"],
      ["choice", "NONE"],
      ["move", "RULE_SKIPPED"],
    ]);
  },
);
it("数据库默认翻译资格与元数据分开，子目录同名文件不套用数据库字段，ASCII 标记随中文写回更新", async () => {
  const ascii = s("name");
  ascii.pairs![0]![1] = { t: "F" };
  const root = a([
    { t: "0" },
    o("RPG::Actor", { "@name": ascii, "@character_name": s("asset"), "@note": s("note") }),
  ]);
  const nested = await read_rgss_data(root, "Data/plugin/Actors.rvdata2", "ace", false);
  expect(nested.items.map((item) => item.status)).toEqual(Array(3).fill("RULE_SKIPPED"));
  const parsed = await read_rgss_data(root, "Data/Actors.rvdata2", "ace", false);
  expect(parsed.items.map((item) => item.status)).toEqual(["NONE", "RULE_SKIPPED", "RULE_SKIPPED"]);
  const item = parsed.items[0]!;
  item.dst = "中文";
  await write_rgss_data(root, [item], "ace");
  const value = field(array(root)[1]!, "@name")!;
  expect(text(value)).toBe("中文");
  expect(value.pairs![0]![1].t).toBe("T");
  expect(base(value).data!.equals(Buffer.from("中文"))).toBe(true);
  expect(read_rgss_metadata(item.extra_field).usage).toBe("text");
});

it("普通 Hash 数组与默认翻译字段共同提取", async () => {
  const hash = {
    t: "{",
    pairs: [
      [s("key"), s("value")],
      [n(1), s("number")],
    ] as [ReturnType<typeof s>, ReturnType<typeof s>][],
  };
  const root = a([o("RPG::Actor", { "@name": s("hero"), "@custom": a([hash]) })]);
  const result = await read_rgss_data(root, "Data/Actors.rvdata2", "ace", false);
  expect(result.items.map((item) => item.src)).toEqual(["hero", "value", "number"]);
});

it("不同槽位共享字符串仍可分别翻译，父对象别名共享同一结果", async () => {
  const shared = s("shared"),
    parent = o("RPG::Actor", { "@name": shared, "@description": shared });
  const root = decode(encode(a([parent, parent])));
  const parsed = await read_rgss_data(root, "Data/Actors.rvdata2", "ace", false);
  expect(parsed.items).toHaveLength(2);
  parsed.items[0]!.dst = "姓名";
  parsed.items[1]!.dst = "描述";
  await write_rgss_data(root, parsed.items, "ace");
  const result = decode(encode(root));
  expect(base(array(result)[0]!)).toBe(base(array(result)[1]!));
  expect(text(field(array(result)[0]!, "@name")!)).toBe("姓名");
  expect(text(field(array(result)[1]!, "@description")!)).toBe("描述");
});
it("同槽位的路径别名合并相同译文，冲突时原稿对象完全不变", async () => {
  const parent = o("RPG::Actor", { "@name": s("shared") });
  const root = decode(encode(a([parent, parent, o("RPG::Actor", { "@name": s("other") })])));
  const parsed = await read_rgss_data(root, "Data/Actors.rvdata2", "ace", false);
  const item = parsed.items[0]!,
    other = parsed.items[1]!;
  item.dst = "一致";
  other.dst = "其他";
  const alias = structuredClone(item),
    location = read_rgss_metadata(alias.extra_field).location;
  if (location.kind !== "field") throw Error("Expected field");
  location.path = [1, { field: "@name" }];
  alias.dst = "冲突";
  const before = encode(root);
  await expect(write_rgss_data(root, [other, item, alias], "ace")).rejects.toThrow("Conflicting");
  expect(encode(root).equals(before)).toBe(true);
  alias.dst = item.dst;
  await write_rgss_data(root, [alias, item, other], "ace");
  expect(text(field(array(root)[0]!, "@name")!)).toBe("一致");
  expect(text(field(array(root)[2]!, "@name")!)).toBe("其他");
});
it("共享事件列表按实际列表身份合并并倒序修改", async () => {
  const list = a([
    c(101, [s("face"), n(0), n(0), n(2)]),
    c(401, [s("first")]),
    c(101, [s("face"), n(0), n(0), n(2)]),
    c(401, [s("last")]),
    c(0, []),
  ]);
  const root = decode(encode(o("Fixture", { "@first": list, "@second": list })));
  const parsed = await read_rgss_data(root, "Data/Map001.rvdata2", "ace", false);
  const changes = parsed.items.filter((item) => item.status === "NONE");
  expect(changes).toHaveLength(2);
  changes[0]!.dst = "一\n二\n三\n四\n五";
  changes[1]!.dst = "末尾";
  const alias = structuredClone(changes[0]!),
    location = read_rgss_metadata(alias.extra_field).location;
  if (location.kind !== "block") throw Error("Expected block");
  location.path = [{ field: "@second" }];
  await write_rgss_data(root, [changes[1]!, alias, changes[0]!], "ace");
  expect(base(field(root, "@first")!)).toBe(base(field(root, "@second")!));
  const result = await read_rgss_data(root, "Data/Map001.rvdata2", "ace", false);
  expect(result.items.filter((item) => item.status === "NONE").map((item) => item.src)).toEqual([
    "一\n二\n三\n四",
    "五",
    "末尾",
  ]);
});
it("只有明确的 EventCommand 和 MoveCommand 进入事件解释", async () => {
  const impostor = o("Fixture", { "@code": n(355), "@parameters": a([s('puts "ordinary"')]) });
  const move = o("RPG::MoveCommand", { "@code": n(45), "@parameters": a([s('puts "move"')]) });
  const root = o("Fixture", {
    "@data": a([impostor]),
    "@route": a([move]),
    "@event": a([c(355, [s('puts "event"')])]),
  });
  const result = await read_rgss_data(root, "Data/Map001.rvdata2", "ace", false);
  expect(result.warnings).toEqual([]);
  expect(
    result.items.map((item) => [item.src, read_rgss_metadata(item.extra_field).location.kind]),
  ).toEqual([
    ['puts "ordinary"', "field"],
    ["move", "ruby"],
    ["event", "ruby"],
  ]);
});

it("共享选项槽位去重后仍同步所有关联分支", async () => {
  const choices = a([s("choice")]);
  const root = decode(
    encode(
      a([
        c(102, [choices]),
        c(402, [n(0), s("choice")]),
        c(404, []),
        c(102, [choices]),
        c(402, [n(0), s("choice")]),
        c(404, []),
      ]),
    ),
  );
  const parsed = await read_rgss_data(root, "Data/CommonEvents.rvdata2", "ace", false);
  expect(parsed.items).toHaveLength(1);
  parsed.items[0]!.dst = "选项";
  await write_rgss_data(root, parsed.items, "ace");
  for (const index of [1, 4])
    expect(text(array(field(array(root)[index]!, "@parameters")!)[1]!)).toBe("选项");
});

it.each([false, true])(
  "共享词典的默认翻译资格不受成员顺序影响：标准字段入口在前=%s",
  async (display_first) => {
    const label = s("term"),
      dictionary = o("RPG::System::Terms", { "@basic": a([label]) });
    const entries: Record<string, ReturnType<typeof o>> = display_first
      ? { "@terms": dictionary, "@plugin_terms": dictionary }
      : { "@plugin_terms": dictionary, "@terms": dictionary };
    const root = decode(encode(o("RPG::System", { ...entries, "@resource": label })));
    const parsed = await read_rgss_data(root, "Data/System.rvdata2", "ace", false);
    expect(parsed.warnings).toEqual([]);
    expect(
      parsed.items.map((item) => [
        item.src,
        read_rgss_metadata(item.extra_field).usage,
        item.status,
      ]),
    ).toEqual([
      ["term", "text", "NONE"],
      ["term", "metadata", "RULE_SKIPPED"],
    ]);
  },
);
it.each([false, true])(
  "普通字段与事件共享槽位时默认翻译资格优先：事件入口在前=%s",
  async (event_first) => {
    const event = c(320, [n(1), s("actor")]),
      parameters = field(event, "@parameters")!,
      events = a([event]);
    const root = o(
      "Fixture",
      event_first
        ? { "@events": events, "@plugin": parameters }
        : { "@plugin": parameters, "@events": events },
    );
    const parsed = await read_rgss_data(root, "Data/Map001.rvdata2", "ace", false);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.status).toBe("NONE");
    expect(read_rgss_metadata(parsed.items[0]!.extra_field).usage).toBe("text");
  },
);
