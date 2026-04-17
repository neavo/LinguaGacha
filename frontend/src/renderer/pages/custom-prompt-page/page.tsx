import '@/pages/custom-prompt-page/custom-prompt-page.css'
import type { ScreenComponentProps } from '@/app/navigation/types'
import { useI18n } from '@/i18n'
import {
  CustomPromptCommandBar,
} from '@/pages/custom-prompt-page/components/custom-prompt-command-bar'
import {
  CustomPromptConfirmDialog,
} from '@/pages/custom-prompt-page/components/custom-prompt-confirm-dialog'
import {
  CustomPromptPresetInputDialog,
} from '@/pages/custom-prompt-page/components/custom-prompt-preset-input-dialog'
import type { CustomPromptVariant } from '@/pages/custom-prompt-page/config'
import {
  useCustomPromptPageState,
} from '@/pages/custom-prompt-page/use-custom-prompt-page-state'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'
import { AppEditor } from '@/widgets/app-editor/app-editor'

type CustomPromptPageProps = ScreenComponentProps & {
  variant: CustomPromptVariant
}

function compress_prompt_preview(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, ' ↵ ')
}

export function CustomPromptPage(
  props: CustomPromptPageProps,
): JSX.Element {
  const page_state = useCustomPromptPageState(props.variant)
  const { t } = useI18n()

  return (
    <div
      className="custom-prompt-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <div className="custom-prompt-page__content">
        <Tooltip>
          <TooltipTrigger asChild>
            <section
              className="custom-prompt-page__readonly-strip"
              aria-label={t('custom_prompt_page.section.prefix_label')}
              tabIndex={0}
            >
              <p
                className="custom-prompt-page__readonly-strip-label font-medium"
              >
                {t('custom_prompt_page.section.prefix_label')}
              </p>
              <pre className="custom-prompt-page__readonly-block">
                {compress_prompt_preview(page_state.template.prefix_text)}
              </pre>
            </section>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={8}
            className="custom-prompt-page__readonly-tooltip"
          >
            <pre className="custom-prompt-page__readonly-tooltip-copy">
              {page_state.template.prefix_text}
            </pre>
          </TooltipContent>
        </Tooltip>

        <AppEditor
          class_name="custom-prompt-page__editor-host"
          mode="markdown"
          value={page_state.prompt_text}
          aria_label={t(page_state.header_title_key)}
          read_only={false}
          on_change={page_state.update_prompt_text}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <section
              className="custom-prompt-page__readonly-strip"
              aria-label={t('custom_prompt_page.section.suffix_label')}
              tabIndex={0}
            >
              <p
                className="custom-prompt-page__readonly-strip-label font-medium"
              >
                {t('custom_prompt_page.section.suffix_label')}
              </p>
              <pre className="custom-prompt-page__readonly-block">
                {compress_prompt_preview(page_state.template.suffix_text)}
              </pre>
            </section>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={8}
            className="custom-prompt-page__readonly-tooltip"
          >
            <pre className="custom-prompt-page__readonly-tooltip-copy">
              {page_state.template.suffix_text}
            </pre>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="custom-prompt-page__command-bar-shell">
        <CustomPromptCommandBar
          title_key={page_state.title_key}
          header_title_key={page_state.header_title_key}
          header_description_key={page_state.header_description_key}
          enabled={page_state.enabled}
          save_shortcut_enabled={
            !page_state.confirm_state.open
            && !page_state.preset_input_state.open
            && !page_state.preset_menu_open
          }
          preset_items={page_state.preset_items}
          preset_menu_open={page_state.preset_menu_open}
          on_toggle_enabled={page_state.update_enabled}
          on_save={page_state.save_prompt_text}
          on_import={page_state.import_prompt_from_picker}
          on_export={page_state.export_prompt_from_picker}
          on_open_preset_menu={page_state.open_preset_menu}
          on_apply_preset={page_state.apply_preset}
          on_request_reset={page_state.request_reset_prompt}
          on_request_save_preset={page_state.request_save_preset}
          on_request_rename_preset={page_state.request_rename_preset}
          on_request_delete_preset={page_state.request_delete_preset}
          on_set_default_preset={page_state.set_default_preset}
          on_cancel_default_preset={page_state.cancel_default_preset}
          on_preset_menu_open_change={page_state.set_preset_menu_open}
        />
      </div>

      <CustomPromptConfirmDialog
        state={page_state.confirm_state}
        on_confirm={() => {
          void page_state.confirm_pending_action()
        }}
        on_close={page_state.close_confirm_dialog}
      />

      <CustomPromptPresetInputDialog
        state={page_state.preset_input_state}
        on_change={page_state.update_preset_input_value}
        on_submit={() => {
          void page_state.submit_preset_input()
        }}
        on_close={page_state.close_preset_input_dialog}
      />
    </div>
  )
}
