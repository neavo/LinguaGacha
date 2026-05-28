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
  const execute_transaction = vi.fn();
  const execute = vi.fn(() => {
    return {
      "project_runtime_revision.quality": 1,
      "project_runtime_revision.prompts": 2,
    };
  });
  const publish = vi.fn(async () => []);
  return {
    database: {
      execute_transaction,
      execute,
    },
    app_event_bus: {
      publish,
    },
  } as unknown as CoreServices & {
    database: {
      execute_transaction: typeof execute_transaction;
      execute: typeof execute;
    };
    app_event_bus: {
      publish: typeof publish;
    };
  };
}

describe("cli-resource-applier", () => {
  it("写入 CLI 临时工程资源后发布质量和提示词缓存刷新事件", async () => {
    const core_services = create_core_services();

    await apply_cli_resources(core_services, create_translate_command(), "E:/Project/tmp.lg");

    expect(core_services.database.execute_transaction).toHaveBeenCalledWith(
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
    expect(core_services.app_event_bus.publish).toHaveBeenCalledTimes(2);
    expect(core_services.app_event_bus.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "project.quality.changed",
        projectPath: "E:/Project/tmp.lg",
        source: "cli",
        affectedSections: ["quality", "prompts"],
      }),
    );
    expect(core_services.app_event_bus.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "project.prompts.changed",
        projectPath: "E:/Project/tmp.lg",
        source: "cli",
        affectedSections: ["quality", "prompts"],
      }),
    );
  });
});
