import { expect, it } from "vitest";
import { GenericFormat } from "./generic-format";
import { write_zip } from "../../../test/zip-fixture";

it("通用包固定数组坐标，保留私有字段，姓名独立写回", async () => {
  const records = [
    { message: "ようこそ", name: "受付", locator: { record: 17 }, names: ["private"] },
    { message: "開始", locator: ["menu", 2], names: ["private"] },
    { message: "続行" },
  ];
  const content = await write_zip(new Map([["items.json", JSON.stringify(records)]]));
  const format = new GenericFormat();
  const items = await format.read_from_stream(content, "abc.generic");
  expect(
    items.map((item) => [item.row, item.src, item.name_src, item.file_type, item.file_path]),
  ).toEqual([
    [0, "ようこそ", "受付", "GENERIC", "abc.generic"],
    [1, "開始", null, "GENERIC", "abc.generic"],
    [2, "続行", null, "GENERIC", "abc.generic"],
  ]);
  expect(
    JSON.parse(
      await format.render_text(
        content,
        [
          { ...items[0]!, status: "PROCESSED", dst: "", name_dst: "接待" },
          { ...items[1]!, status: "EXCLUDED", dst: "未采用", name_dst: "菜单" },
          { ...items[2]!, dst: "未确认" },
        ],
        "abc.generic",
      ),
    ),
  ).toEqual([
    { ...records[0], message: "", name: "接待" },
    { ...records[1], name: "菜单" },
    records[2],
  ]);
});

it.each([{}, [null], [{ message: 3 }], [{ message: "valid" }, { message: "bad", name: null }]])(
  "坏记录使整个解析失败：%j",
  async (records) => {
    const content = await write_zip(new Map([["items.json", JSON.stringify(records)]]));
    await expect(
      new GenericFormat().read_from_stream(content, "bad.generic"),
    ).rejects.toMatchObject({ code: "file.invalid_structure" });
  },
);

it("空数组合法，固定入口缺失或 UTF-8 损坏时失败", async () => {
  const format = new GenericFormat();
  const empty = await write_zip(new Map([["items.json", "[]"]]));
  expect(await format.read_from_stream(empty, "empty.generic")).toEqual([]);
  expect(await format.render_text(empty, [], "empty.generic")).toBe("[]");
  for (const content of [
    await write_zip(new Map([["nested/items.json", "[]"]])),
    await write_zip(new Map([["items.json", new Uint8Array([0xff])]])),
  ])
    await expect(format.read_from_stream(content, "bad.generic")).rejects.toMatchObject({
      code: "file.invalid_structure",
    });
});
