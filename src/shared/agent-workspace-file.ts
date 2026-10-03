export type AgentTextFormat = "markdown" | "json" | "jsonl";

/** 文件入口返回的当前会话资源描述。 */
export type AgentFile = Readonly<{
  path: string; // 规范化并逐段编码的工作区相对路径，作为标签身份。
  name: string; // 上传文件保留原名称，其它文件使用工作区名称。
  preview: AgentTextFormat | "image" | null;
  kind: "file" | "directory";
}>;

export type AgentDocument = Readonly<{
  sessionId: string;
  path: string; // 规范化、逐段编码的工作区相对链接，也是标签身份。
  content: string;
}>;

/** 按解码后的扩展名选择预览入口，查询和锚点不参与格式判断。 */
export function resolve_agent_text_format(href: string): AgentTextFormat | null {
  try {
    const extension = /\.([^./]+)$/u
      .exec(decodeURIComponent(href.split(/[?#]/u, 1)[0]!))?.[1]
      ?.toLowerCase();
    if (extension === "md" || extension === "markdown") return "markdown";
    if (extension === "json" || extension === "jsonl") return extension;
    return null;
  } catch {
    return null; // 损坏的编码仍交给既有链接入口报告校验错误。
  }
}

/** 文档路径和 href 都是 URL 路径；只解码一次，归一后再逐段编码。 */
export function resolve_agent_workspace_href(href: string, document_path = ""): string {
  const suffix_index = href.search(/[?#]/u);
  const raw_path = suffix_index < 0 ? href : href.slice(0, suffix_index);
  const suffix = suffix_index < 0 ? "" : href.slice(suffix_index);
  if (raw_path === "") return `${document_path}${suffix}`;
  const decoded = decodeURIComponent(raw_path);
  if (/^[/]|[\\:\0]/u.test(decoded)) throw new Error("Invalid workspace path");
  const parts =
    document_path === "" ? [] : decodeURIComponent(document_path).split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (parts.length === 0) throw new Error("Invalid workspace path");
      parts.pop();
    } else parts.push(part);
  }
  return `${parts.map(encodeURIComponent).join("/")}${decoded.endsWith("/") ? "/" : ""}${suffix}`;
}
