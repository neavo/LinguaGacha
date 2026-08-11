import { BrowserWindow, protocol, session, type Session } from "electron";

import type { JsonValue } from "../../domain/json";
import {
  AGENT_WORKSPACE_MAX_RESULT_BYTES,
  type BackendRuntimeAgentWorkspaceRunRequest,
  type BackendRuntimeAgentWorkspaceRunResponse,
} from "../../shared/backend-runtime";
import {
  AgentWorkspaceInvalidError,
  AgentWorkspaceTransactionError,
  DesktopAgentWorkspaceFiles,
} from "./desktop-agent-workspace-files";

const AGENT_WORKSPACE_SCHEME = "lg-agent-workspace"; // 只注册在独立脚本 session
const AGENT_WORKSPACE_URL = `${AGENT_WORKSPACE_SCHEME}://workspace/__runner__`; // 唯一允许导航的空文档
const AGENT_WORKSPACE_PARTITION = "agent-workspace"; // 无 persist: 前缀，应用退出后不落盘
const AGENT_WORKSPACE_SCRIPT_RESULT_TOO_LARGE =
  "脚本返回结果过大；请在工作区内完成聚合并只返回摘要，跨步骤确有需要时再把最小结构化状态写入 scratch。";

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

/** 在独立 Chromium 沙箱中执行单次编排脚本，并拥有本次文件事务。 */
export class DesktopAgentWorkspaceRunner {
  private readonly runner_session: Session; // 不复用默认 session 的 cookie、代理状态或权限
  private active_files: DesktopAgentWorkspaceFiles | null = null; // protocol 只映射当前合并视图
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

