

<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>使用 AI 能力一键翻译 小说、游戏、字幕 等文本内容的次世代文本翻译器</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，使用 AI 技术次世代文本翻译器
- 开箱即用，（几乎）无需设置，功能的强大，不需要通过繁琐的设置来体现
- 支持 `中` `英` `日` `韩` `俄` `德` `法` `意` 等 16 种语言的一键互译
- 支持 `字幕`、`电子书`、`游戏文本` 等多种文本类型与文本格式
- 支持 `OpenAI` `Google` `Anthropic` `SakuraLLM` 等各种本地或在线接口

> <img width="2570" height="1605" alt="01" src="https://github.com/user-attachments/assets/898f6606-9c74-47db-b63e-33d544cfdf15" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 特别说明 ⚠️
- 如您在翻译过程中使用了 [LinguaGacha](https://github.com/neavo/LinguaGacha) ，请在作品信息或发布页面的显要位置进行说明！
- 如您的项目涉及任何商业行为或者商业收益，在使用 [LinguaGacha](https://github.com/neavo/LinguaGacha) 前，请先与作者联系以获得授权！

## 功能优势 📌
- 极快的翻译速度，十秒钟一份字幕，一分钟一本小说，五分钟一部游戏
- 一键生成术语表，保证角色姓名等专有名词在整部作品中的译名统一　`👈👈 独家绝技`
- 最优的翻译质量，无论是 旗舰模型 `诸如 DeepSeek-R1` 还是 本地小模型　`诸如 Qwen2.5-7B`
- 同类应用中最强的样式与代码保留能力，显著减少后期工作量，是制作内嵌汉化的最佳选择
  - `.md` `.ass` `.epub` 格式几乎可以保留所有原有样式
  - 大部分的 `WOLF`、`RenPy`、`RPGMaker`、`Kirikiri` 引擎游戏无需人工处理，即翻即玩　`👈👈 独家绝技`

## 基本流程 🛸
- 从 [发布页](https://github.com/neavo/LinguaGacha/releases) 下载应用
  - Windows: 下载 `.zip` 文件，解压后双击 `app.exe` 启动
  - macOS: 下载 `.dmg` 文件，Intel 选择 `x86_64`，Apple Silicon 选择 `arm64`，拖拽到应用程序文件夹
    - 首次运行可能提示"无法验证开发者"
    - 请右键点击应用选择"打开"，或执行 `xattr -cr /Applications/LinguaGacha.app`
  - Linux: 下载 `.AppImage` 文件
    - 添加执行权限后运行 `chmod +x LinguaGacha*.AppImage && ./LinguaGacha*.AppImage`
- 获取一个可靠的 AI 大模型接口，建议选择其一：
  - [ [本地接口](https://github.com/neavo/OneClickLLAMA) ]，免费，需至少 8G 显存的独立显卡，Nvidia 显卡为佳
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ]，需付费但便宜，速度快，质量高，无显卡要求 `👈👈 推荐`
- 准备要翻译的文本
  - `字幕`、`电子书` 等一般不需要预处理
  - `游戏文本` 需要根据游戏引擎选择合适的工具进行提取
- 启动应用
  - 将 `待翻译的文件` 拖到页面上创建项目
  - 在 `模型管理` 中设置并激活要使用的模型
  - 在 `基础设置` 中设置原文语言、译文语言等必要信息
  - 在 `工作台` 中执行 `分析` 或 `翻译` 任务
  - Enjoy!

## 使用教程 📝
- 综合
  - [基础教程](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈👈 手把手教学，有手就行，新手必看`
  - [高质量翻译 WOLF 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLF)
  - [高质量翻译 RenPy 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [高质量翻译 RPGMaker 系列引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 视频教程
  - [How to Translate RPGMV with LinguaGacha and Translator++ (English)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- 功能说明
  - [命令行模式](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
  - [术语表](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[文本保护](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[文本替换](https://github.com/neavo/LinguaGacha/wiki/Replacement)　　
  - [强制思考](https://github.com/neavo/LinguaGacha/wiki/ForceThinking)　　[MTool 优化器](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)
  - [百宝箱 - 繁简转换](https://github.com/neavo/LinguaGacha/wiki/TSConversion) [百宝箱 - 姓名字段提取](https://github.com/neavo/LinguaGacha/wiki/NameFieldExtraction)
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍，也欢迎在 [讨论区](https://github.com/neavo/LinguaGacha/discussions) 投稿你的使用心得

## 文本格式 🏷️
- 在任务开始时，应用将读取输入文件夹（及其子目录）内所有支持的文件，包括但是不限于：
  - 字幕（.srt .ass）
  - 电子书（.txt .epub）
  - Markdown（.md）
  - [RenPy](https://www.renpy.org) 导出游戏文本（.rpy）
  - [MTool](https://mtool.app) 导出游戏文本（.json）
  - [SExtractor](https://github.com/satan53x/SExtractor) 导出游戏文本（.txt .json .xlsx）
  - [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools) 导出游戏文本（.json）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 项目文件（.trans）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 导出游戏文本（.xlsx）
  - [WOLF 官方翻译工具](https://silversecond.booth.pm/items/5151747) 导出游戏文本（.xlsx）
- 具体示例可见 [Wiki - 支持的文件格式](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)，更多格式将持续添加，你也可以在 [ISSUES](https://github.com/neavo/LinguaGacha/issues) 中提出你的需求

## 近期更新 📅
- 20260522 v0.101.3
  - 调整与改进 [#598](https://github.com/neavo/LinguaGacha/issues/598) [#599](https://github.com/neavo/LinguaGacha/issues/599) [#601](https://github.com/neavo/LinguaGacha/issues/601) [#603](https://github.com/neavo/LinguaGacha/issues/603) [#604](https://github.com/neavo/LinguaGacha/issues/604)

- 20260520 v0.101.2
  - 调整与改进 [#592](https://github.com/neavo/LinguaGacha/issues/592) [#593](https://github.com/neavo/LinguaGacha/issues/593) [#595](https://github.com/neavo/LinguaGacha/issues/595)

- 20260520 v0.101.1
  - fix - 任务启动/执行时的卡顿的问题 [#587](https://github.com/neavo/LinguaGacha/issues/587)
  - fix - MacOS 打包架构不正确的问题 [#588](https://github.com/neavo/LinguaGacha/issues/588)

- 20260519 v0.101.0
  - feat - [命令行模式](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
  - fix - 尝试修复页面假死的问题 [#583](https://github.com/neavo/LinguaGacha/issues/583) [#585](https://github.com/neavo/LinguaGacha/issues/585)

## 开发指南 🛠️
- 安装 [ [Go](https://go.dev) ] 和 [ [`Node.js`](https://nodejs.org) ]，然后 `npm install`
- 更新依赖 `npm update`
- 运行应用 `npm run dev`
- 提交 PR 前请根据改动范围执行 [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) 中的对应验证
- 非开发者请直接在 [发布页](https://github.com/neavo/LinguaGacha/releases) 下载打包版本

## 问题反馈 😥
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75

## Star History

<a href="https://www.star-history.com/?repos=neavo%2FLinguaGacha&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&legend=top-left" />
 </picture>
</a>