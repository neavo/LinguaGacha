import {
  htmlToMarkdown as convert_html,
  streamHtmlToMarkdown as convert_stream,
} from "@mdream/js/core";
import { filterPlugin, isolateMainPlugin } from "@mdream/js/plugins";

export type AgentWorkspaceHtmlToMarkdownOptions = Readonly<{
  baseUrl?: string;
  mainContent?: boolean;
  include?: readonly string[];
  exclude?: readonly string[];
}>;

export type AgentWorkspaceHtmlTools = Readonly<{
  htmlToMarkdown: (html: string, options?: AgentWorkspaceHtmlToMarkdownOptions) => string;
  streamHtmlToMarkdown: (
    source: ReadableStream<Uint8Array | string> | null,
    options?: AgentWorkspaceHtmlToMarkdownOptions,
  ) => AsyncIterable<string>;
}>;

/** HTML 转换工具只公开稳定产品参数，底层转换库不进入 Agent 契约。 */
export const AGENT_WORKSPACE_HTML_TOOLS: AgentWorkspaceHtmlTools = Object.freeze({
  htmlToMarkdown: (html, options) => convert_html(html, build_options(options)),
  streamHtmlToMarkdown: (source, options) => convert_stream(source, build_options(options)),
});

/** 与运行时实现同处维护的模型可见 TypeScript 声明。 */
export function format_agent_workspace_html_tools_typescript_api(): string[] {
  return [
    "type HtmlToMarkdownOptions = Readonly<{",
    "  /** 用于解析相对链接和图片地址，网页响应通常传入 response.url。 */",
    "  baseUrl?: string;",
    "  /** 提取页面主内容；不能与 include 同时使用。 */",
    "  mainContent?: boolean;",
    "  /** 只转换匹配任一 CSS selector 的内容。 */",
    "  include?: readonly string[];",
    "  /** 跳过匹配任一 CSS selector 的内容。 */",
    "  exclude?: readonly string[];",
    "}>;",
    "",
    "interface WorkspaceHtmlTools {",
    "  /** 将 HTML 字符串转换为 Markdown。 */",
    "  htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): string;",
    "  /** 流式转换 HTML；返回值应在脚本内消费或写入文件。 */",
    "  streamHtmlToMarkdown(",
    "    source: ReadableStream<Uint8Array | string> | null,",
    "    options?: HtmlToMarkdownOptions,",
    "  ): AsyncIterable<string>;",
    "}",
  ];
}

/** mainContent 与显式 include 都定义正文入口，拒绝并存以保持选择语义唯一。 */
function build_options(options: AgentWorkspaceHtmlToMarkdownOptions | undefined) {
  if (options?.mainContent === true && options.include !== undefined) {
    throw new TypeError("mainContent and include cannot be used together.");
  }
  const plugins = [];
  if (options?.mainContent === true) plugins.push(isolateMainPlugin());
  if (options?.include !== undefined || options?.exclude !== undefined) {
    plugins.push(
      filterPlugin({
        ...(options.include === undefined ? {} : { include: [...options.include] }),
        ...(options.exclude === undefined ? {} : { exclude: [...options.exclude] }),
      }),
    );
  }
  return {
    ...(options?.baseUrl === undefined ? {} : { origin: options.baseUrl }),
    ...(plugins.length === 0 ? {} : { plugins }),
  };
}
