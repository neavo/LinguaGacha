import { create_schema_renderer } from "../workspace/schema-description";
import { SEARCH_INPUT_SCHEMA, SEARCH_TIMEOUT_MS } from "./schema";

const renderer = create_schema_renderer(new Map());

/** 工作区直接提供搜索契约，来源名称与参数从实际校验 Schema 生成。 */
export const SEARCH_DESCRIPTION = [
  "### 网页搜索：`@lg/search`",
  "",
  '- 用 `import { search } from "@lg/search"` 导入，例如 `console.log(JSON.stringify(await search({ query: "查询词" })))`。',
  "- 每次调用只请求一个来源。",
  "- 省略 `provider` 时使用默认配置。",
  "- 请求使用应用代理。",
  "- `query` 不能为空。",
  `- 连接与正文读取共用 ${SEARCH_TIMEOUT_MS / 1000} 秒时限。`,
  "- 网络错误与超时抛错，停止脚本会取消请求。",
  "- `body` 保留原始响应，HTTP 错误也正常返回，需要结合 `status` 和正文判断结果。",
  "- 读取网页用普通 `fetch` 代码，不使用搜索。",
  "",
  "```ts",
  "declare module '@lg/search' {",
  `  export function search(input: ${renderer.render(SEARCH_INPUT_SCHEMA)}): Promise<Readonly<{`,
  `    provider: ${renderer.render(SEARCH_INPUT_SCHEMA.properties.provider)};`,
  "    status: number;",
  "    contentType: string;",
  "    body: string;",
  "  }>>;",
  "}",
  "```",
].join("\n");
