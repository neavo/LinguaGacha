import { describe, expect, it } from "vitest";
import { RPGMakerMvMzFormat } from "./rpgmaker-format";
import { read_javascript_strings } from "./javascript";
import { rpgmaker_default_status } from "./json";
import { create_item } from "../../../domain/item";

const format = new RPGMakerMvMzFormat({
  target_language: "ZH",
  write_translated_name_fields_to_file: true,
});
const command = (code: number, parameters: unknown[], indent = 0) => ({ code, parameters, indent });

describe("MV/MZ 原稿写回", () => {
  it("保存的定位独立于用途分类、条目顺序和当前提取字段", async () => {
    const bytes = Buffer.from('[null,{"name":"勇者","legacy":"旧字段"}]');
    const items = [
      create_item({
        src: "旧字段",
        dst: "历史译文",
        status: "PROCESSED",
        row: 99,
        extra_field: {
          rpgmaker: { usage: "display", location: { kind: "field", path: [1, "legacy"] } },
          old: true,
        },
      }),
      create_item({
        src: "勇者",
        dst: "英雄",
        status: "PROCESSED",
        extra_field: {
          rpgmaker: { usage: "metadata", location: { kind: "field", path: [1, "name"] } },
        },
      }),
    ];
    expect(
      JSON.parse(Buffer.from(await format.render(bytes, "data/Actors.json", items)).toString()),
    ).toEqual([null, { name: "英雄", legacy: "历史译文" }]);
  });
  it("标准显示字段与默认排除按位置独立，人工启用后可写回并能恢复默认状态", async () => {
    const bytes = Buffer.from(
      JSON.stringify([
        null,
        { id: 1, name: "同文", nickname: "別名", profile: "紹介", note: "同文", faceName: "顔" },
      ]),
    );
    const items = await format.read_from_stream(bytes, "data/Actors.json");
    expect(items.filter((item) => item.src === "同文").map((item) => item.status)).toEqual([
      "NONE",
      "RULE_SKIPPED",
    ]);
    expect(await format.render(bytes, "data/Actors.json", items)).toBe(bytes);
    const note = items.find((item) => item.src === "同文" && item.status === "RULE_SKIPPED")!;
    note.status = "PROCESSED";
    note.dst = "启用备注";
    expect(rpgmaker_default_status(note)).toBe("RULE_SKIPPED");
    const output = JSON.parse(
      Buffer.from(await format.render(bytes, "data/Actors.json", items)).toString(),
    );
    expect(output[1]).toMatchObject({ name: "同文", note: "启用备注", faceName: "顔" });
    expect(
      await format.read_from_stream(
        Buffer.from('{"currencyUnit":"金","terms":{"basic":["等级"]},"switches":["开关"]}'),
        "data/System.json",
      ),
    ).toMatchObject([
      { src: "金", status: "NONE" },
      { src: "等级", status: "NONE" },
      { src: "开关", status: "RULE_SKIPPED" },
    ]);
  });

  it("对话变长、姓名、选项分支与后续脚本各按原始位置写回", async () => {
    const list = [
      command(101, ["Face", 0, 0, 2, "勇者"]),
      command(401, ["一行"]),
      command(102, [["はい", "いいえ"], -1, 0, 2, 0]),
      command(402, [0, "はい"]),
      command(402, [1, "いいえ"]),
      command(404, []),
      command(355, ['const x = "脚本";']),
      command(655, ["console.log(x);"]),
      command(108, ["注释"]),
      command(408, ["续行"]),
      command(0, []),
    ];
    const bytes = Buffer.from(
      JSON.stringify({ displayName: "地图", events: [null, { name: "EV001", pages: [{ list }] }] }),
    );
    const items = await format.read_from_stream(bytes, "data/Map001.json");
    expect(items.find((item) => item.src === "脚本")?.extra_field).toMatchObject({
      rpgmaker: { usage: "script", source_context: 'x = "脚本"' },
    });
    for (const item of items) {
      if (item.src === "一行")
        Object.assign(item, {
          status: "PROCESSED",
          dst: "第一行\n第二行\n第三行",
          name_dst: "英雄",
        });
      if (item.src === "はい") Object.assign(item, { status: "PROCESSED", dst: "是" });
      if (item.src === "脚本")
        Object.assign(item, { status: "PROCESSED", dst: '引号"和\\换行\n😀' });
    }
    const output = JSON.parse(
      Buffer.from(await format.render(bytes, "data/Map001.json", items)).toString(),
    );
    const written = output.events[1].pages[0].list;
    expect(written[0]).toEqual(command(101, ["Face", 0, 0, 2, "英雄"]));
    expect(written.slice(1, 4)).toEqual([
      command(401, ["第一行"]),
      command(401, ["第二行"]),
      command(401, ["第三行"]),
    ]);
    expect(written[4].parameters[0]).toEqual(["是", "いいえ"]);
    expect(written[5].parameters).toEqual([0, "是"]);
    expect(read_javascript_strings(written[8].parameters[0])[0]?.src).toBe('引号"和\\换行\n😀');
    expect(written.slice(-3)).toEqual(list.slice(-3));
  });

  it("JS 的 Unicode 范围与模板片段转义保留表达式，非法定位拒绝写回", async () => {
    const source = 'const x = "中文😀"; const y = `你好${x}世界`;';
    const bytes = Buffer.from(source);
    const items = await format.read_from_stream(bytes, "js/plugins/test.js");
    expect(items.map((item) => item.src)).toEqual(["中文😀", "你好", "世界"]);
    expect(items[0]?.extra_field).toMatchObject({
      rpgmaker: { usage: "script", source_context: 'x = "中文😀"' },
    });
    const translations = ['引号"\\\n😀', "`前${字}", "后"];
    items.forEach((item, index) => {
      item.status = "PROCESSED";
      item.dst = translations[index]!;
    });
    const result = Buffer.from(await format.render(bytes, "js/plugins/test.js", items)).toString();
    expect(read_javascript_strings(result).map((span) => span.src)).toEqual(translations);
    expect(result).toContain("${x}");
    await expect(
      format.render(bytes, "js/plugins/test.js", [...items, items[0]!]),
    ).rejects.toMatchObject({ code: "file.invalid_structure" });
    await expect(
      format.read_from_stream(Buffer.from('const x = "未闭合'), "js/plugins/bad.js"),
    ).rejects.toThrow();
  });
});
