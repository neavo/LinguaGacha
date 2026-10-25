import { expect, it } from "vitest";
import { compare_app_version, parse_app_version } from "./app-version";

it("三段数字按数值比较并去除前导零", () => {
  expect(parse_app_version("01.002.3")).toEqual({ major: 1, minor: 2, patch: 3, value: "1.2.3" });
  for (const [left, right] of [
    ["10.0.0", "2.99.99"],
    ["1.10.0", "1.2.99"],
    ["1.2.10", "1.2.9"],
  ]) {
    expect(
      compare_app_version(parse_app_version(left)!, parse_app_version(right)!),
    ).toBeGreaterThan(0);
  }
  expect(compare_app_version(parse_app_version("01.2.03")!, parse_app_version("1.2.3")!)).toBe(0);
  expect(parse_app_version("9007199254740991.0.0")?.major).toBe(Number.MAX_SAFE_INTEGER);
});

it.each([
  undefined,
  null,
  123,
  {},
  "",
  "v1.2.3",
  "1.2",
  "1.2.3.4",
  "1.2.3-beta",
  " 1.2.3",
  "1.2.3\n",
  "1.-2.3",
  "１.2.3",
  "9007199254740992.0.0",
])("无效项目版本按未知处理：%j", (value) => expect(parse_app_version(value)).toBeNull());
