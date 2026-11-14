<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>全能翻译 AGENT Harness · 音频 视频 游戏 电子书 · 一键 · 高质量 · 全格式</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，翻译特化的次世代 `AGENT Harness`
- `一键`
  - 各语言全自动一键互译
  - 拖进去，点开始，等熟肉
  - 无需任何技术背景，无需任何语言知识
- `高质量`
  - 不受模型审查限制，自由输出
  - 自动生成术语表，保证专有名词在整部作品中的统一
  - 完美保留各种 `字幕` `电子书` `游戏引擎` 的样式效果
  - 语义化智能审校，只管指出问题，AGENT 自动帮你修正与润色
- `全格式`
  - 万物皆可译，包括但不限于：
  - 音频与视频 - `ASMR` `动画` `影视剧` `动态漫画` 等形式
  - 字幕与电子书 - `.txt` `.md` `.epub` `.pdf` `.srt` `.ass` `.ssa` `.vtt` `.lrc` 等格式
  - 游戏引擎与数据文件 - `Godot` `ACTION GAME MAKER` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `KV-JSON` `Message-JSON` 等引擎与数据

> <img width="1600" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="1600" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 特别说明 ⚠️
- 如您在翻译过程中使用了 [LinguaGacha](https://github.com/neavo/LinguaGacha) ，请在作品信息或发布页面的显要位置进行说明！
- 如您的项目涉及任何商业行为或者商业收益，在使用 [LinguaGacha](https://github.com/neavo/LinguaGacha) 前，请先与作者联系以获得授权！

## 效果展示 ✨
<table>
  <tbody>
    <tr><td><details open><summary><b>🎬 视频 · 逐对话对齐时间轴</b></summary><br><img width="1280" alt="视频" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details><summary><b>🎧 音频 · 字幕/频谱可视化双输出</b></summary><br><img width="1280" alt="音频" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
    <tr><td><details><summary><b>📚 电子书 · PDF/EPUB/Markdown 多格式兼容</b></summary><br><img width="1280" alt="电子书" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/book.png" /></details></td></tr>
  </tbody>
</table>

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
- 获取一个可靠的 AI 大模型接口，比如 [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ]
- 启动应用并创建工程，将 `待翻译文件` 拖入 `AGENT` 输入框，按下回车！

## 使用教程 📝
- **入门**
  - [基础教程](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 手把手教学，有手就行，新手必看`
  - [模型管理](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[文件格式支持](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)　　[常见问题](https://github.com/neavo/LinguaGacha/wiki/FAQ)
- **功能**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[校对](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[术语表](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[文本保护](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[文本替换](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [自定义提示词](https://github.com/neavo/LinguaGacha/wiki/CustomPrompt)　　[实验室](https://github.com/neavo/LinguaGacha/wiki/Laboratory)　　[功能设置](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[MTool 优化器](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[命令行模式](https://github.com/neavo/LinguaGacha/wiki/CLIMode)　　[高级设置](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **最佳实践**
  - [高质量翻译 音视频 的最佳实践](https://github.com/neavo/LinguaGacha/wiki/Media)
  - [高质量翻译 Godot 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)
  - [高质量翻译 RenPy 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [高质量翻译 Tyrano 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)
  - [高质量翻译 WOLFRPG 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)
  - [高质量翻译 RPGMAKER 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍

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
