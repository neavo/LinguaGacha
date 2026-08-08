import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { cn } from "@frontend/shadcn/classnames";
import {
  app_editor_text_mark_field,
  app_editor_whitespace_extension,
  create_app_editor_text_mark_hover_extension,
  type AppEditorSyntax,
  type AppTextMark,
  normalize_app_text_marks,
  resolve_app_editor_readonly_extensions,
  resolve_app_editor_syntax_extensions,
  resolve_app_editor_theme_extensions,
  set_app_editor_text_marks_effect,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";
import "@frontend/widgets/app-editor/app-editor.css";

type AppEditorVariant = "document" | "field" | "viewer";

type AppEditorBaseProps = {
  value: string;
  aria_label: string;
  class_name?: string;
};

type AppEditorEditingProps = {
  read_only: boolean;
  invalid?: boolean;
  aria_invalid?: boolean;
  indent_with_tab?: boolean;
  marks?: readonly AppTextMark[];
  on_change?: (next_value: string) => void;
  on_blur?: () => void;
};

type AppEditorDocumentProps = AppEditorBaseProps &
  AppEditorEditingProps & {
    variant?: "document";
    syntax?: AppEditorSyntax;
  };

type AppEditorFieldProps = AppEditorBaseProps &
  AppEditorEditingProps & {
    variant: "field";
    syntax?: never;
  };

type AppEditorViewerProps = AppEditorBaseProps & {
  variant: "viewer";
  syntax?: AppEditorSyntax;
  wrap_lines: boolean;
};

type AppEditorProps = AppEditorDocumentProps | AppEditorFieldProps | AppEditorViewerProps;

type NormalizedAppEditorProps = AppEditorBaseProps & {
  variant: AppEditorVariant;
  syntax: AppEditorSyntax;
  wrap_lines: boolean;
  read_only: boolean;
  invalid: boolean;
  aria_invalid: boolean;
  indent_with_tab: boolean;
  marks: readonly AppTextMark[];
  on_change?: (next_value: string) => void;
  on_blur?: () => void;
};

// 各维度独立重配，避免 React 属性变化时重建 EditorView 和丢失选区。
const editor_theme_compartment = new Compartment();
const editor_readonly_compartment = new Compartment();
const editor_syntax_compartment = new Compartment();
const editor_variant_compartment = new Compartment();
const editor_keymap_compartment = new Compartment();
const empty_app_text_marks: readonly AppTextMark[] = Object.freeze([]);

/** 把互斥的公开形态收口为 CodeMirror 唯一运行配置。 */
function normalize_app_editor_props(props: AppEditorProps): NormalizedAppEditorProps {
  if (props.variant === "viewer") {
    return {
      ...props,
      syntax: props.syntax ?? "plain",
      read_only: true,
      invalid: false,
      aria_invalid: false,
      indent_with_tab: false,
      marks: empty_app_text_marks,
    };
  }

  return {
    ...props,
    variant: props.variant ?? "document",
    syntax: props.variant === "field" ? "plain" : (props.syntax ?? "plain"),
    wrap_lines: props.variant !== "field",
    invalid: props.invalid === true,
    aria_invalid: (props.aria_invalid ?? props.invalid) === true,
    indent_with_tab: props.indent_with_tab ?? true,
    marks: props.marks ?? empty_app_text_marks,
  };
}

/** 字段形态不允许换行，外部多行值统一折叠为空格。 */
function normalize_field_editor_value(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, " ");
}

/** 字段形态在事务边界强制单行，并吞掉 Enter 以避免表单误提交。 */
const field_editor_single_line_extension: Extension = [
  EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.newDoc.lines <= 1) {
      return transaction;
    }

    const next_value = normalize_field_editor_value(transaction.newDoc.toString());
    const next_head = normalize_field_editor_value(
      transaction.newDoc.sliceString(0, transaction.newSelection.main.head),
    ).length;

    return {
      changes: {
        from: 0,
        to: transaction.startState.doc.length,
        insert: next_value,
      },
      selection: EditorSelection.cursor(next_head),
    };
  }),
  Prec.high(
    keymap.of([
      {
        key: "Enter",
        run: () => true,
      },
      {
        key: "Shift-Enter",
        run: () => true,
      },
    ]),
  ),
];

