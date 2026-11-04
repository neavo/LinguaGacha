import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { write_message_records } from "./message-records";

it.each([null, ""])("空译名 %s 保留源姓名结构", (name_dst) => {
  const records = [{ name: "Alice", names: [123, "Bob"], message: "one" }];
  write_message_records(records, [create_item({ src: "one", name_dst })], "m.json", true);
  expect(records).toEqual([{ name: "Alice", names: [123, "Bob"], message: "one" }]);
});

it.each([{ row: -1 }, { row: 0.5 }, { row: 1 }, { src: "mismatch" }])(
  "拒绝错误定位 %j",
  (patch) => {
    expect(() =>
      write_message_records(
        [{ message: "one" }],
        [{ ...create_item({ src: "one" }), ...patch }],
        "m.json",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "file.invalid_structure",
        public_details: { file: "m.json" },
      }),
    );
  },
);

it("拒绝重复定位，避免后写覆盖前写", () => {
  const item = create_item({ src: "one" });
  expect(() => write_message_records([{ message: "one" }], [item, item], "m.json")).toThrow(
    expect.objectContaining({ code: "file.invalid_structure" }),
  );
});
