import { expect, it } from "vitest";
import { resolve_output_item_name } from "./item-name";

it("生成优先使用非空译名，空译名回退并保留源姓名空值", () => {
  expect(resolve_output_item_name({ name_src: "太郎", name_dst: "塔罗" })).toBe("塔罗");
  expect(resolve_output_item_name({ name_src: "太郎", name_dst: null })).toBe("太郎");
  expect(resolve_output_item_name({ name_src: "太郎", name_dst: "" })).toBe("太郎");
  expect(resolve_output_item_name({ name_src: "", name_dst: null })).toBe("");
  expect(resolve_output_item_name({ name_src: null, name_dst: "" })).toBeNull();
});
