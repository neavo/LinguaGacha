import { expect, it } from "vitest";
import type {
  ProofreadingFile,
  ProofreadingFileSelection,
} from "@shared/proofreading/proofreading-types";
import {
  build_proofreading_file_tree,
  change_proofreading_file_selection,
} from "./proofreading-file-tree";

const files: ProofreadingFile[] = [
  { file_path: "readme.txt", internal_file_path: null, kind: "item", count: 2 },
  { file_path: "game\\intro.rpy", internal_file_path: null, kind: "item", count: 3 },
  { file_path: "game/tl/zh/common.rpy", internal_file_path: null, kind: "item", count: 0 },
  { file_path: "other/common.rpy", internal_file_path: null, kind: "item", count: 5 },
  { file_path: "game/tl/ja/manual.pdf", internal_file_path: null, kind: "page", count: 4 },
];

function select(paths: string[]): ProofreadingFileSelection {
  return {
    mode: "selected",
    values: paths.map((file_path) => ({ file_path, internal_file_path: null })),
  };
}

it("多级路径按首次出现顺序组织，混合分隔符和同名文件保留身份", () => {
  const tree = build_proofreading_file_tree(files, select([]), "未分组");
  expect(tree.children).toMatchObject([
    { name: "readme.txt" },
    {
      name: "game",
      children: [{ name: "intro.rpy" }, { name: "tl", children: [{ name: "zh" }, { name: "ja" }] }],
    },
    { name: "other" },
  ]);
  expect(
    new Set(
      change_proofreading_file_selection(files, select([]), tree, true).map(
        (file) => file.file_path,
      ),
    ),
  ).toEqual(new Set(files.map((file) => file.file_path)));
});

it("目录统计完整后代，批量选择保留其他目录和原集合", () => {
  const selected = select(["game\\intro.rpy", "other/common.rpy"]);
  const tree = build_proofreading_file_tree(files, selected, "未分组");
  const game = tree.children[1]!;
  expect(tree).toMatchObject({ file_count: 5, selected_count: 2 });
  expect(game).toMatchObject({ file_count: 3, selected_count: 1 });
  const values = change_proofreading_file_selection(files, selected, game, true);
  expect(new Set(values.map((file) => file.file_path))).toEqual(
    new Set([
      "game\\intro.rpy",
      "other/common.rpy",
      "game/tl/zh/common.rpy",
      "game/tl/ja/manual.pdf",
    ]),
  );
  expect(selected).toEqual(select(["game\\intro.rpy", "other/common.rpy"]));
  expect(
    change_proofreading_file_selection(files, { mode: "selected", values }, game, false),
  ).toEqual([{ file_path: "other/common.rpy", internal_file_path: null }]);
});

it("显式选择不包含新增文件，清空选择和空候选保持为空", () => {
  const tree = build_proofreading_file_tree(files, select([]), "未分组");
  const selection: ProofreadingFileSelection = {
    mode: "selected",
    values: change_proofreading_file_selection(files, select([]), tree.children[1]!, true),
  };
  const updated_files: ProofreadingFile[] = [
    ...files,
    { file_path: "game/new.txt", internal_file_path: null, kind: "item", count: 1 },
  ];
  expect(
    build_proofreading_file_tree(updated_files, selection, "未分组").children[1],
  ).toMatchObject({ file_count: 4, selected_count: 3 });
  expect(
    build_proofreading_file_tree(updated_files, { mode: "default" }, "未分组").selected_count,
  ).toBe(6);
  expect(change_proofreading_file_selection(files, selection, tree, false)).toEqual([]);
  expect(build_proofreading_file_tree([], select([]), "未分组")).toMatchObject({
    file_count: 0,
    selected_count: 0,
    children: [],
  });
});

it("容器按完整身份隔离同名内部目录，未分组与内部文件均参与父级选择", () => {
  const candidates: ProofreadingFile[] = [
    { file_path: "a.trans", internal_file_path: "data/Actors.json", kind: "item", count: 2 },
    { file_path: "a.trans", internal_file_path: "data/Map.json", kind: "item", count: 1 },
    { file_path: "a.trans", internal_file_path: null, kind: "item", count: 1 },
    { file_path: "b.trans", internal_file_path: "data/Actors.json", kind: "item", count: 4 },
    { file_path: "a.trans/data/Actors.json", internal_file_path: null, kind: "item", count: 1 },
  ];
  const selection: ProofreadingFileSelection = { mode: "selected", values: [candidates[0]!] };
  const tree = build_proofreading_file_tree(candidates, selection, "未分组");
  const first = tree.children[0]!;
  const second = tree.children[1]!;
  expect(first).toMatchObject({
    kind: "container",
    file_count: 3,
    selected_count: 1,
    children: [{ name: "data" }, { name: "未分组", count: 1 }],
  });
  expect(second).toMatchObject({ kind: "container", file_count: 1, selected_count: 0 });
  if (first.kind === "file" || second.kind === "file") throw new Error("缺少容器节点");
  expect(first.children[0]!.key).not.toBe(second.children[0]!.key);
  const values = change_proofreading_file_selection(candidates, selection, first, true);
  expect(values).toEqual(
    candidates
      .slice(0, 3)
      .map(({ file_path, internal_file_path }) => ({ file_path, internal_file_path })),
  );
  expect(
    build_proofreading_file_tree(candidates, { mode: "selected", values }, "未分组").selected_count,
  ).toBe(3);
});
