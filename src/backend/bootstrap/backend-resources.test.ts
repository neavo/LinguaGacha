import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
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
  it("启动共享资源并在关闭时恢复全局网络入口", async () => {
    const original_fetch = globalThis.fetch;
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const resources = await BackendResources.start(create_options());

    expect(resources.metadata.read_version()).toBe("1.2.3");
    expect(globalThis.fetch).not.toBe(original_fetch);

    await resources.dispose();

    expect(globalThis.fetch).toBe(original_fetch);
    expect(database_close).toHaveBeenCalledOnce();
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

function create_options() {
  return {
    appRoot: app_root,
    builtinRoot: path.resolve(process.cwd(), "builtin"),
    logTargets: { console: false, window: false },
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
  };
}