/** 三种形态在同一入口声明行号、空白标记与换行契约。 */
function resolve_app_editor_variant_extensions(
  variant: AppEditorVariant,
  wrap_lines: boolean,
): Extension[] {
  switch (variant) {
    case "field":
      return [field_editor_single_line_extension];
    case "viewer":
      return [lineNumbers(), ...(wrap_lines ? [EditorView.lineWrapping] : [])];
    case "document":
      return [
        lineNumbers(),
        highlightActiveLineGutter(),
        app_editor_whitespace_extension,
        EditorView.lineWrapping,
      ];
  }
}

/** 外部值进入字段形态前先应用与事务一致的单行规则。 */
function resolve_app_editor_value(value: string, variant: AppEditorVariant): string {
  if (variant === "field") {
    return normalize_field_editor_value(value);
  }

  return value;
}

/** Tab 是否缩进由调用方决定，其余键位始终沿用 CodeMirror 默认映射。 */
function resolve_app_editor_keymap_extension(indent_with_tab: boolean): Extension {
  return keymap.of([
    ...(indent_with_tab ? [indentWithTab] : []),
    ...defaultKeymap,
    ...historyKeymap,
  ]);
}

/** 外部值缩短时把选区端点限制到新文档范围。 */
function clamp_selection_offset(offset: number, max_offset: number): number {
  if (offset < 0) {
    return 0;
  }
  if (offset > max_offset) {
    return max_offset;
  }

  return offset;
}

/** 保留多选区结构，只裁剪越过新文档末尾的端点。 */
function create_clamped_selection(
  selection: EditorSelection,
  next_length: number,
): EditorSelection {
  return EditorSelection.create(
    selection.ranges.map((range) => {
      return EditorSelection.range(
        clamp_selection_offset(range.anchor, next_length),
        clamp_selection_offset(range.head, next_length),
      );
    }),
    selection.mainIndex,
  );
}

/** 组合只创建一次的基础扩展；运行期变化通过各自 Compartment 重配。 */
function create_editor_extensions(args: {
  theme_extension: Extension;
  syntax_extension: Extension;
  variant_extension: Extension;
  keymap_extension: Extension;
  read_only: boolean;
  on_change: (next_value: string) => void;
  on_blur: () => void;
  suppress_change_ref: { current: boolean };
  marks_ref: { current: readonly AppTextMark[] };
}): Extension[] {
  return [
    editor_theme_compartment.of(args.theme_extension),
    editor_readonly_compartment.of(resolve_app_editor_readonly_extensions(args.read_only)),
    editor_syntax_compartment.of(args.syntax_extension),
    editor_variant_compartment.of(args.variant_extension),
    app_editor_text_mark_field,
    create_app_editor_text_mark_hover_extension(args.marks_ref),
    drawSelection(),
    history(),
    args.keymap_extension,
    EditorView.domEventHandlers({
      blur: () => {
        args.on_blur();
      },
    }),
    EditorView.updateListener.of((update) => {
      // 为什么：这是受控编辑器，外部同步 value 时不能再向上触发 on_change 形成回环
      if (!update.docChanged || args.suppress_change_ref.current) {
        return;
      }

      args.on_change(update.state.doc.toString());
    }),
  ];
}

