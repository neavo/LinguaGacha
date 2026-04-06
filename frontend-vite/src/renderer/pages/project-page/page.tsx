import { AlertTriangle, BadgeAlert, File, FolderOpen, ShieldAlert, SquareMousePointer, X } from 'lucide-react'
import { forwardRef, type ComponentProps, type DragEvent, type MouseEvent, type MouseEventHandler, useState } from 'react'

import {
  type ProjectSnapshot,
} from '@/app/state/desktop-runtime-context'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/ui/card'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/context-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Progress } from '@/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import '@/pages/project-page/project-page.css'
import { PROJECT_FORMAT_SUPPORT_ITEMS } from '@/pages/project-page/support-formats'
import { DesktopApiError, api_fetch } from '@/app/desktop-api'

type ProjectPageProps = {
  is_sidebar_collapsed: boolean
}

type ProjectPreviewStats = {
  file_count: number
  created_at: string
  last_updated_at: string
  progress_percent: number
  translated_items: number
  total_items: number
}

type SelectedProject = {
  path: string
  name: string
  preview: ProjectPreviewStats | null
}

type SelectedSource = {
  path: string
  name: string
  source_file_count: number
}

type MissingRecentProjectState = {
  path: string
  name: string
} | null

type ProjectPreviewPayload = {
  preview?: {
    path?: string
    name?: string
    file_count?: number
    created_at?: string
    updated_at?: string
    total_items?: number
    translated_items?: number
    progress?: number
  }
}

type ProjectSourceFilesPayload = {
  source_files?: string[]
}

type ProjectSnapshotPayload = {
  project?: {
    path?: string
    loaded?: boolean
  }
}

type SettingsPayload = {
  settings?: {
    expert_mode?: boolean
    project_save_mode?: string
    project_fixed_path?: string
    recent_projects?: Array<{
      path?: string
      name?: string
    }>
  }
}

type PanelHeaderProps = {
  accent_class_name: string
  title: string
  subtitle: string
}

type DropZoneCardProps = Omit<ComponentProps<'button'>, 'title' | 'onClick' | 'onDragOver' | 'onDrop'> & {
  icon: 'source' | 'project'
  title: string
  tone: 'blue' | 'purple'
  disabled?: boolean
  on_click?: MouseEventHandler<HTMLButtonElement>
  on_drag_over?: (event: DragEvent<HTMLButtonElement>) => void
  on_drop?: (event: DragEvent<HTMLButtonElement>) => void
}

type FormatSupportCardProps = {
  title: string
  extensions: string
}

type RecentProjectRowProps = {
  name: string
  path: string
  on_select: () => void
  on_remove: () => void
  remove_aria_label: string
}

type ProjectPreviewPanelProps = {
  project: SelectedProject
}

type DroppedPathResult = {
  path: string | null
  has_multiple_paths: boolean
}

function extract_file_name(file_path: string): string {
  const normalized_segments = file_path.split(/[\\/]+/u)
  return normalized_segments.at(-1) ?? file_path
}

function extract_stem(file_name: string): string {
  return file_name.replace(/\.[^.]+$/u, '')
}

function extract_parent_dir(file_path: string): string {
  const normalized_index = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'))
  if (normalized_index <= 0) {
    return ''
  }

  return file_path.slice(0, normalized_index)
}

function join_path(directory_path: string, file_name: string): string {
  if (directory_path === '') {
    return file_name
  }

  const path_separator = directory_path.includes('\\') ? '\\' : '/'
  const normalized_directory = directory_path.replace(/[\\/]+$/u, '')
  return `${normalized_directory}${path_separator}${file_name}`
}

function build_timestamp_suffix(): string {
  const now = new Date()
  const year = now.getFullYear().toString().padStart(4, '0')
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  const hour = now.getHours().toString().padStart(2, '0')
  const minute = now.getMinutes().toString().padStart(2, '0')
  const second = now.getSeconds().toString().padStart(2, '0')
  return `${year}${month}${day}_${hour}${minute}${second}`
}

