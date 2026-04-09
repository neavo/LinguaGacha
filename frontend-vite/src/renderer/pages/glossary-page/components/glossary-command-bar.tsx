import {
  FileDown,
  FileUp,
  FolderOpen,
  Plus,
  Sigma,
} from 'lucide-react'

import { useI18n } from '@/i18n'
import type { GlossaryPresetItem } from '@/pages/glossary-page/types'
import { ActionBar, ActionBarSeparator } from '@/ui/action-bar'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'

type GlossaryCommandBarProps = {
  enabled: boolean
  preset_items: GlossaryPresetItem[]
  preset_menu_open: boolean
  statistics_running: boolean
  on_toggle_enabled: (next_value: boolean) => Promise<void>
  on_create: () => void
  on_import: () => Promise<void>
  on_export: () => Promise<void>
  on_statistics: () => Promise<void>
  on_open_preset_menu: () => Promise<void>
  on_apply_preset: (virtual_id: string) => Promise<void>
  on_preset_menu_open_change: (next_open: boolean) => void
}

export function GlossaryCommandBar(
  props: GlossaryCommandBarProps,
): JSX.Element {
  const { t } = useI18n()

  return (
    <ActionBar
      className="glossary-page__command-bar"
      title={t('glossary_page.title')}
      description={t('glossary_page.summary')}
      actions={(
        <>
          <Button variant="ghost" size="toolbar" onClick={props.on_create}>
            <Plus data-icon="inline-start" />
            {t('glossary_page.action.create')}
          </Button>
          <ActionBarSeparator />
          <div className="glossary-page__command-pair">
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_import()
              }}
            >
              <FileDown data-icon="inline-start" />
              {t('glossary_page.action.import')}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_export()
              }}
            >
              <FileUp data-icon="inline-start" />
              {t('glossary_page.action.export')}
            </Button>
          </div>
          <ActionBarSeparator />
          <Button
            variant="ghost"
            size="toolbar"
            disabled={props.statistics_running}
            onClick={() => {
              void props.on_statistics()
            }}
          >
            <Sigma data-icon="inline-start" />
            {t('glossary_page.action.statistics')}
          </Button>
          <ActionBarSeparator />
          <DropdownMenu
            open={props.preset_menu_open}
            onOpenChange={(next_open) => {
              props.on_preset_menu_open_change(next_open)
              if (next_open) {
                void props.on_open_preset_menu()
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="toolbar">
                <FolderOpen data-icon="inline-start" />
                {t('glossary_page.action.preset')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {props.preset_items.length > 0
                  ? props.preset_items.map((item) => (
                      <DropdownMenuItem
                        key={item.virtual_id}
                        onClick={() => {
                          void props.on_apply_preset(item.virtual_id)
                        }}
                      >
                        {item.name}
                      </DropdownMenuItem>
                    ))
                  : (
                      <DropdownMenuItem disabled>
                        {t('glossary_page.preset.empty')}
                      </DropdownMenuItem>
                    )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      hint={(
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="glossary-page__toggle-cluster">
              <span
                className="glossary-page__toggle-title"
                data-ui-text="emphasis"
              >
                {t('glossary_page.title')}
              </span>
              <BooleanSegmentedToggle
                aria_label={t('glossary_page.title')}
                value={props.enabled}
                on_value_change={(next_value) => {
                  void props.on_toggle_enabled(next_value)
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="glossary-page__toggle-tooltip"
          >
            <p>{t('glossary_page.toggle.tooltip')}</p>
          </TooltipContent>
        </Tooltip>
      )}
    />
  )
}
