import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { PresetInputState, PresetItem } from "@frontend/features/preset-editor/preset-types";

export type CustomPromptTemplate = {
  default_text: string;
  prefix_text: string;
  suffix_text: string;
};

export type CustomPromptConfirmState =
  | {
      kind: null;
    }
  | {
      kind: "reset";
      submitting: boolean;
    }
  | {
      kind: "delete-preset";
      target_virtual_id: string;
      submitting: boolean;
    }
  | {
      kind: "overwrite-preset";
      preset_input_value: string;
      submitting: boolean;
    };

export type UseCustomPromptPageStateResult = {
  title_key: LocaleKey;
  header_title_key: LocaleKey;
  header_description_key: LocaleKey;
  template: CustomPromptTemplate;
  prompt_text: string;
  enabled: boolean;
  readonly: boolean;
  preset_items: PresetItem[];
  preset_menu_open: boolean;
  confirm_state: CustomPromptConfirmState;
  preset_input_state: PresetInputState;
  update_prompt_text: (next_text: string) => void;
  update_enabled: (next_enabled: boolean) => Promise<boolean>;
  flush_prompt_change: () => Promise<boolean>;
  import_prompt_from_picker: () => Promise<void>;
  export_prompt_from_picker: () => Promise<void>;
  open_preset_menu: () => Promise<void>;
  apply_preset: (virtual_id: string) => Promise<void>;
  request_reset_prompt: () => void;
  request_save_preset: () => void;
  request_rename_preset: (preset_item: PresetItem) => void;
  request_delete_preset: (preset_item: PresetItem) => void;
  set_default_preset: (virtual_id: string) => Promise<void>;
  cancel_default_preset: () => Promise<void>;
  confirm_pending_action: () => Promise<void>;
  close_confirm_dialog: () => void;
  update_preset_input_value: (next_value: string) => void;
  submit_preset_input: () => Promise<void>;
  close_preset_input_dialog: () => void;
  set_preset_menu_open: (next_open: boolean) => void;
};
