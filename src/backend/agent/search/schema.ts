import { Type, type Static } from "@earendil-works/pi-ai";

export const SEARCH_TIMEOUT_MS = 15_000; // 执行与模型说明共用时限。

const SEARCH_PROVIDER_SCHEMA = Type.Union([
  Type.Literal("deepseek"),
  Type.Literal("exa"),
  Type.Literal("tavily"),
  Type.Literal("firecrawl"),
  Type.Literal("anysearch"),
  Type.Literal("keenable"),
]);
export type SearchProvider = Static<typeof SEARCH_PROVIDER_SCHEMA>;

/** 公开参数同时用于生成模型声明和宿主校验。 */
export const SEARCH_INPUT_SCHEMA = Type.Object(
  {
    query: Type.String({ minLength: 1, pattern: "\\S" }),
    provider: Type.Optional(SEARCH_PROVIDER_SCHEMA),
  },
  { additionalProperties: false },
);
export type SearchInput = Readonly<Static<typeof SEARCH_INPUT_SCHEMA>>;
export const WORKSPACE_SEARCH_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("search"),
    ...SEARCH_INPUT_SCHEMA.properties,
  },
  { additionalProperties: false },
);
export type WorkspaceSearchRequest = Static<typeof WORKSPACE_SEARCH_REQUEST_SCHEMA>;
export type SearchResponse = Readonly<{
  provider: SearchProvider;
  status: number;
  contentType: string;
  body: string;
}>;
export type SearchPort = (input: SearchInput, signal: AbortSignal) => Promise<SearchResponse>;
