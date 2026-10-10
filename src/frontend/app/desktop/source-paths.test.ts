import { expect, it } from "vitest";

import { normalize_source_paths } from "@frontend/app/desktop/source-paths";

it("过滤空值并按准确路径去重，保留路径中的空格", () => {
  expect(normalize_source_paths([" b.txt ", "", "a.txt", "b.txt", "  "])).toEqual([
    " b.txt ",
    "a.txt",
    "b.txt",
  ]);
});
