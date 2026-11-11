import { it } from "vitest";
import { check_typescript } from "../../../test/typescript-fixture";
import { SEARCH_DESCRIPTION } from "./description";

it("搜索声明可独立编译，拒绝未知来源和多余参数", () => {
  const declaration = /```ts\n([\s\S]*?)\n```/u.exec(SEARCH_DESCRIPTION)![1]!;
  check_typescript([
    `${declaration.replace("declare module '@lg/search'", "declare namespace Search")}
      const response = await Search.search({query: '查询'});
      const status: number = response.status;
      const body: string = response.body;
      Search.search({query: '查询', provider: 'deepseek'});
      // @ts-expect-error 来源受公开契约约束。
      Search.search({query: '查询', provider: 'unknown'});
      // @ts-expect-error URL 由宿主拥有。
      Search.search({query: '查询', url: 'https://example.com'});
      `,
  ]);
});
