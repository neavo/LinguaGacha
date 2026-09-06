import { describe, expect, it } from "vitest";

import { ModelKeyLeasePool } from "./model-key-lease-pool";

describe("ModelKeyLeasePool", () => {
  it("任务级全局 round-robin 分配多 Key，重试会重新轮换", () => {
    const pool = new ModelKeyLeasePool();
    const model = {
      api_format: "OpenAI",
      api_url: "https://example.com/v1",
      model_id: "gpt-5-mini",
      api_key: "key-a\nkey-b",
    };

    expect(pool.lease_model(model)["api_key"]).toBe("key-a");
    expect(pool.lease_model(model)["api_key"]).toBe("key-b");
    expect(pool.lease_model(model)["api_key"]).toBe("key-a");
  });
});
