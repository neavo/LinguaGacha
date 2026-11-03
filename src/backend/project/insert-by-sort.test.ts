import { expect, it } from "vitest";
import { insert_by_sort } from "./insert-by-sort";

it.each([-1, 99])("排序 %s 追加到末尾，同位置按优先级与行序排列", (sort) => {
  expect(
    insert_by_sort(
      ["kept"],
      [
        { value: "new", sort, rank: 1, line: 1 },
        { value: "later", sort, rank: 0, line: 2 },
        { value: "earlier", sort, rank: 0, line: 1 },
      ],
    ),
  ).toEqual(["kept", "earlier", "later", "new"]);
});
