import { workspace_requests } from "../workspace/runtime/request-channel";
import type { SearchInput, SearchResponse } from "./schema";

export type { SearchInput, SearchProvider, SearchResponse } from "./schema";

/** 每次只请求一个来源，响应正文由调用者判断。 */
export async function search(input: SearchInput): Promise<SearchResponse> {
  return (await workspace_requests().call({ ...input, kind: "search" })) as SearchResponse;
}