function build_default_project_file_name(source_path: string): string {
  const file_name = extract_file_name(source_path)
  const has_extension = file_name.lastIndexOf('.') > 0
  const base_name = has_extension ? extract_stem(file_name) : file_name
  return `${base_name}_${build_timestamp_suffix()}.lg`
}

function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  return {
    path: String(payload.project?.path ?? ''),
    loaded: Boolean(payload.project?.loaded),
  }
}

function normalize_project_preview(project_path: string, fallback_name: string, payload: ProjectPreviewPayload): SelectedProject {
  const preview = payload.preview ?? {}
  const resolved_name = String(preview.name ?? fallback_name)

  return {
    path: project_path,
    name: resolved_name,
    preview: {
      file_count: Number(preview.file_count ?? 0),
      created_at: String(preview.created_at ?? ''),
      last_updated_at: String(preview.updated_at ?? ''),
      progress_percent: Math.round(Number(preview.progress ?? 0) * 100),
      translated_items: Number(preview.translated_items ?? 0),
      total_items: Number(preview.total_items ?? 0),
    },
  }
}

function normalize_dropped_file_uri_path(file_uri: string): string | null {
  try {
    const normalized_url = new URL(file_uri)
    if (normalized_url.protocol !== 'file:') {
      return null
    }

    let normalized_path = decodeURIComponent(normalized_url.pathname)
    if (/^\/[A-Za-z]:\//u.test(normalized_path)) {
      normalized_path = normalized_path.slice(1)
    }

    if (/^[A-Za-z]:\//u.test(normalized_path)) {
      normalized_path = normalized_path.split('/').join('\\')
    }

    return normalized_path
  } catch {
    return null
  }
}

function resolve_dropped_path(data_transfer: DataTransfer): DroppedPathResult {
  const dropped_files = Array.from(data_transfer.files)
  if (dropped_files.length > 1) {
    return {
      path: null,
      has_multiple_paths: true,
    }
  }

  const dropped_file = dropped_files[0] as (File & { path?: string }) | undefined
  if (dropped_file !== undefined && typeof dropped_file.path === 'string' && dropped_file.path !== '') {
    return {
      path: dropped_file.path,
      has_multiple_paths: false,
    }
  }

  const raw_uri_list = data_transfer.getData('text/uri-list')
  const normalized_uri_list = raw_uri_list
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

  if (normalized_uri_list.length > 1) {
    return {
      path: null,
      has_multiple_paths: true,
    }
  }

  const normalized_path = normalized_uri_list.length === 1
    ? normalize_dropped_file_uri_path(normalized_uri_list[0])
    : null

  return {
    path: normalized_path,
    has_multiple_paths: false,
  }
}

function open_context_menu_at_click_position(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    button: 2,
    buttons: 2,
    view: window,
  }))
}

function PanelHeader(props: PanelHeaderProps): JSX.Element {
  return (
    <CardHeader>
      <div className="flex items-start gap-3">
        <span className={cn('project-home__section-rail', props.accent_class_name)} aria-hidden="true" />
        <div className="space-y-2">
          <CardTitle className="text-[clamp(1.62rem,1.48rem+0.34vw,1.92rem)] leading-[1.08] tracking-[-0.028em]">
            {props.title}
          </CardTitle>
          <CardDescription className="max-w-[520px] text-[0.8rem] leading-[1.45] text-[color:var(--project-home-subtitle)]">
            {props.subtitle}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  )
}

const DropZoneCard = forwardRef<HTMLButtonElement, DropZoneCardProps>(function DropZoneCard(props, ref): JSX.Element {
  const {
    icon,
    title,
    tone,
    disabled,
    on_click,
    on_drag_over,
    on_drop,
    className,
    ...button_props
  } = props
  // 让创建与打开入口保留不同图标语义，避免 props 只传不消费导致 lint 失败。
  const Icon = icon === 'source' ? File : FolderOpen

  return (
    <button
      ref={ref}
      {...button_props}
      className={cn(
        'project-home__dropzone flex w-full flex-col items-center justify-center text-center',
        tone === 'blue' ? 'project-home__dropzone--blue' : 'project-home__dropzone--purple',
        'h-[145px] px-5 py-4',
        className,
      )}
      type="button"
      disabled={disabled}
      onClick={on_click}
      onDragOver={on_drag_over}
      onDrop={on_drop}
    >
      <span className="project-home__dropzone-icon">
        <Icon className="size-11 stroke-[1.8]" />
      </span>
      <p className="mt-2.5 text-[0.96rem] tracking-[-0.018em] text-foreground" data-ui-text="emphasis">
        {title}
      </p>
    </button>
  )
})

