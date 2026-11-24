import { type JSX, useState } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@frontend/shadcn/input-group";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { project_asset_extension, SourceFilePathIndex } from "@shared/project/project-asset-paths";
import { is_portable_file_name } from "@shared/utils/file-name";
import type { WorkbenchFileEntry } from "@shared/workbench/workbench-query";

type RenameCheck = { target: string } | { issue: "invalid_name" | "exists" } | null; // `null` 表示名称未变

type WorkbenchRenameDialogProps = {
  entry: WorkbenchFileEntry;
  entries: readonly WorkbenchFileEntry[];
  submitting: boolean;
  on_submit: (new_rel_path: string) => void;
  on_close: () => void;
};

/** 按后端文件布局的同一套名称、扩展名与最终集合规则检查新名称，目录和扩展名保持不变。 */
function check_rename(
  entry: WorkbenchFileEntry,
  stem: string,
  entries: readonly WorkbenchFileEntry[],
): RenameCheck {
  stem = stem.trim(); // 只规范用户输入的主干，已有路径按原始身份定位。
  const extension = project_asset_extension(entry.rel_path);
  const name = stem + extension;
  const target = entry.rel_path.slice(0, entry.rel_path.lastIndexOf("/") + 1) + name;
  if (target === entry.rel_path) return null;
  // 主干也是游戏输出目录名。拼接后缀会掩盖主干末尾的点。
  if (!is_portable_file_name(stem) || project_asset_extension(name) !== extension)
    return { issue: "invalid_name" };
  const index = new SourceFilePathIndex();
  for (const other of entries)
    if (other.rel_path !== entry.rel_path) index.reserve(other.rel_path, other.file_type);
  return index.find_conflict(target, entry.file_type) === null ? { target } : { issue: "exists" };
}

/** 改名弹窗只编辑文件名主干，非法名称就地提示并禁止提交。 */
export function WorkbenchRenameDialog(props: WorkbenchRenameDialogProps): JSX.Element {
  const { t } = useI18n();
  const extension = project_asset_extension(props.entry.rel_path);
  const file_name = props.entry.rel_path.slice(props.entry.rel_path.lastIndexOf("/") + 1);
  const [stem, set_stem] = useState(file_name.slice(0, file_name.length - extension.length));
  const check = check_rename(props.entry, stem, props.entries);
  const issue = check !== null && "issue" in check ? check.issue : null;
  const title = t("workbench_page.action.rename");

  return (
    <AppPageDialog
      open
      title={title}
      size="sm"
      submitting={props.submitting}
      onClose={props.on_close}
      primaryAction={{
        label: t("app.action.confirm"),
        shortcut: "submit",
        disabled: check === null || issue !== null,
        onSelect: () => {
          if (check !== null && "target" in check) props.on_submit(check.target);
        },
      }}
    >
      <InputGroup>
        <InputGroupInput
          autoFocus
          aria-label={title}
          aria-invalid={issue !== null || undefined}
          value={stem}
          disabled={props.submitting}
          onFocus={(event) => event.target.select()}
          onChange={(event) => set_stem(event.target.value)}
        />
        {extension === "" ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupText>{extension}</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
      {issue === null ? null : (
        <p className="workbench-page__rename-issue">{t(`workbench_page.dialog.rename.${issue}`)}</p>
      )}
    </AppPageDialog>
  );
}
