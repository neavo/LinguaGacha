import { describe, expect, it } from "vitest";
import { create_rpgmaker_mv_mz_adapter } from "./rpgmaker-format";
import { read_javascript_strings } from "./javascript";
import { create_item } from "../../../domain/item";

const members = await create_rpgmaker_mv_mz_adapter({
  target_language: "ZH",
  write_translated_name_fields_to_file: true,
}).create_members(new Map());
const command = (code: number, parameters: unknown[], indent = 0) => ({ code, parameters, indent }); // 保留原稿指令结构与写回索引。

describe("MV/MZ 原稿写回", () => {
  it.each(["data/Plugins.json", "js/plugins.js"])(
    "文字修改后外层和嵌套 JSON 的数值字面量保持原样：%s",
    async (file) => {
      const numbers =
        '"large":9007199254740993,"overflow":1e400,"negative":-0,"decimal":1.2300,"array":[1E+03,1e-999,-0,9007199254740995]';
      const nested = `{"text":"内部",${numbers}}`;
      const source = `{"text":"外部",${numbers},"nested":${JSON.stringify(nested)}}`;
      const json = file.endsWith(".json");
      const bytes = Buffer.from(json ? source : `const settings = ${JSON.stringify(source)};`);
      const { items } = await members.read_file(bytes, file);
      for (const item of items) Object.assign(item, { status: "PROCESSED", dst: `${item.src}译` });
      const expected = `{"text":"外部译",${numbers},"nested":${JSON.stringify(nested.replace("内部", "内部译"))}}`;
      const output = Buffer.from(await members.render(bytes, file, items)).toString();
      expect(output).toBe(json ? expected : `const settings = ${JSON.stringify(expected)};`);
    },
  );

  it.each(["data/Plugins.json", "js/plugins.js", "js/plugins/template.js"])(
    "多层 JSON 的多个译文按容器合并，顺序独立，保留类型与未修改容器：%s",
    async (file) => {
      const untouched = '{ "text" : "保留", "escape": "\\u65e5" }';
      const inner = {
        Text: "はい",
        Other: "いいえ",
        count: 7,
        enabled: true,
        empty: null,
        digit: "0",
        choices: JSON.stringify(["いいえ", 0, true, null]),
      };
      let nested = JSON.stringify(inner);
      for (const key of ["Command", "CommandList", "Window", "WindowList", "Scene"])
        nested = JSON.stringify({ [key]: nested });
      const payload = JSON.stringify({ nested, untouched });
      const json = file.endsWith(".json");
      const template = file.endsWith("template.js");
      const bytes = Buffer.from(
        json
          ? JSON.stringify({ settings: payload })
          : template
            ? `const settings = \`${JSON.stringify(payload).slice(1, -1)}\`;`
            : `const settings = ${JSON.stringify(payload)};`,
      );
      const { items } = await members.read_file(bytes, file);
      if (!json) {
        expect(items.every((item) => item.status === "RULE_SKIPPED")).toBe(true);
      }
      const translations = new Map([
        ["はい", '引号"\\\n😀${x}`'],
        ["いいえ", "否"],
      ]);
      for (const item of items) {
        if (translations.has(item.src))
          Object.assign(item, { status: "PROCESSED", dst: translations.get(item.src) });
      }
      const output = await members.render(bytes, file, items);
      expect(
        Buffer.from(await members.render(bytes, file, [...items].reverse())).equals(output),
      ).toBe(true);
      const text = Buffer.from(output).toString();
      const script = json ? null : read_javascript_strings(text);
      if (script && !script.ok) throw new Error("Output script is invalid");
      const settings = JSON.parse(
        json ? JSON.parse(text).settings : script && script.strings[0]!.src,
      );
      expect(settings.untouched).toBe(untouched);
      let value = JSON.parse(settings.nested);
      for (const key of ["Scene", "WindowList", "Window", "CommandList", "Command"])
        value = JSON.parse(value[key]);
      expect(value).toEqual({
        ...inner,
        Text: translations.get("はい"),
        Other: "否",
        choices: JSON.stringify(["否", 0, true, null]),
      });
    },
  );

  it("原文译文相同的 JSON 容器保留空白与转义，邻近普通译文正常写回", async () => {
    const container = '{ "text" : "\\u65e5" }';
    const bytes = Buffer.from(JSON.stringify({ settings: container, label: "标题" }));
    const { items } = await members.read_file(bytes, "data/Plugins.json");
    for (const item of items)
      Object.assign(item, {
        status: "PROCESSED",
        dst: item.src === "标题" ? "标题译文" : item.src,
      });
    expect(
      JSON.parse(Buffer.from(await members.render(bytes, "data/Plugins.json", items)).toString()),
    ).toEqual({ settings: container, label: "标题译文" });
  });

  it.each(["js/plugins/test.js", "data/CommonEvents.json"])(
    "插件和事件脚本默认排除，人工翻译按保存定位写回：%s",
    async (file) => {
      const script = 'const x = {"管理😀": "显示"}; show(`你好${x}世界`); x[`選択_${id}`];';
      const json = file.endsWith(".json");
      const bytes = Buffer.from(
        json ? JSON.stringify([null, { list: [command(355, [script])] }]) : script,
      );
      const { items } = await members.read_file(bytes, file);
      expect(items.map(({ src, status }) => [src, status])).toEqual([
        ["管理😀", "RULE_SKIPPED"],
        ["显示", "RULE_SKIPPED"],
        ["你好", "RULE_SKIPPED"],
        ["世界", "RULE_SKIPPED"],
        ["選択_", "RULE_SKIPPED"],
      ]);
      expect(items[0]?.extra_field).toMatchObject({
        rpgmaker_mv_mz: {
          source_context: '"管理😀": "显示"',
          location: { kind: "script" },
        },
      });
      items[0]!.status = "PROCESSED";
      items[0]!.dst = "人工😀";
      const output = Buffer.from(await members.render(bytes, file, items)).toString();
      expect(json ? JSON.parse(output)[1].list[0].parameters[0] : output).toBe(
        script.replace("管理😀", "人工😀"),
      );
    },
  );
  it("错误脚本前后的对白可翻译，行数变化后仍完整保留失败脚本", async () => {
    const broken = [command(355, ['say("保留原文");']), command(655, ["if()array.push;"])];
    const list = [
      command(101, ["", 0, 0, 2]),
      command(401, ["前文"]),
      ...broken,
      command(111, [12, "$dataMap."]),
      command(101, ["", 0, 0, 2]),
      command(401, ["后文"]),
      command(355, ['say("有效脚本");']),
      command(0, []),
    ];
    const bytes = Buffer.from(JSON.stringify([null, { list, id: 1 }]));
    const result = await members.read_file(bytes, "data/CommonEvents.json");
    expect(result.warnings).toMatchObject([
      {
        rel_path: "data/CommonEvents.json",
        json_path: [1, "list", 2, "parameters", 0],
        diagnostics: [{ line: 2, column: 4 }],
      },
      { json_path: [1, "list", 4, "parameters", 1] },
    ]);
    expect(result.items.map((item) => item.src)).toEqual(["前文", "后文", "有效脚本"]);
    for (const item of result.items) {
      item.status = "PROCESSED";
      item.dst = item.src === "前文" ? "前一\n前二" : `${item.src}译文`;
    }
    const output = JSON.parse(
      Buffer.from(await members.render(bytes, "data/CommonEvents.json", result.items)).toString(),
    );
    expect(output).toEqual([
      null,
      {
        id: 1,
        list: [
          list[0],
          command(401, ["前一"]),
          command(401, ["前二"]),
          ...broken,
          list[4],
          list[5],
          command(401, ["后文译文"]),
          command(355, ['say("有效脚本译文");']),
          list[8],
        ],
      },
    ]);
  });
  it("保存的定位独立于用途分类、条目顺序和当前提取字段", async () => {
    const bytes = Buffer.from('[null,{"name":"勇者","legacy":"旧字段"}]');
    const items = [
      create_item({
        src: "旧字段",
        dst: "历史译文",
        status: "PROCESSED",
        row: 99,
        extra_field: {
          rpgmaker_mv_mz: {
            internal_file_path: "data/Actors.json",
            usage: "text",
            location: { kind: "field", path: [1, "legacy"] },
          },
          old: true,
        },
      }),
      create_item({
        src: "勇者",
        dst: "英雄",
        status: "PROCESSED",
        extra_field: {
          rpgmaker_mv_mz: {
            internal_file_path: "data/Actors.json",
            usage: "metadata",
            location: { kind: "field", path: [1, "name"] },
          },
        },
      }),
    ];
    expect(
      JSON.parse(Buffer.from(await members.render(bytes, "data/Actors.json", items)).toString()),
    ).toEqual([null, { name: "英雄", legacy: "历史译文" }]);
  });
  it("默认翻译字段与默认排除按位置独立，人工启用后可写回", async () => {
    const bytes = Buffer.from(
      JSON.stringify([
        null,
        { id: 1, name: "同文", nickname: "別名", profile: "紹介", note: "同文", faceName: "顔" },
      ]),
    );
    const { items } = await members.read_file(bytes, "data/Actors.json");
    expect(items.filter((item) => item.src === "同文").map((item) => item.status)).toEqual([
      "NONE",
      "RULE_SKIPPED",
    ]);
    expect(await members.render(bytes, "data/Actors.json", items)).toBe(bytes);
    const note = items.find((item) => item.src === "同文" && item.status === "RULE_SKIPPED")!;
    note.status = "PROCESSED";
    note.dst = "启用备注";
    const output = JSON.parse(
      Buffer.from(await members.render(bytes, "data/Actors.json", items)).toString(),
    );
    expect(output[1]).toMatchObject({ name: "同文", note: "启用备注", faceName: "顔" });
    expect(
      await members.read_file(
        Buffer.from('{"currencyUnit":"金","terms":{"basic":["等级"]},"switches":["开关"]}'),
        "data/System.json",
      ),
    ).toMatchObject({
      items: [
        { src: "金", status: "NONE" },
        { src: "等级", status: "NONE" },
        { src: "开关", status: "RULE_SKIPPED" },
      ],
    });
  });

  it("对话变长后，姓名、JSON 选项镜像与脚本按原始位置写回", async () => {
    const choice = JSON.stringify({ text: "はい" });
    const script = `const x = ${JSON.stringify(JSON.stringify({ text: "脚本" }))};`;
    const list = [
      command(101, ["Face", 0, 0, 2, "勇者"]),
      command(401, ["一行"]),
      command(102, [[choice, "いいえ"], -1, 0, 2, 0]),
      command(402, [0, choice]),
      command(402, [1, "いいえ"]),
      command(404, []),
      command(355, [script]),
      command(655, ["console.log(x);"]),
      command(108, ["注释"]),
      command(408, ["续行"]),
      command(0, []),
    ];
    const bytes = Buffer.from(
      JSON.stringify({ displayName: "地图", events: [null, { name: "EV001", pages: [{ list }] }] }),
    );
    const { items } = await members.read_file(bytes, "data/Map001.json");
    expect(items.find((item) => item.src === "脚本")?.status).toBe("RULE_SKIPPED");
    for (const item of items) {
      if (item.src === "一行")
        Object.assign(item, {
          status: "PROCESSED",
          dst: "第一行\n第二行\n第三行",
          name_dst: "英雄",
        });
      if (item.src === choice)
        Object.assign(item, { status: "PROCESSED", dst: JSON.stringify({ text: "是" }) });
      if (item.src === "脚本")
        Object.assign(item, { status: "PROCESSED", dst: '引号"和\\换行\n😀' });
    }
    const output = JSON.parse(
      Buffer.from(await members.render(bytes, "data/Map001.json", items)).toString(),
    );
    const written = output.events[1].pages[0].list;
    expect(written[0]).toEqual(command(101, ["Face", 0, 0, 2, "英雄"]));
    expect(written.slice(1, 4)).toEqual([
      command(401, ["第一行"]),
      command(401, ["第二行"]),
      command(401, ["第三行"]),
    ]);
    expect(written[4].parameters[0]).toEqual([JSON.stringify({ text: "是" }), "いいえ"]);
    expect(written[5].parameters).toEqual([0, written[4].parameters[0][0]]);
    expect(read_javascript_strings(written[8].parameters[0])).toMatchObject({
      ok: true,
      strings: [{ src: JSON.stringify({ text: '引号"和\\换行\n😀' }) }],
    });
    expect(written.slice(-3)).toEqual(list.slice(-3));
  });

  it("JS 的 Unicode 范围与模板片段转义保留表达式，非法定位拒绝写回", async () => {
    const source = 'const x = "中文😀"; const y = `你好${x}世界`;';
    const bytes = Buffer.from(source);
    const { items } = await members.read_file(bytes, "js/plugins/test.js");
    expect(items.map((item) => item.src)).toEqual(["中文😀", "你好", "世界"]);
    expect(items[0]?.extra_field).toMatchObject({
      rpgmaker_mv_mz: {
        internal_file_path: "js/plugins/test.js",
        source_context: 'x = "中文😀"',
      },
    });
    const translations = ['引号"\\\n😀', "`前${字}", "后"];
    items.forEach((item, index) => {
      item.status = "PROCESSED";
      item.dst = translations[index]!;
    });
    const result = Buffer.from(await members.render(bytes, "js/plugins/test.js", items)).toString();
    expect(read_javascript_strings(result)).toMatchObject({
      ok: true,
      strings: translations.map((src) => ({ src })),
    });
    expect(result).toContain("${x}");
    await expect(
      members.render(bytes, "js/plugins/test.js", [...items, items[0]!]),
    ).rejects.toMatchObject({ code: "file.invalid_structure" });
  });
});
