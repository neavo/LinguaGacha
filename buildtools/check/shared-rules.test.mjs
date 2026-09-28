import path from "node:path";
import { expect, it } from "vitest";
import { create_check_context } from "./core.mjs";
import { create_source_reader } from "./source-reader.mjs";
import { create_shared_boundary_rules } from "./shared-rules.mjs";

it("基础层对相对路径、别名、类型转发和动态导入使用同一边界", () => {
  const errors = check({
    "src/domain/example.ts":
      'import type { Store } from "@backend/store";\nexport * from "../native/fs";',
    "src/shared/example.ts":
      'export type { View } from "@frontend/view";\nconst load = () => import("node:fs/promises");',
    "src/shared/pdf-schema.ts": 'import { Type } from "@earendil-works/pi-ai";',
  });
  expect(errors.map(({ relative_path, line }) => `${relative_path}:${line}`)).toEqual([
    "src/domain/example.ts:1",
    "src/domain/example.ts:2",
    "src/shared/example.ts:1",
    "src/shared/example.ts:2",
    "src/shared/pdf-schema.ts:1",
  ]);
});

it("共享纯计算及类型引用合法，数据库加载链排除类型依赖但检查运行时转发", () => {
  expect(
    check({
      "src/shared/example.ts":
        'import type { Value } from "../domain/value"; export const bytes = new Uint8Array(1);',
      "src/shared/pdf-schema.ts": 'import { Type } from "typebox";',
      "src/backend/migration/database-migrations.ts":
        'import type { Migration } from "./types";\nexport { run } from "./database-helper";',
      "src/backend/migration/types.ts": 'import type { Project } from "../project/project";',
      "src/backend/migration/database-helper.ts":
        'const load = () => import("@backend/file/parser");',
    }),
  ).toEqual([
    expect.objectContaining({ relative_path: "src/backend/migration/database-helper.ts", line: 1 }),
  ]);
});

/** 使用测试自有源码及别名，证明规则不依赖当前仓库布局。 */
function check(sources) {
  const project_root = path.resolve("shared-boundary-fixture");
  const files = new Map(
    Object.entries(sources).map(([name, source]) => [path.join(project_root, name), source]),
  );
  const context = create_check_context({
    project_root,
    files: [...files.keys()],
    paths: { "@backend/*": ["src/backend/*"], "@frontend/*": ["src/frontend/*"] },
    source_reader: create_source_reader((file) => files.get(file)),
  });
  return create_shared_boundary_rules().flatMap((rule) => rule.check(context));
}
