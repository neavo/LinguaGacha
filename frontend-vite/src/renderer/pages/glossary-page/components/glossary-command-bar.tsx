import {
  Heart,
  HeartOff,
  FileDown,
  FileUp,
  Folder,
  FolderHeart,
  FolderOpen,
  Plus,
  Recycle,
  Save,
  Sigma,
  PencilLine,
  Trash2,
} from 'lucide-react'

import { useI18n } from '@/i18n'
import type { GlossaryPresetItem } from '@/pages/glossary-page/types'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from '@/widgets/command-bar/command-bar'

type GlossaryCommandBarProps = {
  enabled: boolean
  preset_items: GlossaryPresetItem[]
  preset_menu_open: boolean
  selected_entry_count: number
  statistics_running: boolean
  on_toggle_enabled: (next_value: boolean) => Promise<void>
  on_create: () => void
  on_delete_selected: () => Promise<void>
  on_import: () => Promise<void>
  on_export: () => Promise<void>
  on_statistics: () => Promise<void>
  on_open_preset_menu: () => Promise<void>
  on_apply_preset: (virtual_id: string) => Promise<void>
  on_request_reset: () => void
  on_request_save_preset: () => void
  on_request_rename_preset: (preset_item: GlossaryPresetItem) => void
  on_request_delete_preset: (preset_item: GlossaryPresetItem) => void
  on_set_default_preset: (virtual_id: string) => Promise<void>
  on_cancel_default_preset: () => Promise<void>
  on_preset_menu_open_change: (next_open: boolean) => void
}

export function GlossaryCommandBar(
  props: GlossaryCommandBarProps,
): JSX.Element {
  const { t } = useI18n()
  const builtin_preset_items = props.preset_items.filter((item) => item.type === 'builtin')
  const user_preset_items = props.preset_items.filter((item) => item.type === 'user')
  const toggle_state_key = props.enabled ? 'app.toggle.enabled' : 'app.toggle.disabled'
  const toggle_tooltip_title = t('glossary_page.toggle.status').replace(
    '{TITLE}',
    t('glossary_page.title'),
  ).replace(
    '{STATE}',
    t(toggle_state_key),
  )

  return (
    <CommandBar
      title={t('glossary_page.title')}
      description={t('glossary_page.summary')}
      actions={(
        <>
          <CommandBarGroup>
            <Button variant="ghost" size="toolbar" onClick={props.on_create}>
              <Plus data-icon="inline-start" />
              {t('glossary_page.action.create')}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={props.selected_entry_count === 0}
              onClick={() => {
                void props.on_delete_selected()
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t('glossary_page.action.delete')}
            </Button>
          </CommandBarGroup>
          <CommandBarSeparator />
          <CommandBarGroup>
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
          </CommandBarGroup>
          <CommandBarSeparator />
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
          <CommandBarSeparator />
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
                <DropdownMenuItem
                  onSelect={() => {
                    props.on_request_reset()
                  }}
                >
                  <Recycle />
                  {t('app.action.reset')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    props.on_request_save_preset()
                  }}
                >
                  <Save />
                  {t('glossary_page.preset.save')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {(builtin_preset_items.length > 0 || user_preset_items.length > 0)
                ? <DropdownMenuSeparator />
                : null}
              {builtin_preset_items.length > 0
                ? (
                    <DropdownMenuGroup>
                      {builtin_preset_items.map((item) => (
                        <DropdownMenuSub key={item.virtual_id}>
                          <DropdownMenuSubTrigger>
                            {item.is_default ? <FolderHeart /> : <Folder />}
                            {item.name}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                void props.on_apply_preset(item.virtual_id)
                              }}
                            >
                              <FileDown />
                              {t('glossary_page.preset.apply')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {item.is_default
                              ? (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_cancel_default_preset()
                                    }}
                                  >
                                    <HeartOff />
                                    {t('glossary_page.preset.cancel_default')}
                                  </DropdownMenuItem>
                                )
                              : (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_set_default_preset(item.virtual_id)
                                    }}
                                  >
                                    <Heart />
                                    {t('glossary_page.preset.set_default')}
                                  </DropdownMenuItem>
                                )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ))}
                    </DropdownMenuGroup>
                  )
                : null}
              {builtin_preset_items.length > 0 && user_preset_items.length > 0
                ? <DropdownMenuSeparator />
                : null}
              {user_preset_items.length > 0
                ? (
                    <DropdownMenuGroup>
                      {user_preset_items.map((item) => (
                        <DropdownMenuSub key={item.virtual_id}>
                          <DropdownMenuSubTrigger>
                            {item.is_default ? <FolderHeart /> : <Folder />}
                            {item.name}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                void props.on_apply_preset(item.virtual_id)
                              }}
                            >
                              <FileDown />
                              {t('glossary_page.preset.apply')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                props.on_request_rename_preset(item)
                              }}
                            >
                              <PencilLine />
                              {t('glossary_page.preset.rename')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                props.on_request_delete_preset(item)
                              }}
                            >
                              <Trash2 />
                              {t('glossary_page.preset.delete')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {item.is_default
                              ? (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_cancel_default_preset()
                                    }}
                                  >
                                    <HeartOff />
                                    {t('glossary_page.preset.cancel_default')}
                                  </DropdownMenuItem>
                                )
                              : (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_set_default_preset(item.virtual_id)
                                    }}
                                  >
                                    <Heart />
                                    {t('glossary_page.preset.set_default')}
                                  </DropdownMenuItem>
                                )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ))}
                    </DropdownMenuGroup>
                  )
                : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      hint={(
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="glossary-page__toggle-cluster">
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
            <div className="glossary-page__toggle-tooltip-copy">
              <p
                className="glossary-page__toggle-tooltip-title"
                data-ui-text="emphasis"
              >
                {toggle_tooltip_title}
              </p>
              <p>{t('glossary_page.toggle.tooltip')}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    />
  )
}
