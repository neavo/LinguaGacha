import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NPM_INITIAL_CWD_ENV_NAME } from "./lifecycle-command-resolver";
import { CoreLifecycleManager } from "./lifecycle-manager";

let temp_dir = ""; // temp_dir 承载测试应用根和数据根，避免生命周期日志写入真实工作区
let original_initial_cwd: string | undefined; // original_initial_cwd 用于恢复 npm 启动目录，避免测试污染后续用例的应用根解析

/**
 * 读取生命周期测试写出的日志文本，用于确认启动链路不再记录旧 database HTTP 服务
 */
function read_log_text(log_dir: string): string {
  if (!fs.existsSync(log_dir)) {
    return "";
  }
  return fs
    .readdirSync(log_dir)
    .filter((file_name) => file_name.endsWith(".log"))
    .map((file_name) => fs.readFileSync(path.join(log_dir, file_name), "utf-8"))
    .join("\n");
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-lifecycle-"));
  fs.mkdirSync(path.join(temp_dir, "resource"), { recursive: true });
  fs.writeFileSync(path.join(temp_dir, "version.txt"), "9.8.7", "utf-8");
  original_initial_cwd = process.env[NPM_INITIAL_CWD_ENV_NAME];
  process.env[NPM_INITIAL_CWD_ENV_NAME] = temp_dir;
});

afterEach(() => {
  if (original_initial_cwd === undefined) {
    delete process.env[NPM_INITIAL_CWD_ENV_NAME];
  } else {
    process.env[NPM_INITIAL_CWD_ENV_NAME] = original_initial_cwd;
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("CoreLifecycleManager", () => {
  it("直接注入 ProjectDatabase 并只启动公开 API Gateway", async () => {
    const manager = new CoreLifecycleManager({ appRoot: temp_dir });

    const start_result = await manager.start();
    try {
      const health_response = await fetch(`${start_result.baseUrl}/api/health`);

      expect(await health_response.json()).toEqual({
        ok: true,
        data: {
          service: "linguagacha-core",
          status: "ok",
          version: "9.8.7",
        },
      });

      const log_text = read_log_text(path.join(temp_dir, "log"));
      expect(log_text).toContain("ProjectDatabase 已就绪");
      expect(log_text).not.toContain("Database Service 已启动");
    } finally {
      await manager.stop();
    }
  });
});
