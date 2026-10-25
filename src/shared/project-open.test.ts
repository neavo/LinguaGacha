import { expect, it } from "vitest";
import { read_project_version_confirmation } from "./project-open";

it("确认详情只保留协议中的规范版本", () => {
  expect(
    read_project_version_confirmation({
      target_app_version: "2.1.0",
      current_app_version: "1.0.0",
      path: "untrusted.lg",
    }),
  ).toEqual({ target_app_version: "2.1.0", current_app_version: "1.0.0" });
});

it.each([
  null,
  { target_app_version: "2.1.0" },
  { target_app_version: "02.1.0", current_app_version: "1.0.0" },
  { target_app_version: "2.1.0", current_app_version: 1 },
])("拒绝缺失或非规范的确认详情：%j", (details) => {
  expect(read_project_version_confirmation(details)).toBeNull();
});
