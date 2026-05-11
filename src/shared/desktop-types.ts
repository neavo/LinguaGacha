export type ThemeMode = "light" | "dark";

export type TitleBarControlSide = "left" | "right" | "none";

export type DesktopShellInfo = {
  platform: NodeJS.Platform;
  usesTitleBarOverlay: boolean;
  titleBarHeight: number;
  titleBarControlSide: TitleBarControlSide;
  titleBarSafeAreaStart: number;
  titleBarSafeAreaEnd: number;
};

export type DesktopPathPickResult = {
  canceled: boolean;
  paths: string[];
};
