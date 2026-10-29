import type { JSX } from "react";
import { CircleChevronRight } from "lucide-react";

import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import type { RouteId, ScreenComponentProps } from "@frontend/app/navigation/types";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import "@frontend/pages/toolbox-page/toolbox-page.css";
import { Card, CardContent, CardHeader, CardTitle } from "@frontend/shadcn/card";
import { Separator } from "@frontend/shadcn/separator";

/** 入口只描述文案与目标路由，工具逻辑由目标页面拥有。 */
type ToolboxEntry = {
  title_key: LocaleKey;
  description_key: LocaleKey;
  route_id: RouteId;
};

// 按展示顺序排列。
const TOOLBOX_ENTRIES: readonly ToolboxEntry[] = [
  {
    title_key: "translation_transfer_page.title",
    description_key: "toolbox_page.entries.translation_transfer.description",
    route_id: "translation-transfer",
  },
  {
    title_key: "game_font_page.title", // 入口与功能页共用名称。
    description_key: "toolbox_page.entries.game_font.description",
    route_id: "game-font",
  },
];

/** 工具入口不依赖工程会话，未打开 `.lg` 时也可使用。 */
export function ToolboxPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const { navigate_to_route } = useAppNavigation();

  return (
    <div className="toolbox-page page-shell page-shell--full">
      <section className="toolbox-page__grid" aria-label={t("toolbox_page.title")}>
        {TOOLBOX_ENTRIES.map((entry) => (
          // 使用原生按钮承载卡片样式，确保工具入口具备键盘与语义交互。
          <Card
            key={entry.route_id}
            render={<button type="button" />}
            className="toolbox-page__card"
            onClick={() => {
              navigate_to_route(entry.route_id);
            }}
          >
            <CardHeader className="toolbox-page__card-header">
              <CardTitle className="toolbox-page__card-title">{t(entry.title_key)}</CardTitle>
              <CircleChevronRight className="toolbox-page__card-icon" aria-hidden="true" />
            </CardHeader>
            <Separator className="toolbox-page__separator" />
            <CardContent className="toolbox-page__card-content">
              <p className="toolbox-page__description">{t(entry.description_key)}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