/** 受控 CodeMirror 表面，统一字段、正文与只读查看器的互斥语义。 */
export function AppEditor(props: AppEditorProps): JSX.Element {
  const { resolvedTheme } = useTheme();
  const config = normalize_app_editor_props(props);
  const { indent_with_tab, read_only, syntax, variant, wrap_lines } = config;
  const value = resolve_app_editor_value(props.value, variant);
  const host_ref = useRef<HTMLDivElement | null>(null);
  const editor_view_ref = useRef<EditorView | null>(null);
  const on_change_ref = useRef(config.on_change);
  const on_blur_ref = useRef(config.on_blur);
  const suppress_change_ref = useRef(false);
  // EditorView 生命周期独立于 React 重渲染，首帧配置固定后只通过 Compartment 同步。
  const initial_value_ref = useRef(value);
  const initial_aria_label_ref = useRef(props.aria_label);
  const initial_aria_invalid_ref = useRef(config.aria_invalid);
  const initial_read_only_ref = useRef(read_only);
  const initial_syntax_ref = useRef(syntax);
  const initial_variant_ref = useRef(variant);
  const initial_wrap_lines_ref = useRef(wrap_lines);
  const initial_indent_with_tab_ref = useRef(indent_with_tab);
  const initial_marks_ref = useRef(normalize_app_text_marks(value.length, config.marks));
  const marks_ref = useRef<readonly AppTextMark[]>(initial_marks_ref.current);
  const initial_theme_extension_ref = useRef(
    resolve_app_editor_theme_extensions(resolvedTheme, syntax),
  );

  useEffect(() => {
    on_change_ref.current = config.on_change;
  }, [config.on_change]);

  useEffect(() => {
    on_blur_ref.current = config.on_blur;
  }, [config.on_blur]);

  useEffect(() => {
    if (host_ref.current === null) {
      return;
    }

    const editor_state = EditorState.create({
      doc: initial_value_ref.current,
      extensions: create_editor_extensions({
        theme_extension: initial_theme_extension_ref.current,
        syntax_extension: resolve_app_editor_syntax_extensions(initial_syntax_ref.current),
        variant_extension: resolve_app_editor_variant_extensions(
          initial_variant_ref.current,
          initial_wrap_lines_ref.current,
        ),
        keymap_extension: editor_keymap_compartment.of(
          resolve_app_editor_keymap_extension(initial_indent_with_tab_ref.current),
        ),
        read_only: initial_read_only_ref.current,
        on_change: (next_value) => {
          on_change_ref.current?.(next_value);
        },
        on_blur: () => {
          on_blur_ref.current?.();
        },
        suppress_change_ref,
        marks_ref,
      }),
    });

    const editor_view = new EditorView({
      state: editor_state,
      parent: host_ref.current,
    });

    editor_view.contentDOM.setAttribute("aria-label", initial_aria_label_ref.current);
    editor_view.contentDOM.setAttribute(
      "aria-invalid",
      initial_aria_invalid_ref.current ? "true" : "false",
    );
    editor_view.contentDOM.setAttribute("spellcheck", "false");
    editor_view.dispatch({
      effects: set_app_editor_text_marks_effect.of(initial_marks_ref.current),
    });
    editor_view_ref.current = editor_view;

    return () => {
      editor_view.destroy();
      editor_view_ref.current = null;
    };
  }, []);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.contentDOM.setAttribute("aria-label", props.aria_label);
    editor_view.contentDOM.setAttribute("aria-invalid", config.aria_invalid ? "true" : "false");
  }, [config.aria_invalid, props.aria_label]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_theme_compartment.reconfigure(
        resolve_app_editor_theme_extensions(resolvedTheme, syntax),
      ),
    });
  }, [resolvedTheme, syntax]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_syntax_compartment.reconfigure(resolve_app_editor_syntax_extensions(syntax)),
    });
  }, [syntax]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_variant_compartment.reconfigure(
        resolve_app_editor_variant_extensions(variant, wrap_lines),
      ),
    });
  }, [variant, wrap_lines]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_keymap_compartment.reconfigure(
        resolve_app_editor_keymap_extension(indent_with_tab),
      ),
    });
  }, [indent_with_tab]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_readonly_compartment.reconfigure(
        resolve_app_editor_readonly_extensions(read_only),
      ),
    });
  }, [read_only]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    const current_value = editor_view.state.doc.toString();
    if (current_value === value) {
      return;
    }

    const next_selection = create_clamped_selection(editor_view.state.selection, value.length);

    suppress_change_ref.current = true;
    try {
      editor_view.dispatch({
        changes: {
          from: 0,
          to: current_value.length,
          insert: value,
        },
        selection: next_selection,
      });
    } finally {
      suppress_change_ref.current = false;
    }
  }, [value]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    const next_marks = normalize_app_text_marks(value.length, config.marks);
    marks_ref.current = next_marks;
    editor_view.dispatch({
      effects: set_app_editor_text_marks_effect.of(next_marks),
    });
  }, [config.marks, value]);

  return (
    <div
      ref={host_ref}
      data-invalid={config.invalid ? "true" : undefined}
      data-readonly={read_only ? "true" : undefined}
      className={cn(
        "app-editor",
        variant === "field" ? "app-editor--field" : undefined,
        variant === "viewer" ? "app-editor--viewer" : undefined,
        wrap_lines ? "app-editor--wrap-lines" : undefined,
        read_only && variant !== "viewer" ? "app-editor--readonly" : undefined,
        config.invalid ? "app-editor--invalid" : undefined,
        props.class_name,
      )}
    />
  );
}
