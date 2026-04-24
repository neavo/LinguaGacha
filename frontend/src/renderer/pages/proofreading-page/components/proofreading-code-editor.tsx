import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  hoverTooltip,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
  type Tooltip,
  tooltips,
  type DecorationSet,
} from "@codemirror/view";

import { cn } from "@/lib/utils";
import {
  app_editor_full_height_selection_extension,
  resolve_app_editor_theme_extensions,
} from "@/widgets/app-editor/app-editor-code-mirror";
import "@/widgets/app-editor/app-editor.css";

export type ProofreadingCodeEditorHighlight = {
  start: number;
  end: number;
  tone: "success" | "warning";
  tooltip?: string;
};

type ProofreadingCodeEditorProps = {
  value: string;
  aria_label: string;
  read_only: boolean;
  class_name?: string;
  highlights?: ProofreadingCodeEditorHighlight[];
  on_change?: (next_value: string) => void;
};

const editor_theme_compartment = new Compartment();
const editor_readonly_compartment = new Compartment();
const set_highlights_effect = StateEffect.define<ProofreadingCodeEditorHighlight[]>();

const success_highlight = Decoration.mark({
  class: "proofreading-page__glossary-mark--success",
});

const warning_highlight = Decoration.mark({
  class: "proofreading-page__glossary-mark--warning",
});

function build_highlight_decorations(highlights: ProofreadingCodeEditorHighlight[]): DecorationSet {
  if (highlights.length === 0) {
    return Decoration.none;
  }

  // 为什么：RangeSetBuilder 要求装饰范围按位置递增写入，先排序才能稳定处理重复命中和交错术语。
  const sorted_highlights = [...highlights].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    if (left.end !== right.end) {
      return left.end - right.end;
    }

    return left.tone.localeCompare(right.tone);
  });
  const builder = new RangeSetBuilder<Decoration>();
  sorted_highlights.forEach((highlight) => {
    if (highlight.end <= highlight.start) {
      return;
    }

    builder.add(
      highlight.start,
      highlight.end,
      highlight.tone === "success" ? success_highlight : warning_highlight,
    );
  });
  return builder.finish();
}

