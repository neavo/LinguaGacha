import { describe, expect, it } from "vitest";

import { is_project_runtime_stage } from "./desktop-project-change-types";

describe("desktop-project-change-types", () => {
  it("只接受后端公开项目 section 作为 renderer 刷新阶段", () => {
    expect(is_project_runtime_stage("items")).toBe(true);
    expect(is_project_runtime_stage("proofreading")).toBe(true);
    expect(is_project_runtime_stage("task")).toBe(false);
    expect(is_project_runtime_stage("unknown")).toBe(false);
  });
});
