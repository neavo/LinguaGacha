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

import { cn } from "@frontend/styling/classnames";
import {
  app_editor_text_mark_field,
  app_editor_whitespace_extension,
  create_app_editor_text_mark_hover_extension,
  type AppEditorMode,
  type AppTextMark,
  normalize_app_text_marks,
  resolve_app_editor_mode_extensions,
  resolve_app_editor_theme_extensions,
  set_app_editor_text_marks_effect,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";
import "@frontend/widgets/app-editor/app-editor.css";

type AppEditorVariant = "editor" | "field";

type AppEditorProps = {
  value: string;
  aria_label: string;
  read_only: boolean;
  invalid?: boolean;
  aria_invalid?: boolean;
  mode?: AppEditorMode;
  variant?: AppEditorVariant;
  indent_with_tab?: boolean;
  marks?: readonly AppTextMark[];
  class_name?: string;
  on_change?: (next_value: string) => void;
};

const editor_theme_compartment = new Compartment();
const editor_readonly_compartment = new Compartment();
const editor_mode_compartment = new Compartment();
const editor_variant_compartment = new Compartment();
const editor_keymap_compartment = new Compartment();

function normalize_field_editor_value(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, " ");
}

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

function resolve_app_editor_variant_extensions(variant: AppEditorVariant): Extension[] {
  if (variant === "field") {
    return [field_editor_single_line_extension];
  }

  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    app_editor_whitespace_extension,
    EditorView.lineWrapping,
  ];
}

function resolve_app_editor_value(value: string, variant: AppEditorVariant): string {
  if (variant === "field") {
    return normalize_field_editor_value(value);
  }

  return value;
}

function resolve_app_editor_keymap_extension(indent_with_tab: boolean): Extension {
  return keymap.of([
    ...(indent_with_tab ? [indentWithTab] : []),
    ...defaultKeymap,
    ...historyKeymap,
  ]);
}

function clamp_selection_offset(offset: number, max_offset: number): number {
  if (offset < 0) {
    return 0;
  }
  if (offset > max_offset) {
    return max_offset;
  }

  return offset;
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
      );
    }),
    selection.mainIndex,
  );
}

function create_editor_extensions(args: {
  theme_extension: Extension;
  mode_extension: Extension;
  variant_extension: Extension;
  keymap_extension: Extension;
  read_only: boolean;
  on_change: (next_value: string) => void;
  suppress_change_ref: { current: boolean };
  marks_ref: { current: readonly AppTextMark[] };
}): Extension[] {
  return [
    editor_theme_compartment.of(args.theme_extension),
    editor_readonly_compartment.of(EditorState.readOnly.of(args.read_only)),
    editor_mode_compartment.of(args.mode_extension),
    editor_variant_compartment.of(args.variant_extension),
    app_editor_text_mark_field,
    create_app_editor_text_mark_hover_extension(args.marks_ref),
    drawSelection(),
    history(),
    args.keymap_extension,
    EditorView.updateListener.of((update) => {
      // 为什么：这是受控编辑器，外部同步 value 时不能再向上触发 on_change 形成回环
      if (!update.docChanged || args.suppress_change_ref.current) {
        return;
      }

      args.on_change(update.state.doc.toString());
    }),
  ];
}

export function AppEditor(props: AppEditorProps): JSX.Element {
  const { resolvedTheme } = useTheme();
  const mode = props.mode ?? "plain";
  const variant = props.variant ?? "editor";
  const indent_with_tab = props.indent_with_tab ?? true;
  const value = resolve_app_editor_value(props.value, variant);
  const host_ref = useRef<HTMLDivElement | null>(null);
  const editor_view_ref = useRef<EditorView | null>(null);
  const on_change_ref = useRef(props.on_change);
  const suppress_change_ref = useRef(false);
  const initial_value_ref = useRef(value);
  const initial_aria_label_ref = useRef(props.aria_label);
  const initial_aria_invalid_ref = useRef((props.aria_invalid ?? props.invalid) === true);
  const initial_read_only_ref = useRef(props.read_only);
  const initial_mode_ref = useRef(mode);
  const initial_variant_ref = useRef(variant);
  const initial_indent_with_tab_ref = useRef(indent_with_tab);
  const initial_marks_ref = useRef(normalize_app_text_marks(value.length, props.marks ?? []));
  const marks_ref = useRef<readonly AppTextMark[]>(initial_marks_ref.current);
  const initial_theme_extension_ref = useRef(
    resolve_app_editor_theme_extensions(resolvedTheme, mode),
  );

  useEffect(() => {
    on_change_ref.current = props.on_change;
  }, [props.on_change]);

  useEffect(() => {
    if (host_ref.current === null) {
      return;
    }

    const editor_state = EditorState.create({
      doc: initial_value_ref.current,
      extensions: create_editor_extensions({
        theme_extension: initial_theme_extension_ref.current,
        mode_extension: resolve_app_editor_mode_extensions(initial_mode_ref.current),
        variant_extension: resolve_app_editor_variant_extensions(initial_variant_ref.current),
        keymap_extension: editor_keymap_compartment.of(
          resolve_app_editor_keymap_extension(initial_indent_with_tab_ref.current),
        ),
        read_only: initial_read_only_ref.current,
        on_change: (next_value) => {
          on_change_ref.current?.(next_value);
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
    editor_view.contentDOM.setAttribute(
      "aria-invalid",
      (props.aria_invalid ?? props.invalid) === true ? "true" : "false",
    );
  }, [props.aria_invalid, props.aria_label, props.invalid]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_theme_compartment.reconfigure(
        resolve_app_editor_theme_extensions(resolvedTheme, mode),
      ),
    });
  }, [mode, resolvedTheme]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_mode_compartment.reconfigure(resolve_app_editor_mode_extensions(mode)),
    });
  }, [mode]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_variant_compartment.reconfigure(
        resolve_app_editor_variant_extensions(variant),
      ),
    });
  }, [variant]);

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
      effects: editor_readonly_compartment.reconfigure(EditorState.readOnly.of(props.read_only)),
    });
  }, [props.read_only]);

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

    const next_marks = normalize_app_text_marks(value.length, props.marks ?? []);
    marks_ref.current = next_marks;
    editor_view.dispatch({
      effects: set_app_editor_text_marks_effect.of(next_marks),
    });
  }, [props.marks, value]);

  return (
    <div
      ref={host_ref}
      data-invalid={props.invalid === true ? "true" : undefined}
      data-readonly={props.read_only ? "true" : undefined}
      className={cn(
        "app-editor",
        variant === "field" ? "app-editor--field" : undefined,
        props.read_only ? "app-editor--readonly" : undefined,
        props.invalid === true ? "app-editor--invalid" : undefined,
        props.class_name,
      )}
    />
  );
}
