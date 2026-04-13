import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { tags } from '@lezer/highlight'

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state'
import {
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
} from '@codemirror/view'

import { cn } from '@/lib/utils'
import '@/widgets/app-editor/app-editor.css'

type AppEditorMode = 'plain' | 'markdown'

type AppEditorProps = {
  value: string
  aria_label: string
  read_only: boolean
  invalid?: boolean
  mode?: AppEditorMode
  class_name?: string
  on_change?: (next_value: string) => void
}

type MarkdownPalette = {
  marker: string
  heading: string
  strong: string
  emphasis: string
  inline_code: string
  link: string
  quote: string
  separator: string
}

type EditorPalette = {
  background: string
  foreground: string
  gutter_background: string
  gutter_foreground: string
  gutter_active_foreground: string
  selection_background: string
  active_line_background: string
  markdown: MarkdownPalette
}

const editor_theme_compartment = new Compartment()
const editor_readonly_compartment = new Compartment()
const editor_mode_compartment = new Compartment()

const light_editor_palette: EditorPalette = {
  background: '#ffffff',
  foreground: '#1f2328',
  gutter_background: '#ffffff',
  gutter_foreground: '#6e7781',
  gutter_active_foreground: '#4c5663',
  selection_background: '#e9eef9',
  active_line_background: '#f3f4f6',
  markdown: {
    marker: '#0451a5',
    heading: '#003eaa',
    strong: '#003eaa',
    emphasis: '#2f5fb3',
    inline_code: '#a31515',
    link: '#0451a5',
    quote: '#6e7781',
    separator: '#9a6700',
  },
}

const dark_editor_palette: EditorPalette = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  gutter_background: '#1e1e1e',
  gutter_foreground: '#858585',
  gutter_active_foreground: '#c6c6c6',
  selection_background: '#2a2d2e',
  active_line_background: '#2a2d2e',
  markdown: {
    marker: '#569cd6',
    heading: '#4ea1ff',
    strong: '#4ea1ff',
    emphasis: '#78b7ff',
    inline_code: '#ce9178',
    link: '#569cd6',
    quote: '#8b949e',
    separator: '#d7ba7d',
  },
}

function create_editor_theme(
  palette: EditorPalette,
  dark: boolean,
): Extension {
  return EditorView.theme({
    '&': {
      backgroundColor: palette.background,
      color: palette.foreground,
    },
    '.cm-content': {
      caretColor: 'var(--primary)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--primary)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: palette.selection_background,
    },
    '.cm-activeLine': {
      backgroundColor: palette.active_line_background,
    },
    '.cm-gutters': {
      backgroundColor: palette.gutter_background,
      color: palette.gutter_foreground,
    },
    '.cm-activeLineGutter': {
      backgroundColor: palette.active_line_background,
      color: palette.gutter_active_foreground,
    },
  }, {
    dark,
  })
}

function create_markdown_highlight_extension(
  palette: EditorPalette,
): Extension {
  return syntaxHighlighting(HighlightStyle.define([
    {
      tag: tags.processingInstruction,
      color: palette.markdown.marker,
    },
    {
      tag: [
        tags.heading1,
        tags.heading2,
        tags.heading3,
        tags.heading4,
        tags.heading5,
        tags.heading6,
        tags.heading,
      ],
      color: palette.markdown.heading,
      fontWeight: '700',
    },
    {
      tag: tags.strong,
      color: palette.markdown.strong,
      fontWeight: '700',
    },
    {
      tag: tags.emphasis,
      color: palette.markdown.emphasis,
      fontStyle: 'italic',
    },
    {
      tag: tags.strikethrough,
      color: palette.foreground,
      textDecoration: 'line-through',
    },
    {
      tag: tags.monospace,
      color: palette.markdown.inline_code,
    },
    {
      tag: [tags.link, tags.url, tags.labelName],
      color: palette.markdown.link,
      textDecoration: 'underline',
    },
    {
      tag: tags.quote,
      color: palette.markdown.quote,
    },
    {
      tag: tags.contentSeparator,
      color: palette.markdown.separator,
    },
  ]))
}

function resolve_theme_extensions(
  resolved_theme: string | undefined,
  mode: AppEditorMode,
): Extension {
  const palette = resolved_theme === 'dark'
    ? dark_editor_palette
    : light_editor_palette
  const base_theme = create_editor_theme(palette, resolved_theme === 'dark')

  if (mode === 'markdown') {
    return [
      base_theme,
      create_markdown_highlight_extension(palette),
    ]
  }

  return base_theme
}

function resolve_mode_extensions(mode: AppEditorMode): Extension {
  if (mode === 'markdown') {
    // 为什么：提示词编辑器里常见的标题、链接、删除线都依赖 Markdown 语言扩展才能得到稳定高亮。
    return markdown({ base: markdownLanguage })
  }

  return []
}

