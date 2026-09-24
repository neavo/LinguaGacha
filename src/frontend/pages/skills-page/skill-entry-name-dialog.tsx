import { useState } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { Input } from "@frontend/shadcn/input";
import { AppButton } from "@frontend/widgets/app-button";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type Props = {
  operation: "create_file" | "create_directory" | "rename";
  initial_name: string;
  busy: boolean;
  readonly: boolean;
  on_submit: (name: string) => Promise<boolean>;
  on_close: () => void;
};

/** 名称弹窗持有输入草稿，父组件负责目标路径和文件命令。 */
export function SkillEntryNameDialog(props: Props): JSX.Element {
  const { t } = useI18n();
  const [name, set_name] = useState(props.initial_name);
  const disabled = props.busy || props.readonly;
  /** 校验名称并补全文件后缀，命令成功后关闭弹窗。 */
  async function submit() {
    if (disabled || !name.trim()) return;
    // 在补后缀之前拒绝路径与末尾点，避免将非法输入变成另一个合法名称。
    if (/[/\\]/.test(name) || /[. ]$/.test(name)) {
      push_toast("error", t("app.error.request.validation_failed.message"));
      return;
    }
    const final_name =
      props.operation === "create_file" && !name.includes(".") ? `${name}.md` : name;
    if (await props.on_submit(final_name)) props.on_close();
  }
  return (
    <AppPageDialog
      open
      title={t(`skills_page.editor.${props.operation}`)}
      size="sm"
      dismissBehavior={props.busy ? "blocked" : "default"}
      onClose={props.on_close}
      footer={
        <>
          <AppButton size="sm" variant="outline" disabled={props.busy} onClick={props.on_close}>
            {t("app.action.cancel")}
          </AppButton>
          <AppButton size="sm" disabled={disabled || !name.trim()} onClick={() => void submit()}>
            {t("app.action.confirm")}
          </AppButton>
        </>
      }
    >
      <Input
        autoFocus
        aria-label={t(`skills_page.editor.${props.operation}`)}
        placeholder={t(`skills_page.editor.${props.operation}`)}
        value={name}
        disabled={disabled}
        onFocus={(event) => event.target.select()}
        onChange={(event) => set_name(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
    </AppPageDialog>
  );
}
