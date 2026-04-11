import { FileInput, FilePlus2, SquarePower, type LucideIcon } from 'lucide-react'

import { Button } from '@/shadcn/button'
import { useI18n, type LocaleKey } from '@/i18n'
import {
  CommandBar,
  CommandBarSeparator,
} from '@/widgets/command-bar/command-bar'

type WorkbenchCommandBarProps = {
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
      title={t('workbench_page.section.command_bar')}
      description={t('workbench_page.command.description')}
      actions={
        <>
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
    />
  )
}


