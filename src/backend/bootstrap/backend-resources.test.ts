import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { migration_orchestrator } from "../migration/migration-orchestrator";
import { SystemProxyHttpClient } from "../network/system-proxy-http-client";
import { BackendResources } from "./backend-resources";

let app_root = "";

beforeEach(() => {
  app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-backend-resources-"));
  fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(app_root, { recursive: true, force: true });
});

describe("BackendResources", () => {
  it("启动迁移完成后交付共享资源，关闭时恢复全局网络入口", async () => {
    const original_fetch = globalThis.fetch;
    const legacy_skills = path.join(app_root, "userdata", "agent", "skill");
    fs.mkdirSync(legacy_skills, { recursive: true });
    fs.writeFileSync(path.join(legacy_skills, "fixture.txt"), "skill");
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const resources = await BackendResources.start(create_options());

    expect(resources.metadata.read_version()).toBe("1.2.3");
    expect(globalThis.fetch).not.toBe(original_fetch);
    expect(fs.existsSync(legacy_skills)).toBe(false);
    expect(
      fs.readFileSync(path.join(resources.paths.get_agent_user_skill_dir(), "fixture.txt"), "utf8"),
    ).toBe("skill");

    await resources.dispose();

    expect(globalThis.fetch).toBe(original_fetch);
    expect(database_close).toHaveBeenCalledOnce();
  });

  it("启动迁移失败时阻止后续初始化并释放启动资源", async () => {
    const failure = new Error("startup migration failed");
    vi.spyOn(migration_orchestrator, "run_startup_migrations").mockRejectedValueOnce(failure);
    const install = vi.spyOn(SystemProxyHttpClient.prototype, "install_as_global_fetch");
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");

    await expect(BackendResources.start(create_options())).rejects.toBe(failure);
    expect(install).not.toHaveBeenCalled();
    expect(database_close).toHaveBeenCalledOnce();
    expect(log_shutdown).toHaveBeenCalledOnce();
  });

  it("启动后段失败时释放 transport、数据库和日志", async () => {
    const failure = new Error("transport install failed");
    vi.spyOn(SystemProxyHttpClient.prototype, "install_as_global_fetch").mockImplementationOnce(
      () => {
        throw failure;
      },
    );
    const transport_dispose = vi.spyOn(SystemProxyHttpClient.prototype, "dispose");
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");

    await expect(BackendResources.start(create_options())).rejects.toBe(failure);

    expect(transport_dispose).toHaveBeenCalledOnce();
    expect(database_close).toHaveBeenCalledOnce();
    expect(log_shutdown).toHaveBeenCalledOnce();
  });
});

/** 用临时安装根启动真实资源，关闭控制台和窗口日志。 */
function create_options() {
  return {
    appRoot: app_root,
    builtinRoot: path.resolve(process.cwd(), "builtin"),
    logTargets: { console: false, window: false },
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
  };
}
