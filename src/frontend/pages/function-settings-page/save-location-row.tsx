import type { JSX } from "react";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/shadcn/select";

type Props = {
  title: string;
  description: string;
  options: { value: string; label: string }[];
  mode: string;
  fixed_path: string;
  busy: boolean;
  on_mode_change: (value: string) => void;
};

/** 两类保存位置共用选择器，固定模式在说明下显示已保存路径。 */
export function SaveLocationRow(props: Props): JSX.Element {
  return (
    <SettingCardRow
      className="function-settings-page__save-location-row"
      action_width="content"
      title={props.title}
      description={
        props.mode === "FIXED" && props.fixed_path
          ? `${props.description}\n${props.fixed_path}`
          : props.description
      }
      action={
        <Select
          items={props.options}
          value={props.mode}
          disabled={props.busy}
          onValueChange={(value) => {
            if (value !== null) props.on_mode_change(value);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {props.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
    />
  );
}
