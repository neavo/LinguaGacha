<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), is an AI-powered next-generation text translator
- Out of the box, (almost) no setup needed, powerful does not need to be shown through complicated setting options
- Supports one-click translation between 16 languages
  - including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc
- Supports various text types and formats such as `Subtitle`, `E-Book`, and `Game Text`
- Supports both local and online interfaces such as `Claude`, `ChatGPT`, `DeepSeek`, `SakuraLLM`

> <img width="2570" height="1605" alt="sample_01" src="https://github.com/user-attachments/assets/038a9bc3-4821-4b19-8221-eec32e823599" />

> <img width="2570" height="1605" alt="sample_02" src="https://github.com/user-attachments/assets/0fcd4749-53cd-496a-bfe6-f1270cf727f0" />

## Special Notice ⚠️
- If you use [LinguaGacha](https://github.com/neavo/LinguaGacha) during translation, please include clear attribution in prominent locations of your work's information or release pages!
- For projects involving commercial activities or profits, please contact the author for authorization before using [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Feature Advantages 📌
- Ultra-fast translation speed: subtitles in ten seconds, novels in one minute, games in five minutes
- Automatically generate a glossary to ensure consistent translation of proper nouns like character names throughout the entire work.  `👈👈 Exclusive Feature`
- Optimal translation quality, whether it's flagship models `such as DeepSeek-R1` or local small models `such as Qwen2.5-7B`
- The strongest style and code retention capability among similar applications, significantly reducing post-processing workload, making it the best choice for creating embedded Chinese localization.
  - `.md` `.ass` `.epub` formats can almost retain all original styles.
  - Most `WOLF`, `RenPy`, `RPGMaker`, `Kirikiri` games require no manual processing, allowing for instant translation and play `👈👈 Exclusive Feature`

## System Requirements 🖥️
- Compatible with AI model interfaces following `OpenAI`, `Google`, `Anthropic`, `SakuraLLM` standards

## Basic Workflow 🛸
- Download application from [Releases page](https://github.com/neavo/LinguaGacha/releases)
  - Windows: Download `.zip` file, extract and run `app.exe`
  - macOS: Download `.dmg` file, choose `x86_64` for Intel or `arm64` for Apple Silicon, drag to Applications folder
    - On first launch, you may see "unidentified developer" warning
    - Please right-click the app and select "Open", or run `xattr -cr /Applications/LinguaGacha.app`
  - Linux: Download `.AppImage` file
    - Make it executable and run `chmod +x LinguaGacha*.AppImage && ./LinguaGacha*.AppImage`
- Obtain a reliable AI model interface (choose one):
  - [ [Local API](https://github.com/neavo/OneClickLLAMA) ] (Free, requires ≥8GB VRAM GPU, Nvidia recommended)
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ] (Paid, cost-effective, fast, high-quality, no GPU required)　`👈👈 Recommended`
- Prepare source text:
  - `Subtitles`/`E-books` typically require no preprocessing
  - `Game texts` need extraction using appropriate tools for specific game engines
- Launch the application:
  - Configure essential settings (source/target languages) in `Project Settings`
  - Copy files to input folder (default: `input`), start translation in `Begin Translation`

## User Guide 📝
- Overall
  - [Basic Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈👈 Step-by-step tutorial, easy to follow, a must-read for beginners`
  - [Best Practices for High-Quality Translation of WOLF Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFEN)
  - [Best Practices for High-Quality Translation of RPGMaker Series Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- Video Tutorial
  - [How to Translate RPGMV with LinguaGacha and Translator++ (English)](https://www.youtube.com/watch?v=NbpyL2fMgDc)
- Feature Description
  - [CLI Mode](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)
  - [Glossary](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[Text Preserve](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[Text Replacement](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [Force Thinking](https://github.com/neavo/LinguaGacha/wiki/ForceThinkingEN)　　[MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)
  - [TS Conversion](https://github.com/neavo/LinguaGacha/wiki/TSConversionEN) [Name-Field Extraction](https://github.com/neavo/LinguaGacha/wiki/NameFieldExtractionEN)
  - You can find more details on each feature in the [Wiki](https://github.com/neavo/LinguaGacha/wiki), and you are welcome to share your experience in the [Discussions](https://github.com/neavo/LinguaGacha/discussions)

## Supported Formats 🏷️
- Processes all supported files in input folder (including subdirectories):
  - Subtitles (.srt .ass)
  - E-books (.txt .epub)
  - Markdown（.md）
  - [RenPy](https://www.renpy.org) exports (.rpy)
  - [MTool](https://mtool.app) exports (.json)
  - [SExtractor](https://github.com/satan53x/SExtractor) exports (.txt .json .xlsx)
  - [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools) exports (.json)
  - [Translator++](https://dreamsavior.net/translator-plusplus) project (.trans)
  - [Translator++](https://dreamsavior.net/translator-plusplus) exports (.xlsx)
  - [WOLF Official Translation Tool](https://silversecond.booth.pm/items/5151747) exports (.xlsx)
- See [Wiki - Supported Formats](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F) for examples. Submit format requests via [ISSUES](https://github.com/neavo/LinguaGacha/issues)

## Recent Updates 📅
- 2026428 v0.99.1
  - Optimizations and Improvements #513 #522
  - Try to fix startup errors on the macOS version

- 2026427 v0.99.0
  - Completely redesigned the user interface, faster, higher, stronger
  - Temporarily removed `CLI` mode

### Development Guide 🛠️
- This project consists of `Python Core` and an `Electron` frontend. We recommend preparing [**uv**](https://github.com/astral-sh/uv) and [`Node.js 24`](https://nodejs.org/)
- Install dependencies `uv sync -U --extra test` `npm --prefix frontend install`
- Update dependencies `uv sync -U --extra test` `npm --prefix frontend update`
- Run the application `npm --prefix frontend run dev`
- Before submitting a PR, run the corresponding checks in [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) based on the scope of your changes
- For non-developers, please download the packaged version directly from the [Releases page](https://github.com/neavo/LinguaGacha/releases)

## Support 😥
- Runtime logs are stored in `log` folder
- Please attach relevant logs when reporting issues
- You can also join our groups for discussion and feedback:
  - Discord - https://discord.gg/pyMRBGse75
