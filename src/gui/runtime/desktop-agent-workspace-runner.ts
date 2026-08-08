import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { BrowserWindow, protocol, session, type Session } from "electron";

import type {
  BackendRuntimeAgentWorkspaceRunRequest,
  BackendRuntimeAgentWorkspaceRunResponse,
} from "../../shared/backend-runtime";
import type { JsonValue } from "../../domain/json";

const AGENT_WORKSPACE_SCHEME = "lg-agent-workspace"; // 只注册在独立脚本 session
const AGENT_WORKSPACE_URL = `${AGENT_WORKSPACE_SCHEME}://workspace/__runner__`; // 唯一允许导航的空文档
const AGENT_WORKSPACE_PARTITION = "agent-workspace"; // 无 persist: 前缀，应用退出后不落盘
const MAX_AGENT_WORKSPACE_RESULT_BYTES = 64 * 1024; // worker 只接收小型 JSON 摘要
const AGENT_WORKSPACE_RESULT_TOO_LARGE = "脚本返回结果过大；请写入 scratch 并只返回摘要。";

/** 自定义 scheme 权限必须在 Electron ready 前注册。 */
export function register_agent_workspace_scheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AGENT_WORKSPACE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * 在独立 Chromium 沙箱中执行一次 Agent 脚本，并仅开放当前工作区文件协议。
 */
export class DesktopAgentWorkspaceRunner {
  private readonly runner_session: Session; // 不复用默认 session 的 cookie、代理状态或权限
  private active_workspace_path: string | null = null; // protocol 只映射当前一次 run
  private active_window: BrowserWindow | null = null; // abort / dispose 共享的唯一 renderer 句柄
  private running = false; // 在首个 await 前占位，阻止并发请求同时通过空闲检查

  /** 注册私有文件协议，并在 session 层关闭网络、权限与下载。 */
  public constructor() {
    this.runner_session = session.fromPartition(AGENT_WORKSPACE_PARTITION, { cache: false });
    this.runner_session.protocol.handle(AGENT_WORKSPACE_SCHEME, (request) =>
      this.handle_protocol_request(request),
    );
    this.runner_session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith(`${AGENT_WORKSPACE_SCHEME}://`) });
    });
    this.runner_session.setPermissionCheckHandler(() => false);
    this.runner_session.setPermissionRequestHandler((_web_contents, _permission, callback) => {
      callback(false);
    });
    this.runner_session.on("will-download", (event) => event.preventDefault());
  }

  /** 同一 runner 只允许一个工作区运行，调用结束即销毁 renderer。 */
  public async run(
    request: BackendRuntimeAgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<BackendRuntimeAgentWorkspaceRunResponse> {
    signal.throwIfAborted();
    if (this.running) {
      throw new Error("Agent 工作区脚本正在运行。");
    }
    this.running = true;
    try {
      return await this.run_once(request, signal);
    } finally {
      this.running = false;
    }
  }

  /** 校验目录、清空浏览器状态并完成一次 renderer 执行与资源收尾。 */
  private async run_once(
    request: BackendRuntimeAgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<BackendRuntimeAgentWorkspaceRunResponse> {
    const workspace_path = path.resolve(request.workspacePath);
    const workspace_stat = await fs.promises.stat(workspace_path);
    if (!workspace_stat.isDirectory()) {
      throw new Error("Agent 工作区目录不存在。");
    }
    // 每次脚本只复用磁盘工作区；浏览器存储不得跨 run 或跨工程形成第二份状态。
    await this.runner_session.clearStorageData();
    const target_window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: this.runner_session,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    this.active_workspace_path = workspace_path;
    this.active_window = target_window;
    target_window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target_window.webContents.on("will-navigate", (event, url) => {
      if (url !== AGENT_WORKSPACE_URL) event.preventDefault();
    });
    const abort = () => target_window.destroy();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await target_window.loadURL(AGENT_WORKSPACE_URL);
      signal.throwIfAborted();
      const serialized = await target_window.webContents.executeJavaScript(
        build_workspace_script(request.script),
        true,
      );
      signal.throwIfAborted();
      const serialized_text = String(serialized);
      // renderer 内的快速检查改善模型错误；main 的独立硬门防止脚本改写全局对象后绕过上限。
      if (Buffer.byteLength(serialized_text, "utf-8") > MAX_AGENT_WORKSPACE_RESULT_BYTES) {
        throw new Error(AGENT_WORKSPACE_RESULT_TOO_LARGE);
      }
      return { result: JSON.parse(serialized_text) as JsonValue };
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      if (!target_window.isDestroyed()) target_window.destroy();
      if (this.active_window === target_window) this.active_window = null;
      if (this.active_workspace_path === workspace_path) this.active_workspace_path = null;
    }
  }

  /** 应用退出时封口协议和仍在运行的 renderer。 */
  public dispose(): void {
    this.active_window?.destroy();
    this.active_window = null;
    this.active_workspace_path = null;
    this.runner_session.protocol.unhandle(AGENT_WORKSPACE_SCHEME);
  }

  /** 协议只映射当前运行目录；target/scratch 可写，其余文件只读。 */
  private async handle_protocol_request(request: Request): Promise<Response> {
    const workspace_path = this.active_workspace_path;
    if (workspace_path === null) return response_text(410, "工作区未激活。");
    return await handle_agent_workspace_protocol_request(workspace_path, request);
  }
}

