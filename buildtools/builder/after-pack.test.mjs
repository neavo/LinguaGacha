import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { install_windows_cli_launcher, resolve_windows_go_arch } from "./after-pack.mjs";

const cleanup_roots = [];

describe("afterPack Windows CLI launcher", () => {
  afterEach(async () => {
    while (cleanup_roots.length > 0) {
      await rm(cleanup_roots.pop(), { force: true, recursive: true });
    }
  });

  it.each([
    ["x64", "x64"],
    ["arm64", "arm64"],
  ])("把 electron-builder 架构 %s 映射为 Windows 工具架构 %s", (arch, expected) => {
    expect(resolve_windows_go_arch({ arch })).toBe(expected);
  });

  it("非 Windows 打包不运行 Go 工具链", async () => {
    const run_command = vi.fn();

    await install_windows_cli_launcher(
      { electronPlatformName: "linux", arch: "x64", appOutDir: "unused" },
      run_command,
    );

    expect(run_command).not.toHaveBeenCalled();
  });

  it("Windows 打包先测试再构建并复制固定 CLI 产物", async () => {
    const project_dir = await mkdtemp(path.join(tmpdir(), "linguagacha-after-pack-"));
    cleanup_roots.push(project_dir);
    const app_out_dir = path.join(project_dir, "app-out");
    mkdirSync(app_out_dir, { recursive: true });
    const calls = [];
    const run_command = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] !== "build") {
        return;
      }
      const output_path = args[args.indexOf("-o") + 1];
      mkdirSync(path.dirname(output_path), { recursive: true });
      writeFileSync(output_path, "cli-binary");
    };

    await install_windows_cli_launcher(
      {
        electronPlatformName: "win32",
        arch: "x64",
        appOutDir: app_out_dir,
        packager: { projectDir: project_dir },
      },
      run_command,
    );

    expect(calls.map((call) => call.args[0])).toEqual(["test", "build"]);
    expect(calls[0]?.args).toEqual(["test", "./..."]);
    expect(calls[1]?.options.env).toMatchObject({
      CGO_ENABLED: "0",
      GOARCH: "amd64",
      GOOS: "windows",
    });
    await expect(readFile(path.join(app_out_dir, "cli.exe"), "utf8")).resolves.toBe("cli-binary");
  });
});
