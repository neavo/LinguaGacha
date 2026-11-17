import { describe, it } from "vitest";

import { check_typescript } from "../../../test/typescript-fixture";
import { format_project_typescript_api } from "./api-description";

describe("@lg/project 模型声明", () => {
  it("从运行时结果 Schema 生成可编译声明", () => {
    check_typescript([
      format_project_typescript_api().replace(
        "declare module '@lg/project' {",
        "declare namespace ProjectApi {",
      ),
    ]);
  });
});
