import { describe, expect, it } from "vitest";

import { move_ordered_ids, type ReorderTarget } from "./reorder";

describe("app table reorder", () => {
  it.each<{ target: ReorderTarget; expected: string[] }>([
    { target: "top", expected: ["a", "c", "b", "d", "e"] },
    { target: "bottom", expected: ["b", "d", "e", "a", "c"] },
    { target: { id: "b" }, expected: ["a", "c", "b", "d", "e"] },
    { target: { id: "d" }, expected: ["b", "d", "a", "c", "e"] },
    { target: { id: "a" }, expected: ["a", "b", "c", "d", "e"] },
  ])("向 $target 移动时保留移动组和剩余行的原顺序", ({ target, expected }) => {
    const ordered_ids = ["a", "b", "c", "d", "e"];
    expect(
      move_ordered_ids({
        ordered_ids,
        moving_ids: ["c", "a"],
        target,
      }),
    ).toEqual(expected);
    expect(ordered_ids).toEqual(["a", "b", "c", "d", "e"]);
  });

  it.each<{ moving_ids: string[]; target: ReorderTarget; expected: string[] }>([
    { moving_ids: ["d", "b"], target: "bottom", expected: ["a", "c", "b", "d"] },
    { moving_ids: ["a", "b"], target: "top", expected: ["a", "b", "c", "d"] },
    { moving_ids: ["c", "d"], target: "bottom", expected: ["a", "b", "c", "d"] },
    { moving_ids: ["d", "c", "b", "a"], target: "top", expected: ["a", "b", "c", "d"] },
    { moving_ids: [], target: "bottom", expected: ["a", "b", "c", "d"] },
  ])("首尾行、全选与空选区按实际顺序处理：$moving_ids → $target", (args) => {
    expect(
      move_ordered_ids({
        ordered_ids: ["a", "b", "c", "d"],
        moving_ids: args.moving_ids,
        target: args.target,
      }),
    ).toEqual(args.expected);
  });
});
