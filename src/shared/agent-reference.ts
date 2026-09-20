/** 引用只存在于消息正文；路径按工作区规则解析，技能按目录名称读取。 */
export type AgentReference =
  | { kind: "project" | "upload"; path: string }
  | { kind: "skill"; name: string };

export type AgentReferenceRange = Readonly<{
  from: number;
  to: number;
  marker: string;
  reference: AgentReference;
}>;

/** 用 JSON 字符串保留名称与路径，供插入和复制共用。 */
export function format_agent_reference(reference: AgentReference): string {
  const name = reference.kind === "skill" ? "skill" : `${reference.kind}_file`;
  const value = reference.kind === "skill" ? reference.name : reference.path;
  return `@${name}(${JSON.stringify(value)})`;
}

/** JSON 字符串承担路径转义；未完成或非法引用仍是普通文本。 */
export function find_agent_reference_ranges(text: string): AgentReferenceRange[] {
  const ranges: AgentReferenceRange[] = [];
  const pattern = /@(project_file|upload_file|skill)\(("(?:[^"\\\r\n]|\\[^\r\n])*")\)/gu;
  for (const match of text.matchAll(pattern)) {
    const from = match.index;
    let slashes = 0;
    for (let i = from - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
    if (slashes % 2 !== 0) continue;
    let value: string;
    try {
      value = JSON.parse(match[2]!) as string;
    } catch {
      continue;
    } // 输入时不完整的 JSON 转义无须中断编辑。
    if (value.length === 0) continue;
    const reference: AgentReference =
      match[1] === "skill"
        ? { kind: "skill", name: value }
        : { kind: match[1] === "project_file" ? "project" : "upload", path: value };
    ranges.push({ from, to: from + match[0].length, marker: match[0], reference });
  }
  return ranges;
}

/** 文件规模只属于候选展示，不进入正文引用。 */
export type AgentFileCandidate =
  | { kind: "project"; path: string; count: number; unit: "items" | "pages" }
  | { kind: "upload"; path: string; size: number };

export type AgentFilesResponse = { sessionId: string; files: AgentFileCandidate[] };
