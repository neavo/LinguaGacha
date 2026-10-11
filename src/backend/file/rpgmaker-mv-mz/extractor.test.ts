import { SOURCE_CONTEXT_MAX_LENGTH } from "./types";
import { expect, it } from "vitest";
import { create_rpgmaker_extractor } from "./extractor";
import { read_json_record } from "../../../domain/json";

it("JSON 只展开字符串值，标量与无效 JSON 保持原文，内部事件形状按普通结构遍历", () => {
  const extractor = create_rpgmaker_extractor("data/Plugins.json");
  const source = JSON.stringify({
    title: "开始",
    count: 1,
    enabled: true,
    empty: null,
    list: [{ code: 401, parameters: ["事件形状"] }],
    values: ["0", "true", "null", '"引号文本"', "{坏文本", "[]", "{}", ""],
  });
  extractor.add(source, { usage: "metadata", location: { kind: "field", path: ["settings"] } });
  expect(extractor.items.map(({ src, status }) => [src, status])).toEqual(
    ["开始", "事件形状", "0", "true", "null", '"引号文本"', "{坏文本"].map((src) => [
      src,
      "RULE_SKIPPED",
    ]),
  );
  expect(extractor.items[1]?.extra_field).toMatchObject({
    rpgmaker: {
      location: {
        kind: "json",
        path: ["list", 0, "parameters", 0],
        container: { kind: "field", path: ["settings"] },
      },
      source_context: expect.stringContaining("settings"),
    },
  });
});

it("六层解码保留每层路径与外层用途，上下文有界且保留邻近值", () => {
  const extractor = create_rpgmaker_extractor("js/plugins.js");
  let source = JSON.stringify({ Text: "はい", Hint: "选择提示", padding: "😀".repeat(2000) });
  for (const key of ["Command", "CommandList", "Window", "WindowList", "SceneCustomMenu"])
    source = JSON.stringify({ [key]: source });
  extractor.script(`const parameters = ${JSON.stringify(source)};`, { kind: "field", path: [] });
  const item = extractor.items.find(({ src }) => src === "はい")!;
  expect(item.extra_field).toMatchObject({ rpgmaker: { usage: "text" } });
  const metadata = read_json_record(read_json_record(item.extra_field)["rpgmaker"]) as {
    source_context: string;
  };
  for (const key of [
    "parameters",
    "SceneCustomMenu",
    "WindowList",
    "Window",
    "CommandList",
    "Command",
    "Text",
    "选择提示",
  ])
    expect(metadata.source_context).toContain(key);
  expect(metadata.source_context.length).toBeLessThanOrEqual(SOURCE_CONTEXT_MAX_LENGTH);
  expect(metadata.source_context.isWellFormed()).toBe(true);
});

it("完整模板可以展开，含插值模板中看似完整的 JSON 片段保持原文", () => {
  const extractor = create_rpgmaker_extractor("js/plugins.js");
  extractor.script('const full = `{"text":"完整"}`; const partial = `{"text":"片段"}${x}尾`;', {
    kind: "field",
    path: [],
  });
  expect(extractor.items.map(({ src }) => src)).toEqual(["完整", '{"text":"片段"}', "尾"]);
});

it.each([
  { padding: "无关".repeat(2000), before: "前邻", target: "目标😀", after: "后邻" },
  ["无关".repeat(2000), "前邻", "目标😀", "后邻", "遥远成员"],
])("上下文选取目标及前后成员，不受父容器开头长文本影响", (value) => {
  const extractor = create_rpgmaker_extractor("data/Plugins.json");
  extractor.add(JSON.stringify(value), {
    usage: "metadata",
    location: { kind: "field", path: ["settings"] },
  });
  const item = extractor.items.find(({ src }) => src === "目标😀")!;
  const context = read_json_record(read_json_record(item.extra_field)["rpgmaker"])[
    "source_context"
  ] as string;
  for (const text of ["settings", "目标😀", "前邻", "后邻"]) expect(context).toContain(text);
  expect(context).not.toContain("无关");
  expect(context).not.toContain("遥远成员");
  expect(context.length).toBeLessThanOrEqual(SOURCE_CONTEXT_MAX_LENGTH);
  expect(context.isWellFormed()).toBe(true);
});

it("长目标优先保留定位和正文，相邻对象与数组只展示成员数", () => {
  const extractor = create_rpgmaker_extractor("data/Plugins.json");
  const target = "目标😀".repeat(2000);
  extractor.add(
    JSON.stringify({
      before: { hidden: "对象正文", extra: true },
      target,
      after: ["数组正文", 1, null],
    }),
    {
      usage: "metadata",
      location: { kind: "field", path: ["settings"] },
    },
  );
  const item = extractor.items.find(({ src }) => src === target)!;
  const context = read_json_record(read_json_record(item.extra_field)["rpgmaker"])[
    "source_context"
  ] as string;
  for (const text of ["settings", "target", "目标😀", "before", "Object(2)", "after", "Array(3)"])
    expect(context).toContain(text);
  expect(context).not.toContain("对象正文");
  expect(context).not.toContain("数组正文");
  expect(context.length).toBeLessThanOrEqual(SOURCE_CONTEXT_MAX_LENGTH);
  expect(context.isWellFormed()).toBe(true);
});
