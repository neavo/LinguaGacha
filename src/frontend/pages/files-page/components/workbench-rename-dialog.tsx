import { type JSX, useState } from "react";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@frontend/shadcn/input-group";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { project_asset_extension } from "@shared/project/project-asset-paths";
import { is_portable_file_name } from "@shared/utils/file-name";

type WorkbenchRenameDialogProps = {
  rel_path: string;
  submitting: boolean;
  on_submit: (new_rel_path: string) => void;
  on_close: () => void;
};

/** 改名弹窗只编辑文件名主干。目标占用由写入入口检查。 */
export function WorkbenchRenameDialog(props: WorkbenchRenameDialogProps): JSX.Element {
  const { t } = useI18n();
  const { rel_path } = props;
  const extension = project_asset_extension(rel_path);
  const basename_start = rel_path.lastIndexOf("/") + 1;
  const original_stem = rel_path.slice(basename_start, rel_path.length - extension.length);
  const [stem, set_stem] = useState(original_stem);
  const title = t("workbench_page.action.rename");

  function submit(): void {
    const trimmed = stem.trim();
    if (stem === original_stem || trimmed === original_stem) return props.on_close();
    const name = trimmed + extension;
    // 游戏输出目录沿用主干，拼接后缀会掩盖主干末尾的点。
    if (!is_portable_file_name(trimmed) || project_asset_extension(name) !== extension) {
      push_toast("warning", t("app.feedback.invalid_file_name"));
      return;
    }
    props.on_submit(rel_path.slice(0, basename_start) + name);
  }

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
        onSelect: submit,
      }}
    >
      <InputGroup>
        <InputGroupInput
          autoFocus
          aria-label={title}
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
    </AppPageDialog>
  );
}
