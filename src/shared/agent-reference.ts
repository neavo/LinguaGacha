/** 引用只存在于消息正文。文件引用保留路径，技能引用保留目录名称。 */
export type AgentReference =
  | { kind: "file" | "workspace" | "upload"; path: string }
  | { kind: "skill"; name: string };

export type AgentReferenceRange = Readonly<{
  from: number;
  to: number;
  marker: string;
  reference: AgentReference;
}>;

/** 用 JSON 字符串保留名称与路径，供插入和复制共用。 */
export function format_agent_reference(reference: AgentReference): string {
  return format_agent_reference_parts(reference).join("");
}

/** 引用块可单独裁切参数，保留类型与定界符。 */
export function format_agent_reference_parts(
  reference: AgentReference,
): readonly [prefix: string, value: string, suffix: string] {
  const name =
    reference.kind === "skill" || reference.kind === "file"
      ? reference.kind
      : `${reference.kind}_file`;
  const value = reference.kind === "skill" ? reference.name : reference.path;
  return [`@${name}("`, JSON.stringify(value).slice(1, -1), '")'];
}

/** JSON 字符串承担路径转义；未完成或非法引用仍是普通文本。 */
export function find_agent_reference_ranges(text: string): AgentReferenceRange[] {
  const ranges: AgentReferenceRange[] = [];
  const pattern = /@(file|workspace_file|upload_file|skill)\(("(?:[^"\\\r\n]|\\[^\r\n])*")\)/gu;
  for (const match of text.matchAll(pattern)) {
    const from = match.index;
    let slashes = 0;
    for (let i = from - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
    if (slashes % 2 !== 0) continue;
    let value: string;
    try {
      value = JSON.parse(match[2]!) as string;
    } catch {
      continue; // 编辑中的无效转义仍显示为普通正文。
    }
    if (value.length === 0) continue;
    const reference: AgentReference =
      match[1] === "skill"
        ? { kind: "skill", name: value }
        : {
            kind:
              match[1] === "file" ? "file" : match[1] === "workspace_file" ? "workspace" : "upload",
            path: value,
          };
    ranges.push({ from, to: from + match[0].length, marker: match[0], reference });
  }
  return ranges;
}

/** 同条消息的重名文件逐级展示父目录，重复引用同一路径时共用标签。 */
export function resolve_agent_reference_labels(ranges: readonly AgentReferenceRange[]): string[] {
  const labels = ranges.map(({ marker }) => marker);
  const files = ranges.flatMap(({ reference }, index) => {
    if (reference.kind === "skill") return [];
    const { path } = reference;
    const segments = path.split(/[\\/]+/u).filter(Boolean);
    return [
      {
        index,
        segments: segments.length > 0 ? segments : [path],
        identity: path.replace(/[\\/]+$/u, ""), // 目录末尾的分隔符不影响去重。
        depth: 1,
      },
    ];
  });

  // 每轮重新分组，展开后的标签也可能与其他块重名。
  let expanded: boolean;
  do {
    expanded = false;
    for (const file of files) {
      labels[file.index] = file.segments.slice(-file.depth).join("/");
    }
    const groups = Map.groupBy(files, ({ index }) => labels[index]);
    for (const group of groups.values()) {
      if (group.every(({ identity }) => identity === group[0]!.identity)) continue;
      for (const file of group) {
        if (file.depth >= file.segments.length) continue;
        file.depth++;
        expanded = true;
      }
    }
  } while (expanded);
  return labels;
}

/** 文件规模只属于候选展示，不进入正文引用。 */
export type AgentFileCandidate =
  | { kind: "workspace"; path: string; count: number }
  | { kind: "upload"; path: string; size: number };

export type AgentFilesResponse = { chatId: string; files: AgentFileCandidate[] };
