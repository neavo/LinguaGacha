import child_process from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Arch } from "builder-util";

const WINDOWS_GO_TOOLS = [
  {
    label: "Windows CLI 启动器",
    executableName: "cli.exe", // Windows 用户看到的唯一 CLI 文件名
    ldflags: "-s -w",
    sourceRelativeDir: path.join("buildtools", "builder", "win-cli"), // Go 模块固定落点
    outputRelativeDir: path.join("build", "builder", "win-cli"), // 架构子目录由 afterPack 目标架构决定
  },
  {
    label: "Windows 自动更新器",
    executableName: "berserker.exe", // 主应用复制到 userdata 后用于覆盖更新
    ldflags: "-s -w -H windowsgui",
    sourceRelativeDir: path.join("buildtools", "builder", "win-berserker"), // Go 模块固定落点
    outputRelativeDir: path.join("build", "builder", "win-berserker"), // 架构子目录由 afterPack 目标架构决定
  },
];

const WINDOWS_CLI_TOOL = WINDOWS_GO_TOOLS[0];
const WINDOWS_BERSERKER_TOOL = WINDOWS_GO_TOOLS[1];

/**
 * electron-builder 打包后补齐 Windows 轻量 CLI 启动器和自动更新器。
 */
export default async function after_pack(context) {
  await install_windows_cli_launcher(context);
  await install_windows_berserker(context);
}

/**
 * Windows 使用 Go 编译出的 console launcher；macOS 和 Linux 直接由主程序 --cli 进入命令模式。
 */
export async function install_windows_cli_launcher(
  context,
  run_command = child_process.execFileSync,
) {
  await install_windows_go_tool(context, WINDOWS_CLI_TOOL, run_command);
}

/**
 * Windows 使用 Go 编译出的外部更新器；其它平台没有自动覆盖更新入口。
 */
export async function install_windows_berserker(context, run_command = child_process.execFileSync) {
  await install_windows_go_tool(context, WINDOWS_BERSERKER_TOOL, run_command);
}

/**
 * Windows 发布包必须在 afterPack 内构建轻量 console launcher，确保打包入口拥有完整产物生命周期。
 */
export async function build_windows_cli_launcher(
  project_dir,
  windows_arch,
  run_command = child_process.execFileSync,
) {
  await build_windows_go_tool(project_dir, WINDOWS_CLI_TOOL, windows_arch, run_command);
}

/**
 * Windows 发布包必须在 afterPack 内构建外部更新器，保证 zip 自带覆盖更新能力。
 */
export async function build_windows_berserker(
  project_dir,
  windows_arch,
  run_command = child_process.execFileSync,
) {
  await build_windows_go_tool(project_dir, WINDOWS_BERSERKER_TOOL, windows_arch, run_command);
}

/**
 * 安装单个 Windows Go 工具，非 Windows 平台直接跳过。
 */
async function install_windows_go_tool(context, tool, run_command) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const project_dir = resolve_project_dir(context);
  const windows_arch = resolve_windows_go_arch(context);
  await build_windows_go_tool(project_dir, tool, windows_arch, run_command);

  const tool_path = resolve_windows_go_tool_path(project_dir, tool, windows_arch);
  await assert_windows_go_tool_exists(tool_path, tool);
  await fs.copyFile(tool_path, path.join(context.appOutDir, tool.executableName));
}

/**
 * 在对应 Go 模块内执行测试和构建，输出固定发布产物。
 */
async function build_windows_go_tool(project_dir, tool, windows_arch, run_command) {
  const tool_source_dir = path.join(project_dir, tool.sourceRelativeDir);
  const go_arch = resolve_windows_go_arch_from_name(windows_arch);
  const tool_output_dir = path.join(project_dir, tool.outputRelativeDir, windows_arch);
  const tool_output_path = resolve_windows_go_tool_path(project_dir, tool, windows_arch);
  // Go 测试使用宿主架构运行，避免在 x64 机器上执行 arm64 测试二进制。
  const go_test_env = {
    ...process.env,
    CGO_ENABLED: "0",
  };
  // Go 构建才切到发布目标架构，保证 zip 内工具和 Electron 主程序一致。
  const go_build_env = {
    ...process.env,
    CGO_ENABLED: "0",
    GOARCH: go_arch,
    GOOS: "windows",
  };

  await fs.mkdir(tool_output_dir, { recursive: true });
  run_go(["test", "./..."], tool_source_dir, go_test_env, run_command, tool);
  run_go(
    ["build", "-trimpath", "-ldflags", tool.ldflags, "-o", tool_output_path, "."],
    tool_source_dir,
    go_build_env,
    run_command,
    tool,
  );
}

/**
 * 从 electron-builder 上下文解析仓库根，测试上下文缺省时回退当前工作目录。
 */
function resolve_project_dir(context) {
  return context.packager?.projectDir ?? process.cwd();
}

/**
 * afterPack 只从固定构建目录取 Go 工具，避免发布目录与源码目录耦合。
 */
function resolve_windows_go_tool_path(project_dir, tool, windows_arch) {
  return path.join(project_dir, tool.outputRelativeDir, windows_arch, tool.executableName);
}

/**
 * 从 electron-builder 的目标架构解析 Windows Go 工具发布架构。
 */
export function resolve_windows_go_arch(context) {
  const arch_name = resolve_electron_builder_arch_name(context.arch);

  if (arch_name === "x64" || arch_name === "arm64") {
    return arch_name;
  }

  throw new Error(`不支持的 Windows 发布架构：${String(arch_name ?? context.arch)}`);
}

/**
 * 把 Windows 发布架构映射为 Go 交叉编译使用的 GOARCH。
 */
function resolve_windows_go_arch_from_name(windows_arch) {
  if (windows_arch === "x64") {
    return "amd64";
  }

  if (windows_arch === "arm64") {
    return "arm64";
  }

  throw new Error(`不支持的 Windows 发布架构：${String(windows_arch)}`);
}

/**
 * electron-builder 上下文可能给出 Arch 枚举值或字符串，这里统一转成名称。
 */
function resolve_electron_builder_arch_name(arch) {
  if (arch === "x64" || arch === "arm64") {
    return arch;
  }

  if (typeof arch === "number") {
    const arch_name = Arch[arch];
    return typeof arch_name === "string" ? arch_name : null;
  }

  return null;
}

/**
 * 所有 Go 命令都在各自模块内运行，避免污染仓库根目录。
 */
function run_go(args, cwd, env, run_command, tool) {
  try {
    run_command("go", args, {
      cwd,
      env,
      stdio: "inherit",
    });
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`构建 ${tool.label}需要 Go 工具链；请先安装 Go 并确保 go 在 PATH 中`);
    }
    throw error;
  }
}

/**
 * 构建后仍校验产物存在，避免 Go 构建异常或测试替身遗漏时静默发布坏包。
 */
async function assert_windows_go_tool_exists(tool_path, tool) {
  try {
    const stat = await fs.stat(tool_path);
    if (stat.isFile()) {
      return;
    }
  } catch {
    // 下面抛出带构建上下文的统一错误。
  }
  throw new Error(`缺少 ${tool.label}：${tool_path}，请检查 Go 构建输出`);
}
