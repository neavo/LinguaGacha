import { type JSX, Fragment, type ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { SORTABLE_PROVIDER_OPTIONS } from "@frontend/widgets/interactions/sortable";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";

import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { Card, CardContent } from "@frontend/shadcn/card";

type ModelCategoryCardProps = {
  title: string;
  description: string;
  accent_color: string;
  models: ModelEntrySnapshot[];
  add_action: ReactNode;
  disabled: boolean;
  render_model: (model: ModelEntrySnapshot, index: number, drag_disabled: boolean) => ReactNode;
  on_reorder: (ordered_model_ids: string[]) => Promise<void>;
};

/** 展示单个模型分类，并把有效拖拽结果转换为完整模型 ID 顺序。 */
export function ModelCategoryCard(props: ModelCategoryCardProps): JSX.Element {
  const reorder = useReorder({
    ids: props.models.map((model) => model.id),
    disabled: props.disabled,
    on_reorder: props.on_reorder,
  });
  const models_by_id = new Map(props.models.map((model) => [model.id, model]));

  return (
    <Card className="model-page__category-card">
      <CardContent className="model-page__category-card-content">
        <header className="model-page__category-header">
          <div className="model-page__category-main">
            <div
              className="model-page__category-accent"
              style={{ backgroundColor: props.accent_color }}
              aria-hidden="true"
            />
            <div className="model-page__category-copy">
              <h2 className="model-page__category-title font-medium">{props.title}</h2>
              <p className="model-page__category-description">{props.description}</p>
            </div>
          </div>
          <div className="model-page__category-action">{props.add_action}</div>
        </header>

        <DragDropProvider {...SORTABLE_PROVIDER_OPTIONS} {...reorder.events}>
          <div className="model-page__flow-list">
            {reorder.ordered_ids.map((id, index) => (
              <Fragment key={id}>
                {props.render_model(
                  models_by_id.get(id)!,
                  index,
                  props.disabled || reorder.pending,
                )}
              </Fragment>
            ))}
          </div>
        </DragDropProvider>
      </CardContent>
    </Card>
  );
}
