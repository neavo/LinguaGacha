import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { type JSX, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronRight, File, Files, Folder, FolderOpen } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { Badge } from "@frontend/shadcn/badge";
import type {
  ProofreadingFile,
  ProofreadingFileSelection,
} from "@shared/proofreading/proofreading-types";
import {
  build_proofreading_file_tree,
  change_proofreading_file_selection,
  type ProofreadingFileNode,
} from "./proofreading-file-tree";

const FILE_ROW_HEIGHT = 32; // 固定行高同时供占位高度与滚动定位使用。
const FILE_TREE_INDENT = 16;
const FILE_TREE_VIEWPORT_HEIGHT = 480;
const FILE_TREE_OVERSCAN = 6;

/** 文件选择由页面持有，目录展开状态随组件所属工程重置。 */
export function ProofreadingFilePicker(props: {
  files: ProofreadingFile[];
  selection: ProofreadingFileSelection;
  disabled: boolean;
  on_change: (selection: ProofreadingFileSelection) => void;
}): JSX.Element {
  const { t } = useI18n();
  // 仅记录用户覆盖值，异步到达的顶层目录也会默认展开。
  const [expansion, set_expansion] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const ungrouped_label = t("proofreading_page.ungrouped_file");
  const tree = useMemo(
    () => build_proofreading_file_tree(props.files, props.selection, ungrouped_label),
    [props.files, props.selection, ungrouped_label],
  );
  const all = tree.file_count > 0 && tree.selected_count === tree.file_count;

  // 浮层挂载后交给虚拟列表观察尺寸，关闭时解除滚动宿主。
  const [scroll_element, set_scroll_element] = useState<HTMLDivElement | null>(null);
  // 将展开分支按阅读顺序铺平，只挂载视口附近行，整树仍负责选择与统计。
  const rows = useMemo(() => {
    const visible: { node: ProofreadingFileNode; depth: number; expanded: boolean }[] = [];
    /** 按展开状态收集可见层级，后代顺序沿用完整树。 */
    function visit(nodes: ProofreadingFileNode[], depth: number): void {
      for (const node of nodes) {
        const expanded = expansion.get(node.key) ?? (node.kind === "directory" && depth === 0);
        visible.push({ node, depth, expanded });
        if (node.kind !== "file" && expanded) visit(node.children, depth + 1);
      }
    }
    visit(tree.children, 0);
    return visible;
  }, [tree, expansion]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: rows.length,
    getScrollElement: () => scroll_element,
    getItemKey: (index) => rows[index]!.node.key,
    estimateSize: () => FILE_ROW_HEIGHT,
    overscan: FILE_TREE_OVERSCAN,
    initialRect: { width: 0, height: FILE_TREE_VIEWPORT_HEIGHT },
  });

  /** 挂载视口附近行，缩进和定位来自可见层级与虚拟滚动结果。 */
  function render_rows(): JSX.Element {
    return (
      <ul className="proofreading-page__file-tree" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual_row) => {
          const { node, depth, expanded } = rows[virtual_row.index]!;
          const branch = node.kind !== "file";
          const checked = node.selected_count === node.file_count;
          // 整行处理展开点击，复选框拦截冒泡，使选择与展开独立。
          const toggle_expansion = (): void => {
            set_expansion((current) => new Map(current).set(node.key, !expanded));
          };
          return (
            <li
              key={node.key}
              aria-level={depth + 1}
              style={{
                height: FILE_ROW_HEIGHT,
                paddingLeft: depth * FILE_TREE_INDENT,
                transform: `translateY(${virtual_row.start}px)`,
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      className="proofreading-page__file-row"
                      data-directory={branch ? "true" : undefined}
                      onClick={branch ? toggle_expansion : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={node.name}
                        ref={(element) => {
                          if (element) element.indeterminate = node.selected_count > 0 && !checked;
                        }}
                        onChange={() =>
                          props.on_change({
                            mode: "selected",
                            values: change_proofreading_file_selection(
                              props.files,
                              props.selection,
                              node,
                              !checked,
                            ),
                          })
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                      {node.kind !== "file" ? (
                        <button
                          type="button"
                          className="proofreading-page__file-body"
                          aria-label={node.name}
                          aria-expanded={expanded}
                        >
                          {node.kind === "container" ? (
                            <File />
                          ) : expanded ? (
                            <FolderOpen />
                          ) : (
                            <Folder />
                          )}
                          <span className="proofreading-page__file-name">{node.name}</span>
                          <Badge>
                            {node.selected_count}/{node.file_count}
                            {expanded ? <ChevronDown /> : <ChevronRight />}
                          </Badge>
                        </button>
                      ) : (
                        <div className="proofreading-page__file-body">
                          <span className="proofreading-page__file-name">{node.name}</span>
                          <Badge>{node.count}</Badge>
                        </div>
                      )}
                    </div>
                  }
                />
                <TooltipContent>{node.path}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <AppButton
            variant="ghost"
            size="toolbar"
            className="search-bar__action-trigger"
            data-active={tree.selected_count > 0 ? "true" : undefined}
            disabled={props.disabled}
          />
        }
      >
        <Files data-icon="inline-start" />
        {t("proofreading_page.action.files")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-(--ui-layer-overlay)">
          <Popover.Popup
            className="proofreading-page__file-picker"
            aria-label={t("proofreading_page.action.files")}
          >
            <label className="proofreading-page__file-all">
              <input
                type="checkbox"
                checked={all}
                disabled={tree.file_count === 0}
                ref={(element) => {
                  if (element) element.indeterminate = tree.selected_count > 0 && !all;
                }}
                onChange={() =>
                  props.on_change(all ? { mode: "selected", values: [] } : { mode: "default" })
                }
              />
              {t("proofreading_page.filter.select_all")}
            </label>
            <div
              className="proofreading-page__file-options"
              ref={set_scroll_element}
              style={{ maxHeight: FILE_TREE_VIEWPORT_HEIGHT }}
            >
              {tree.file_count > 0 ? (
                render_rows()
              ) : (
                <p className="proofreading-page__file-hint" role="status">
                  {t("proofreading_page.no_files")}
                </p>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
