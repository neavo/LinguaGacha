import child_process from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import type { AppPathService } from "../../backend/app/app-path-service";
import type {
  DesktopUpdateDownloadIpcRequest,
  DesktopUpdateDownloadProgress,
  DesktopUpdateDownloadResult,
  DesktopUpdateLaunchRequest,
  DesktopUpdateLaunchResult,
} from "../bridge/bridge-types";

const BERSERKER_EXECUTABLE_NAME = "berserker.exe";
const DOWNLOAD_TEMP_SUFFIX = ".download";
const WINDOWS_PLATFORM: NodeJS.Platform = "win32";
const UPDATE_VERSION_DIR_PREFIX = "v";

type DesktopUpdateProgressReporter = (progress: DesktopUpdateDownloadProgress) => void;
type DesktopUpdateFetch = typeof fetch;
type DesktopUpdateSpawn = typeof child_process.spawn;

export type DesktopUpdateRuntime = {
  platform: NodeJS.Platform;
  execPath: string;
  pid: number;
  fetch: DesktopUpdateFetch;
  spawn: DesktopUpdateSpawn;
};

export type DesktopUpdateServiceOptions = {
  paths: AppPathService;
  runtime?: Partial<DesktopUpdateRuntime>;
};

/**
 * Electron main 自动更新副作用入口，renderer 只能通过 preload 的窄桥接调用它。
 */
export class DesktopUpdateService {
  private readonly paths: AppPathService;
  private readonly runtime: DesktopUpdateRuntime;

  /**
   * 初始化自动更新服务依赖，测试可替换运行时副作用边界。
   */
  public constructor(options: DesktopUpdateServiceOptions) {
    this.paths = options.paths;
    this.runtime = {
      platform: options.runtime?.platform ?? process.platform,
      execPath: options.runtime?.execPath ?? process.execPath,
      pid: options.runtime?.pid ?? process.pid,
      fetch: options.runtime?.fetch ?? fetch,
      spawn: options.runtime?.spawn ?? child_process.spawn,
    };
  }

  /**
   * 启动期只清理版本目录，保留可复用的 berserker.exe。
   */
  public async cleanup_berserker_version_dirs(): Promise<void> {
    await cleanup_berserker_version_dirs(this.paths);
  }

  /**
   * 下载 Windows x64 release zip，环境不满足时返回发布页回退结果。
   */
  public async download_release(
    request: DesktopUpdateDownloadIpcRequest,
    report_progress: DesktopUpdateProgressReporter,
  ): Promise<DesktopUpdateDownloadResult> {
    const fallback_result = await this.resolve_download_fallback(request);
    if (fallback_result !== null) {
      return fallback_result;
    }

    const zip_url = request.windows_x64_zip_url;
    if (zip_url === null) {
      return {
        status: "fallback_to_release_page",
        release_url: request.release_url,
        reason: "missing_windows_x64_zip_url",
      };
    }

    const version_dir = this.paths.get_berserker_version_dir(request.latest_version);
    const zip_file_name = resolve_zip_file_name(zip_url, request.latest_version);
    const zip_path = path.join(version_dir, zip_file_name);
    const temp_zip_path = `${zip_path}${DOWNLOAD_TEMP_SUFFIX}`;

    await fs.mkdir(version_dir, { recursive: true });
    await fs.rm(temp_zip_path, { force: true });

    try {
      const response = await this.runtime.fetch(zip_url, { method: "GET" });
      if (!response.ok) {
        throw new Error(`下载更新包失败：HTTP ${response.status.toString()}`);
      }
      if (response.body === null) {
        throw new Error("下载更新包失败：响应体为空");
      }

      const downloaded_bytes = await write_response_body_to_file({
        requestId: request.request_id,
        response,
        targetPath: temp_zip_path,
        reportProgress: report_progress,
      });
      await fs.rm(zip_path, { force: true });
      await fs.rename(temp_zip_path, zip_path);
      report_progress({
        request_id: request.request_id,
        progress_percent: 100,
        downloaded_bytes,
        total_bytes: read_content_length(response.headers),
      });

      return {
        status: "downloaded",
        latest_version: request.latest_version,
        release_url: request.release_url,
        zip_path,
      };
    } catch (error) {
      await fs.rm(temp_zip_path, { force: true });
      throw error;
    }
  }

  /**
   * 复制发布包内的更新器并启动，主应用退出由 IPC handler 统一触发。
   */
  public async launch_berserker(
    request: DesktopUpdateLaunchRequest,
  ): Promise<DesktopUpdateLaunchResult> {
    const version_dir = this.paths.get_berserker_version_dir(request.latest_version);
    const resolved_zip_path = path.resolve(request.zip_path);
    if (!is_path_inside(resolved_zip_path, version_dir)) {
      throw new Error("更新包路径不在当前版本目录内");
    }

    const update_root_dir = this.paths.get_berserker_update_root_dir();
    await fs.mkdir(update_root_dir, { recursive: true });
    const packaged_berserker_path = path.join(this.paths.get_app_root(), BERSERKER_EXECUTABLE_NAME);
    const user_berserker_path = path.join(update_root_dir, BERSERKER_EXECUTABLE_NAME);
    await fs.copyFile(packaged_berserker_path, user_berserker_path);

    const args = [
      "--zip",
      resolved_zip_path,
      "--target",
      this.paths.get_app_root(),
      "--app",
      this.runtime.execPath,
      "--wait-pid",
      this.runtime.pid.toString(),
    ];
    await spawn_berserker(this.runtime.spawn, user_berserker_path, args);

    return { status: "launched" };
  }

