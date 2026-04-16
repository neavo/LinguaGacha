import { FileInput, FilePlus2, Radar, SquarePower, type LucideIcon } from 'lucide-react'

import { Button } from '@/shadcn/button'
import { useI18n, type LocaleKey } from '@/i18n'
import type { TranslationTaskRuntime } from '@/app/state/use-translation-task-runtime'
import type { TranslationTaskActionKind } from '@/lib/translation-task'
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from '@/widgets/command-bar/command-bar'
import { TranslationTaskMenu } from '@/widgets/translation-task/translation-task-menu'
import { TranslationTaskRuntimeSummary } from '@/widgets/translation-task/translation-task-runtime-summary'

type WorkbenchCommandBarProps = {
  task_runtime: TranslationTaskRuntime
  can_edit_files: boolean
  can_export_translation: boolean
  can_close_project: boolean
  on_add_file: () => void
  on_export_translation: () => void
  on_close_project: () => void
}

type CommandAction = {
  id: 'add-file' | 'export-translation' | 'close-project'
  icon: LucideIcon
  label_key: LocaleKey
  disabled: boolean
  on_click: () => void
}

export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n()
  const active_task_action_kind: TranslationTaskActionKind | null = props.task_runtime.task_confirm_state?.kind ?? null
  const actions: CommandAction[] = [
    {
      id: 'add-file',
      icon: FilePlus2,
      label_key: 'workbench_page.action.add_file',
      disabled: !props.can_edit_files,
      on_click: props.on_add_file,
    },
    {
      id: 'export-translation',
      icon: FileInput,
      label_key: 'workbench_page.action.export_translation',
      disabled: !props.can_export_translation,
      on_click: props.on_export_translation,
    },
    {
      id: 'close-project',
      icon: SquarePower,
      label_key: 'workbench_page.action.close_project',
      disabled: !props.can_close_project,
      on_click: props.on_close_project,
    },
  ]

  return (
    <CommandBar
      className="workbench-page__task-command-bar"
      title={t('workbench_page.section.command_bar')}
      description={t('workbench_page.command.description')}
      actions={
        <>
          <CommandBarGroup>
            <TranslationTaskMenu
              translation_task_display_snapshot={props.task_runtime.translation_task_display_snapshot}
              translation_task_metrics={props.task_runtime.translation_task_metrics}
              disabled={props.task_runtime.translation_task_menu_disabled}
              busy={props.task_runtime.translation_task_menu_busy}
              active_task_action_kind={active_task_action_kind}
              on_start_or_continue={props.task_runtime.request_start_or_continue_translation}
              on_request_confirmation={props.task_runtime.request_task_action_confirmation}
            />
            <Button
              type="button"
              size="toolbar"
              variant="ghost"
              disabled
            >
              <Radar data-icon="inline-start" />
              {t('proofreading_page.action.analysis_task')}
            </Button>
          </CommandBarGroup>
          <CommandBarSeparator />
          {actions.map((action, index) => {
            const Icon = action.icon

            return (
              <div key={action.id} className="contents">
                {index > 0 ? <CommandBarSeparator /> : null}
                <Button variant="ghost" size="toolbar" disabled={action.disabled} onClick={action.on_click}>
                  <Icon data-icon="inline-start" />
                  {t(action.label_key)}
                </Button>
              </div>
            )
          })}
        </>
      }
      hint={(
        <TranslationTaskRuntimeSummary
          class_name="workbench-page__task-summary"
          translation_task_metrics={props.task_runtime.translation_task_metrics}
          can_open={props.task_runtime.can_open_translation_detail_sheet}
          on_open={props.task_runtime.open_translation_detail_sheet}
        />
      )}
    />
  )
}


