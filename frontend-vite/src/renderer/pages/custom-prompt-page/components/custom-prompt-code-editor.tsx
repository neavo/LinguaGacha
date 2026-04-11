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

type CustomPromptCodeEditorProps = {
  value: string
  onChange: (next_value: string) => void
  aria_label: string
}

const editor_theme_compartment = new Compartment()

type EditorPalette = {
  background: string
  foreground: string
  gutter_background: string
  gutter_foreground: string
  gutter_active_foreground: string
  selection_background: string
  active_line_background: string
  marker: string
  heading: string
  strong: string
  emphasis: string
  inline_code: string
  link: string
  quote: string
  separator: string
}

const light_editor_palette: EditorPalette = {
  background: '#ffffff',
  foreground: '#1f2328',
  gutter_background: '#ffffff',
  gutter_foreground: '#6e7781',
  gutter_active_foreground: '#4c5663',
  selection_background: '#e9eef9',
  active_line_background: '#f3f4f6',
  marker: '#0451a5',
  heading: '#003eaa',
  strong: '#003eaa',
  emphasis: '#2f5fb3',
  inline_code: '#a31515',
  link: '#0451a5',
  quote: '#6e7781',
  separator: '#9a6700',
}

const dark_editor_palette: EditorPalette = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  gutter_background: '#1e1e1e',
  gutter_foreground: '#858585',
  gutter_active_foreground: '#c6c6c6',
  selection_background: '#2a2d2e',
  active_line_background: '#2a2d2e',
  marker: '#569cd6',
  heading: '#4ea1ff',
  strong: '#4ea1ff',
  emphasis: '#78b7ff',
  inline_code: '#ce9178',
  link: '#569cd6',
  quote: '#8b949e',
  separator: '#d7ba7d',
}

function create_markdown_editor_theme(
  palette: EditorPalette,
  dark: boolean,
): Extension {
  const editor_theme = EditorView.theme({
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

  const highlight_style = HighlightStyle.define([
    {
      tag: tags.processingInstruction,
      color: palette.marker,
    },
    {
      tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6, tags.heading],
      color: palette.heading,
      fontWeight: '700',
    },
    {
      tag: tags.strong,
      color: palette.strong,
      fontWeight: '700',
    },
    {
      tag: tags.emphasis,
      color: palette.emphasis,
      fontStyle: 'italic',
    },
    {
      tag: tags.strikethrough,
      color: palette.foreground,
      textDecoration: 'line-through',
    },
    {
      tag: tags.monospace,
      color: palette.inline_code,
    },
    {
      tag: [tags.link, tags.url, tags.labelName],
      color: palette.link,
      textDecoration: 'underline',
    },
    {
      tag: tags.quote,
      color: palette.quote,
    },
    {
      tag: tags.contentSeparator,
      color: palette.separator,
    },
  ])

  return [editor_theme, syntaxHighlighting(highlight_style)]
}

const light_editor_theme = create_markdown_editor_theme(
  light_editor_palette,
  false,
)

const dark_editor_theme = create_markdown_editor_theme(
  dark_editor_palette,
  true,
)

function clamp_selection_offset(offset: number, max_offset: number): number {
  if (offset < 0) {
    return 0
  } else if (offset > max_offset) {
    return max_offset
  } else {
    return offset
  }
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

function resolve_editor_theme(resolved_theme: string | undefined): Extension {
  if (resolved_theme === 'dark') {
    return dark_editor_theme
  } else {
    return light_editor_theme
  }
}

function create_editor_extensions(
  theme_extension: Extension,
  on_change: (next_value: string) => void,
  suppress_change_ref: { current: boolean },
): Extension[] {
  return [
    editor_theme_compartment.of(theme_extension),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    highlightWhitespace(),
    // Why: 这里需要 GFM 语法基线，像 ~~删除线~~ 这类常见写法否则不会被解析，
    // 看起来就像默认高亮完全失效了一样。
    markdown({ base: markdownLanguage }),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      // Why: 外部导入、重置和预设替换会主动改写全文，这里必须跳过受控回写，
      // 否则父层会收到重复 onChange，造成不必要的状态抖动。
      if (!update.docChanged || suppress_change_ref.current) {
        return
      }

      on_change(update.state.doc.toString())
    }),
  ]
}

export function CustomPromptCodeEditor(
  props: CustomPromptCodeEditorProps,
): JSX.Element {
  const { resolvedTheme } = useTheme()
  const host_ref = useRef<HTMLDivElement | null>(null)
  const editor_view_ref = useRef<EditorView | null>(null)
  const on_change_ref = useRef(props.onChange)
  const suppress_change_ref = useRef(false)
  const initial_value_ref = useRef(props.value)
  const initial_aria_label_ref = useRef(props.aria_label)
  const initial_theme_extension_ref = useRef(resolve_editor_theme(resolvedTheme))

  useEffect(() => {
    on_change_ref.current = props.onChange
  }, [props.onChange])

  useEffect(() => {
    if (host_ref.current === null) {
      return
    }

    const editor_state = EditorState.create({
      doc: initial_value_ref.current,
      extensions: create_editor_extensions(
        initial_theme_extension_ref.current,
        (next_value) => {
          on_change_ref.current(next_value)
        },
        suppress_change_ref,
      ),
    })
    const editor_view = new EditorView({
      state: editor_state,
      parent: host_ref.current,
    })

    // Why: CodeMirror 的 content DOM 是运行时生成的，a11y 属性要在实例创建后补齐。
    editor_view.contentDOM.setAttribute('aria-label', initial_aria_label_ref.current)
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
  }, [props.aria_label])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (editor_view === null) {
      return
    }

    // Why: 主题扩展必须通过 compartment 热切换，才能在亮暗模式切换时保住编辑器实例、
    // 光标位置和撤销历史，而不是整棵重建。
    editor_view.dispatch({
      effects: editor_theme_compartment.reconfigure(
        resolve_editor_theme(resolvedTheme),
      ),
    })
  }, [resolvedTheme])

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

    // Why: 导入、应用预设和重置都会整段替换正文，这里尽量保住用户的选区位置，
    // 避免内容一刷新就把光标硬弹回开头。
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

  return <div ref={host_ref} className="custom-prompt-page__editor-host" />
}