const highlight_field = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(current_decorations, transaction) {
    let next_decorations = current_decorations.map(transaction.changes);

    transaction.effects.forEach((effect) => {
      if (effect.is(set_highlights_effect)) {
        next_decorations = build_highlight_decorations(effect.value);
      }
    });

    return next_decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

function resolve_editor_theme(resolved_theme: string | undefined): Extension {
  return resolve_app_editor_theme_extensions(resolved_theme, "plain");
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

function resolve_hovered_highlights(
  highlights: ProofreadingCodeEditorHighlight[],
  pos: number,
  side: number,
): ProofreadingCodeEditorHighlight[] {
  const containing_highlights = highlights.filter((highlight) => {
    if (highlight.tooltip === undefined || highlight.tooltip.length === 0) {
      return false;
    }

    if (side < 0) {
      return highlight.start < pos && pos <= highlight.end;
    }

    return highlight.start <= pos && pos < highlight.end;
  });

  if (containing_highlights.length === 0) {
    return [];
  }

  const shortest_length = Math.min(
    ...containing_highlights.map((highlight) => {
      return highlight.end - highlight.start;
    }),
  );

  return containing_highlights.filter((highlight) => {
    return highlight.end - highlight.start === shortest_length;
  });
}

function create_editor_extensions(
  theme_extension: Extension,
  read_only: boolean,
  on_change: (next_value: string) => void,
  suppress_change_ref: { current: boolean },
  highlights_ref: { current: ProofreadingCodeEditorHighlight[] },
): Extension[] {
  return [
    editor_theme_compartment.of(theme_extension),
    editor_readonly_compartment.of(EditorState.readOnly.of(read_only)),
    highlight_field,
    tooltips({
      parent: document.body,
      position: "fixed",
    }),
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    app_editor_full_height_selection_extension,
    highlightSpecialChars(),
    highlightWhitespace(),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    hoverTooltip((view, pos, side): Tooltip | null => {
      void view;
      const hovered_highlights = resolve_hovered_highlights(highlights_ref.current, pos, side);

      if (hovered_highlights.length === 0) {
        return null;
      }

      const tooltip_lines = [
        ...new Set(
          hovered_highlights
            .map((highlight) => {
              return highlight.tooltip ?? "";
            })
            .filter((tooltip) => tooltip.length > 0),
        ),
      ];

      if (tooltip_lines.length === 0) {
        return null;
      }

      const tooltip_start = Math.min(...hovered_highlights.map((highlight) => highlight.start));
      const tooltip_end = Math.max(...hovered_highlights.map((highlight) => highlight.end));

      return {
        pos: tooltip_start,
        end: tooltip_end,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "proofreading-page__glossary-hover-tooltip";

          const copy = document.createElement("div");
          copy.className = "proofreading-page__glossary-hover-tooltip-copy";
          copy.textContent = tooltip_lines.join("\n\n");
          dom.append(copy);

          return { dom };
        },
      };
    }),
    EditorView.updateListener.of((update) => {
      // 为什么：这里是受控编辑器，外部同步 value 时不能再回调 on_change 造成回环。
      if (!update.docChanged || suppress_change_ref.current) {
        return;
      }

      on_change(update.state.doc.toString());
    }),
  ];
}

export function ProofreadingCodeEditor(props: ProofreadingCodeEditorProps): JSX.Element {
  const { resolvedTheme } = useTheme();
  const host_ref = useRef<HTMLDivElement | null>(null);
  const editor_view_ref = useRef<EditorView | null>(null);
  const on_change_ref = useRef(props.on_change);
  const suppress_change_ref = useRef(false);
  const initial_value_ref = useRef(props.value);
  const initial_aria_label_ref = useRef(props.aria_label);
  const initial_theme_extension_ref = useRef(resolve_editor_theme(resolvedTheme));
  const initial_read_only_ref = useRef(props.read_only);
  const initial_highlights_ref = useRef(props.highlights ?? []);
  const highlights_ref = useRef(props.highlights ?? []);

  useEffect(() => {
    on_change_ref.current = props.on_change;
  }, [props.on_change]);

  useEffect(() => {
    highlights_ref.current = props.highlights ?? [];
  }, [props.highlights]);

  useEffect(() => {
    if (host_ref.current === null) {
      return;
    }

    const editor_state = EditorState.create({
      doc: initial_value_ref.current,
      extensions: create_editor_extensions(
        initial_theme_extension_ref.current,
        initial_read_only_ref.current,
        (next_value) => {
          on_change_ref.current?.(next_value);
        },
        suppress_change_ref,
        highlights_ref,
      ),
    });

    const editor_view = new EditorView({
      state: editor_state,
      parent: host_ref.current,
    });

    editor_view.contentDOM.setAttribute("aria-label", initial_aria_label_ref.current);
    editor_view.contentDOM.setAttribute("spellcheck", "false");
    editor_view.dispatch({
      effects: set_highlights_effect.of(initial_highlights_ref.current),
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
  }, [props.aria_label]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: editor_theme_compartment.reconfigure(resolve_editor_theme(resolvedTheme)),
    });
  }, [resolvedTheme]);

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: [editor_readonly_compartment.reconfigure(EditorState.readOnly.of(props.read_only))],
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

  useEffect(() => {
    const editor_view = editor_view_ref.current;
    if (editor_view === null) {
      return;
    }

    editor_view.dispatch({
      effects: set_highlights_effect.of(props.highlights ?? []),
    });
  }, [props.highlights]);

  return (
    <div
      ref={host_ref}
      data-readonly={props.read_only ? "true" : undefined}
      className={cn(
        "app-editor",
        props.read_only ? "app-editor--readonly" : undefined,
        props.class_name,
      )}
    />
  );
}
