<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>全能翻译 AGENT Harness · 一键 · 高质量 · 全格式</p>
<p align='center'>漫画 游戏 音视频 电子书 · PDF EPUB ASMR MANGA COMIC RPGGAME GALGAME</p>

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，翻译特化的次世代 `AGENT Harness`
- `一键`
  - 各语言全自动一键互译
  - 全自动翻译，无需人工介入
- `高质量`
  - 无限制自由输出
  - 不同内容细致调教，确保最佳质量
  - 智能术语与审校，简单对话就可以让行文措辞对齐你的喜好
- `全格式，不局限于下列示例：`
  - 音频与视频 - `ASMR` `动画` `影视剧` `动态漫画` 等
  - 图片与漫画 - `日漫` `美漫` `黑白` `彩色` `横排` `竖排` 等
  - 字幕与电子书 - `.txt` `.md` `.epub` `.pdf` `.srt` `.ass` `.ssa` `.vtt` `.lrc` 等
  - 游戏引擎与数据文件 - `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `KV-JSON` `Message-JSON` 等

> <img width="1600" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="1600" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

> [!IMPORTANT]
> - 发布使用 [LinguaGacha](https://github.com/neavo/LinguaGacha) 翻译的作品时，必须在显要位置提及 [LinguaGacha](https://github.com/neavo/LinguaGacha) …!
> - 作者保留所有权利，源码仅作展示用途，禁止一切形式的集成、修改、分发、转售或二次开发 …!

## 效果展示（全自动翻译，零人工介入） ✨
<table>
  <tbody>
    <tr><td><details open><summary><b>🗯️ 漫画</b></summary><br><img width="1280" alt="图片" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/image.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎬 视频</b></summary><br><img width="1280" alt="视频" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎧 音频</b></summary><br><img width="1280" alt="音频" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>🎮 游戏</b></summary><br><img width="1280" alt="游戏" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/game.jpg" /></details></td></tr>
    <tr><td><details open><summary><b>📚 电子书</b></summary><br><img width="1280" alt="电子书" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/book.png" /></details></td></tr>
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
  - [高质量翻译 漫画和图片 的最佳实践](https://github.com/neavo/LinguaGacha/wiki/Image)
  - [高质量翻译 Godot 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)
  - [高质量翻译 RenPy 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [高质量翻译 Tyrano 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)
  - [高质量翻译 WOLFRPG 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)
  - [高质量翻译 RPGMAKER 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍

## 近期更新 📅
- 20261123 v0.142.3
  - 优化了 `RP` 与 `写作` 的效果
  - 修复与改进 [#1123](../../issues/1123) [#1124](../../issues/1124)

- 20261120 v0.142.2
  - 支持透明 `图片` 的翻译 [#1120](../../pull/1120)
  - 显著优化 `图片（漫画）` 的翻译排版 [#1116](../../pull/1116)
  - 修复与改进 [#1117](../../issues/1117) [#1118](../../issues/1118) [#1119](../../issues/1119)

- 20261119 v0.142.1
  - 新增 `图片（漫画）` 翻译 [#1109](../../pull/1109)
  - 修复与改进 [#1111](../../issues/1111) [#1112](../../issues/1112)

## 问题反馈 😥
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
