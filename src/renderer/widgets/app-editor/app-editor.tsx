import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { cn } from "@/lib/utils";
import {
  app_editor_whitespace_extension,
  type AppEditorMode,
  resolve_app_editor_mode_extensions,
  resolve_app_editor_theme_extensions,
} from "@/widgets/app-editor/app-editor-code-mirror";
import "@/widgets/app-editor/app-editor.css";

type AppEditorProps = {
  value: string;
  aria_label: string;
  read_only: boolean;
  invalid?: boolean;
  mode?: AppEditorMode;
  class_name?: string;
  on_change?: (next_value: string) => void;
};

const editor_theme_compartment = new Compartment();
const editor_readonly_compartment = new Compartment();
const editor_mode_compartment = new Compartment();

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
  read_only: boolean;
  on_change: (next_value: string) => void;
  suppress_change_ref: { current: boolean };
}): Extension[] {
  return [
    editor_theme_compartment.of(args.theme_extension),
    editor_readonly_compartment.of(EditorState.readOnly.of(args.read_only)),
    editor_mode_compartment.of(args.mode_extension),
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    app_editor_whitespace_extension,
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      // 为什么：这是受控编辑器，外部同步 value 时不能再向上触发 on_change 形成回环。
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
  const host_ref = useRef<HTMLDivElement | null>(null);
  const editor_view_ref = useRef<EditorView | null>(null);
  const on_change_ref = useRef(props.on_change);
  const suppress_change_ref = useRef(false);
  const initial_value_ref = useRef(props.value);
  const initial_aria_label_ref = useRef(props.aria_label);
  const initial_invalid_ref = useRef(props.invalid === true);
  const initial_read_only_ref = useRef(props.read_only);
  const initial_mode_ref = useRef(mode);
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
        read_only: initial_read_only_ref.current,
        on_change: (next_value) => {
          on_change_ref.current?.(next_value);
        },
        suppress_change_ref,
      }),
    });

    const editor_view = new EditorView({
      state: editor_state,
      parent: host_ref.current,
    });

    editor_view.contentDOM.setAttribute("aria-label", initial_aria_label_ref.current);
    editor_view.contentDOM.setAttribute(
      "aria-invalid",
      initial_invalid_ref.current ? "true" : "false",
    );
    editor_view.contentDOM.setAttribute("spellcheck", "false");
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
    editor_view.contentDOM.setAttribute("aria-invalid", props.invalid === true ? "true" : "false");
  }, [props.aria_label, props.invalid]);

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
      effects: editor_readonly_compartment.reconfigure(EditorState.readOnly.of(props.read_only)),
    });
  }, [props.read_only]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    const current_value = editor_view.state.doc.toString();
    if (current_value === props.value) {
      return;
    }

    const next_selection = create_clamped_selection(
      editor_view.state.selection,
      props.value.length,
    );

    suppress_change_ref.current = true;
    try {
      editor_view.dispatch({
        changes: {
          from: 0,
          to: current_value.length,
          insert: props.value,
        },
        selection: next_selection,
      });
    } finally {
      suppress_change_ref.current = false;
    }
  }, [props.value]);

  return (
    <div
      ref={host_ref}
      data-invalid={props.invalid === true ? "true" : undefined}
      data-readonly={props.read_only ? "true" : undefined}
      className={cn(
        "app-editor",
        props.read_only ? "app-editor--readonly" : undefined,
        props.invalid === true ? "app-editor--invalid" : undefined,
        props.class_name,
      )}
    />
  );
}
