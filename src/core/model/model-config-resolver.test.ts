import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  read_model_preset_records,
  read_model_records,
  resolve_active_model,
  resolve_active_model_id,
} from "./model-config-resolver";

describe("model-config-resolver", () => {
  it("优先使用命中的激活模型", () => {
    const config = {
      activate_model_id: "model-2",
      models: [{ id: "model-1" }, { id: "model-2" }],
    };

    expect(resolve_active_model(config)).toMatchObject({ id: "model-2" });
    expect(resolve_active_model_id(config)).toBe("model-2");
  });

  it("激活模型缺失或失效时回退到首个可用模型", () => {
    const config = {
      activate_model_id: "missing",
      models: [{ id: "model-1" }, { id: "model-2" }],
    };

    expect(resolve_active_model(config)).toMatchObject({ id: "model-1" });
    expect(resolve_active_model_id({ ...config, activate_model_id: "" })).toBe("model-1");
  });

  it("过滤坏模型项并在没有可用模型时返回空结果", () => {
    expect(
      read_model_records({
        activate_model_id: "",
        models: [null, "bad", ["bad"], { id: "model-1" }],
      }),
    ).toEqual([{ id: "model-1" }]);
    expect(resolve_active_model_id({ activate_model_id: "", models: [] })).toBe("");
  });

  it("读取模型列表返回副本，避免调用方污染原始配置", () => {
    const model = { id: "model-1", name: "原始模型" };
    const config = {
      activate_model_id: "model-1",
      models: [model],
    };

    const records = read_model_records(config);
    records[0]["name"] = "调用方改名";
    records.push({ id: "model-2" });

    expect(model).toEqual({ id: "model-1", name: "原始模型" });
    expect(read_model_records(config)).toEqual([{ id: "model-1", name: "原始模型" }]);
  });

  it("读取内置模型预设时过滤非对象项并兼容缺失文件", () => {
    const preset_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-model-preset-"));
    const preset_dir = path.join(preset_root, "resource", "model", "preset");
    const paths = {
      get_model_preset_dir: () => preset_dir,
    };
    try {
      fs.mkdirSync(preset_dir, { recursive: true });
      fs.writeFileSync(
        path.join(preset_dir, "preset_model_builtin.json"),
        JSON.stringify([{ id: "preset-1" }, null, "bad", ["bad"]]),
        "utf-8",
      );

      expect(read_model_preset_records(paths)).toEqual([{ id: "preset-1" }]);
      fs.rmSync(path.join(preset_dir, "preset_model_builtin.json"));
      expect(read_model_preset_records(paths)).toEqual([]);
    } finally {
      fs.rmSync(preset_root, { force: true, recursive: true });
    }
  });
});
