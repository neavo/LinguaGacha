import path from "node:path";
import { is_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { default_native_fs } from "../../native/native-fs";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./workspace/runtime/policy";

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
