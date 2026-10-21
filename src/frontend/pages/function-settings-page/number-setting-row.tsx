import { type JSX, useEffect, useRef, useState } from "react";

import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { parse_bounded_setting_number_draft } from "@frontend/features/settings-editor/setting-number-draft";
import { Input } from "@frontend/shadcn/input";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type NumberSettingRowProps = {
  title: string;
  description: string;
  invalid_message: string;
  value: number;
  min: number;
  max: number;
  integer: boolean;
  pending: boolean;
  on_commit: (value: number) => Promise<void>;
};

/** 组件持有数字草稿，设置编辑器负责保存与失败恢复。 */
export function NumberSettingRow(props: NumberSettingRowProps): JSX.Element {
  const { t } = useI18n();
  const [draft, set_draft] = useState(String(props.value));
  const [editing, set_editing] = useState(false);
  const dirty = useRef(false); // 未修改时结束编辑，采用期间收到的权威快照。
  const parsed = parse_bounded_setting_number_draft(draft, props.min, props.max);
  const invalid = parsed === null || (props.integer && !Number.isInteger(parsed));

  useEffect(() => {
    if (!editing && !props.pending) set_draft(String(props.value));
  }, [editing, props.pending, props.value]);

  /** 校验草稿并串行提交，保存结束后同步权威值。 */
  async function commit(): Promise<void> {
    if (props.pending) return;
    if (!dirty.current) {
      set_editing(false);
      return;
    }
    if (invalid || parsed === null) {
      set_editing(true);
      push_error_toast(t("app.feedback.save_failed"), props.invalid_message);
      return;
    }
    dirty.current = false; // 提交前清除修改标记，Enter 与失焦共用去重条件。
    try {
      if (parsed !== props.value) await props.on_commit(parsed);
    } finally {
      set_editing(false);
    }
  }

  return (
    <SettingCardRow
      title={props.title}
      description={props.description}
      action={
        <div className="function-settings-page__number-field">
          <Input
            type="number"
            aria-label={props.title}
            min={props.min}
            max={props.max}
            step={props.integer ? 1 : "any"}
            value={draft}
            aria-invalid={invalid || undefined}
            disabled={props.pending}
            onChange={(event) => {
              dirty.current = true;
              set_editing(true);
              set_draft(event.target.value);
            }}
            onFocus={() => set_editing(true)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void commit();
            }}
          />
        </div>
      }
    />
  );
}
