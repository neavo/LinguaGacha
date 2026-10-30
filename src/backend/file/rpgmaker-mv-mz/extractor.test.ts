import { expect, it } from "vitest";
import { create_rpgmaker_extractor } from "./extractor";
import { read_rpgmaker_metadata } from "./item";

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
  extractor.expand(source, { usage: "metadata", location: { kind: "field", path: ["settings"] } });
  expect(extractor.items.map(({ src, status }) => [src, status])).toEqual(
    ["开始", "事件形状", "0", "true", "null", '"引号文本"', "{坏文本"].map((src) => [
      src,
      "RULE_SKIPPED",
    ]),
  );
  expect(extractor.items[1]?.extra_field).toMatchObject({
    rpgmaker_mv_mz: {
      location: {
        kind: "json",
        path: ["list", 0, "parameters", 0],
        container: { kind: "field", path: ["settings"] },
      },
    },
  });
});

it("六层解码保留条目顺序、默认状态与完整写回定位", () => {
  const extractor = create_rpgmaker_extractor("data/CommonEvents.json");
  let source = JSON.stringify({ Text: "はい", Hint: "选择提示" });
  for (const key of ["Command", "CommandList", "Window", "WindowList", "SceneCustomMenu"])
    source = JSON.stringify({ [key]: source });
  extractor.script(`const parameters = ${JSON.stringify(source)};`, { kind: "field", path: [] });
  const item = extractor.items.find(({ src }) => src === "はい")!;
  expect(extractor.items.every((entry) => entry.status === "RULE_SKIPPED")).toBe(true);
  expect(extractor.items.map(({ src }) => src)).toEqual(["はい", "选择提示"]);
  const metadata = read_rpgmaker_metadata(item.extra_field);
  expect(metadata.internal_file_path).toBe("data/CommonEvents.json");
  expect(metadata.usage).toBe("metadata");
  let location = metadata.location;
  for (const key of ["Text", "Command", "CommandList", "Window", "WindowList", "SceneCustomMenu"]) {
    expect(location).toMatchObject({ kind: "json", path: [key] });
    if (location.kind !== "json") throw new Error("Missing JSON container");
    location = location.container;
  }
  expect(location).toEqual({
    kind: "script",
    start: 19,
    end: 19 + JSON.stringify(source).length,
    template: false,
    container: { kind: "field", path: [] },
  });
});

it("完整模板可以展开，含插值模板中看似完整的 JSON 片段保持原文", () => {
  const extractor = create_rpgmaker_extractor("js/plugins.js");
  extractor.script('const full = `{"text":"完整"}`; const partial = `{"text":"片段"}${x}尾`;', {
    kind: "field",
    path: [],
  });
  expect(extractor.items.map(({ src }) => src)).toEqual(["完整", '{"text":"片段"}', "尾"]);
});
