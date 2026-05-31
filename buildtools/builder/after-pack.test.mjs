import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { build_windows_cli_launcher, install_windows_cli_launcher } from "./after-pack.mjs";

const cleanup_roots = []; // 收集测试临时目录，避免真实发布目录被触碰
const WINDOWS_CLI_SOURCE_RELATIVE_DIR = path.join("buildtools", "builder", "win-cli-launcher"); // 测试只关心 Go 模块稳定位置
const WINDOWS_CLI_OUTPUT_RELATIVE_PATH = path.join(
  "build",
  "builder",
  "win-cli-launcher",
  "cli.exe",
); // afterPack 对外复制的唯一产物

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

describe("electron-builder afterPack", () => {
  it("Windows 发布目录放入 afterPack 构建出的轻量 cli.exe", async () => {
    const project_dir = create_temp_dir();
    const app_out_dir = create_temp_dir();
    const commands = [];

    await install_windows_cli_launcher(
      {
        appOutDir: app_out_dir,
        electronPlatformName: "win32",
        packager: { projectDir: project_dir },
      },
      create_go_runner(commands, "go-launcher"),
    );

    expect(readFileSync(path.join(app_out_dir, "cli.exe"), "utf-8")).toBe("go-launcher");
    expect(commands.map((command) => command.command)).toEqual(["go", "go"]);
    expect(commands.map((command) => command.args)).toEqual([
      ["test", "./..."],
      [
        "build",
        "-trimpath",
        "-ldflags",
        "-s -w",
        "-o",
        path.join(project_dir, WINDOWS_CLI_OUTPUT_RELATIVE_PATH),
        ".",
      ],
    ]);
    expect(commands[0].options.cwd).toBe(path.join(project_dir, WINDOWS_CLI_SOURCE_RELATIVE_DIR));
    expect(commands[1].options.env).toMatchObject({
      CGO_ENABLED: "0",
      GOARCH: "amd64",
      GOOS: "windows",
    });
  });

  it("macOS 和 Linux 不运行 Go 构建也不生成额外 cli 文件", async () => {
    const project_dir = create_temp_dir();
    const app_out_dir = create_temp_dir();
    const commands = [];

    await install_windows_cli_launcher(
      {
        appOutDir: app_out_dir,
        electronPlatformName: "darwin",
        packager: { projectDir: project_dir },
      },
      create_go_runner(commands, "go-launcher"),
    );
    await install_windows_cli_launcher(
      {
        appOutDir: app_out_dir,
        electronPlatformName: "linux",
        packager: { projectDir: project_dir },
      },
      create_go_runner(commands, "go-launcher"),
    );

    expect(() => readFileSync(path.join(app_out_dir, "cli"))).toThrow();
    expect(() => readFileSync(path.join(app_out_dir, "cli.exe"))).toThrow();
    expect(commands).toHaveLength(0);
  });

  it("Windows 构建后缺少启动器产物时中止打包", async () => {
    const project_dir = create_temp_dir();
    const app_out_dir = create_temp_dir();

    await expect(
      install_windows_cli_launcher(
        {
          appOutDir: app_out_dir,
          electronPlatformName: "win32",
          packager: { projectDir: project_dir },
        },
        create_go_runner_without_output(),
      ),
    ).rejects.toThrow("缺少 Windows CLI 启动器");
  });

  it("缺少 PATH 中的 go 时输出清晰错误", async () => {
    const project_dir = create_temp_dir();

    await expect(
      build_windows_cli_launcher(project_dir, create_missing_go_runner()),
    ).rejects.toThrow("构建 Windows CLI 启动器需要 Go 工具链");
  });
});

/**
 * 创建独立临时目录，afterEach 统一清理。
 */
function create_temp_dir() {
  const root = mkdtempSync(path.join(os.tmpdir(), "linguagacha-after-pack-"));
  cleanup_roots.push(root);
  return root;
}

/**
 * 创建 Go 命令替身，build 命令会写出 cli.exe，避免测试依赖本机 Go 工具链。
 */
function create_go_runner(commands, output) {
  return (command, args, options) => {
    commands.push({ args, command, options });
    if (args[0] !== "build") {
      return;
    }

    const output_arg_index = args.indexOf("-o");
    writeFileSync(args[output_arg_index + 1], output);
  };
}

/**
 * 构建命令正常返回但不产生 cli.exe，用来证明 afterPack 不会静默发布缺入口的包。
 */
function create_go_runner_without_output() {
  return () => {};
}

/**
 * 模拟系统 PATH 中没有 go.exe 的错误形态。
 */
function create_missing_go_runner() {
  return () => {
    const error = new Error("spawn go ENOENT");
    error.code = "ENOENT";
    throw error;
  };
}
