import {
  FileDown,
  FileUp,
  Folder,
  FolderHeart,
  FolderOpen,
  Heart,
  HeartOff,
  PencilLine,
  Plus,
  Recycle,
  Save,
  Sigma,
  Trash2,
} from 'lucide-react'

import { useI18n, type LocaleKey } from '@/i18n'
import type { TextReplacementPresetItem } from '@/pages/text-replacement-page/types'
import { Button } from '@/shadcn/button'
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
} from '@/shadcn/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from '@/widgets/command-bar/command-bar'
import { SegmentedToggle } from '@/widgets/segmented-toggle/segmented-toggle'

type TextReplacementCommandBarProps = {
  title_key: LocaleKey
  enabled: boolean
  preset_items: TextReplacementPresetItem[]
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
  on_request_rename_preset: (preset_item: TextReplacementPresetItem) => void
  on_request_delete_preset: (preset_item: TextReplacementPresetItem) => void
  on_set_default_preset: (virtual_id: string) => Promise<void>
  on_cancel_default_preset: () => Promise<void>
  on_preset_menu_open_change: (next_open: boolean) => void
}

export function TextReplacementCommandBar(
  props: TextReplacementCommandBarProps,
): JSX.Element {
  const { t } = useI18n()
  const boolean_segmented_options = [
    {
      value: 'disabled',
      label: t('app.toggle.disabled'),
    },
    {
      value: 'enabled',
      label: t('app.toggle.enabled'),
    },
  ] as const
  const builtin_preset_items = props.preset_items.filter((item) => item.type === 'builtin')
  const user_preset_items = props.preset_items.filter((item) => item.type === 'user')
  const toggle_state_key = props.enabled ? 'app.toggle.enabled' : 'app.toggle.disabled'
  const toggle_tooltip_title = t('text_replacement_page.toggle.status').replace(
    '{TITLE}',
    t(props.title_key),
  ).replace(
    '{STATE}',
    t(toggle_state_key),
  )

  return (
    <CommandBar
      title={t(props.title_key)}
      actions={(
        <>
          <CommandBarGroup>
            <Button variant="ghost" size="toolbar" onClick={props.on_create}>
              <Plus data-icon="inline-start" />
              {t('text_replacement_page.action.create')}
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
              {t('text_replacement_page.action.delete')}
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
              {t('text_replacement_page.action.import')}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_export()
              }}
            >
              <FileUp data-icon="inline-start" />
              {t('text_replacement_page.action.export')}
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
            {t('text_replacement_page.action.statistics')}
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
                {t('text_replacement_page.action.preset')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={props.on_request_reset}>
                  <Recycle />
                  {t('app.action.reset')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={props.on_request_save_preset}>
                  <Save />
                  {t('text_replacement_page.preset.save')}
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
                              {t('text_replacement_page.preset.apply')}
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
                                    {t('text_replacement_page.preset.cancel_default')}
                                  </DropdownMenuItem>
                                )
                              : (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_set_default_preset(item.virtual_id)
                                    }}
                                  >
                                    <Heart />
                                    {t('text_replacement_page.preset.set_default')}
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
                              {t('text_replacement_page.preset.apply')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                props.on_request_rename_preset(item)
                              }}
                            >
                              <PencilLine />
                              {t('text_replacement_page.preset.rename')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                props.on_request_delete_preset(item)
                              }}
                            >
                              <Trash2 />
                              {t('text_replacement_page.preset.delete')}
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
                                    {t('text_replacement_page.preset.cancel_default')}
                                  </DropdownMenuItem>
                                )
                              : (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_set_default_preset(item.virtual_id)
                                    }}
                                  >
                                    <Heart />
                                    {t('text_replacement_page.preset.set_default')}
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
            <div className="text-replacement-page__toggle-cluster">
              <SegmentedToggle
                aria_label={t(props.title_key)}
                size="sm"
                value={props.enabled ? 'enabled' : 'disabled'}
                options={boolean_segmented_options}
                on_value_change={(next_value) => {
                  void props.on_toggle_enabled(
                    next_value === 'enabled',
                  )
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="text-replacement-page__toggle-tooltip"
          >
            <div className="text-replacement-page__toggle-tooltip-copy">
              <p
                className="text-replacement-page__toggle-tooltip-title text-background"
                data-ui-text="emphasis"
              >
                {toggle_tooltip_title}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    />
  )
}

