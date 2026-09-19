import { expect, it } from "vitest";
import type { ProofreadingFile } from "@shared/proofreading/proofreading-types";
import {
  build_proofreading_file_tree,
  change_proofreading_file_selection,
} from "./proofreading-file-tree";

const files: ProofreadingFile[] = [
  { file_path: "readme.txt", kind: "item", count: 2 },
  { file_path: "game\\intro.rpy", kind: "item", count: 3 },
  { file_path: "game/tl/zh/common.rpy", kind: "item", count: 0 },
  { file_path: "other/common.rpy", kind: "item", count: 5 },
  { file_path: "game/tl/ja/manual.pdf", kind: "page", count: 4 },
];

it("多级路径按首次出现顺序组织，混合分隔符和同名文件保留身份", () => {
  const tree = build_proofreading_file_tree(files, new Set());
  expect(tree.children).toMatchObject([
    { name: "readme.txt" },
    {
      name: "game",
      children: [{ name: "intro.rpy" }, { name: "tl", children: [{ name: "zh" }, { name: "ja" }] }],
    },
    { name: "other" },
  ]);
  expect(new Set(change_proofreading_file_selection(new Set(), tree, true))).toEqual(
    new Set(files.map((file) => file.file_path)),
  );
});

it("目录统计完整后代，批量选择保留其他目录和原集合", () => {
  const selected = new Set(["game\\intro.rpy", "other/common.rpy"]);
  const tree = build_proofreading_file_tree(files, selected);
  const game = tree.children[1]!;
  expect(tree).toMatchObject({ file_count: 5, selected_count: 2 });
  expect(game).toMatchObject({ file_count: 3, selected_count: 1 });
  const choice = change_proofreading_file_selection(selected, game, true);
  expect(new Set(choice)).toEqual(
    new Set([
      "game\\intro.rpy",
      "other/common.rpy",
      "game/tl/zh/common.rpy",
      "game/tl/ja/manual.pdf",
    ]),
  );
  expect(selected).toEqual(new Set(["game\\intro.rpy", "other/common.rpy"]));
  expect(change_proofreading_file_selection(new Set(choice), game, false)).toEqual([
    "other/common.rpy",
  ]);
});

it("显式选择不包含新增文件，清空选择和空候选保持为空", () => {
  const tree = build_proofreading_file_tree(files, new Set());
  const choice = new Set(change_proofreading_file_selection(new Set(), tree.children[1]!, true));
  const updated = build_proofreading_file_tree(
    [...files, { file_path: "game/new.txt", kind: "item", count: 1 }],
    choice,
  );
  expect(updated.children[1]).toMatchObject({ file_count: 4, selected_count: 3 });
  expect(change_proofreading_file_selection(choice, tree, false)).toEqual([]);
  expect(build_proofreading_file_tree([], new Set())).toMatchObject({
    file_count: 0,
    selected_count: 0,
    children: [],
  });
});