/** 真实协议读写保持为纯 Request/Response 边界，便于不启动 Electron 即验证流语义。 */
export async function handle_agent_workspace_protocol_request(
  workspace_path: string,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== "workspace") return response_text(404, "未知工作区。");
  if (url.pathname === "/__runner__" && request.method === "GET") {
    return new Response(
      "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-eval'; connect-src 'self'\">",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  try {
    if (url.pathname.startsWith("/files/")) {
      const relative_path = decode_protocol_path(url.pathname.slice("/files/".length));
      const file_path = resolve_workspace_path(workspace_path, relative_path);
      if (request.method === "GET") return await read_workspace_file(file_path);
      if (request.method === "PUT") {
        if (!is_workspace_write_path(relative_path)) {
          return response_text(403, "该工作区文件只读。");
        }
        return await write_workspace_file(file_path, request);
      }
      if (request.method === "DELETE") {
        if (!is_workspace_scratch_path(relative_path)) {
          return response_text(403, "只能删除 scratch 文件。");
        }
        await fs.promises.rm(file_path, { recursive: true, force: true });
        return new Response(null, { status: 204 });
      }
    }
    if (url.pathname === "/__list__" && request.method === "GET") {
      const relative_path = url.searchParams.get("path") ?? "";
      const directory = resolve_workspace_path(workspace_path, relative_path);
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      return Response.json(
        entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        })),
      );
    }
  } catch (error) {
    return response_text(400, project_protocol_error(error));
  }
  return response_text(405, "不支持的工作区操作。");
}

/** 路径只接受正斜线相对路径，并在 resolve 后再次校验根目录边界。 */
export function resolve_workspace_path(workspace_path: string, relative_path: string): string {
  if (
    relative_path.includes("\\") ||
    relative_path.includes("\0") ||
    path.posix.isAbsolute(relative_path) ||
    path.win32.isAbsolute(relative_path)
  ) {
    throw new Error("工作区路径非法。");
  }
  const root = path.resolve(workspace_path);
  const target = path.resolve(root, ...relative_path.split("/"));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("工作区路径越界。");
  }
  return target;
}

/** URL path 只解码一次，非法百分号不会进入平台路径解析。 */
function decode_protocol_path(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("工作区路径编码非法。");
  }
}

/** target 与 scratch 可以覆盖；manifest 和所有 context 永远只读。 */
function is_workspace_write_path(relative_path: string): boolean {
  return relative_path.startsWith("target/") || is_workspace_scratch_path(relative_path);
}

/** 删除只对临时 scratch 开放，target 必须始终保留到 Backend 校验。 */
function is_workspace_scratch_path(relative_path: string): boolean {
  return relative_path === "scratch" || relative_path.startsWith("scratch/");
}