function FormatSupportCard(props: FormatSupportCardProps): JSX.Element {
  return (
    <Card className="project-home__format-card">
      <CardContent className="space-y-0.5 px-3 py-3">
        <h3 className="text-[0.78rem] leading-[1.35] tracking-[-0.015em] text-foreground" data-ui-text="emphasis">{props.title}</h3>
        <p className="text-[0.72rem] leading-[1.35] text-[color:var(--project-home-muted)]">{props.extensions}</p>
      </CardContent>
    </Card>
  )
}

function RecentProjectRow(props: RecentProjectRowProps): JSX.Element {
  function handle_remove_click(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    props.on_remove()
  }

  return (
    <div className="project-home__recent-row">
      <button className="project-home__recent-main" type="button" onClick={props.on_select}>
        <span className="project-home__recent-icon">
          <File className="size-[18px] stroke-[1.8]" />
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[0.76rem] tracking-[-0.012em] text-foreground" data-ui-text="emphasis">{props.name}</span>
              <span className="mt-0.5 block truncate text-[0.66rem] text-[color:var(--project-home-muted)]">
                {props.path}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" sideOffset={8} className="max-w-[32rem] break-all">
            {props.path}
          </TooltipContent>
        </Tooltip>
      </button>

      <Button
        variant="ghost"
        size="icon-sm"
        className="project-home__recent-remove h-7 w-7 p-0"
        onClick={handle_remove_click}
        aria-label={props.remove_aria_label}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

function RecentProjectEmptyState(): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="project-home__recent-empty">
      <BadgeAlert className="project-home__recent-empty-icon size-16 stroke-[1.9]" />
      <p className="project-home__recent-empty-text">{t('project_page.open.empty')}</p>
    </div>
  )
}

