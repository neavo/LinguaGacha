import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPathService } from "../../backend/app/app-path-service";
import {
  DesktopUpdateService,
  cleanup_berserker_version_dirs,
  type DesktopUpdateRuntime,
} from "./desktop-update-service";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }
});

describe("DesktopUpdateService", () => {
  it("下载 Windows x64 zip 到 userdata berserker 版本目录并回传进度", async () => {
    const app_root = create_temp_root("linguagacha-update-app-");
    const exec_path = path.join(app_root, "app.exe");
    fs.writeFileSync(exec_path, "app", "utf-8");
    const service = create_service(app_root, {
      execPath: exec_path,
      fetch: async () =>
        new Response(new Blob(["hello update"]), {
          status: 200,
          headers: { "content-length": "12" },
        }),
    });
    const progress_values: number[] = [];

    const result = await service.download_release(
      {
        request_id: "download-1",
        latest_version: "1.2.4",
        release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
        windows_x64_zip_url:
          "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
      },
      (progress) => {
        progress_values.push(progress.progress_percent);
      },
    );

    const expected_zip_path = path.join(
      app_root,
      "userdata",
      "berserker",
      "v1.2.4",
      "LinguaGacha_v1.2.4_Windows_x64.zip",
    );
    expect(result).toEqual({
      status: "downloaded",
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
      zip_path: expected_zip_path,
    });
    expect(fs.readFileSync(expected_zip_path, "utf-8")).toBe("hello update");
    expect(fs.existsSync(`${expected_zip_path}.download`)).toBe(false);
    expect(progress_values.at(-1)).toBe(100);
  });

  it("非 Windows、缺 zip 或应用目录不可写时返回发布页回退结果", async () => {
    const app_root = create_temp_root("linguagacha-update-fallback-");
    const base_request = {
      request_id: "download-1",
      latest_version: "1.2.4",
      release_url: "release",
      windows_x64_zip_url: "zip-url",
    };
    const non_windows_service = create_service(app_root, { platform: "linux" });
    const missing_zip_service = create_service(app_root);
    const blocked_exec_path = path.join(app_root, "blocked", "app.exe");
    fs.writeFileSync(path.dirname(blocked_exec_path), "blocked", "utf-8");
    const blocked_service = create_service(app_root, { execPath: blocked_exec_path });

    await expect(non_windows_service.download_release(base_request, vi.fn())).resolves.toEqual({
      status: "fallback_to_release_page",
      release_url: "release",
      reason: "unsupported_platform",
    });
    await expect(
      missing_zip_service.download_release(
        {
          ...base_request,
          windows_x64_zip_url: null,
        },
        vi.fn(),
      ),
    ).resolves.toEqual({
      status: "fallback_to_release_page",
      release_url: "release",
      reason: "missing_windows_x64_zip_url",
    });
    await expect(blocked_service.download_release(base_request, vi.fn())).resolves.toEqual({
      status: "fallback_to_release_page",
      release_url: "release",
      reason: "target_dir_not_writable",
    });
  });

  it("启动清理只删除 berserker 下的 v 开头目录", async () => {
    const app_root = create_temp_root("linguagacha-update-cleanup-");
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    fs.mkdirSync(path.join(paths.get_berserker_update_root_dir(), "v1.2.3"), { recursive: true });
    fs.mkdirSync(path.join(paths.get_berserker_update_root_dir(), "cache"), { recursive: true });
    fs.writeFileSync(path.join(paths.get_berserker_update_root_dir(), "berserker.exe"), "exe");

    await cleanup_berserker_version_dirs(paths);

    expect(fs.existsSync(path.join(paths.get_berserker_update_root_dir(), "v1.2.3"))).toBe(false);
    expect(fs.existsSync(path.join(paths.get_berserker_update_root_dir(), "cache"))).toBe(true);
    expect(fs.existsSync(path.join(paths.get_berserker_update_root_dir(), "berserker.exe"))).toBe(
      true,
    );
  });

  it("重启更新前复制 berserker 并用 zip、目标目录、主程序和 pid 启动", async () => {
    const app_root = create_temp_root("linguagacha-update-launch-");
    const packaged_berserker_path = path.join(app_root, "berserker.exe");
    const zip_path = path.join(
      app_root,
      "userdata",
      "berserker",
      "v1.2.4",
      "LinguaGacha_v1.2.4_Windows_x64.zip",
    );
    fs.mkdirSync(path.dirname(zip_path), { recursive: true });
    fs.writeFileSync(packaged_berserker_path, "berserker", "utf-8");
    fs.writeFileSync(zip_path, "zip", "utf-8");
    const spawn_calls: Array<{ command: string; args: string[]; options: unknown }> = [];
    const service = create_service(app_root, {
      execPath: path.join(app_root, "app.exe"),
      pid: 12345,
      spawn: ((command: string, args?: readonly string[], options?: unknown) => {
        spawn_calls.push({ command, args: [...(args ?? [])], options });
        const child = new EventEmitter() as EventEmitter & { unref: () => void };
        child.unref = vi.fn();
        queueMicrotask(() => {
          child.emit("spawn");
        });
        return child as never;
      }) as unknown as DesktopUpdateRuntime["spawn"],
    });

    await expect(
      service.launch_berserker({
        latest_version: "1.2.4",
        zip_path,
      }),
    ).resolves.toEqual({ status: "launched" });

    const user_berserker_path = path.join(app_root, "userdata", "berserker", "berserker.exe");
    expect(fs.readFileSync(user_berserker_path, "utf-8")).toBe("berserker");
    expect(spawn_calls).toEqual([
      {
        command: user_berserker_path,
        args: [
          "--zip",
          zip_path,
          "--target",
          app_root,
          "--app",
          path.join(app_root, "app.exe"),
          "--wait-pid",
          "12345",
        ],
        options: {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        },
      },
    ]);
  });

  it("拒绝启动当前版本目录外的更新包", async () => {
    const app_root = create_temp_root("linguagacha-update-invalid-");
    const service = create_service(app_root);

    await expect(
      service.launch_berserker({
        latest_version: "1.2.4",
        zip_path: path.join(app_root, "userdata", "berserker", "v1.2.5", "update.zip"),
      }),
    ).rejects.toThrow("更新包路径不在当前版本目录内");
  });
});

/**
 * 创建自动更新服务测试实例，并替换下载、进程和平台副作用。
 */
function create_service(
  app_root: string,
  runtime: Partial<DesktopUpdateRuntime> = {},
): DesktopUpdateService {
  return new DesktopUpdateService({
    paths: new AppPathService({ appRoot: app_root, env: {}, platform: "win32" }),
    runtime: {
      platform: "win32",
      execPath: path.join(app_root, "app.exe"),
      pid: 1,
      fetch: async () => new Response(new Blob(["zip"]), { status: 200 }),
      ...runtime,
    },
  });
}

/**
 * 创建测试临时根目录，afterEach 统一清理。
 */
function create_temp_root(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup_roots.push(root);
  return root;
}
