import { describe, expect, it, vi } from "vitest";

import type { CLICommandOptions } from "../cli-parser";
import { apply_cli_resources } from "./cli-resource-applier";
import type { BackendServices } from "../../backend/bootstrap/backend-services";
import type {
  ProjectDatabase,
  ProjectDatabaseWrite,
} from "../../backend/database/database-operations";

/**
 * 资源全部缺省的翻译命令用于验证 CLI 默认关闭策略。
 */
function create_translate_command(): CLICommandOptions {
  return {
    command: "translate",
    inputPaths: ["input.txt"],
    outputDir: "out",
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    resources: {
      promptPath: null,
      glossaryPath: null,
      preReplacementPath: null,
      postReplacementPath: null,
      textPreservePath: null,
    },
  };
}

/**
 * 提交桩实际执行类型化写入，让断言落在 ProjectDatabase 可观察调用上。
 */
function create_backend_services() {
  const set_meta = vi.fn();
  const database = {
    set_meta,
    set_rules: vi.fn(),
    set_rule_text: vi.fn(),
  } as unknown as ProjectDatabase;
  const commit_cli_resource_writes = vi.fn(
    async (_project_path: string, writes: ProjectDatabaseWrite[]) => {
      for (const write of writes) {
        write(database);
      }
    },
  );
  return {
    backend_services: { commit_cli_resource_writes } as unknown as BackendServices,
    commit_cli_resource_writes,
    set_meta,
  };
}

describe("cli-resource-applier", () => {
  it("把 CLI 资源编译为类型化写入并交给后端提交", async () => {
    const { backend_services, commit_cli_resource_writes, set_meta } = create_backend_services();

    await apply_cli_resources(backend_services, create_translate_command(), "E:/Project/tmp.lg");

    expect(commit_cli_resource_writes).toHaveBeenCalledWith("E:/Project/tmp.lg", expect.any(Array));
    expect(set_meta).toHaveBeenCalledWith("E:/Project/tmp.lg", "glossary_enable", false);
    expect(set_meta).toHaveBeenCalledWith("E:/Project/tmp.lg", "text_preserve_mode", "off");
  });
});
