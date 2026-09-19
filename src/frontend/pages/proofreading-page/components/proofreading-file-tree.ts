import type { ProofreadingFile } from "@shared/proofreading/proofreading-types";

/** 目录统计文件个数，文件节点的 `count` 保留原始内容数量。 */
type NodeInfo = {
  name: string;
  path: string; // 目录使用统一分隔符，文件保留原始路径作为选择身份。
  file_count: number;
  selected_count: number;
};

type DirectoryNode = NodeInfo & {
  kind: "directory";
  children: ProofreadingFileNode[];
};

export type ProofreadingFileNode = (NodeInfo & { kind: "file"; count: number }) | DirectoryNode;

/** 按首次出现顺序建树，并沿祖先累计选择数量，供渲染和整目录勾选共用。 */
export function build_proofreading_file_tree(
  files: readonly ProofreadingFile[],
  selected: ReadonlySet<string>,
): DirectoryNode {
  const root: DirectoryNode = {
    kind: "directory",
    name: "",
    path: "",
    children: [],
    file_count: 0,
    selected_count: 0,
  };
  const directories = new Map<string, DirectoryNode>([["", root]]);
  for (const file of files) {
    const parts = file.file_path.split(/[\\/]/u);
    const selected_count = Number(selected.has(file.file_path));
    let parent = root;
    parent.file_count++;
    parent.selected_count += selected_count;
    for (let index = 0; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join("/");
      let directory = directories.get(path);
      if (!directory) {
        directory = {
          kind: "directory",
          name: parts[index]!,
          path,
          children: [],
          file_count: 0,
          selected_count: 0,
        };
        directories.set(path, directory);
        parent.children.push(directory);
      }
      directory.file_count++;
      directory.selected_count += selected_count;
      parent = directory;
    }
    parent.children.push({
      kind: "file",
      name: parts.at(-1)!,
      path: file.file_path,
      count: file.count,
      file_count: 1,
      selected_count,
    });
  }
  return root;
}

/** 返回更新后的文件集合，默认与显式选择意图由页面决定。 */
export function change_proofreading_file_selection(
  selected: ReadonlySet<string>,
  node: ProofreadingFileNode,
  checked: boolean,
): string[] {
  const next = new Set(selected);
  // 遍历完整子树，使折叠目录内的文件参与同一次选择更新。
  function visit(current: ProofreadingFileNode): void {
    if (current.kind === "directory") current.children.forEach(visit);
    else if (checked) next.add(current.path);
    else next.delete(current.path);
  }
  visit(node);
  return [...next];
}
