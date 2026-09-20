import {
  build_proofreading_file_key,
  type ProofreadingFile,
  type ProofreadingFileRef,
  type ProofreadingFileSelection,
} from "@shared/proofreading/proofreading-types";

type NodeInfo = {
  name: string;
  key: string; // 展开身份包含节点种类和外层路径，跨容器同名目录互不影响。
  path: string; // 供提示显示的完整位置。
  file_count: number; // 可选叶子数，容器自身不重复计数。
  selected_count: number;
};

type BranchNode = NodeInfo & {
  kind: "directory" | "container";
  children: ProofreadingFileNode[];
};

export type ProofreadingFileNode =
  | (NodeInfo & { kind: "file"; count: number; file: ProofreadingFileRef })
  | BranchNode;

/** 默认选择取当前候选，显式选择保留已选引用，供建树与批量勾选共用。 */
function selected_files(
  files: readonly ProofreadingFile[],
  selection: ProofreadingFileSelection,
): Map<string, ProofreadingFileRef> {
  return new Map(
    (selection.mode === "default" ? files : selection.values).map((file) => [
      build_proofreading_file_key(file),
      { file_path: file.file_path, internal_file_path: file.internal_file_path },
    ]),
  );
}

/** 候选提供工程顺序与内部自然顺序，父级汇总叶子选择。 */
export function build_proofreading_file_tree(
  files: readonly ProofreadingFile[],
  selection: ProofreadingFileSelection,
  ungrouped_label: string,
): BranchNode {
  const root: BranchNode = {
    kind: "directory",
    name: "",
    key: "root",
    path: "",
    children: [],
    file_count: 0,
    selected_count: 0,
  };
  const directories = new Map<string, BranchNode>();
  const selected = selected_files(files, selection);
  const groups = new Map<string, ProofreadingFile[]>();
  for (const file of files) {
    const group = groups.get(file.file_path);
    if (group) group.push(file);
    else groups.set(file.file_path, [file]);
  }

  /** 目录键包含所属容器，展示分隔符统一后仍保留叶子的原始身份。 */
  function parent_directory(parent: BranchNode, parts: string[], outer: string | null): BranchNode {
    for (let index = 0; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join("/");
      const key = JSON.stringify(["directory", outer, path]);
      let directory = directories.get(key);
      if (!directory) {
        directory = {
          kind: "directory",
          name: parts[index]!,
          key,
          path: outer === null ? path : `${outer} | ${path}`,
          children: [],
          file_count: 0,
          selected_count: 0,
        };
        directories.set(key, directory);
        parent.children.push(directory);
      }
      parent = directory;
    }
    return parent;
  }

  /** 将候选放入展示树，选择身份与提示文本各自保留完整路径。 */
  function add_leaf(parent: BranchNode, file: ProofreadingFile, name: string): void {
    const key = build_proofreading_file_key(file);
    parent.children.push({
      kind: "file",
      name,
      key: `file:${key}`,
      path:
        file.internal_file_path === null
          ? file.file_path
          : `${file.file_path} | ${file.internal_file_path}`,
      file: { file_path: file.file_path, internal_file_path: file.internal_file_path },
      count: file.count,
      file_count: 1,
      selected_count: Number(selected.has(key)),
    });
  }

  for (const [file_path, group] of groups) {
    const parts = file_path.split(/[\\/]/u);
    const parent = parent_directory(root, parts, null);
    if (!group.some((file) => file.internal_file_path !== null)) {
      add_leaf(parent, group[0]!, parts.at(-1)!);
      continue;
    }
    const container: BranchNode = {
      kind: "container",
      name: parts.at(-1)!,
      key: JSON.stringify(["container", file_path]),
      path: file_path,
      children: [],
      file_count: 0,
      selected_count: 0,
    };
    parent.children.push(container);
    for (const file of group) {
      if (file.internal_file_path === null) add_leaf(container, file, ungrouped_label);
      else {
        const internal_parts = file.internal_file_path.split(/[\\/]/u);
        add_leaf(
          parent_directory(container, internal_parts, file_path),
          file,
          internal_parts.at(-1)!,
        );
      }
    }
  }

  /** 从叶子向父级汇总，折叠与挂载范围不影响全选和半选。 */
  function summarize(node: ProofreadingFileNode): void {
    if (node.kind === "file") return;
    for (const child of node.children) {
      summarize(child);
      node.file_count += child.file_count;
      node.selected_count += child.selected_count;
    }
  }
  summarize(root);
  return root;
}

/** 遍历完整后代更新选择，保留其他分支与失效引用的显式意图。 */
export function change_proofreading_file_selection(
  files: readonly ProofreadingFile[],
  selection: ProofreadingFileSelection,
  node: ProofreadingFileNode,
  checked: boolean,
): ProofreadingFileRef[] {
  const next = selected_files(files, selection);
  /** 每个叶子只更新一次，父级仅提供遍历入口。 */
  function visit(current: ProofreadingFileNode): void {
    if (current.kind !== "file") current.children.forEach(visit);
    else if (checked) next.set(build_proofreading_file_key(current.file), current.file);
    else next.delete(build_proofreading_file_key(current.file));
  }
  visit(node);
  return [...next.values()];
}
