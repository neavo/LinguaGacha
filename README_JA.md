<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>AIの能力を活用して小説、ゲーム、字幕などのテキストをワンクリックで翻訳する次世代のテキスト翻訳ツール</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ] | [ [한국어](./README_KO.md) ] | [ [Deutsch](./README_DE.md) ]

## 概要 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)、AIを活用した次世代のテキスト翻訳ツールです
- 箱から出してすぐに使え、（ほぼ）設定不要。機能の強力さは、煩雑な設定を必要としません。
- `中国語`、`英語`、`日本語`、`韓国語`、`ロシア語`、`ドイツ語`、`フランス語`、`イタリア語`など 16 言語にワンタッチ双方向翻訳対応。
- `字幕`、`電子書籍`、`ゲームテキストなど`、色々なテキストタイプと形式に対応。
- `OpenAI`、`Google`、`Anthropic`、`SakuraLLM` などのローカルおよびオンラインインターフェースをサポート

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 特別なお知らせ ⚠️
- 翻訳中に [LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する場合は、作品の情報やリリースページの目立つ場所に明確な帰属を含めてください！
- 商業活動や利益を伴うプロジェクトの場合は、[LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する前に、著者に連絡して許可を得てください！

## 機能の利点 📌
- 対話を通じてさまざまなタスクを自動で完了する内蔵 `AGENT` モード　`👈👈 独自の強み`
- 用語集をワンクリックで生成し、キャラクター名などの専門用語の訳語を作品全体で統一
- 最高の翻訳品質と最速の翻訳速度、10秒で字幕1本、1分で小説1冊、5分でゲーム1本
- 同種のアプリケーションの中で最強のスタイルとコード保持能力、後工程の作業量を大幅に削減、字幕埋め込み（内嵌字幕）作成に最適
  - `字幕` `電子書籍` は元のスタイルをすべて保持
  - `RenPy` `Godot` `WOLFRPG` `RPGMAKER` `Kirikiri` `ACTION GAME MAKER` のゲームは翻訳後すぐにプレイ可能

## ワークフロー 🛸
- [リリースページ](https://github.com/neavo/LinguaGacha/releases) からアプリケーションをダウンロード
  - Windows:
    - CPU の種類に応じて `*_Windows_x64.zip` または `*_Windows_arm64.zip` をダウンロード
    - 解凍して `app.exe` をダブルクリックして起動
  - <details>
    <summary>macOS:</summary>
    - CPU の種類に応じて `*_macOS_x64.dmg` または `*_macOS_arm64.dmg` をダウンロード
    - アプリケーションフォルダにドラッグし、まだ起動しないでください
    - ターミナルを開き、`sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` と入力して Enter を押してください
    - システムパスワードを入力し、ターミナルを閉じると、通常通り起動できます
    </details>
  - <details>
    <summary>Linux:</summary>
    - CPU の種類に応じて `*_Linux_x64.AppImage` または `*_Linux_arm64.AppImage` をダウンロード
    - `chmod +x LinguaGacha*.AppImage` で実行権限を付与
    - `./LinguaGacha*.AppImage` を実行
    </details>
- 信頼できるAIモデルインターフェースを取得。おすすめ：
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN) ] (GPU不要)
- ソーステキストを準備：
  - `字幕`/`電子書籍`は通常、前処理が不要
  - `ゲームテキスト`は特定のゲームエンジンに適したツールを使用して抽出が必要
- アプリケーションを起動：
  - `翻訳するファイル` をページにドラッグしてプロジェクトを作成
  - `基本設定` でソース言語、ターゲット言語などの必要な情報を設定
  - `AGENT` でモデルを選択し、画面上のプリセット指示を順にクリックして以下の手順を実行：
    - `用語抽出`　`👈👈 任意ですが推奨。翻訳品質に大きく影響します`
    - `全文翻訳`
    - `自動校正`　`👈👈 任意ですが推奨。翻訳品質に大きく影響します`
  - `AGENT` で訳文生成をクリック

## 使い方チュートリアル - English 📝
- Getting Started
  - [Basic Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈👈 Step-by-step tutorial, easy to follow, a must-read for beginners`
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

## 対応フォーマット 🏷️
- 字幕 `.srt .ass .ssa .vtt .lrc`
- 電子書籍 `.txt .pdf .epub`
- Markdown `.md`
- [RenPy](https://www.renpy.org) エクスポート `.rpy`
- `KV-JSON` ゲームテキスト `.json`、出力元 [MTool](https://mtool.app) [SExtractor](https://github.com/satan53x/SExtractor)
- `Message-JSON` ゲームテキスト `.json`、出力元 [SExtractor](https://github.com/satan53x/SExtractor) [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)
- `Godot 4` ゲームファイル：ゲームフォルダーまたは `.exe` をインポート
- `WOLFRPG 3` ゲームファイル：ゲームフォルダーまたは `.exe` をインポート
- `RPGMAKER MV/MZ` ゲームファイル：ゲームフォルダーまたは `.exe` をインポート
- `RPGMAKER XP/VX/VXAce` ゲームファイル：ゲームフォルダーまたは `.exe` をインポート
- サポート終了予定：
  - プロジェクトファイル `.trans`、出力元 [Translator++](https://dreamsavior.net/translator-plusplus)
  - ゲームテキスト `.xlsx`、出力元 [SExtractor](https://github.com/satan53x/SExtractor) [Translator++](https://dreamsavior.net/translator-plusplus) [WOLF 公式翻訳ツール](https://silversecond.booth.pm/items/5151747)
- 例については [Wiki - 対応フォーマット](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN) を参照。対応フォーマットは今後も追加予定

## 最近の更新 📅
- 20261020 v0.130.0
  - `Godot 4` ゲームのネイティブサポート [#1005](../../issues/1005)
  - `ACTION GAME MAKER` ゲームのネイティブサポート [#1005](../../issues/1005)

## 開発ガイド 🛠️
- [Go](https://go.dev) と [`Node.js`](https://nodejs.org) をインストール
- 依存関係のインストール: `npm install`
- 依存関係の更新: `npm ci`
- アプリの実行: `npm run dev`
- リリースのビルド: `npm run build`
- PRを提出する前に、変更範囲に応じて [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) の対応する検証を実行してください
- 非開発者の方は [リリースページ](https://github.com/neavo/LinguaGacha/releases) からビルド済みバージョンをダウンロードすることをお勧めします

## サポート 😥
- 実行時のログは `log` フォルダに保存されます
- 問題を報告する際は、関連するログを添付してください
- グループに参加して、ディスカッションやフィードバックもできます。
  - Discord - https://discord.gg/pyMRBGse75
