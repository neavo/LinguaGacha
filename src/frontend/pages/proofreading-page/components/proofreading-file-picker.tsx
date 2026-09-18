import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Files } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { Input } from "@frontend/shadcn/input";
import type { ProofreadingFile } from "@shared/proofreading/proofreading-types";
import type { ProofreadingFilterChoice } from "../proofreading-filter-state";

/** 页面拥有选择意图，浮层只持有候选搜索词，全选始终覆盖整个工程。 */
export function ProofreadingFilePicker(props: {
  files: ProofreadingFile[];
  selection: ProofreadingFilterChoice<string>;
  disabled: boolean;
  on_change: (selection: ProofreadingFilterChoice<string>) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [keyword, set_keyword] = useState("");
  const selected = new Set(
    props.selection.mode === "default"
      ? props.files.map((file) => file.file_path)
      : props.selection.values,
  );
  const count = props.files.filter((file) => selected.has(file.file_path)).length;
  const all = props.files.length > 0 && count === props.files.length;
  return (
    <Popover.Root onOpenChange={() => set_keyword("")}>
      <Popover.Trigger
        render={
          <AppButton
            variant="ghost"
            size="toolbar"
            className="search-bar__action-trigger"
            data-active={all ? "true" : undefined}
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
            <Input
              value={keyword}
              placeholder={t("proofreading_page.filter.search_placeholder")}
              onChange={(event) => set_keyword(event.target.value)}
            />
            <label className="proofreading-page__file-option">
              <input
                type="checkbox"
                ref={(node) => {
                  if (node) node.indeterminate = count > 0 && !all;
                }}
                checked={all}
                onChange={() =>
                  props.on_change(all ? { mode: "selected", values: [] } : { mode: "default" })
                }
              />
              {t("proofreading_page.filter.select_all")}
            </label>
            <div className="proofreading-page__file-options">
              {props.files
                .filter((file) =>
                  file.file_path.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()),
                )
                .map((file) => (
                  <Tooltip key={file.file_path}>
                    <TooltipTrigger
                      render={
                        <label className="proofreading-page__file-option">
                          <input
                            type="checkbox"
                            checked={selected.has(file.file_path)}
                            onChange={() => {
                              const next = new Set(selected);
                              if (next.has(file.file_path)) next.delete(file.file_path);
                              else next.add(file.file_path);
                              props.on_change({ mode: "selected", values: [...next] });
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{file.file_path}</span>
                          <span>
                            {t(
                              file.kind === "page"
                                ? "proofreading_page.pages.page_count"
                                : "proofreading_page.pages.item_count",
                              { COUNT: String(file.count) },
                            )}
                          </span>
                        </label>
                      }
                    />
                    <TooltipContent>{file.file_path}</TooltipContent>
                  </Tooltip>
                ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
