import type { LocaleKey } from '@/i18n'

export type CustomPromptTemplate = {
  default_text: string
  prefix_text: string
  suffix_text: string
}

export type CustomPromptPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
  path?: string
  is_default?: boolean
}

export type CustomPromptConfirmState =
  | {
      open: false
      kind: null
      preset_name: string
      preset_input_value: string
      submitting: boolean
      target_virtual_id: string | null
    }
  | {
      open: true
      kind: 'reset' | 'delete-preset' | 'overwrite-preset'
      preset_name: string
      preset_input_value: string
      submitting: boolean
      target_virtual_id: string | null
    }

export type CustomPromptPresetInputState =
  | {
      open: false
      mode: null
      value: string
      submitting: boolean
      target_virtual_id: string | null
    }
  | {
      open: true
      mode: 'save' | 'rename'
      value: string
      submitting: boolean
      target_virtual_id: string | null
    }

export type UseCustomPromptPageStateResult = {
  title_key: LocaleKey
  header_title_key: LocaleKey
  header_description_key: LocaleKey
  template: CustomPromptTemplate
  prompt_text: string
  enabled: boolean
  preset_items: CustomPromptPresetItem[]
  preset_menu_open: boolean
  confirm_state: CustomPromptConfirmState
  preset_input_state: CustomPromptPresetInputState
  update_prompt_text: (next_text: string) => void
  update_enabled: (next_enabled: boolean) => Promise<void>
  save_prompt_text: () => Promise<void>
  import_prompt_from_picker: () => Promise<void>
  export_prompt_from_picker: () => Promise<void>
  open_preset_menu: () => Promise<void>
  apply_preset: (virtual_id: string) => Promise<void>
  request_reset_prompt: () => void
  request_save_preset: () => void
  request_rename_preset: (preset_item: CustomPromptPresetItem) => void
  request_delete_preset: (preset_item: CustomPromptPresetItem) => void
  set_default_preset: (virtual_id: string) => Promise<void>
  cancel_default_preset: () => Promise<void>
  confirm_pending_action: () => Promise<void>
  close_confirm_dialog: () => void
  update_preset_input_value: (next_value: string) => void
  submit_preset_input: () => Promise<void>
  close_preset_input_dialog: () => void
  set_preset_menu_open: (next_open: boolean) => void
}
