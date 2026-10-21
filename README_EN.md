<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ] | [ [한국어](./README_KO.md) ] | [ [Deutsch](./README_DE.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), is an AI-powered next-generation text translator
- Out of the box, (almost) no setup needed, powerful does not need to be shown through complicated options
- Supports one-click translation between 16 languages
  - including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc
- Supports various text types and formats such as `Subtitle`, `E-Book`, and `Game Text`
- Supports both local and online interfaces compatible with `OpenAI`, `Google`, `Anthropic`, `SakuraLLM`

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
- Built-in `AGENT` mode that automatically completes various tasks through conversation `👈👈 Exclusive Feature`
  - No technical knowledge required: translate and play
  - Covers major engines: `RenPy` `Godot` `WOLFRPG` `RPGMAKER` `Kirikiri` `ACTION GAME MAKER`

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
- Launch the application:
  - Drag the `files to translate` onto the page to create a project
  - Configure essential information such as source and target languages on the `Basic Settings` page
  - Select a model on the `AGENT` page, then click the preset instructions in the interface in order to complete the following steps:
    - `Glossary Extraction`　`👈👈 Optional but recommended; important for translation quality`
    - `Full Text Translation`
    - `Automatic Proofreading`　`👈👈 Optional but recommended; important for translation quality`
  - Click Generate Translation on the `AGENT` or `Workbench` page

## User Guide 📝
- Getting Started
  - [Basic Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈 Step-by-step tutorial, easy to follow, a must-read for beginners`
  - [File Format Support](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)
- Model Setup
  - [Model Management](https://github.com/neavo/LinguaGacha/wiki/ModelManagementEN)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN)
- Feature Description
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/AgentEN)　　[Proofreading](https://github.com/neavo/LinguaGacha/wiki/ProofreadingEN)
  - [Glossary](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[Text Preserve](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[Text Replacement](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)　　[CLI Mode](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)
- Engine Best Practices
  - [Best Practices for High-Quality Translation of RenPy Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)
  - [Best Practices for High-Quality Translation of Godot Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)
  - [Best Practices for High-Quality Translation of WOLFRPG Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)
  - [Best Practices for High-Quality Translation of RPGMAKER Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- Community Notes
  - [Machine Translation Notes for Kirikiri Engine Games Without Complex Encryption](https://github.com/neavo/LinguaGacha/discussions/181)
- You can find more details on each feature in the [Wiki](https://github.com/neavo/LinguaGacha/wiki)
- You are welcome to share your experience in the [Discussions](https://github.com/neavo/LinguaGacha/discussions)

## Supported Formats 🏷️
| Type | Format | Notes |
|:---|:---|:---|
| Subtitles | `.srt` `.ass` `.ssa` `.vtt` `.lrc` | - |
| E-books | `.txt` `.pdf` `.epub` | - |
| Markdown | `.md` | - |
| `KV-JSON` game text | `.json` | Source: [[MTool](https://mtool.app)] [[SExtractor](https://github.com/satan53x/SExtractor)] |
| `Message-JSON` game text | `.json` | Source: [[SExtractor](https://github.com/satan53x/SExtractor)] [[VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)] |
| `RenPy` game text | `.rpy` | Guide: [[Best Practices for High-Quality Translation of RenPy Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)] |
| `Godot 4` game files | `.exe` or game directory | Guide: [[Best Practices for High-Quality Translation of Godot Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)] |
| `WOLFRPG 3` game files | `.exe` or game directory | Guide: [[Best Practices for High-Quality Translation of WOLFRPG Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)] |
| `RPGMAKER MV/MZ` game files | `.exe` or game directory | Guide: [[Best Practices for High-Quality Translation of RPGMAKER Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)] |
| `RPGMAKER XP/VX/VXAce` game files | `.exe` or game directory | Guide: [[Best Practices for High-Quality Translation of RPGMAKER Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)] |
| `.xlsx` game text | `.xlsx` | Source: [SExtractor](https://github.com/satan53x/SExtractor) [Translator++](https://dreamsavior.net/translator-plusplus) [WOLF Official Translation Tool](https://silversecond.booth.pm/items/5151747)　`👈 Support ending soon` |
| `.trans` project files | `.trans` | Source: [Translator++](https://dreamsavior.net/translator-plusplus)　`👈 Support ending soon` |

## Recent Updates 📅
- 20261021 v0.130.1
  - Native support for encrypted `Godot 4` games [#1011](../../issues/1011)
  - Fixes and improvements [#1013](../../issues/1013) [#1014](../../issues/1014) [#1015](../../issues/1015)

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