function clamp_selection_offset(offset: number, max_offset: number): number {
  if (offset < 0) {
    return 0
  }
  if (offset > max_offset) {
    return max_offset
  }

  return offset
}

function create_clamped_selection(
  selection: EditorSelection,
  next_length: number,
): EditorSelection {
  return EditorSelection.create(
    selection.ranges.map((range) => {
      return EditorSelection.range(
        clamp_selection_offset(range.anchor, next_length),
        clamp_selection_offset(range.head, next_length),
      )
    }),
    selection.mainIndex,
  )
}

function create_editor_extensions(args: {
  theme_extension: Extension
  mode_extension: Extension
  read_only: boolean
  on_change: (next_value: string) => void
  suppress_change_ref: { current: boolean }
}): Extension[] {
  return [
    editor_theme_compartment.of(args.theme_extension),
    editor_readonly_compartment.of(EditorState.readOnly.of(args.read_only)),
    editor_mode_compartment.of(args.mode_extension),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    highlightWhitespace(),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      // 为什么：这是受控编辑器，外部同步 value 时不能再向上触发 on_change 形成回环。
      if (!update.docChanged || args.suppress_change_ref.current) {
        return
      }

      args.on_change(update.state.doc.toString())
    }),
  ]
}

export function AppEditor(props: AppEditorProps): JSX.Element {
  const { resolvedTheme } = useTheme()
  const mode = props.mode ?? 'plain'
  const host_ref = useRef<HTMLDivElement | null>(null)
  const editor_view_ref = useRef<EditorView | null>(null)
  const on_change_ref = useRef(props.on_change)
  const suppress_change_ref = useRef(false)
  const initial_value_ref = useRef(props.value)
  const initial_aria_label_ref = useRef(props.aria_label)
  const initial_invalid_ref = useRef(props.invalid === true)
  const initial_read_only_ref = useRef(props.read_only)
  const initial_mode_ref = useRef(mode)
  const initial_theme_extension_ref = useRef(resolve_theme_extensions(resolvedTheme, mode))

  useEffect(() => {
    on_change_ref.current = props.on_change
  }, [props.on_change])

  useEffect(() => {
    if (host_ref.current === null) {
      return
    }

    const editor_state = EditorState.create({
      doc: initial_value_ref.current,
      extensions: create_editor_extensions({
        theme_extension: initial_theme_extension_ref.current,
        mode_extension: resolve_mode_extensions(initial_mode_ref.current),
        read_only: initial_read_only_ref.current,
        on_change: (next_value) => {
          on_change_ref.current?.(next_value)
        },
        suppress_change_ref,
      }),
    })

    const editor_view = new EditorView({
      state: editor_state,
      parent: host_ref.current,
    })

    editor_view.contentDOM.setAttribute('aria-label', initial_aria_label_ref.current)
    editor_view.contentDOM.setAttribute('aria-invalid', initial_invalid_ref.current ? 'true' : 'false')
    editor_view.contentDOM.setAttribute('spellcheck', 'false')
    editor_view_ref.current = editor_view

    return () => {
      editor_view.destroy()
      editor_view_ref.current = null
    }
  }, [])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    if (editor_view === null) {
      return
    }

    editor_view.contentDOM.setAttribute('aria-label', props.aria_label)
    editor_view.contentDOM.setAttribute('aria-invalid', props.invalid === true ? 'true' : 'false')
  }, [props.aria_label, props.invalid])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    if (editor_view === null) {
      return
    }

    editor_view.dispatch({
      effects: editor_theme_compartment.reconfigure(
        resolve_theme_extensions(resolvedTheme, mode),
      ),
    })
  }, [mode, resolvedTheme])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    if (editor_view === null) {
      return
    }

    editor_view.dispatch({
      effects: editor_mode_compartment.reconfigure(
        resolve_mode_extensions(mode),
      ),
    })
  }, [mode])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    if (editor_view === null) {
      return
    }

    editor_view.dispatch({
      effects: editor_readonly_compartment.reconfigure(
        EditorState.readOnly.of(props.read_only),
      ),
    })
  }, [props.read_only])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    if (editor_view === null) {
      return
    }

    const current_value = editor_view.state.doc.toString()
    if (current_value === props.value) {
      return
    }

    const next_selection = create_clamped_selection(
      editor_view.state.selection,
      props.value.length,
    )

    suppress_change_ref.current = true
    try {
      editor_view.dispatch({
        changes: {
          from: 0,
          to: current_value.length,
          insert: props.value,
        },
        selection: next_selection,
      })
    } finally {
      suppress_change_ref.current = false
    }
  }, [props.value])

  return (
    <div
      ref={host_ref}
      data-invalid={props.invalid === true ? 'true' : undefined}
      data-readonly={props.read_only ? 'true' : undefined}
      className={cn(
        'app-editor',
        props.read_only ? 'app-editor--readonly' : undefined,
        props.invalid === true ? 'app-editor--invalid' : undefined,
        props.class_name,
      )}
    />
  )
}
