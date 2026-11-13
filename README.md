<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>使用 AI 能力一键翻译 小说、游戏、字幕、音视频 等内容的次世代翻译器</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，使用 AI 技术的次世代多形态翻译器
- 开箱即用，（几乎）无需设置，功能的强大，不需要通过繁琐的设置来体现
- 支持 `中` `英` `日` `韩` `俄` `德` `法` `意` 等 16 种语言的一键互译
- 支持 `字幕`、`电子书`、`游戏引擎`、`音频（ASMR）`、`视频（动态漫画 / 动画）` 等多种输入格式
- 支持 `OpenAI` `Google` `Anthropic` `SakuraLLM` 等各种本地或在线接口

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

> <img width="1280" alt="视频与动态漫画双语字幕效果" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" />

> <img width="1280" alt="纯音频双语可视化成片效果" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" />

## 特别说明 ⚠️
- 如您在翻译过程中使用了 [LinguaGacha](https://github.com/neavo/LinguaGacha) ，请在作品信息或发布页面的显要位置进行说明！
- 如您的项目涉及任何商业行为或者商业收益，在使用 [LinguaGacha](https://github.com/neavo/LinguaGacha) 前，请先与作者联系以获得授权！

## 功能优势 📌
- 最优的翻译质量，最快的翻译速度
  - 完美保留各种 `字幕` `电子书` 的样式效果
  - 自动生成术语表，保证专有名词在整部作品中的统一
  - 十秒钟一份字幕，一分钟一本小说，五分钟一部游戏
- 内置 `AGENT` 模式，通过对话自动完成各种任务　`👈👈 独家绝技`
  - 无需任何技术知识，游戏即翻即玩
  - 主流游戏引擎全覆盖 `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `Unity` `Bakin` `RealLive` `Escude` `ACTION GAME MAKER`
  - **`音视频（ASMR / 动态漫画）一站式翻译`**：本地语音识别 + 画面文字检测，视频自动避让气泡/人脸排版双语 `.ass`，纯音频直接生成 `1920×1080` 频谱可视化双语 `.mp4`

## 基本流程 🛸
- 从 [发布页](https://github.com/neavo/LinguaGacha/releases) 下载应用
  - Windows:
    - 根据 CPU 类型下载 `*_Windows_x64.zip` 或 `*_Windows_arm64.zip`
    - 解压后双击 `app.exe` 启动
  - <details>
    <summary>macOS:</summary>
    - 根据 CPU 类型下载 `*_macOS_x64.dmg` 或 `*_macOS_arm64.dmg`
    - 拖拽到应用程序文件夹，先不要启动
    - 打开终端输入 `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` 然后回车
    - 输入系统密码，关闭终端，可以正常运行了
    </details>
  - <details>
    <summary>Linux:</summary>
    - 根据 CPU 类型下载 `*_Linux_x64.AppImage` 或 `*_Linux_arm64.AppImage`
    - 添加执行权限 `chmod +x LinguaGacha*.AppImage`
    - 运行 `./LinguaGacha*.AppImage`
    </details>
- 获取一个可靠的 AI 大模型接口，推荐：
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ]，无显卡要求
- 启动应用并创建工程，将 `待翻译文件`、`游戏目录` 或 `音视频` 拖入 `AGENT` 输入框，按下回车！

## 使用教程 📝
- **入门与媒体**
  - [基础教程](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 手把手教学，新手必看`
  - [文件格式支持](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)　　[音频与视频翻译（ASMR / 动态漫画）](https://github.com/neavo/LinguaGacha/wiki/Media)　　[常见问题](https://github.com/neavo/LinguaGacha/wiki/FAQ)
- **模型与设置**
  - [模型管理](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[功能设置与实验室](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[应用代理](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **核心功能**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[校对与预览](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[术语表](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[文本保护](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)
  - [文本替换](https://github.com/neavo/LinguaGacha/wiki/Replacement)　　[MTool 优化器](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[命令行模式](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
- **游戏引擎最佳实践**
  - [通用流程与改字指南](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGames)：[Godot](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot) · [RenPy](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy) · [Tyrano](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano) · [WOLFRPG](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG) · [RPGMAKER](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
  - [无复杂加密 kirikiri 引擎机翻笔记（社区）](https://github.com/neavo/LinguaGacha/discussions/181)
- 更多说明详见 [Wiki 首页](https://github.com/neavo/LinguaGacha/wiki)

## 支持格式 🏷️
| 类型 | 格式 / 载体 | 说明 |
|:---|:---|:---|
| 音频（ASMR / 语音） | 常见音频格式（含带封面音频） | 交付译文/双语 `.ass` 与频谱可视化双语 `.mp4`，见 [[音频与视频翻译](https://github.com/neavo/LinguaGacha/wiki/Media)] |
| 视频（动画 / 动态漫画） | 常见视频格式 | 语音对白 + 画面文字检测与避让排版，交付译文/双语 `.ass`，见 [[音频与视频翻译](https://github.com/neavo/LinguaGacha/wiki/Media)] |
| 字幕与歌词 | `.srt` `.ass` `.ssa` `.vtt` `.lrc` | 保留时间轴与样式 |
| 电子书与文档 | `.txt` `.md` `.pdf` `.epub` | `.pdf` 支持 `AGENT` 解析与双语对照预览 |
| `KV-JSON` / `Message-JSON` | `.json` | 来源 [[MTool](https://mtool.app)] [[SExtractor](https://github.com/satan53x/SExtractor)] [[VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)] |
| `Godot` / `ACTION GAME MAKER` | `.exe` 或游戏目录 | 教程 [[Godot 指南](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)] |
| `RenPy` | `.exe` 或游戏目录 | 教程 [[RenPy 指南](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)] |
| `Tyrano` | `.exe` 或游戏目录 | 教程 [[Tyrano 指南](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)] |
| `WOLFRPG` | `.exe` 或游戏目录 | 教程 [[WOLFRPG 指南](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)] |
| `RPGMAKER MV/MZ / XP/VX/VXAce` | `.exe` 或游戏目录 | 教程 [[RPGMAKER 指南](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)] |
| `.rpy` `.xlsx` `.trans` | 旧版兼容格式 | `👈 即将停止支持`，建议改用对应引擎原生目录导入 |
| 其它格式文件或游戏 | 任意 | 拖入 `AGENT` 工作区自动识别处理 |

## 近期更新 📅
- 20261113 v0.141.2
  - 优化 `音视频` 翻译能力 [1095](../../issues/1092)
  - 修复与改进 [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - 优化 `音视频` 翻译能力 [#1092](../../issues/1092)
  - 修复与改进 [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - 新增 `音频（ASMR）` 翻译 [#1085](../../pull/1085)
  - 新增 `视频` 翻译 [#1085](../../pull/1085)
  - 修复与改进 [#1083](../../issues/1083) [#1084](../../issues/1084)

## 开发指南 🛠️
- 安装 [ [Go](https://go.dev) ] 和 [ [`Node.js`](https://nodejs.org) ]
- 安装依赖 `npm install`
- 更新依赖 `npm ci`
- 运行应用 `npm run dev`
- 构建发布 `npm run build`
- 提交 PR 前请根据改动范围执行 [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) 中的对应验证
- 非开发者请直接在 [发布页](https://github.com/neavo/LinguaGacha/releases) 下载打包版本

## 问题反馈 😥
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
