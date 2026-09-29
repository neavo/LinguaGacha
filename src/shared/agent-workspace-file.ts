export type AgentDocument = Readonly<{
  sessionId: string;
  path: string; // 规范化、逐段编码的工作区相对链接，也是标签身份。
  content: string;
}>;

/** 按解码后的扩展名选择预览入口，查询和锚点不参与格式判断。 */
export function is_agent_markdown_path(href: string): boolean {
  try {
    return /\.(?:md|markdown)$/iu.test(decodeURIComponent(href.split(/[?#]/u, 1)[0]!));
  } catch {
    return false; // 损坏的编码仍交给既有链接入口报告校验错误。
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
