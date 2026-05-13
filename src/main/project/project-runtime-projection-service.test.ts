import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import { ProjectRuntimeProjectionService } from "./project-runtime-projection-service";

describe("ProjectRuntimeProjectionService", () => {
  it("读取 quality/prompts 时不预热 items 快照", () => {
    const calls: string[] = [];
    const service = new ProjectRuntimeProjectionService(
      create_database_stub((operation) => {
        calls.push(operation.name);
        if (operation.name === "getAllItems") {
          throw new Error("不应读取 items");
        }
        if (operation.name === "getAllMeta") {
          return {};
        }
        if (operation.name === "getRules") {
          return [];
        }
        if (operation.name === "getRuleText") {
          return "";
        }
        return null;
      }),
    );

    service.build_section_payloads({
      projectState: { loaded: true, projectPath: "E:/demo/demo.lg" },
      sections: ["quality", "prompts"],
    });

    expect(calls).toContain("getAllMeta");
    expect(calls).toContain("getRules");
    expect(calls).toContain("getRuleText");
    expect(calls).not.toContain("getAllItems");
  });

  it("manifest 计数使用聚合 operation，不为计数扫描完整 item payload", () => {
    const execute = vi.fn((operation: DatabaseOperation) => {
      if (operation.name === "getAllMeta") {
        return {};
      }
      if (operation.name === "getAssetCount") {
        return 2;
      }
      if (operation.name === "getItemCount") {
        return 5;
      }
      if (operation.name === "getAllItems") {
        throw new Error("不应读取 items");
      }
      return null;
    });
    const service = new ProjectRuntimeProjectionService(create_database_stub(execute));

    const manifest = service.build_manifest({ loaded: true, projectPath: "E:/demo/demo.lg" });

    expect(manifest["counts"]).toEqual({ files: 2, items: 5 });
    expect(execute).toHaveBeenCalledWith({
      name: "getAssetCount",
      args: { projectPath: "E:/demo/demo.lg" },
    });
    expect(execute).toHaveBeenCalledWith({
      name: "getItemCount",
      args: { projectPath: "E:/demo/demo.lg" },
    });
  });

  function create_database_stub(
    execute: (operation: DatabaseOperation) => unknown,
  ): ProjectDatabase {
    return {
      execute,
    } as unknown as ProjectDatabase;
  }
});
