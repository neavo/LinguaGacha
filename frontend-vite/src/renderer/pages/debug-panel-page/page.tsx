import { useState } from 'react'

import { useAppNavigation } from '@/app/navigation/navigation-context'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n, type LocaleKey } from '@/i18n'
import '@/pages/debug-panel-page/debug-panel-page.css'
import { Badge } from '@/shadcn/badge'
import { Button } from '@/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shadcn/card'
import {
  BellRing,
  CircleAlert,
  CircleCheckBig,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  TriangleAlert,
  X,
} from 'lucide-react'

type DebugPanelPageProps = {
  title_key: LocaleKey
  summary_key: LocaleKey
  is_sidebar_collapsed: boolean
}

type ToastKind = 'info' | 'success' | 'warning' | 'error'

type ToastIdentifier = string | number

const TOAST_TITLE_KEYS: Readonly<Record<ToastKind, LocaleKey>> = {
  info: 'debug_panel_page.toast.info.title',
  success: 'debug_panel_page.toast.success.title',
  warning: 'debug_panel_page.toast.warning.title',
  error: 'debug_panel_page.toast.error.title',
}

const TOAST_BUTTON_KEYS: Readonly<Record<ToastKind, LocaleKey>> = {
  info: 'debug_panel_page.toast.info.button',
  success: 'debug_panel_page.toast.success.button',
  warning: 'debug_panel_page.toast.warning.button',
  error: 'debug_panel_page.toast.error.button',
}

// 统一图标映射，避免按钮文案变化时还要在 JSX 里重复判断视觉语义。
function resolve_toast_icon(kind: ToastKind): JSX.Element {
  if (kind === 'success') {
    return <CircleCheckBig className="size-4" />
  }

  if (kind === 'warning') {
    return <TriangleAlert className="size-4" />
  }

  if (kind === 'error') {
    return <CircleAlert className="size-4" />
  }

  return <BellRing className="size-4" />
}

function resolve_progress_inline_title(progress_percent: number, t: (key: LocaleKey) => string): string {
  if (progress_percent >= 60) {
    return `${t('debug_panel_page.progress.toast_title')} · ${progress_percent}% · ${t('debug_panel_page.progress.status_inline_running')}`
  } else if (progress_percent > 0) {
    return `${t('debug_panel_page.progress.toast_title')} · ${progress_percent}% · ${t('debug_panel_page.progress.status_inline_booting')}`
  } else {
    return `${t('debug_panel_page.progress.toast_title')} · ${t('debug_panel_page.progress.status_inline_idle')}`
  }
}

