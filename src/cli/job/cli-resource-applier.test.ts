import { describe, expect, it, vi } from "vitest";

import type { CLICommandOptions } from "../cli-parser";
import { apply_cli_resources } from "./cli-resource-applier";
import type { CoreServices } from "../../core/bootstrap/core-services";

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

function create_core_services() {
  const commit_cli_resource_operations = vi.fn(async () => undefined);
  return {
    commit_cli_resource_operations,
  } as unknown as CoreServices & {
    commit_cli_resource_operations: typeof commit_cli_resource_operations;
  };
}
describe("cli-resource-applier", () => {
  it("写入 CLI 临时工程资源后发布质量和提示词缓存刷新事件", async () => {
    const core_services = create_core_services();

    await apply_cli_resources(core_services, create_translate_command(), "E:/Project/tmp.lg");

    expect(core_services.commit_cli_resource_operations).toHaveBeenCalledWith(
      "E:/Project/tmp.lg",
      expect.arrayContaining([
        expect.objectContaining({
          name: "setMeta",
          args: expect.objectContaining({
            projectPath: "E:/Project/tmp.lg",
            key: "glossary_enable",
            value: false,
          }),
        }),
        expect.objectContaining({
          name: "setMeta",
          args: expect.objectContaining({
            projectPath: "E:/Project/tmp.lg",
            key: "text_preserve_mode",
            value: "off",
          }),
        }),
      ]),
    );
  });
});
