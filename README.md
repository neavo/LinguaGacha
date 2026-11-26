<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>全能翻译 AGENT Harness · 一键 · 高质量 · 全格式</p>
<p align='center'>漫画 游戏 音视频 电子书 · PDF EPUB ASMR MANGA COMIC RPGGAME GALGAME</p>

## 🌍 README
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 📢 概述
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，翻译特化的次世代 `AGENT Harness`
- `一键`
  - 各语言全自动一键互译
  - 全自动翻译，无需人工介入
- `高质量`
  - 无限制自由输出
  - 不同内容细致调教，确保最佳质量
  - 智能术语与审校，简单对话就可以让行文措辞对齐你的喜好
- `全格式，包括但是不限于：`
  - 音频与视频 - `ASMR` `动画` `影视剧` `动态漫画`
  - 图片与漫画 - `日漫` `美漫` `黑白` `彩色` `横排` `竖排`
  - 字幕与电子书 - `.txt` `.md` `.epub` `.pdf` `.srt` `.ass` `.ssa` `.vtt` `.lrc`
  - 游戏引擎与数据文件 - `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `KV-JSON` `Message-JSON`

> <img width="1600" alt="亮色" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/light.jpg" />

> <img width="1600" alt="暗色" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/dark.jpg" />

> [!IMPORTANT]
> - 发布使用 [LinguaGacha](https://github.com/neavo/LinguaGacha) 翻译的作品时，必须在显要位置提及 [LinguaGacha](https://github.com/neavo/LinguaGacha) …!
> - 作者保留所有权利，源码仅作展示用途，禁止一切形式的集成、修改、分发、转售或二次开发 …!

## ✨ 效果展示（全自动翻译，零人工介入）
<table>
  <tbody>
    <tr><td><details open><summary><b>🗯️ 漫画</b></summary><br><img width="1280" alt="图片" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/image.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎬 视频</b></summary><br><img width="1280" alt="视频" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎧 音频</b></summary><br><img width="1280" alt="音频" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎮 游戏</b></summary><br><img width="1280" alt="游戏" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/game.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>📚 电子书</b></summary><br><img width="1280" alt="电子书" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/book.png" /></details></td></tr>
  </tbody>
</table>

## 🛸 基本流程
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

## 📝 使用教程
- **入门**
  - [基础教程](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 手把手教学，有手就行，新手必看`
  - [模型管理](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)　　[文件格式支持](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)
- **功能**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[校对](https://github.com/neavo/LinguaGacha/wiki/Proofreading)　　[术语表](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[文本保护](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[文本替换](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [自定义提示词](https://github.com/neavo/LinguaGacha/wiki/CustomPrompt)　　[实验室](https://github.com/neavo/LinguaGacha/wiki/Laboratory)　　[功能设置](https://github.com/neavo/LinguaGacha/wiki/Settings)　　[MTool 优化器](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[命令行模式](https://github.com/neavo/LinguaGacha/wiki/CLIMode)　　[高级设置](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- **最佳实践**
  - [高质量翻译 音视频 的最佳实践](https://github.com/neavo/LinguaGacha/wiki/Media)
  - [高质量翻译 漫画和图片 的最佳实践](https://github.com/neavo/LinguaGacha/wiki/Image)
  - [高质量翻译 Godot 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)
  - [高质量翻译 RenPy 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [高质量翻译 Tyrano 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)
  - [高质量翻译 WOLFRPG 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)
  - [高质量翻译 RPGMAKER 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍

## 📅 近期更新
- 20261126 v0.143.0
  - 支持同时打开多个工程 [#1127](../../issues/1127)
  - 优化漫画（图片）翻译的效果 [#1130](../../issues/1130)
  - 修复与改进 [#1131](../../issues/1131) [#1132](../../issues/1132) [#1133](../../issues/1133) [#1134](../../issues/1134)

## ❓ 常见问题

- 可以不使用 `AGENT` 翻译吗\
  文本、字幕等内置格式可在 `工作台` 直接批量翻译，也可使用命令行 👉 [查看步骤](https://github.com/neavo/LinguaGacha/wiki/FAQ#-可以不使用-agent-翻译吗)

- 游戏或文件更新后，能保留已有译文吗\
  在原工程中使用 `AGENT` 的 `更新文件`，保留已完成的译文，再补译新增或变动的内容 👉 [查看步骤](https://github.com/neavo/LinguaGacha/wiki/FAQ#-游戏或文件更新后能保留已有译文吗)

## 😥 问题反馈
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
