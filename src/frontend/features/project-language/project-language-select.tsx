import { type JSX, useMemo } from "react";

import {
  ALL_LANGUAGE_CODE,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  type LanguageCode,
} from "@domain/language";
import type { ProjectLanguageKey } from "@domain/project-settings";
import { get_language_label_key } from "@frontend/app/locale/language-label";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/shadcn/select";

type ProjectLanguageSelectProps = {
  field: ProjectLanguageKey; // 源语言选项包含“任意语言”，目标语言只列可译出语言
  value: string;
  disabled?: boolean;
  on_change: (next_value: string) => void;
};

/** 设置页与新建项目弹窗共用的项目语言下拉，集中维护选项与文案。 */
export function ProjectLanguageSelect(props: ProjectLanguageSelectProps): JSX.Element {
  const { t } = useI18n();
  const options = useMemo(() => {
    const codes: readonly LanguageCode[] =
      props.field === "source_language"
        ? [ALL_LANGUAGE_CODE, ...SOURCE_LANGUAGE_CODES]
        : TARGET_LANGUAGE_CODES;
    return codes.map((code) => ({ value: code, label: t(get_language_label_key(code)) }));
  }, [props.field, t]);

  return (
    <Select
      items={options}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(next_value) => {
        if (next_value !== null) props.on_change(next_value);
      }}
    >
      <SelectTrigger
        aria-label={t(
          props.field === "source_language"
            ? "app.language_role.source"
            : "app.language_role.target",
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
