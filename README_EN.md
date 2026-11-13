<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Translation-specialized Agent Harness for novels, games, documents, audio, and video</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/) is a next-generation `Agent Harness` built specifically for high-quality localization across diverse formats
- Out of the box, (almost) no setup needed—powerful capabilities without complicated configuration
- Supports one-click translation across 16 languages
  - including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc.
- Handles `Subtitles`, `E-books`, `Native Game Engines`, `Audio (ASMR)`, and `Video (Dynamic Comics / Anime)` natively, while any custom or unlisted format can be inspected and written back directly inside the `AGENT` workspace
- Supports local and online providers compatible with `OpenAI`, `Google`, `Anthropic`, and `SakuraLLM`

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## Special Notice ⚠️
- If you use [LinguaGacha](https://github.com/neavo/LinguaGacha) during translation, please include clear attribution in prominent locations of your work's information or release pages!
- For projects involving commercial activities or profits, please contact the author for authorization before using [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Feature Advantages 📌
- Optimal translation quality and the fastest translation speed
  - Fully preserves the styles of various `Subtitles` and `E-books`
  - Automatically generates a glossary to keep proper nouns consistent throughout the work
  - Subtitles in ten seconds, a novel in one minute, a game in five minutes
- Built-in `AGENT` mode that completes complex workflows through conversation `👈👈 Exclusive Feature`
  - No technical knowledge required: translate and play
  - Covers all major engines: `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `Unity` `Bakin` `RealLive` `Escude` `ACTION GAME MAKER`
  - **`End-to-End Audio & Video Translation`**: Local ASR + on-screen text detection with smart bubble/face-avoiding bilingual `.ass` subtitles, plus `1920×1080` spectrum-visualized bilingual `.mp4` output for audio-only works

## Showcase ✨
<table>
  <tbody>
    <tr><td><details><summary><b>🎬 Video (Dynamic Comics) - Accurate timestamps, line-by-line dialogue sync</b></summary><br><img width="1280" alt="Dynamic comic and video bilingual subtitle sample" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details><summary><b>🎧 Audio (ASMR) - Bilingual subtitles + spectrum-visualized video output</b></summary><br><img width="1280" alt="Audio-only bilingual spectrum video sample" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
  </tbody>
</table>

> 💡 **Common formats work out of the box, while any unlisted or custom format can be handled directly inside the `AGENT` workspace** — see [[Supported File Formats](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)]
>
> - **E-books & Subtitles**: `.txt` `.md` `.epub` `.pdf`, `.srt` `.ass` `.ssa` `.vtt` `.lrc`
> - **Audio & Video**: Common audio (ASMR / voice) and video (anime / dynamic comics)
> - **Game Engines & Text**: `Godot` / `ACTION GAME MAKER`, `RenPy`, `Tyrano`, `WOLFRPG`, `RPGMAKER`, `KV-JSON` / `Message-JSON`

## Basic Workflow 🛸
- Download application from [Releases page](https://github.com/neavo/LinguaGacha/releases)
  - Windows:
    - Download `*_Windows_x64.zip` or `*_Windows_arm64.zip` according to your CPU type
    - Extract it and double-click `app.exe` to launch
  - <details>
    <summary>macOS:</summary>
    - Download `*_macOS_x64.dmg` or `*_macOS_arm64.dmg` according to your CPU type
    - Drag it to the Applications folder, but do not launch it yet
    - Open Terminal, enter `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app`, then press Enter
    - Enter your system password, close Terminal, and you can launch it normally
    </details>
  - <details>
    <summary>Linux:</summary>
    - Download `*_Linux_x64.AppImage` or `*_Linux_arm64.AppImage` according to your CPU type
    - Add executable permission with `chmod +x LinguaGacha*.AppImage`
    - Run `./LinguaGacha*.AppImage`
    </details>
- Obtain a reliable AI model interface. Recommended:
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN) ] (No GPU required)
- Launch the app, create a project, drag your `files`, `game folder`, or `audio/video` into the `AGENT` input box, and press Enter!

## User Guide 📝
- **Getting Started**
  - [Basic Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈 Step-by-step tutorial, a must-read for beginners`
  - [Models](https://github.com/neavo/LinguaGacha/wiki/ModelManagementEN)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN)　　[File Format Support](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)　　[FAQ](https://github.com/neavo/LinguaGacha/wiki/FAQEN)
- **Features**
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/AgentEN)　　[Proofreading](https://github.com/neavo/LinguaGacha/wiki/ProofreadingEN)　　[Glossary](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[Text Preserve](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[Text Replacement](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [Custom Prompts](https://github.com/neavo/LinguaGacha/wiki/CustomPromptEN)　　[Laboratory](https://github.com/neavo/LinguaGacha/wiki/LaboratoryEN)　　[Function Settings](https://github.com/neavo/LinguaGacha/wiki/SettingsEN)　　[MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)　　[CLI Mode](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)　　[Advanced Features](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeaturesEN)
- **Best Practices**
  - [Best Practices for High-Quality Translation of Audio and Video](https://github.com/neavo/LinguaGacha/wiki/MediaEN)
  - [Best Practices for High-Quality Translation of Godot Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)
  - [Best Practices for High-Quality Translation of RenPy Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)
  - [Best Practices for High-Quality Translation of Tyrano Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyranoEN)
  - [Best Practices for High-Quality Translation of WOLFRPG Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)
  - [Best Practices for High-Quality Translation of RPGMAKER Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- You can find more details on each feature in the [Wiki](https://github.com/neavo/LinguaGacha/wiki)

## Recent Updates 📅
- 20261113 v0.141.2
  - Improved `audio and video` translation [1095](../../issues/1092)
  - Fixes and improvements [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - Improved `audio and video` translation [#1092](../../issues/1092)
  - Fixes and improvements [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - Added `Audio (ASMR)` translation [#1085](../../pull/1085)
  - Added `Video` translation [#1085](../../pull/1085)
  - Fixes and improvements [#1083](../../issues/1083) [#1084](../../issues/1084)

## Development Guide 🛠️
- Install [Go](https://go.dev) and [`Node.js`](https://nodejs.org)
- Install dependencies `npm install`
- Update dependencies `npm ci`
- Run the application `npm run dev`
- Build the release `npm run build`
- Before submitting a PR, run the corresponding checks in [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) based on the scope of your changes
- For non-developers, please download the packaged version directly from the [Releases page](https://github.com/neavo/LinguaGacha/releases)

## Support 😥
- Runtime logs are stored in `log` folder
- Please attach relevant logs when reporting issues
- You can also join our groups for discussion and feedback:
  - Discord - https://discord.gg/pyMRBGse75
