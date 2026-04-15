import type {
  ProofreadingTranslationTaskActionKind,
  ProofreadingTranslationTaskMetrics,
  ProofreadingTranslationTaskSnapshot,
} from '@/pages/proofreading-page/types'
import { useI18n } from '@/i18n'
import { ProofreadingTaskMenu } from '@/pages/proofreading-page/components/proofreading-task-menu'
import { ProofreadingTaskRuntimeSummary } from '@/pages/proofreading-page/components/proofreading-task-runtime-summary'
import { Button } from '@/shadcn/button'
import { Radar } from 'lucide-react'
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from '@/widgets/command-bar/command-bar'

type ProofreadingTaskCommandBarProps = {
  translation_task_display_snapshot: ProofreadingTranslationTaskSnapshot | null
  translation_task_metrics: ProofreadingTranslationTaskMetrics
  translation_task_menu_disabled: boolean
  translation_task_menu_busy: boolean
  can_open_translation_detail_sheet: boolean
  active_task_action_kind: ProofreadingTranslationTaskActionKind | null
  on_start_or_continue_translation: () => Promise<void>
  on_request_task_action_confirmation: (kind: ProofreadingTranslationTaskActionKind) => void
  on_open_translation_detail_sheet: () => void
}

export function ProofreadingTaskCommandBar(
  props: ProofreadingTaskCommandBarProps,
): JSX.Element {
  const { t } = useI18n()

  return (
    <CommandBar
      className="proofreading-page__task-command-bar"
      title={t('proofreading_page.action.translation_task')}
      description={t('proofreading_page.task.detail.description')}
      actions={(
        <>
          <CommandBarGroup>
            <ProofreadingTaskMenu
              translation_task_display_snapshot={props.translation_task_display_snapshot}
              translation_task_metrics={props.translation_task_metrics}
              disabled={props.translation_task_menu_disabled}
              busy={props.translation_task_menu_busy}
              active_task_action_kind={props.active_task_action_kind}
              on_start_or_continue={props.on_start_or_continue_translation}
              on_request_confirmation={props.on_request_task_action_confirmation}
            />
            <CommandBarSeparator />
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
        </>
      )}
      hint={(
        <ProofreadingTaskRuntimeSummary
          class_name="proofreading-page__task-command-summary"
          translation_task_display_snapshot={props.translation_task_display_snapshot}
          translation_task_metrics={props.translation_task_metrics}
          can_open={props.can_open_translation_detail_sheet}
          on_open={props.on_open_translation_detail_sheet}
        />
      )}
    />
  )
}