function ProjectPreviewPanel(props: ProjectPreviewPanelProps): JSX.Element {
  const { t } = useI18n()
  const preview = props.project.preview
  if (preview === null) {
    return <></>
  }

  const stats = [
    {
      label: t('project_page.preview.file_count'),
      value: preview.file_count.toLocaleString(),
    },
    {
      label: t('project_page.preview.created_at'),
      value: preview.created_at,
    },
    {
      label: t('project_page.preview.updated_at'),
      value: preview.last_updated_at,
    },
  ]

  return (
    <Card className="project-home__preview-card">
      <CardContent className="space-y-3 px-4 py-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center justify-between gap-5">
            <span className="text-[0.77rem] text-foreground">{stat.label}</span>
            <span className="text-[0.77rem] text-foreground">{stat.value}</span>
          </div>
        ))}

        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[0.77rem] text-foreground">{t('project_page.preview.progress')}</span>
            <span className="text-[0.77rem] text-foreground">{preview.progress_percent}%</span>
          </div>
          <Progress
            value={preview.progress_percent}
            className="h-1.5 bg-muted"
          />
          <div className="flex items-center justify-between gap-4 text-[0.77rem] text-foreground">
            <span>
              {t('project_page.preview.translated')} {preview.translated_items.toLocaleString()}{' '}
              {t('project_page.preview.rows_unit')}
            </span>
            <span>
              {t('project_page.preview.total')} {preview.total_items.toLocaleString()}{' '}
              {t('project_page.preview.rows_unit')}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProjectPage(props: ProjectPageProps): JSX.Element {
  const {
    settings_snapshot,
    set_project_snapshot,
    refresh_settings,
    refresh_task,
  } = useDesktopRuntime()
  const { push_progress_toast, push_toast, dismiss_toast } = useDesktopToast()
  const { t } = useI18n()
  const [selected_source, set_selected_source] = useState<SelectedSource | null>(null)
  const [selected_project, set_selected_project] = useState<SelectedProject | null>(null)
  const [is_source_checking, set_is_source_checking] = useState(false)
  const [is_preview_loading, set_is_preview_loading] = useState(false)
  const [is_creating_project, set_is_creating_project] = useState(false)
  const [is_opening_project, set_is_opening_project] = useState(false)
  const [missing_recent_project, set_missing_recent_project] = useState<MissingRecentProjectState>(null)
  const recent_projects = settings_snapshot.recent_projects.slice(0, 5)
  const has_recent_projects = recent_projects.length > 0
  const create_footer_class_name = 'project-home__footer mt-auto justify-center pt-4'
  const open_footer_class_name = cn('project-home__footer mt-auto justify-center', selected_project === null ? 'pt-4' : 'pt-6')

  function clear_selected_project(): void {
    set_selected_project(null)
  }

  function clear_selected_source(): void {
    set_selected_source(null)
  }

  async function refresh_recent_projects(): Promise<void> {
    await refresh_settings()
  }

  async function select_project_path(project_path: string, recent_project_name?: string): Promise<void> {
    const fallback_name = recent_project_name === undefined || recent_project_name === ''
      ? extract_stem(extract_file_name(project_path))
      : recent_project_name

    set_is_preview_loading(true)
    set_selected_project({
      path: project_path,
      name: fallback_name,
      preview: null,
    })

    try {
      const payload = await api_fetch<ProjectPreviewPayload>('/api/project/preview', { path: project_path })
      set_selected_project(normalize_project_preview(project_path, fallback_name, payload))
    } catch (error) {
      if (recent_project_name !== undefined && error instanceof DesktopApiError && error.code === 'not_found') {
        set_missing_recent_project({
          path: project_path,
          name: fallback_name,
        })
      } else {
        push_toast('warning', t('project_page.open.preview_unavailable'))
      }

      set_selected_project(null)
    } finally {
      set_is_preview_loading(false)
    }
  }

  async function handle_select_source_path(source_path: string): Promise<void> {
    set_is_source_checking(true)

    try {
      const payload = await api_fetch<ProjectSourceFilesPayload>('/api/project/source-files', { path: source_path })
      const source_files = Array.isArray(payload.source_files) ? payload.source_files : []

      if (source_files.length === 0) {
        set_selected_source(null)
        push_toast('warning', t('project_page.create.unavailable'))
      } else {
        set_selected_source({
          path: source_path,
          name: extract_file_name(source_path),
          source_file_count: source_files.length,
        })
      }
    } catch {
      set_selected_source(null)
      push_toast('warning', t('project_page.create.unavailable'))
    } finally {
      set_is_source_checking(false)
    }
  }

  async function handle_select_source_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceFilePath()
    if (result.canceled || result.path === null) {
      return
    }

    await handle_select_source_path(result.path)
  }

  async function handle_select_source_folder(): Promise<void> {
    const result = await window.desktopApp.pickProjectSourceDirectoryPath()
    if (result.canceled || result.path === null) {
      return
    }

    await handle_select_source_path(result.path)
  }

  async function handle_select_project_file(): Promise<void> {
    const result = await window.desktopApp.pickProjectFilePath()
    if (result.canceled || result.path === null) {
      return
    }

    await select_project_path(result.path)
  }

  function handle_drop_over(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  async function handle_source_drop(event: DragEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault()

    const dropped_path = resolve_dropped_path(event.dataTransfer)
    if (dropped_path.has_multiple_paths) {
      push_toast('warning', t('project_page.drop_multiple_unavailable'))
      return
    }
    if (dropped_path.path === null || dropped_path.path === '') {
      return
    }

    await handle_select_source_path(dropped_path.path)
  }

  async function handle_project_drop(event: DragEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault()

    const dropped_path = resolve_dropped_path(event.dataTransfer)
    if (dropped_path.has_multiple_paths) {
      push_toast('warning', t('project_page.drop_multiple_unavailable'))
      return
    }
    if (dropped_path.path === null || dropped_path.path === '') {
      return
    }

    await select_project_path(dropped_path.path)
  }

  async function resolve_project_output_path(source_path: string): Promise<string | null> {
    const default_file_name = build_default_project_file_name(source_path)
    const save_mode = settings_snapshot.project_save_mode

    if (save_mode === 'MANUAL') {
      const result = await window.desktopApp.pickProjectSavePath(default_file_name)
      return result.canceled ? null : result.path
    }

    if (save_mode === 'SOURCE') {
      const parent_dir = extract_parent_dir(source_path)
      return join_path(parent_dir, default_file_name)
    }

    let fixed_directory = settings_snapshot.project_fixed_path
    if (fixed_directory === '') {
      const result = await window.desktopApp.pickFixedProjectDirectory()
      if (result.canceled || result.path === null) {
        return null
      }

      fixed_directory = result.path
      await api_fetch<SettingsPayload>('/api/settings/update', {
        project_fixed_path: fixed_directory,
      })
      await refresh_recent_projects()
    }

    return join_path(fixed_directory, default_file_name)
  }

  async function handle_create_project(): Promise<void> {
    if (selected_source === null || is_creating_project) {
      return
    }

    set_is_creating_project(true)
    let progress_toast_id: string | number | null = null

    try {
      const output_path = await resolve_project_output_path(selected_source.path)
      if (output_path === null || output_path === '') {
        return
      }
      const normalized_output_path = output_path.endsWith('.lg') ? output_path : `${output_path}.lg`
      // 创建工程会阻塞用户继续点击入口，用不定进度通知明确告知“正在处理”。
      progress_toast_id = push_progress_toast({
        message: t('project_page.create.loading_toast'),
      })

      const payload = await api_fetch<ProjectSnapshotPayload>('/api/project/create', {
        source_path: selected_source.path,
        path: normalized_output_path,
      })
      set_project_snapshot(normalize_project_snapshot(payload))
      await api_fetch<SettingsPayload>('/api/settings/recent-projects/add', {
        path: normalized_output_path,
        name: extract_stem(extract_file_name(normalized_output_path)),
      })
      await Promise.all([refresh_recent_projects(), refresh_task()])
      clear_selected_source()
      clear_selected_project()
    } catch (error) {
      push_toast('error', error instanceof Error ? error.message : t('project_page.create.unavailable'))
      return
    } finally {
      if (progress_toast_id !== null) {
        dismiss_toast(progress_toast_id)
      }
      set_is_creating_project(false)
    }
  }

  async function handle_open_project(): Promise<void> {
    if (selected_project === null || selected_project.preview === null || is_opening_project) {
      return
    }

    set_is_opening_project(true)
    const progress_toast_id = push_progress_toast({
      message: t('project_page.open.loading_toast'),
    })

    try {
      const payload = await api_fetch<ProjectSnapshotPayload>('/api/project/load', {
        path: selected_project.path,
      })
      set_project_snapshot(normalize_project_snapshot(payload))
      await api_fetch<SettingsPayload>('/api/settings/recent-projects/add', {
        path: selected_project.path,
        name: selected_project.name,
      })
      await Promise.all([refresh_recent_projects(), refresh_task()])
    } catch (error) {
      push_toast('error', error instanceof Error ? error.message : t('project_page.open.preview_unavailable'))
      return
    } finally {
      dismiss_toast(progress_toast_id)
      set_is_opening_project(false)
    }
  }

  async function handle_recent_project_select(project_path: string, project_name: string): Promise<void> {
    await select_project_path(project_path, project_name)
  }

  async function handle_recent_project_remove(project_path: string): Promise<void> {
    try {
      await api_fetch<SettingsPayload>('/api/settings/recent-projects/remove', {
        path: project_path,
      })
      await refresh_recent_projects()
    } catch (error) {
      push_toast('error', error instanceof Error ? error.message : t('project_page.open.remove_unavailable'))
    }
  }

  const source_dropzone = selected_source === null
    ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <DropZoneCard
              icon="source"
              tone="blue"
              title={t('project_page.create.drop_title')}
              disabled={is_source_checking || is_creating_project}
              on_click={open_context_menu_at_click_position}
              on_drag_over={handle_drop_over}
              on_drop={(event) => {
                void handle_source_drop(event)
              }}
            />
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            <ContextMenuItem
              onSelect={() => {
                void handle_select_source_file()
              }}
            >
              <File className="size-4" />
              {t('app.action.select_file')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void handle_select_source_folder()
              }}
            >
              <FolderOpen className="size-4" />
              {t('app.action.select_folder')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    : (
        <div className="project-home__selected-card project-home__selected-card--blue relative">
          <Button
            variant="ghost"
            size="icon-sm"
            className="project-home__selected-close h-[30px] w-[30px] p-0"
            onClick={clear_selected_source}
            aria-label={t('app.action.reset')}
          >
            <X className="size-4" />
          </Button>

          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                className="project-home__selected-content w-full"
                type="button"
                onClick={open_context_menu_at_click_position}
                onDragOver={handle_drop_over}
                onDrop={(event) => {
                  void handle_source_drop(event)
                }}
              >
                <span className="project-home__dropzone-icon">
                  <SquareMousePointer className="size-11 stroke-[1.85]" />
                </span>
                <div className="mx-auto flex w-full max-w-[18rem] flex-col items-center space-y-0.5 text-center">
                  <p className="w-full truncate text-[0.9rem] tracking-[-0.02em] text-foreground" data-ui-text="emphasis">
                    {selected_source.name}
                  </p>
                  <p className="w-full text-[0.76rem] text-[color:var(--project-home-subtitle)]">
                    {t('project_page.create.ready_status').replace('{COUNT}', selected_source.source_file_count.toString())}
                  </p>
                </div>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-40">
              <ContextMenuItem
                onSelect={() => {
                  void handle_select_source_file()
                }}
              >
                <File className="size-4" />
                {t('app.action.select_file')}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void handle_select_source_folder()
                }}
              >
                <FolderOpen className="size-4" />
                {t('app.action.select_folder')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      )

  const open_dropzone = selected_project === null
    ? (
        <DropZoneCard
          icon="project"
          tone="purple"
          title={t('project_page.open.drop_title')}
          disabled={is_preview_loading || is_opening_project}
          on_click={() => {
            void handle_select_project_file()
          }}
          on_drag_over={handle_drop_over}
          on_drop={(event) => {
            void handle_project_drop(event)
          }}
        />
      )
    : (
        <div className="project-home__selected-card project-home__selected-card--purple relative">
          <Button
            variant="ghost"
            size="icon-sm"
            className="project-home__selected-close h-[30px] w-[30px] p-0"
            onClick={clear_selected_project}
            aria-label={t('app.action.reset')}
          >
            <X className="size-4" />
          </Button>

          <button
            className="project-home__selected-content w-full"
            type="button"
            onClick={() => {
              void handle_select_project_file()
            }}
            onDragOver={handle_drop_over}
            onDrop={(event) => {
              void handle_project_drop(event)
            }}
          >
            <span className="project-home__dropzone-icon">
              <SquareMousePointer className="size-11 stroke-[1.85]" />
            </span>
            <div className="mx-auto flex w-full max-w-[18rem] flex-col items-center space-y-0.5 text-center">
              <p className="w-full truncate text-[0.9rem] tracking-[-0.02em] text-foreground" data-ui-text="emphasis">
                {extract_file_name(selected_project.path)}
              </p>
              <p className="w-full text-[0.76rem] text-[color:var(--project-home-subtitle)]">
                {t('project_page.open.ready_status')}
              </p>
            </div>
          </button>
        </div>
      )

  const recent_project_content = selected_project === null
    ? has_recent_projects
      ? (
          <div className="space-y-1">
            {recent_projects.map((project_item) => (
              <RecentProjectRow
                key={project_item.path}
                name={project_item.name}
                path={project_item.path}
                on_select={() => {
                  void handle_recent_project_select(project_item.path, project_item.name)
                }}
                on_remove={() => {
                  void handle_recent_project_remove(project_item.path)
                }}
                remove_aria_label={t('project_page.open.remove_recent_project')}
              />
            ))}
          </div>
        )
      : <RecentProjectEmptyState />
    : is_preview_loading
      ? (
          <Empty variant="inset" className="project-home__empty-state">
            <EmptyHeader>
              <EmptyMedia>
                <ShieldAlert className="size-7 stroke-[1.8]" />
              </EmptyMedia>
              <EmptyTitle>{selected_project.name}</EmptyTitle>
              <EmptyDescription>{t('project_page.open.preview_loading')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      : selected_project.preview !== null
        ? <ProjectPreviewPanel project={selected_project} />
        : (
            <Empty variant="inset" className="project-home__empty-state">
              <EmptyHeader>
                <EmptyMedia>
                  <ShieldAlert className="size-7 stroke-[1.8]" />
                </EmptyMedia>
                <EmptyTitle>{selected_project.name}</EmptyTitle>
                <EmptyDescription>{t('project_page.open.preview_unavailable')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )

  return (
    <>
      <AlertDialog
        open={missing_recent_project !== null}
        onOpenChange={(next_open) => {
          if (!next_open) {
            set_missing_recent_project(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('project_page.open.missing_file_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('project_page.open.missing_file_description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('app.action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target_path = missing_recent_project?.path
                if (target_path === undefined) {
                  return
                }

                void (async () => {
                  await api_fetch<SettingsPayload>('/api/settings/recent-projects/remove', {
                    path: target_path,
                  })
                  await refresh_recent_projects()
                  set_missing_recent_project(null)
                })()
              }}
            >
              {t('project_page.open.missing_file_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        className="project-home page-shell page-shell--full"
        data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
      >
        <div className="project-home__layout grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          <Card variant="panel" className="project-home__panel">
          <PanelHeader
            accent_class_name="bg-[color:var(--project-home-blue)]"
            title={t('project_page.create.title')}
            subtitle={t('project_page.create.subtitle')}
          />

          <CardContent className="flex flex-1 flex-col gap-6 pt-0">
            {source_dropzone}

            <section className="space-y-4 pt-4">
              <h3 className="text-[1rem] leading-none tracking-[-0.02em] text-foreground" data-ui-text="emphasis">
                {t('project_page.formats.title')}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {PROJECT_FORMAT_SUPPORT_ITEMS.map((format_item) => (
                  <FormatSupportCard
                    key={format_item.id}
                    title={t(format_item.title_key)}
                    extensions={format_item.extensions}
                  />
                ))}
              </div>
            </section>
          </CardContent>

          <CardFooter className={create_footer_class_name}>
            <Button
              variant="brand"
              size="lg"
              className="project-home__action min-w-[160px]"
              disabled={selected_source === null || is_source_checking || is_creating_project}
              onClick={() => {
                void handle_create_project()
              }}
            >
              {is_creating_project ? t('app.action.loading') : t('project_page.create.action')}
            </Button>
          </CardFooter>
          </Card>

          <Card variant="panel" className="project-home__panel">
            <PanelHeader
              accent_class_name="bg-[color:var(--project-home-purple)]"
              title={t('project_page.open.title')}
              subtitle={t('project_page.open.subtitle')}
            />

            <CardContent className="flex flex-1 flex-col gap-6 pt-0">
              {open_dropzone}

              <section className="space-y-4 pt-4">
                <h3 className="text-[1rem] leading-none tracking-[-0.02em] text-foreground" data-ui-text="emphasis">
                  {t('project_page.open.recent_title')}
                </h3>

                <div>
                  {recent_project_content}
                </div>
              </section>
            </CardContent>

            <CardFooter className={open_footer_class_name}>
              <Button
                variant="brand"
                size="lg"
                className="project-home__action min-w-[160px]"
                disabled={selected_project === null || selected_project.preview === null || is_preview_loading || is_opening_project}
                onClick={() => {
                  void handle_open_project()
                }}
              >
                {is_opening_project ? t('app.action.loading') : t('project_page.open.action')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  )
}

