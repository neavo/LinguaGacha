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
import type {
  TextPreserveMode,
  TextPreservePresetItem,
} from '@/pages/text-preserve-page/types'
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
import {
  SegmentedToggle,
  type SegmentedToggleOption,
} from '@/widgets/segmented-toggle/segmented-toggle'

type TextPreserveCommandBarProps = {
  title_key: LocaleKey
  summary_key: LocaleKey
  mode: TextPreserveMode
  preset_items: TextPreservePresetItem[]
  preset_menu_open: boolean
  selected_entry_count: number
  statistics_running: boolean
  on_mode_change: (next_mode: TextPreserveMode) => Promise<void>
  on_create: () => void
  on_delete_selected: () => Promise<void>
  on_import: () => Promise<void>
  on_export: () => Promise<void>
  on_statistics: () => Promise<void>
  on_open_preset_menu: () => Promise<void>
  on_apply_preset: (virtual_id: string) => Promise<void>
  on_request_reset: () => void
  on_request_save_preset: () => void
  on_request_rename_preset: (preset_item: TextPreservePresetItem) => void
  on_request_delete_preset: (preset_item: TextPreservePresetItem) => void
  on_set_default_preset: (virtual_id: string) => Promise<void>
  on_cancel_default_preset: () => Promise<void>
  on_preset_menu_open_change: (next_open: boolean) => void
}

const MODE_LABEL_KEY_BY_MODE: Record<TextPreserveMode, LocaleKey> = {
  off: 'text_preserve_page.mode.options.off',
  smart: 'text_preserve_page.mode.options.smart',
  custom: 'text_preserve_page.mode.options.custom',
}

export function TextPreserveCommandBar(
  props: TextPreserveCommandBarProps,
): JSX.Element {
  const { t } = useI18n()
  const mode_options: readonly SegmentedToggleOption<TextPreserveMode>[] = [
    {
      value: 'off',
      label: t('text_preserve_page.mode.options.off'),
    },
    {
      value: 'smart',
      label: t('text_preserve_page.mode.options.smart'),
    },
    {
      value: 'custom',
      label: t('text_preserve_page.mode.options.custom'),
    },
  ]
  const builtin_preset_items = props.preset_items.filter((item) => item.type === 'builtin')
  const user_preset_items = props.preset_items.filter((item) => item.type === 'user')
  const mode_tooltip_title = t('text_preserve_page.mode.status')
    .replace('{TITLE}', t('text_preserve_page.mode.label'))
    .replace('{STATE}', t(MODE_LABEL_KEY_BY_MODE[props.mode]))

  return (
    <CommandBar
      title={t(props.title_key)}
      description={t(props.summary_key)}
      actions={(
        <>
          <CommandBarGroup>
            <Button variant="ghost" size="toolbar" onClick={props.on_create}>
              <Plus data-icon="inline-start" />
              {t('text_preserve_page.action.create')}
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
              {t('text_preserve_page.action.delete')}
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
              {t('text_preserve_page.action.import')}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_export()
              }}
            >
              <FileUp data-icon="inline-start" />
              {t('text_preserve_page.action.export')}
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
            {t('text_preserve_page.action.statistics')}
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
                {t('text_preserve_page.action.preset')}
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
                  {t('text_preserve_page.preset.save')}
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
                              {t('text_preserve_page.preset.apply')}
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
                                    {t('text_preserve_page.preset.cancel_default')}
                                  </DropdownMenuItem>
                                )
                              : (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_set_default_preset(item.virtual_id)
                                    }}
                                  >
                                    <Heart />
                                    {t('text_preserve_page.preset.set_default')}
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
                              {t('text_preserve_page.preset.apply')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                props.on_request_rename_preset(item)
                              }}
                            >
                              <PencilLine />
                              {t('text_preserve_page.preset.rename')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                props.on_request_delete_preset(item)
                              }}
                            >
                              <Trash2 />
                              {t('text_preserve_page.preset.delete')}
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
                                    {t('text_preserve_page.preset.cancel_default')}
                                  </DropdownMenuItem>
                                )
                              : (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void props.on_set_default_preset(item.virtual_id)
                                    }}
                                  >
                                    <Heart />
                                    {t('text_preserve_page.preset.set_default')}
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
            <div className="text-preserve-page__mode-cluster">
              <SegmentedToggle
                aria_label={t('text_preserve_page.mode.label')}
                className="text-preserve-page__mode-toggle"
                item_class_name="text-preserve-page__mode-toggle-item"
                size="sm"
                value={props.mode}
                options={mode_options}
                on_value_change={(next_value) => {
                  void props.on_mode_change(next_value)
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="text-preserve-page__mode-tooltip"
          >
            <div className="text-preserve-page__mode-tooltip-copy">
              <p
                className="text-preserve-page__mode-tooltip-title text-background"
                data-ui-text="emphasis"
              >
                {mode_tooltip_title}
              </p>
              <div
                className="text-preserve-page__mode-tooltip-html text-background/90"
                dangerouslySetInnerHTML={{
                  __html: t('text_preserve_page.mode.content_html'),
                }}
              />
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    />
  )
}

