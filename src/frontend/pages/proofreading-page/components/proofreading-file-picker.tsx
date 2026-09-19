import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronRight, Files, Folder, FolderOpen } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { Badge } from "@frontend/shadcn/badge";
import type { ProofreadingFile } from "@shared/proofreading/proofreading-types";
import type { ProofreadingFilterChoice } from "../proofreading-filter-state";
import {
  build_proofreading_file_tree,
  change_proofreading_file_selection,
  type ProofreadingFileNode,
} from "./proofreading-file-tree";

/** 文件选择由页面持有，目录展开状态随组件所属工程重置。 */
export function ProofreadingFilePicker(props: {
  files: ProofreadingFile[];
  selection: ProofreadingFilterChoice<string>;
  disabled: boolean;
  on_change: (selection: ProofreadingFilterChoice<string>) => void;
}): JSX.Element {
  const { t } = useI18n();
  // 仅记录用户覆盖值，异步到达的顶层目录也会默认展开。
  const [expansion, set_expansion] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const selected = new Set(
    props.selection.mode === "default"
      ? props.files.map((file) => file.file_path)
      : props.selection.values,
  );
  const tree = build_proofreading_file_tree(props.files, selected);
  const all = tree.file_count > 0 && tree.selected_count === tree.file_count;

  /** 只渲染展开分支，计数与勾选始终读取完整子树。 */
  function render_nodes(nodes: ProofreadingFileNode[], depth: number): JSX.Element {
    return (
      <ul className="proofreading-page__file-tree">
        {nodes.map((node) => {
          const directory = node.kind === "directory";
          const expanded = expansion.get(node.path) ?? depth === 0;
          const checked = node.selected_count === node.file_count;
          // 整行处理展开点击，复选框拦截冒泡，使选择与展开独立。
          const toggle_expansion = (): void => {
            set_expansion((current) => new Map(current).set(node.path, !expanded));
          };
          return (
            <li key={node.kind + ":" + node.path}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      className="proofreading-page__file-row"
                      data-directory={directory ? "true" : undefined}
                      onClick={directory ? toggle_expansion : undefined}
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
                            values: change_proofreading_file_selection(selected, node, !checked),
                          })
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                      {node.kind === "directory" ? (
                        <button
                          type="button"
                          className="proofreading-page__file-body"
                          aria-label={node.name}
                          aria-expanded={expanded}
                        >
                          {expanded ? <FolderOpen /> : <Folder />}
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
              {node.kind === "directory" && expanded && render_nodes(node.children, depth + 1)}
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
            <div className="proofreading-page__file-options">
              {tree.file_count > 0 ? (
                render_nodes(tree.children, 0)
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
