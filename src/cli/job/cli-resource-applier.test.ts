import { describe, expect, it, vi } from "vitest";

import type { CLICommandOptions } from "../cli-parser";
import { apply_cli_resources } from "./cli-resource-applier";
import type { BackendServices } from "../../backend/bootstrap/backend-services";

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
 * 组合根桩只暴露项目领域入口，防止测试重新依赖数据库写闭包。
 */
function create_backend_services() {
  const apply_task_input = vi.fn().mockResolvedValue({ accepted: true, changes: [] });
  return {
    backend_services: {
      project: { lifecycle: { apply_task_input } },
    } as unknown as BackendServices,
    apply_task_input,
  };
}

describe("cli-resource-applier", () => {
  it("把缺省 CLI 资源编译为全部关闭的项目任务输入", async () => {
    const { backend_services, apply_task_input } = create_backend_services();

    await apply_cli_resources(backend_services, create_translate_command());

    expect(apply_task_input).toHaveBeenCalledWith({
      quality_rules: [
        { kind: "glossary", entries: [], enabled: false, mode: null },
        { kind: "text_preserve", entries: [], enabled: null, mode: "off" },
        { kind: "pre_replacement", entries: [], enabled: false, mode: null },
        { kind: "post_replacement", entries: [], enabled: false, mode: null },
      ],
      prompts: [
        { kind: "translation", text: "", enabled: false },
        { kind: "analysis", text: "", enabled: false },
      ],
    });
  });
});
