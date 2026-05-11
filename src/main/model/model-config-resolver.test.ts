import { describe, expect, it } from "vitest";

import {
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
});
