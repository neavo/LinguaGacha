import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { describe_agent_workspace_schema_error } from "./validation";

describe("工作区 Schema 错误定位", () => {
  it("按输入判别字段选择联合分支并定位嵌套缺失字段", () => {
    const schema = Type.Union([
      Type.Object({ kind: Type.Literal("first"), other: Type.String() }),
      Type.Object({
        kind: Type.Literal("second"),
        entries: Type.Array(Type.Object({ id: Type.String() })),
      }),
    ]);
    expect(
      describe_agent_workspace_schema_error(schema, { kind: "second", entries: [{}] }),
    ).toMatchObject({ path: "/entries/0/id", message: expect.any(String) });
  });

  it("缺失属性名按 JSON Pointer 转义", () => {
    const schema = Type.Object({ "a~/b": Type.String() });
    expect(describe_agent_workspace_schema_error(schema, {}).path).toBe("/a~0~1b");
  });
});
