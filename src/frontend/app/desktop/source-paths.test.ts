import { expect, it } from "vitest";

import { normalize_source_paths } from "@frontend/app/desktop/source-paths";

it("清理空路径并按首次出现顺序去重", () => {
  expect(normalize_source_paths([" b.txt ", "", "a.txt", "b.txt", "  "])).toEqual([
    "b.txt",
    "a.txt",
  ]);
});
