import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  read_config_model_preset_records,
  read_config_model_records,
  resolve_model_for_usage,
  resolve_agent_batch_translation_model,
} from "./model-config-resolver";

import { Model } from "../../domain/model";

describe("model-config-resolver", () => {
  it("跟随使用当前生效配置，固定选择同一 ID 时仍使用保存配置", () => {
    const agent_model = Model.from_json({ id: "a", thinking: { level: "LOW" } }, "a");
    const config = {
      model_selection: { agent: "b", agent_batch_translation: null as string | null },
      models: [{ id: "a", thinking: { level: "HIGH" } }],
    };
    expect(resolve_agent_batch_translation_model(config, agent_model).thinking.level).toBe("LOW");
    config.model_selection.agent_batch_translation = "a";
    expect(resolve_agent_batch_translation_model(config, agent_model).thinking.level).toBe("HIGH");
    config.model_selection.agent_batch_translation = "missing";
    expect(() => resolve_agent_batch_translation_model(config, agent_model)).toThrow(
      "model.not_found",
    );
  });

  it("执行用途分别解析命中的模型", () => {
    const config = {
      model_selection: {
        translation: "model-1",

        agent: "model-3",
      },
      models: [{ id: "model-1" }, { id: "model-2" }, { id: "model-3" }],
    };

    expect(resolve_model_for_usage(config, "translation")?.["id"]).toBe("model-1");
    expect(resolve_model_for_usage(config, "agent")?.["id"]).toBe("model-3");
  });

  it("用途选择缺失或失效时回退到首个可用模型", () => {
    const config = {
      model_selection: { translation: "missing", agent: "model-2" },
      models: [{ id: "model-1" }, { id: "model-2" }],
    };

    expect(resolve_model_for_usage(config, "translation")).toMatchObject({ id: "model-1" });
    expect(resolve_model_for_usage(config, "agent")?.["id"]).toBe("model-2");
  });

  it("执行用途始终返回领域归一后的 Agent 容量配置", () => {
    const resolved = resolve_model_for_usage(
      {
        model_selection: { agent: "model-1" },
        models: [{ id: "model-1" }],
      },
      "agent",
    );

    expect(resolved?.["agent"]).toEqual({
      context_window: 0,
      max_output_tokens: 0,
    });
  });

  it("过滤坏模型项并在没有可用模型时返回空结果", () => {
    expect(
      read_config_model_records({
        models: [null, "bad", ["bad"], { id: "model-1" }],
      }),
    ).toEqual([{ id: "model-1" }]);
    expect(resolve_model_for_usage({ models: [] }, "translation")).toBeNull();
  });

  it("读取模型列表返回副本，避免调用方污染原始配置", () => {
    const model = { id: "model-1", name: "原始模型" };
    const config = {
      models: [model],
    };

    const records = read_config_model_records(config);
    records[0]["name"] = "调用方改名";
    records.push({ id: "model-2" });

    expect(model).toEqual({ id: "model-1", name: "原始模型" });
    expect(read_config_model_records(config)).toEqual([{ id: "model-1", name: "原始模型" }]);
  });

  it("内置模型目录允许空列表，文件缺失或解析失败时保留错误上下文", () => {
    using temp_root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-model-preset-"));
    const preset_root = temp_root.path;
    const preset_dir = path.join(preset_root, "builtin", "model", "preset");
    const paths = {
      get_model_preset_dir: () => preset_dir,
    };
    fs.mkdirSync(preset_dir, { recursive: true });
    fs.writeFileSync(
      path.join(preset_dir, "preset_model_builtin.json"),
      JSON.stringify([{ id: "preset-1" }]),
      "utf-8",
    );

    expect(read_config_model_preset_records(paths)).toEqual([{ id: "preset-1" }]);
    fs.writeFileSync(path.join(preset_dir, "preset_model_builtin.json"), "[]");
    expect(read_config_model_preset_records(paths)).toEqual([]);
    fs.writeFileSync(path.join(preset_dir, "preset_model_builtin.json"), "{");
    expect(() => read_config_model_preset_records(paths)).toThrow(
      expect.objectContaining({ code: "file.parse_failed", cause: expect.any(SyntaxError) }),
    );
    fs.rmSync(path.join(preset_dir, "preset_model_builtin.json"));
    expect(() => read_config_model_preset_records(paths)).toThrow(
      expect.objectContaining({ code: "file.io_failed", cause: expect.any(Error) }),
    );
  });

  it.each([
    { label: "非数组", data: {} },
    { label: "非对象条目", data: [{ id: "valid" }, null] },
    { label: "缺失 ID", data: [{}] },
    { label: "非字符串 ID", data: [{ id: 1 }] },
    { label: "空白 ID", data: [{ id: " " }] },
    { label: "未规范 ID", data: [{ id: " preset " }] },
    { label: "重复 ID", data: [{ id: "same" }, { id: "same" }] },
  ])("内置目录拒绝$label，避免错误判断预设已下架", ({ data }) => {
    using temp_root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-model-preset-"));
    fs.writeFileSync(path.join(temp_root.path, "preset_model_builtin.json"), JSON.stringify(data));
    expect(() =>
      read_config_model_preset_records({
        get_model_preset_dir: () => temp_root.path,
      }),
    ).toThrow("file.invalid_structure");
  });
});
