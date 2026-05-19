import child_process from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const WINDOWS_CLI_EXECUTABLE_NAME = "cli.exe"; // Windows 用户看到的唯一 CLI 文件名
const WINDOWS_CLI_LAUNCHER_SOURCE_RELATIVE_DIR = path.join(
  "buildtools",
  "builder",
  "win-cli-launcher",
); // Go 模块固定落点
const WINDOWS_CLI_LAUNCHER_OUTPUT_RELATIVE_DIR = path.join("build", "builder", "win-cli-launcher"); // afterPack 与 Go build 共享产物目录
const WINDOWS_CLI_LAUNCHER_OUTPUT_RELATIVE_PATH = path.join(
  WINDOWS_CLI_LAUNCHER_OUTPUT_RELATIVE_DIR,
  WINDOWS_CLI_EXECUTABLE_NAME,
);

/**
 * electron-builder 打包后只补齐 Windows 轻量 CLI 启动器。
 */
export default async function after_pack(context) {
  await install_windows_cli_launcher(context);
}

/**
 * Windows 使用 Go 编译出的 console launcher；macOS 和 Linux 直接由主程序 --cli 进入命令模式。
 */
export async function install_windows_cli_launcher(
  context,
  run_command = child_process.execFileSync,
) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const project_dir = resolve_project_dir(context);
  await build_windows_cli_launcher(project_dir, run_command);

  const launcher_path = resolve_windows_cli_launcher_path(project_dir);
  await assert_windows_cli_launcher_exists(launcher_path);
  await fs.copyFile(launcher_path, path.join(context.appOutDir, WINDOWS_CLI_EXECUTABLE_NAME));
}

/**
 * Windows 发布包必须在 afterPack 内构建轻量 console launcher，确保打包入口拥有完整产物生命周期。
 */
export async function build_windows_cli_launcher(
  project_dir,
  run_command = child_process.execFileSync,
) {
  const launcher_source_dir = path.join(project_dir, WINDOWS_CLI_LAUNCHER_SOURCE_RELATIVE_DIR);
  const launcher_output_dir = path.join(project_dir, WINDOWS_CLI_LAUNCHER_OUTPUT_RELATIVE_DIR);
  const launcher_output_path = path.join(project_dir, WINDOWS_CLI_LAUNCHER_OUTPUT_RELATIVE_PATH);
  const go_env = {
    ...process.env,
    CGO_ENABLED: "0",
    GOARCH: "amd64",
    GOOS: "windows",
  };

  await fs.mkdir(launcher_output_dir, { recursive: true });
  run_go(["test", "./..."], launcher_source_dir, go_env, run_command);
  run_go(
    ["build", "-trimpath", "-ldflags", "-s -w", "-o", launcher_output_path, "."],
    launcher_source_dir,
    go_env,
    run_command,
  );
}

/**
 * 从 electron-builder 上下文解析仓库根，测试上下文缺省时回退当前工作目录。
 */
function resolve_project_dir(context) {
  return context.packager?.projectDir ?? process.cwd();
}

/**
 * afterPack 只从固定构建目录取启动器，避免发布目录与源码目录耦合。
 */
function resolve_windows_cli_launcher_path(project_dir) {
  return path.join(project_dir, WINDOWS_CLI_LAUNCHER_OUTPUT_RELATIVE_PATH);
}

/**
 * 所有 Go 命令都在 launcher 模块内运行，避免污染仓库根目录。
 */
function run_go(args, cwd, env, run_command) {
  try {
    run_command("go", args, {
      cwd,
      env,
      stdio: "inherit",
    });
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("构建 Windows CLI 启动器需要 Go 工具链；请先安装 Go 并确保 go 在 PATH 中");
    }
    throw error;
  }
}

/**
 * 构建后仍校验产物存在，避免 Go 构建异常或测试替身遗漏时静默发布坏包。
 */
async function assert_windows_cli_launcher_exists(launcher_path) {
  try {
    const stat = await fs.stat(launcher_path);
    if (stat.isFile()) {
      return;
    }
  } catch {
    // 下面抛出带构建上下文的统一错误。
  }
  throw new Error(`缺少 Windows CLI 启动器：${launcher_path}，请检查 Go 构建输出`);
}