  private async resolve_download_fallback(
    request: DesktopUpdateDownloadIpcRequest,
  ): Promise<DesktopUpdateDownloadResult | null> {
    if (this.runtime.platform !== WINDOWS_PLATFORM) {
      return {
        status: "fallback_to_release_page",
        release_url: request.release_url,
        reason: "unsupported_platform",
      };
    }
    if (request.windows_x64_zip_url === null) {
      return {
        status: "fallback_to_release_page",
        release_url: request.release_url,
        reason: "missing_windows_x64_zip_url",
      };
    }
    if (!(await can_write_directory(path.dirname(this.runtime.execPath)))) {
      return {
        status: "fallback_to_release_page",
        release_url: request.release_url,
        reason: "target_dir_not_writable",
      };
    }

    return null;
  }
}

/**
 * 清理 userdata/berserker 下的 v* 目录，避免旧更新包长期滞留。
 */
export async function cleanup_berserker_version_dirs(paths: AppPathService): Promise<void> {
  const update_root_dir = paths.get_berserker_update_root_dir();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(update_root_dir, { withFileTypes: true });
  } catch (error) {
    if (is_node_error_code(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(UPDATE_VERSION_DIR_PREFIX))
      .map((entry) =>
        fs.rm(path.join(update_root_dir, entry.name), { force: true, recursive: true }),
      ),
  );
}

/**
 * 流式写入下载响应体，并把累计字节数报告给 renderer。
 */
async function write_response_body_to_file(args: {
  requestId: string;
  response: Response;
  targetPath: string;
  reportProgress: DesktopUpdateProgressReporter;
}): Promise<number> {
  const body = args.response.body;
  if (body === null) {
    throw new Error("下载更新包失败：响应体为空");
  }

  const total_bytes = read_content_length(args.response.headers);
  const reader = body.getReader();
  const file = await fs.open(args.targetPath, "w");
  let downloaded_bytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const chunk = result.value;
      downloaded_bytes += chunk.byteLength;
      await file.write(chunk);
      args.reportProgress({
        request_id: args.requestId,
        progress_percent: calculate_progress_percent(downloaded_bytes, total_bytes),
        downloaded_bytes,
        total_bytes,
      });
    }
  } finally {
    await file.close();
    reader.releaseLock();
  }

  return downloaded_bytes;
}

/**
 * 计算保守下载进度，完成前最高只报告到 99.99。
 */
function calculate_progress_percent(downloaded_bytes: number, total_bytes: number | null): number {
  if (total_bytes === null || total_bytes <= 0) {
    return 0;
  }

  return Math.min(99.99, Math.max(0, (downloaded_bytes / total_bytes) * 100));
}

/**
 * 读取可信的 Content-Length，缺失或非法时交给未知总长分支处理。
 */
function read_content_length(headers: Headers): number | null {
  const raw_value = headers.get("content-length");
  if (raw_value === null) {
    return null;
  }

  const parsed_value = Number(raw_value);
  return Number.isFinite(parsed_value) && parsed_value > 0 ? parsed_value : null;
}

/**
 * 通过临时探针确认安装目录可写，失败时允许 renderer 回退发布页。
 */
async function can_write_directory(directory: string): Promise<boolean> {
  try {
    await fs.mkdir(directory, { recursive: true });
    const probe_path = path.join(
      directory,
      `.linguagacha_update_probe_${Date.now().toString()}_${Math.random().toString(16).slice(2)}`,
    );
    await fs.writeFile(probe_path, "");
    await fs.rm(probe_path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 从下载 URL 解析安全 zip 文件名，异常时使用稳定兜底名称。
 */
function resolve_zip_file_name(zip_url: string, latest_version: string): string {
  try {
    const url = new URL(zip_url);
    const file_name = path.basename(decodeURIComponent(url.pathname)).trim();
    if (is_safe_zip_file_name(file_name)) {
      return file_name;
    }
  } catch {
    // 下面使用稳定文件名兜底。
  }

  return `LinguaGacha_v${latest_version}_Windows_x64.zip`;
}

/**
 * 判断文件名是否能安全落到版本目录内。
 */
function is_safe_zip_file_name(file_name: string): boolean {
  return (
    file_name !== "" &&
    !file_name.includes("/") &&
    !file_name.includes("\\") &&
    file_name.endsWith(".zip")
  );
}

/**
 * 判断子路径是否仍位于父目录内部，防止 renderer 传入越界 zip。
 */
function is_path_inside(child_path: string, parent_path: string): boolean {
  const relative_path = path.relative(path.resolve(parent_path), path.resolve(child_path));
  return (
    relative_path === "" || (!relative_path.startsWith("..") && !path.isAbsolute(relative_path))
  );
}

/**
 * 以脱离主进程的方式启动外部更新器，等待 spawn 成功后再返回。
 */
async function spawn_berserker(
  spawn: DesktopUpdateSpawn,
  executable_path: string,
  args: string[],
): Promise<void> {
  const child = spawn(executable_path, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}

/**
 * 收窄 Node.js 错误码，避免 catch 分支依赖 any。
 */
function is_node_error_code(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
