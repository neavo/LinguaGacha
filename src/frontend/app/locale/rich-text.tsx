import { Fragment, createElement, type ReactNode } from "react";

export type RichTextComponentMap = Partial<Record<string, (children: ReactNode) => ReactNode>>;

const ELEMENT_NODE_TYPE = 1;
const TEXT_NODE_TYPE = 3;

function render_rich_text_text(text_content: string, key_prefix: string): ReactNode {
  const text_lines = text_content.split("\n");

  if (text_lines.length === 1) {
    return text_content;
  } else {
    return text_lines.flatMap((line, line_index) => {
      const is_last_line = line_index === text_lines.length - 1;

      if (is_last_line) {
        return [line];
      } else {
        return [line, createElement("br", { key: `${key_prefix}-line-break-${line_index}` })];
      }
    });
  }
}

function render_rich_text_nodes(
  child_nodes: ArrayLike<ChildNode>,
  component_map: RichTextComponentMap,
  key_prefix: string,
): ReactNode[] {
  return Array.from(child_nodes).map((child_node, child_index) => {
    return render_rich_text_node(child_node, component_map, `${key_prefix}-${child_index}`);
  });
}

function render_rich_text_node(
  child_node: ChildNode,
  component_map: RichTextComponentMap,
  key_prefix: string,
): ReactNode {
  if (child_node.nodeType === TEXT_NODE_TYPE) {
    return createElement(
      Fragment,
      { key: key_prefix },
      render_rich_text_text(child_node.textContent ?? "", key_prefix),
    );
  } else if (child_node.nodeType === ELEMENT_NODE_TYPE) {
    const element_node = child_node as Element;
    const element_children = render_rich_text_nodes(
      element_node.childNodes,
      component_map,
      `${key_prefix}-child`,
    );
    const component_renderer = component_map[element_node.tagName.toLowerCase()];

    if (component_renderer !== undefined) {
      return createElement(Fragment, { key: key_prefix }, component_renderer(element_children));
    } else {
      return createElement(
        Fragment,
        { key: key_prefix },
        render_rich_text_text(element_node.outerHTML, key_prefix),
      );
    }
  } else {
    return createElement(Fragment, { key: key_prefix });
  }
}

function parse_rich_text_root(source_text: string): Element | null {
  if (typeof DOMParser === "undefined") {
    return null;
  } else {
    // 统一用受控容器包一层，避免多根节点时每个调用方各自补壳处理
    const document = new DOMParser().parseFromString(
      `<lg-rich-text>${source_text}</lg-rich-text>`,
      "text/html",
    );
    const root_element = document.body.firstElementChild;

    if (root_element instanceof Element) {
      return root_element;
    } else {
      return null;
    }
  }
}

export function render_rich_text(
  source_text: string,
  component_map: RichTextComponentMap,
): ReactNode {
  const root_element = parse_rich_text_root(source_text);

  if (root_element !== null) {
    return render_rich_text_nodes(root_element.childNodes, component_map, "rich-text");
  } else {
    return source_text;
  }
}