export function DebugPanelPage(props: DebugPanelPageProps): JSX.Element {
  const { t } = useI18n()
  const { proofreading_lookup_intent } = useAppNavigation()
  const { push_toast, push_progress_toast, update_progress_toast, dismiss_toast } = useDesktopToast()
  const [progress_percent, set_progress_percent] = useState<number>(35)
  const [is_progress_indeterminate, set_is_progress_indeterminate] = useState<boolean>(false)
  const [progress_toast_id, set_progress_toast_id] = useState<ToastIdentifier | null>(null)
  const title = t(props.title_key)
  const summary = t(props.summary_key)
  const sidebar_state = props.is_sidebar_collapsed
    ? t('debug_panel_page.shell.sidebar_collapsed')
    : t('debug_panel_page.shell.sidebar_expanded')

  function build_progress_toast_options(next_progress_percent: number, next_is_indeterminate: boolean): {
    message: string
    progress_percent?: number
  } {
    return {
      // 进行中的进度 toast 改为单行标题，直接验证 Sonner 单行布局的真实视觉效果。
      message: next_is_indeterminate
        ? `${t('debug_panel_page.progress.toast_title')} · ${t('debug_panel_page.progress.status_inline_indeterminate')}`
        : resolve_progress_inline_title(next_progress_percent, t),
      progress_percent: next_is_indeterminate ? undefined : next_progress_percent,
    }
  }

  // 固定文案模板，方便稳定复现不同通知状态下的皮肤与层级表现。
  function trigger_toast(kind: ToastKind): void {
    push_toast(kind, t(TOAST_TITLE_KEYS[kind]))
  }

  function sync_progress_toast(next_progress_percent: number): void {
    set_progress_percent(next_progress_percent)
    set_is_progress_indeterminate(false)

    if (progress_toast_id !== null) {
      // 进度控件与 toast 共享同一份状态，避免页面显示和悬浮通知不同步。
      update_progress_toast(progress_toast_id, build_progress_toast_options(next_progress_percent, false))
    }
  }

  function switch_progress_toast_to_indeterminate(): void {
    set_is_progress_indeterminate(true)

    if (progress_toast_id !== null) {
      update_progress_toast(progress_toast_id, build_progress_toast_options(progress_percent, true))
    }
  }

  function start_progress_debug(): void {
    if (progress_toast_id === null) {
      // 共享一个 toast 标识，便于在页面里持续模拟同一条任务通知的生命周期。
      const next_toast_id = push_progress_toast(build_progress_toast_options(progress_percent, is_progress_indeterminate))
      set_progress_toast_id(next_toast_id)
    } else {
      update_progress_toast(progress_toast_id, build_progress_toast_options(progress_percent, is_progress_indeterminate))
    }
  }

  function dismiss_progress_debug(): void {
    if (progress_toast_id === null) {
      return
    }

    dismiss_toast(progress_toast_id)
    set_progress_toast_id(null)
  }

  function dismiss_all_toasts(): void {
    dismiss_toast()
    set_progress_toast_id(null)
  }

  return (
    <div
      className="debug-panel-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <header className="debug-panel-page__hero">
        <div className="debug-panel-page__hero-copy">
          <p className="debug-panel-page__eyebrow">{t('debug_panel_page.eyebrow')}</p>
          <h1 className="debug-panel-page__title">{title}</h1>
          <p className="debug-panel-page__summary">{summary}</p>
        </div>
        <div className="debug-panel-page__hero-badges">
          <Badge variant="outline" className="debug-panel-page__badge">
            {props.is_sidebar_collapsed
              ? <PanelLeftClose className="size-3.5" />
              : <PanelLeftOpen className="size-3.5" />}
            {sidebar_state}
          </Badge>
          <Badge variant="brand" className="debug-panel-page__badge">
            <Gauge className="size-3.5" />
            {t('debug_panel_page.live_badge')}
          </Badge>
        </div>
      </header>

      <section className="debug-panel-page__grid">
        <Card variant="panel" className="debug-panel-page__card">
          <CardHeader className="debug-panel-page__card-header">
            <CardTitle>{t('debug_panel_page.toast.section_title')}</CardTitle>
            <CardDescription>{t('debug_panel_page.toast.section_description')}</CardDescription>
          </CardHeader>
          <CardContent className="debug-panel-page__card-content">
            <div className="debug-panel-page__button-grid">
              {(['info', 'success', 'warning', 'error'] as const).map((kind) => (
                <Button
                  key={kind}
                  variant={kind === 'error' ? 'destructive' : 'outline'}
                  onClick={() => {
                    trigger_toast(kind)
                  }}
                >
                  {resolve_toast_icon(kind)}
                  {t(TOAST_BUTTON_KEYS[kind])}
                </Button>
              ))}
            </div>
            <div className="debug-panel-page__note">
              <p className="debug-panel-page__note-label">{t('debug_panel_page.toast.preview_label')}</p>
              <p className="debug-panel-page__note-value">{t('debug_panel_page.toast.preview_value')}</p>
            </div>
            <Button variant="ghost" onClick={dismiss_all_toasts}>
              <X className="size-4" />
              {t('debug_panel_page.toast.dismiss_all')}
            </Button>
          </CardContent>
        </Card>

        <Card variant="panel" className="debug-panel-page__card">
          <CardHeader className="debug-panel-page__card-header">
            <CardTitle>{t('debug_panel_page.progress.section_title')}</CardTitle>
            <CardDescription>{t('debug_panel_page.progress.section_description')}</CardDescription>
          </CardHeader>
          <CardContent className="debug-panel-page__card-content debug-panel-page__progress-card">
            <div className="debug-panel-page__progress-head">
              <div>
                <p className="debug-panel-page__progress-label">{t('debug_panel_page.progress.current_value')}</p>
                <p className="debug-panel-page__progress-value">
                  {is_progress_indeterminate ? '...' : `${progress_percent}%`}
                </p>
              </div>
              <div className="debug-panel-page__hero-badges">
                <Badge variant={is_progress_indeterminate ? 'secondary' : 'outline'}>
                  {is_progress_indeterminate
                    ? t('debug_panel_page.progress.indeterminate_badge')
                    : t('debug_panel_page.progress.determinate_badge')}
                </Badge>
                <Badge variant={progress_toast_id === null ? 'outline' : 'brand'}>
                  {progress_toast_id === null
                    ? t('debug_panel_page.progress.idle_badge')
                    : t('debug_panel_page.progress.active_badge')}
                </Badge>
              </div>
            </div>

            <label className="debug-panel-page__slider-wrap">
              <span className="debug-panel-page__slider-label">{t('debug_panel_page.progress.slider_label')}</span>
              <input
                className="debug-panel-page__slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress_percent}
                onChange={(event) => {
                  sync_progress_toast(Number(event.target.value))
                }}
              />
            </label>

            <div className="debug-panel-page__button-grid debug-panel-page__button-grid--compact">
              {[0, 25, 50, 75, 100].map((value) => (
                <Button
                  key={value}
                  variant={progress_percent === value ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => {
                    sync_progress_toast(value)
                  }}
                >
                  {value}%
                </Button>
              ))}
            </div>

            <div className="debug-panel-page__button-row">
              <Button variant="brand" onClick={start_progress_debug}>
                {t('debug_panel_page.progress.start_button')}
              </Button>
              <Button
                variant="outline"
                onClick={switch_progress_toast_to_indeterminate}
              >
                {t('debug_panel_page.progress.indeterminate_button')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  sync_progress_toast(0)
                }}
              >
                {t('debug_panel_page.progress.reset_button')}
              </Button>
              <Button variant="ghost" onClick={dismiss_progress_debug} disabled={progress_toast_id === null}>
                {t('debug_panel_page.progress.dismiss_button')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card variant="panel" className="debug-panel-page__card debug-panel-page__card--wide">
          <CardHeader className="debug-panel-page__card-header">
            <CardTitle>{t('debug_panel_page.shell.section_title')}</CardTitle>
            <CardDescription>{t('debug_panel_page.shell.section_description')}</CardDescription>
          </CardHeader>
          <CardContent className="debug-panel-page__card-content">
            <dl className="debug-panel-page__meta-grid">
              <div className="debug-panel-page__meta-row">
                <dt>{t('debug_panel_page.shell.route_title_label')}</dt>
                <dd>{title}</dd>
              </div>
              <div className="debug-panel-page__meta-row">
                <dt>{t('debug_panel_page.shell.route_summary_label')}</dt>
                <dd>{summary}</dd>
              </div>
              <div className="debug-panel-page__meta-row">
                <dt>{t('debug_panel_page.shell.sidebar_label')}</dt>
                <dd>{sidebar_state}</dd>
              </div>
              <div className="debug-panel-page__meta-row">
                <dt>{t('debug_panel_page.shell.toast_label')}</dt>
                <dd>
                  {progress_toast_id === null
                    ? t('debug_panel_page.shell.toast_idle')
                    : t('debug_panel_page.shell.toast_running')}
                </dd>
              </div>
              <div className="debug-panel-page__meta-row">
                <dt>{t('debug_panel_page.shell.title_key_label')}</dt>
                <dd>
                  <code>{props.title_key}</code>
                </dd>
              </div>
              <div className="debug-panel-page__meta-row">
                <dt>{t('debug_panel_page.shell.summary_key_label')}</dt>
                <dd>
                  <code>{props.summary_key}</code>
                </dd>
              </div>
              {props.title_key === 'proofreading_page.title' && proofreading_lookup_intent !== null
                ? (
                    <div className="debug-panel-page__meta-row">
                      <dt>{t('debug_panel_page.shell.proofreading_lookup_intent_label')}</dt>
                      <dd>
                        <code>{JSON.stringify(proofreading_lookup_intent)}</code>
                      </dd>
                    </div>
                  )
                : null}
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}


