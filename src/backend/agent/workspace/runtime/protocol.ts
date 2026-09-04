import { is_json_record } from "../../../../domain/json";
import { normalize_agent_todos } from "../../../../shared/agent-todo";
import type { SystemProxyRoute } from "../../../network/system-proxy-http-client";

export type AgentWorkspaceRuntimeParentMessage =
  | { type: "start"; script: string; todos: string[] }
  | {
      type: "proxy_result";
      id: number;
      result: { ok: true; route: SystemProxyRoute } | { ok: false; message: string };
    };

export type AgentWorkspaceRuntimeChildMessage =
  | { type: "proxy_request"; id: number; url: string }
  | { type: "proxy_cancel"; id: number }
  | { type: "complete"; response: unknown };

/** 父进程输入只接受启动请求和已关联的代理解析结果。 */
export function read_agent_workspace_runtime_parent_message(
  value: unknown,
): AgentWorkspaceRuntimeParentMessage {
  if (!is_json_record(value) || typeof value["type"] !== "string") {
    throw new Error("Workspace runtime received an invalid parent message.");
  }
  if (value["type"] === "start") {
    if (
      Object.keys(value).length !== 3 ||
      typeof value["script"] !== "string" ||
      value["script"].trim() === "" ||
      !("todos" in value)
    ) {
      throw new Error("Workspace runtime received an invalid start message.");
    }
    return {
      type: "start",
      script: value["script"],
      todos: normalize_agent_todos(value["todos"]),
    };
  }
  if (
    value["type"] !== "proxy_result" ||
    Object.keys(value).length !== 3 ||
    !Number.isSafeInteger(value["id"]) ||
    !is_json_record(value["result"])
  ) {
    throw new Error("Workspace runtime received an invalid proxy result.");
  }
  const result = value["result"];
  if (
    result["ok"] === false &&
    Object.keys(result).length === 2 &&
    typeof result["message"] === "string"
  ) {
    return {
      type: "proxy_result",
      id: value["id"] as number,
      result: { ok: false, message: result["message"] },
    };
  }
  if (result["ok"] === true && Object.keys(result).length === 2) {
    return {
      type: "proxy_result",
      id: value["id"] as number,
      result: { ok: true, route: read_proxy_route(result["route"]) },
    };
  }
  throw new Error("Workspace runtime received an invalid proxy result.");
}

/** Deno 输出只允许代理请求、代理取消与唯一完成信封。 */
export function read_agent_workspace_runtime_child_message(
  value: unknown,
): AgentWorkspaceRuntimeChildMessage {
  if (!is_json_record(value) || typeof value["type"] !== "string") {
    throw new Error("Workspace runtime returned an invalid child message.");
  }
  if (value["type"] === "proxy_request") {
    if (
      Object.keys(value).length !== 3 ||
      !Number.isSafeInteger(value["id"]) ||
      typeof value["url"] !== "string"
    ) {
      throw new Error("Workspace runtime returned an invalid proxy request.");
    }
    return { type: "proxy_request", id: value["id"] as number, url: value["url"] };
  }
  if (value["type"] === "proxy_cancel") {
    if (Object.keys(value).length !== 2 || !Number.isSafeInteger(value["id"])) {
      throw new Error("Workspace runtime returned an invalid proxy cancellation.");
    }
    return { type: "proxy_cancel", id: value["id"] as number };
  }
  if (value["type"] === "complete" && Object.keys(value).length === 2 && "response" in value) {
    return { type: "complete", response: value["response"] };
  }
  throw new Error("Workspace runtime returned an invalid child message.");
}

/** 代理结果只接受 Backend 已声明的三种稳定路线。 */
function read_proxy_route(value: unknown): SystemProxyRoute {
  if (!is_json_record(value) || typeof value["kind"] !== "string") {
    throw new Error("Workspace runtime received an invalid proxy route.");
  }
  if (value["kind"] === "direct" && Object.keys(value).length === 1) return { kind: "direct" };
  if (
    (value["kind"] === "proxy" || value["kind"] === "socks5") &&
    Object.keys(value).length === 2 &&
    typeof value["uri"] === "string"
  ) {
    return { kind: value["kind"], uri: value["uri"] };
  }
  throw new Error("Workspace runtime received an invalid proxy route.");
}
