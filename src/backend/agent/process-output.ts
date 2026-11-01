import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { is_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { default_native_fs } from "../../native/native-fs";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./workspace/runtime/policy";

const AGENT_PROCESS_OUTPUT_TAIL_BYTES = 8 * 1024; // 界面只展示末尾窗口，读取开销与日志总量无关
const AGENT_PROCESS_OUTPUT_WATCH_INTERVAL_MS = 500; // 每秒两次足够跟上进度，读取开销可忽略

export type AgentProcessOutputContent = string | JsonRecord | JsonValue[];
export type AgentProcessOutput = Readonly<
  { path: string; bytes: number } & ({ content: AgentProcessOutputContent } | { message: string })
>;

/** 完整原文保留在文件，各路输出只在额度内读入内存。 */
export function read_agent_process_output(workspace: string, relative: string): AgentProcessOutput {
  const file = path.join(workspace, relative);
  const bytes = default_native_fs.stat(file).size;
  if (bytes > AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes)
    return { path: relative, bytes, message: "输出超长，请按需读取记录文件。" };
  const text = default_native_fs.read_text_file(file);
  let content: AgentProcessOutputContent = text;
  try {
    const value = JSON.parse(text) as JsonValue;
    if (is_json_record(value) || Array.isArray(value)) content = value;
  } catch {
    /* 普通文本和混合日志保留原文。 */
  }
  return { path: relative, bytes, content };
}

/** 运行中两路日志的末尾窗口，`line` 是最近增长那一路的最后一行。 */
export type AgentProcessOutputTail = Readonly<{ stdout: string; stderr: string; line: string }>;

/** 定时读取日志末尾供界面观察，中止时正常返回。不用 `fs.watch`，它在 Windows 上不可靠。 */
export async function watch_agent_process_output(
  workspace: string,
  paths: Readonly<{ stdoutPath: string; stderrPath: string }>,
  on_output: (output: AgentProcessOutputTail) => void,
  signal: AbortSignal,
): Promise<void> {
  const files = [paths.stdoutPath, paths.stderrPath].map((relative) =>
    path.join(workspace, relative),
  );
  let sizes = [0, 0];
  while (true) {
    try {
      await setTimeout(AGENT_PROCESS_OUTPUT_WATCH_INTERVAL_MS, undefined, { signal });
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    const next = await Promise.all(
      files.map((file) => ignore_missing(() => default_native_fs.stat(file).size, 0)),
    );
    if (next[0] === sizes[0] && next[1] === sizes[1]) continue;
    const [stdout = "", stderr = ""] = await Promise.all(
      files.map((file, index) => read_tail(file, next[index]!)),
    );
    const grown = next[0] !== sizes[0] ? stdout : stderr; // 两路都增长时取 stdout
    sizes = next;
    on_output({
      stdout,
      stderr,
      line:
        grown
          .split("\n")
          .findLast((line) => line.trim() !== "")
          ?.trim() ?? "",
    });
  }
}

/** 截断处丢弃到首个换行或回车，保留窗口内完整的进度片段，再折叠原地刷新。 */
async function read_tail(file: string, size: number): Promise<string> {
  const offset = Math.max(0, size - AGENT_PROCESS_OUTPUT_TAIL_BYTES);
  const buffer = await ignore_missing(
    () => default_native_fs.read_range(file, offset, size - offset),
    Buffer.alloc(0),
  );
  let text = buffer.toString("utf8");
  if (offset > 0) {
    const boundary = text.search(/[\r\n]/u);
    text = boundary < 0 ? "" : text.slice(boundary + 1);
  }
  return text
    .split("\n")
    .map((line) => {
      const content = line.endsWith("\r") ? line.slice(0, -1) : line; // CRLF 的行尾不是原地刷新
      return content.slice(content.lastIndexOf("\r") + 1);
    })
    .join("\n");
}

/** 日志尚未创建或被脚本删除时，观察按空内容处理；最终回执仍由执行链路读取。 */
async function ignore_missing<T>(read: () => T | Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return empty;
    throw error;
  }
}
