export type AgentTextFormat = "markdown" | "json" | "jsonl";

/** 文件入口返回的当前会话资源描述。 */
export type AgentFile = Readonly<{
  path: string; // 规范文件身份：逐段编码的工作区相对链接，或工作区外文件的 `file:` URL，也是标签身份。
  name: string; // 上传文件保留原名称，其它文件使用文件名。
  preview: AgentTextFormat | "image" | null;
  kind: "file" | "directory";
}>;

export type AgentDocument = Readonly<{
  chatId: string;
  path: string; // 规范文件身份，与 `AgentFile.path` 一致。
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

/** `file:` URL 也可能指向工作区内，由后端统一归类。 */
export function is_agent_file_url(href: string): boolean {
  return /^file:/iu.test(href);
}

/** 相对路径与 `file:` URL 走文件入口，其他协议、主机地址与页内锚点单独处理。 */
export function is_agent_file_href(href: string): boolean {
  return is_agent_file_url(href) || !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(href);
}

/** 外部文档按 URL 解析，工作区相对路径只解码一次并限制在根目录内。 */
export function resolve_agent_file_href(href: string, document_path = ""): string {
  if (is_agent_file_url(href) || is_agent_file_url(document_path)) {
    return new URL(href, is_agent_file_url(document_path) ? document_path : undefined).href;
  }
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