  /** 同一 runner 只允许一个操作，调用结束即销毁 renderer。 */
  public async run(
    request: BackendRuntimeAgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<BackendRuntimeAgentWorkspaceRunResponse> {
    signal.throwIfAborted();
    if (this.running) throw new Error("An agent workspace operation is already running.");
    this.running = true;
    try {
      return await this.run_once(request, signal);
    } finally {
      this.running = false;
    }
  }

  /** 结果过门后才提交自由脚本事务；所有已知失败都显式返回基线状态。 */
  private async run_once(
    request: BackendRuntimeAgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<BackendRuntimeAgentWorkspaceRunResponse> {
    let files: DesktopAgentWorkspaceFiles;
    try {
      files = await DesktopAgentWorkspaceFiles.open(request.workspacePath);
    } catch (error) {
      return failure_response(error, "workspace_invalid", "invalidated", request.workspacePath);
    }

    let recipe_sources: Record<string, string>;
    try {
      recipe_sources = await files.read_recipe_sources();
    } catch (error) {
      await files.rollback();
      return failure_response(error, "workspace_invalid", "invalidated", request.workspacePath);
    }

    let target_window: BrowserWindow;
    try {
      await this.runner_session.clearStorageData();
      signal.throwIfAborted();
      target_window = new BrowserWindow({
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
    } catch (error) {
      try {
        await files.rollback();
      } catch (rollback_error) {
        return failure_response(
          rollback_error,
          "transaction_failed",
          "invalidated",
          request.workspacePath,
        );
      }
      if (signal.aborted) signal.throwIfAborted();
      return failure_response(error, "execution_failed", "preserved", request.workspacePath);
    }
    this.active_files = files;
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
        build_workspace_program(request.script, recipe_sources),
        true,
      );
      signal.throwIfAborted();
      const serialized_text = String(serialized);
      // renderer 属于不可信执行边界；main 在解析和提交事务前必须独立复核字节门。
      if (Buffer.byteLength(serialized_text, "utf-8") > AGENT_WORKSPACE_MAX_RESULT_BYTES) {
        throw new Error(AGENT_WORKSPACE_SCRIPT_RESULT_TOO_LARGE);
      }
      const result = JSON.parse(serialized_text) as JsonValue;
      await files.commit(signal);
      return { status: "success", result };
    } catch (error) {
      let rollback_error: unknown = null;
      try {
        await files.rollback();
      } catch (caught) {
        rollback_error = caught;
      }
      if (signal.aborted && rollback_error === null) {
        if (error instanceof AgentWorkspaceTransactionError && !error.workspacePreserved) {
          return failure_response(
            error,
            "transaction_failed",
            "invalidated",
            request.workspacePath,
          );
        }
        signal.throwIfAborted();
      }
      if (rollback_error !== null) {
        return failure_response(
          rollback_error,
          "transaction_failed",
          "invalidated",
          request.workspacePath,
        );
      }
      if (error instanceof AgentWorkspaceInvalidError) {
        return failure_response(error, "workspace_invalid", "invalidated", request.workspacePath);
      }
      if (error instanceof AgentWorkspaceTransactionError) {
        return failure_response(
          error,
          "transaction_failed",
          error.workspacePreserved ? "preserved" : "invalidated",
          request.workspacePath,
        );
      }
      return failure_response(error, "execution_failed", "preserved", request.workspacePath);
    } finally {
      signal.removeEventListener("abort", abort);
      if (!target_window.isDestroyed()) target_window.destroy();
      if (this.active_window === target_window) this.active_window = null;
      if (this.active_files === files) this.active_files = null;
    }
  }

  /** 应用退出时终止 renderer；run_once 会在执行栈恢复后回滚事务。 */
  public dispose(): void {
    this.active_window?.destroy();
    this.active_window = null;
    this.active_files = null;
    this.runner_session.protocol.unhandle(AGENT_WORKSPACE_SCHEME);
  }

  /** runner 文档与活动文件视图共用同一私有 scheme，未运行时拒绝文件请求。 */
  private async handle_protocol_request(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/__runner__" && request.method === "GET") {
      return runner_document();
    }
    const files = this.active_files;
    if (files === null) return response_text(410, "工作区未激活。");
    return await files.handle(request);
  }
}

/** 把已知失败压缩为跨线程可克隆的稳定结果。 */
function failure_response(
  error: unknown,
  failure: "execution_failed" | "transaction_failed" | "workspace_invalid",
  workspaceState: "preserved" | "invalidated",
  workspace_path: string,
): BackendRuntimeAgentWorkspaceRunResponse {
  return {
    status: "failed",
    workspaceState,
    failure,
    message: safe_error_message(error, workspace_path),
  };
}

/** 只返回首行、去除绝对路径并封顶，既保留可修复信息也不泄漏宿主细节。 */
function safe_error_message(error: unknown, workspace_path: string): string {
  const raw = error instanceof Error ? error.message : "工作区执行失败。";
  const first_line = raw.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const workspace_paths = new Set([
    workspace_path,
    workspace_path.replaceAll("\\", "/"),
    workspace_path.replaceAll("/", "\\"),
  ]);
  let without_workspace_path = first_line;
  for (const candidate of workspace_paths) {
    without_workspace_path = without_workspace_path.replaceAll(candidate, "[workspace]");
  }
  const without_windows_path = without_workspace_path.replace(/[A-Za-z]:[\\/][^\s]*/gu, "[path]");
  return (without_windows_path === "" ? "工作区执行失败。" : without_windows_path).slice(0, 500);
}

/** runner 只需要允许自身 fetch 与内联 AsyncFunction，其余资源全部禁用。 */
function runner_document(): Response {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-eval'; connect-src 'self'\">",
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** 私有协议错误统一使用 UTF-8 纯文本响应。 */
function response_text(status: number, text: string): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** 模型代码只在异步函数内执行，不落盘、不建立长期 REPL。 */
function build_workspace_program(
  script: string,
  recipe_sources: Readonly<Record<string, string>>,
): string {
  return `
(async () => {
  const encodePath = (value) => String(value).split("/").map(encodeURIComponent).join("/");
  const request = async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(await response.text() || ("工作区请求失败：" + response.status));
    return response;
  };
  const readText = async (filePath) => (await request("/files/" + encodePath(filePath))).text();
  const readJson = async (filePath) => JSON.parse(await readText(filePath));
  async function* iterateLines(filePath) {
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
  async function* iterateJsonl(filePath) {
    for await (const line of iterateLines(filePath)) if (line.trim() !== "") yield JSON.parse(line);
  }
  // contract 从当前磁盘快照读取；recipe 与自由脚本不会各自维护第二份声明。
  const contract = await readJson("contract.json");
  // recipe 只获得冻结的读取面，自由脚本在同一基础上追加事务写方法。
  const readonlyWorkspace = Object.freeze({
    contract,
    readText,
    readJson,
    iterateLines,
    iterateJsonl,
    list: async (directory = "") => {
      const response = await request("/__list__?path=" + encodeURIComponent(directory));
      return response.json();
    },
  });
  const writeText = async (filePath, text) => {
    await request("/files/" + encodePath(filePath), { method: "PUT", body: String(text) });
  };
  const writeJson = async (filePath, value) => {
    await writeText(filePath, JSON.stringify(value, null, 2) + "\\n");
  };
  const writeJsonl = async (filePath, rows) => {
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
  };
  const remove = async (filePath) => {
    await request("/files/" + encodePath(filePath), { method: "DELETE" });
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // 发布 recipe 只获得只读 facade；同一脚本内按名称首次调用时编译并复用。
  const recipeSources = Object.freeze(${JSON.stringify(recipe_sources)});
  const compiledRecipes = new Map();
  const runRecipe = async (name, args) => {
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(recipeSources, name)) {
      throw new Error("未知 workspace recipe：" + String(name));
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new TypeError("recipe args 必须是对象。");
    }
    let recipe = compiledRecipes.get(name);
    if (recipe === undefined) {
      const source = recipeSources[name] + "\\nreturn await runRecipe(workspace, args);";
      recipe = new AsyncFunction("workspace", "args", source);
      compiledRecipes.set(name, recipe);
    }
    return await recipe(readonlyWorkspace, args);
  };
  // 正式匹配留在 Electron main，renderer 只补默认值并转发结构化参数。
  const matchLiterals = async (args) => {
    const response = await request("/__match_literals__", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...args,
        examples_per_pattern:
          args?.examples_per_pattern ?? contract.limits.literal_match_examples_default,
      }),
    });
    return await response.json();
  };
  const workspace = Object.freeze({
    ...readonlyWorkspace,
    writeText,
    writeJson,
    writeJsonl,
    remove,
    runRecipe,
    matchLiterals,
  });
  const result = await new AsyncFunction("workspace", ${JSON.stringify(script)})(workspace);
  const serialized = JSON.stringify(result ?? null);
  if (serialized === undefined) throw new TypeError("工作区结果无法序列化为 JSON。");
  if (new TextEncoder().encode(serialized).byteLength > ${AGENT_WORKSPACE_MAX_RESULT_BYTES.toString()}) {
    throw new Error(${JSON.stringify(AGENT_WORKSPACE_SCRIPT_RESULT_TOO_LARGE)});
  }
  return serialized;
})()
//# sourceURL=agent-workspace.js`;
}