/** 读取只接受普通文件，拒绝最终路径为符号链接。 */
async function read_workspace_file(file_path: string): Promise<Response> {
  const stat = await fs.promises.lstat(file_path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("目标不是普通工作区文件。");
  const body = Readable.toWeb(fs.createReadStream(file_path)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers: { "content-type": "application/octet-stream" } });
}

/** target 写入先落同目录临时文件，再用 rename 原子替换旧版本。 */
async function write_workspace_file(file_path: string, request: Request): Promise<Response> {
  if (request.body === null) throw new Error("工作区写入缺少正文。");
  await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
  const temp_path = path.join(
    path.dirname(file_path),
    `.${path.basename(file_path)}.${randomUUID()}.tmp`,
  );
  try {
    await pipeline(
      Readable.fromWeb(
        request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      ),
      fs.createWriteStream(temp_path, { flags: "wx" }),
    );
    await fs.promises.rename(temp_path, file_path);
    return new Response(null, { status: 204 });
  } finally {
    await fs.promises.rm(temp_path, { force: true });
  }
}

/** protocol 只返回无路径的稳定错误，完整文件系统异常留在宿主边界。 */
function project_protocol_error(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("工作区")) return error.message;
  return "工作区文件操作失败。";
}

/** 所有文本响应显式声明 UTF-8，避免 Chromium 猜测本地编码。 */
function response_text(status: number, text: string): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** 模型代码在异步函数内直接执行，不落盘、不建立长期 REPL。 */
function build_workspace_script(script: string): string {
  const script_literal = JSON.stringify(script);
  return `
(async () => {
  const encodePath = (value) => String(value).split("/").map(encodeURIComponent).join("/");
  const request = async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(await response.text() || ("工作区请求失败：" + response.status));
    return response;
  };
  async function* readLines(filePath) {
    const response = await request("/files/" + encodePath(filePath));
    if (response.body === null) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += value;
        let newline = buffered.indexOf("\\n");
        while (newline >= 0) {
          const line = buffered.slice(0, newline).replace(/\\r$/, "");
          buffered = buffered.slice(newline + 1);
          yield line;
          newline = buffered.indexOf("\\n");
        }
      }
      if (buffered !== "") yield buffered.replace(/\\r$/, "");
    } finally {
      reader.releaseLock();
    }
  }
  const workspace = Object.freeze({
    readText: async (filePath) => (await request("/files/" + encodePath(filePath))).text(),
    readJson: async (filePath) => JSON.parse(await workspace.readText(filePath)),
    readLines,
    readJsonl: async function* (filePath) {
      for await (const line of readLines(filePath)) {
        if (line.trim() !== "") yield JSON.parse(line);
      }
    },
    writeText: async (filePath, text) => {
      await request("/files/" + encodePath(filePath), { method: "PUT", body: String(text) });
    },
    writeJson: async (filePath, value) => {
      await workspace.writeText(filePath, JSON.stringify(value, null, 2) + "\\n");
    },
    writeJsonl: async (filePath, rows) => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          try {
            for await (const row of rows) controller.enqueue(encoder.encode(JSON.stringify(row) + "\\n"));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      await request("/files/" + encodePath(filePath), { method: "PUT", body, duplex: "half" });
    },
    list: async (directory = "") => {
      const response = await request("/__list__?path=" + encodeURIComponent(directory));
      return response.json();
    },
    remove: async (filePath) => {
      await request("/files/" + encodePath(filePath), { method: "DELETE" });
    },
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const result = await new AsyncFunction("workspace", ${script_literal})(workspace);
  const serialized = JSON.stringify(result ?? null);
  if (new TextEncoder().encode(serialized).byteLength > ${MAX_AGENT_WORKSPACE_RESULT_BYTES.toString()}) {
    throw new Error(${JSON.stringify(AGENT_WORKSPACE_RESULT_TOO_LARGE)});
  }
  return serialized;
})()
//# sourceURL=agent-workspace.js`;
}
