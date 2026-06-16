<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), is an AI-powered next-generation text translator
- Out of the box, (almost) no setup needed, powerful does not need to be shown through complicated options
- Supports one-click translation between 16 languages
  - including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc
- Supports various text types and formats such as `Subtitle`, `E-Book`, and `Game Text`
- Supports both local and online interfaces compatible with `OpenAI`, `Google`, `Anthropic`, `SakuraLLM`

> <img width="2570" height="1605" alt="01" src="https://github.com/user-attachments/assets/898f6606-9c74-47db-b63e-33d544cfdf15" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## Special Notice ⚠️
- If you use [LinguaGacha](https://github.com/neavo/LinguaGacha) during translation, please include clear attribution in prominent locations of your work's information or release pages!
- For projects involving commercial activities or profits, please contact the author for authorization before using [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Feature Advantages 📌
- Ultra-fast translation speed: subtitles in ten seconds, novels in one minute, games in five minutes
- One click to generate glossary to ensure consistent translation of proper nouns like character names `👈👈 Exclusive Feature`
- Optimal translation quality, whether it's flagship models `such as DeepSeek-R1` or local small models `such as Qwen2.5-7B`
- The strongest style and code retention capability among similar applications, significantly reducing post-processing workload, making it the best choice for creating embedded Chinese localization.
  - `.md` `.ass` `.epub` formats can almost retain all original styles.
  - Most `WOLF`, `RenPy`, `RPGMaker`, `Kirikiri` games require no manual processing, allowing for instant translation and play `👈👈 Exclusive Feature`

## Basic Workflow 🛸
- Download application from [Releases page](https://github.com/neavo/LinguaGacha/releases)
  - Windows:
    - Download `*_Windows_x64.zip` or `*_Windows_arm64.zip` according to your CPU type
    - Extract it and double-click `app.exe` to launch
  - macOS:
    - Download `*_macOS_x64.dmg` or `*_macOS_arm64.dmg` according to your CPU type
    - Drag it to the Applications folder, but do not launch it yet
    - Open Terminal, enter `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app`, then press Enter
    - Enter your system password, close Terminal, and you can launch it normally
  - Linux:
    - Download `*_Linux_x64.AppImage` or `*_Linux_arm64.AppImage` according to your CPU type
    - Add executable permission with `chmod +x LinguaGacha*.AppImage`
    - Run `./LinguaGacha*.AppImage`
- Obtain a reliable AI model interface (choose one):
  - [ [Local API](https://github.com/neavo/OneClickLLAMA) ] (Free, requires ≥8GB VRAM GPU, Nvidia recommended)
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ] (Cheapest, fast, high-quality, no GPU required)
  - [ [VolcEngine](https://github.com/neavo/LinguaGacha/wiki/VolcEngine) ] (Little more expensive, **currently the best translation model**, no GPU required)　`👈👈 Recommended`
- Prepare source text:
  - `Subtitles`/`E-books` typically require no preprocessing
  - `Game texts` need extraction using appropriate tools for specific game engines
- Launch the application:
  - Drag the `files to translate` onto the page to create a project
  - Configure and activate the model you want to use in `Model Management`
  - Configure essential information such as source and target languages in `Basic Settings`
  - Run `Analysis` in `Workbench` to extract the glossary
  - Run `Translation` in `Workbench` to complete the translation
  - Enjoy!

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
  - [MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN) [TS Conversion](https://github.com/neavo/LinguaGacha/wiki/TSConversionEN)
  - You can find more details on each feature in the [Wiki](https://github.com/neavo/LinguaGacha/wiki), and you are welcome to share your experience in the [Discussions](https://github.com/neavo/LinguaGacha/discussions)

## Supported Formats 🏷️
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
- 20260616 v0.102.2
  - Support for `ARM On Linux`
  - Adjust and Improve [#630](https://github.com/neavo/LinguaGacha/issues/630) [#631](https://github.com/neavo/LinguaGacha/issues/631) [#636](https://github.com/neavo/LinguaGacha/issues/636) [#637](https://github.com/neavo/LinguaGacha/issues/637) [#638](https://github.com/neavo/LinguaGacha/issues/638)

- 20260604 v0.102.1
  - Support for `ARM On Windows`
  - Adjust and Improve [#625](https://github.com/neavo/LinguaGacha/issues/625) [#626](https://github.com/neavo/LinguaGacha/issues/626)

- 20260602 v0.102.0
  - `Name Field` is now a basic attribute
    - Can be modified on the `Proofreading Page`
    - Can be extracted in `Analysis Tasks`
    - Can respond to glossaries in `Translation Tasks`
    - ……

## Development Guide 🛠️
- Install [Go](https://go.dev) and [`Node.js`](https://nodejs.org), then run `npm install`
- Update dependencies `npm update`
- Run the application `npm run dev`
- Before submitting a PR, run the corresponding checks in [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) based on the scope of your changes
- For non-developers, please download the packaged version directly from the [Releases page](https://github.com/neavo/LinguaGacha/releases)

## Support 😥
- Runtime logs are stored in `log` folder
- Please attach relevant logs when reporting issues
- You can also join our groups for discussion and feedback:
  - Discord - https://discord.gg/pyMRBGse75

## Star History

<a href="https://www.star-history.com/?repos=neavo%2FLinguaGacha&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&legend=top-left" />
 </picture>
</a>
