import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { AgentPersonalityService } from "./agent-personality-service";

/** 使用临时应用配置与自有默认正文，验证真实持久化边界。 */
function fixture() {
  const root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-personality-"));
  const paths = new AppPathService({
    appRoot: root.path,
    builtinRoot: path.join(root.path, "builtin"),
    env: {},
  });
  const default_path = path.join(
    path.dirname(paths.get_agent_system_prompt_path()),
    "personality.md",
  );
  fs.mkdirSync(path.dirname(default_path), { recursive: true });
  fs.writeFileSync(default_path, "Default role");
  const settings = new AppSettingService(paths);
  const gate = new RuntimeOperationGate();
  const service = new AgentPersonalityService(paths, settings, gate);
  return {
    [Symbol.dispose]: () => root[Symbol.dispose](),
    paths,
    settings,
    gate,
    service,
    default_path,
  };
}

describe("自定义角色配置", () => {
  it("默认资源、持久化覆盖、空正文和重置具有独立语义", async () => {
    using f = fixture();
    const initial = f.service.read();
    expect(initial.body).toBe("Default role");
    const saved = await f.service.save({ revision: initial.revision, body: "Custom role" });
    expect(new AppSettingService(f.paths).read_setting().agent_personality).toBe("Custom role");
    fs.writeFileSync(f.default_path, "Updated default role");
    expect(f.service.read().body).toBe("Custom role");
    const empty = await f.service.save({ revision: saved.revision, body: "" });
    expect(empty.body).toBe("");
    expect(new AppSettingService(f.paths).read_setting().agent_personality).toBe("");
    const reset = await f.service.save({ revision: empty.revision, body: null });
    expect(reset.body).toBe("Updated default role");
    expect(new AppSettingService(f.paths).read_setting().agent_personality).toBeNull();
  });

  it("运行期间拒绝写入，旧版本与无效载荷不能覆盖当前配置", async () => {
    using f = fixture();
    const initial = f.service.read();
    const lease = f.gate.begin_runtime("agent");
    await expect(
      f.service.save({ revision: initial.revision, body: "changed" }),
    ).rejects.toMatchObject({ code: "runtime.busy" });
    expect(f.service.read()).toEqual(initial);
    f.gate.finish_runtime(lease);
    await f.service.save({ revision: initial.revision, body: "saved" });
    await expect(
      f.service.save({ revision: initial.revision, body: "stale" }),
    ).rejects.toMatchObject({ code: "data.revision_conflict" });
    await expect(f.service.save({ revision: initial.revision, body: 1 })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    expect(f.service.read().body).toBe("saved");
  });
});
