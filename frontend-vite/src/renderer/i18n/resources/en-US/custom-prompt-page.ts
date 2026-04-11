import { zh_cn_custom_prompt_page } from '@/i18n/resources/zh-CN/custom-prompt-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_custom_prompt_page = {
  title: 'Custom Prompts',
  summary: 'The custom prompts page will collect task-specific constraints and style preferences in one place.',
  action: {
    import: 'Import',
    export: 'Export',
    save: 'Save',
    preset: 'Preset',
  },
  toggle: {
    status: '{TITLE} - {STATE}',
  },
  section: {
    prefix_label: 'Fixed Prefix',
    suffix_label: 'Fixed Suffix',
  },
  preset: {
    save: 'Save Preset',
    apply: 'Import',
    rename: 'Rename',
    delete: 'Delete Preset',
    set_default: 'Set as Default Preset',
    cancel_default: 'Cancel Default Preset',
    dialog: {
      save_title: 'Save as Preset',
      save_description: 'Save the current prompt body as a user preset for quick import later.',
      save_confirm: 'Save',
      rename_title: 'Rename Preset',
      rename_description: 'Update the name of this user preset.',
      rename_confirm: 'Rename',
      name_placeholder: 'Enter a preset name …',
    },
  },
  confirm: {
    delete_preset: {
      title: 'Delete Preset',
      description: 'Delete preset "{NAME}"?',
      confirm: 'Delete Preset',
    },
    reset: {
      title: 'Confirm Reset',
      description: 'Confirm reset data …?',
      confirm: 'Reset',
    },
    overwrite_preset: {
      title: 'Overwrite Preset',
      description: 'Preset "{NAME}" already exists. Overwrite it …?',
      confirm: 'Overwrite',
    },
  },
  feedback: {
    load_failed: 'Task failed …',
    save_failed: 'Task failed …',
    import_failed: 'Task failed …',
    import_success: 'Data imported …',
    export_failed: 'Task failed …',
    export_success: 'Data exported …',
    preset_failed: 'Task failed …',
    preset_saved: 'Preset saved …',
    preset_renamed: 'Task succeeded …',
    preset_deleted: 'Task succeeded …',
    preset_name_required: 'Preset name is required.',
    preset_exists: 'File already exists …',
    default_preset_set: 'Default preset set …',
    default_preset_cleared: 'Default preset cancelled …',
    save_success: 'Saved …',
    reset_success: 'Reseted …',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>
