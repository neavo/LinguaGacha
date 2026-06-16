<div align=center><img src="https://github.com/user-attachments/assets/de19ec3f-246c-432d-9636-ff16f82b094e" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>AIの能力を活用して小説、ゲーム、字幕などのテキストをワンクリックで翻訳する次世代のテキスト翻訳ツール</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## 概要 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)、AIを活用した次世代のテキスト翻訳ツールです
- 箱から出してすぐに使え、（ほぼ）設定不要。機能の強力さは、煩雑な設定を必要としません。
- `中国語`、`英語`、`日本語`、`韓国語`、`ロシア語`、`ドイツ語`、`フランス語`、`イタリア語`など 16 言語にワンタッチ双方向翻訳対応。
- `字幕`、`電子書籍`、`ゲームテキストなど`、色々なテキストタイプと形式に対応。
- `OpenAI`、`Google`、`Anthropic`、`SakuraLLM` などのローカルおよびオンラインインターフェースをサポート

> <img width="2570" height="1605" alt="01" src="https://github.com/user-attachments/assets/898f6606-9c74-47db-b63e-33d544cfdf15" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 特別なお知らせ ⚠️
- 翻訳中に [LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する場合は、作品の情報やリリースページの目立つ場所に明確な帰属を含めてください！
- 商業活動や利益を伴うプロジェクトの場合は、[LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する前に、著者に連絡して許可を得てください！

## 機能の利点 📌
- 圧倒的な翻訳速度、10秒で字幕1本、1分で小説1冊、5分でゲーム1本
- 用語集をワンクリックで生成し、キャラクター名などの専門用語の訳語を作品全体で統一　`👈👈 独自の強み`
- 最高の翻訳品質、フラッグシップモデル `DeepSeek-R1など` でも、ローカル小規模モデル　`Qwen2.5-7Bなど` でも
- 同種のアプリケーションの中で最強のスタイルとコード保持能力、後工程の作業量を大幅に削減、字幕埋め込み（内嵌字幕）作成に最適
  - `.md` `.ass` `.epub` 形式はほぼすべての元のスタイルを保持可能
  - 大部分の `WOLF`、`RenPy`、`RPGMaker`、`Kirikiri` エンジンゲームは手作業なしで、即翻訳即プレイ可能　`👈👈 独自の強み`

## ワークフロー 🛸
- [リリースページ](https://github.com/neavo/LinguaGacha/releases) からアプリケーションをダウンロード
  - Windows:
    - CPU の種類に応じて `*_Windows_x64.zip` または `*_Windows_arm64.zip` をダウンロード
    - 解凍して `app.exe` をダブルクリックして起動
  - macOS:
    - CPU の種類に応じて `*_macOS_x64.dmg` または `*_macOS_arm64.dmg` をダウンロード
    - アプリケーションフォルダにドラッグし、まだ起動しないでください
    - ターミナルを開き、`sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` と入力して Enter を押してください
    - システムパスワードを入力し、ターミナルを閉じると、通常通り起動できます
  - Linux:
    - CPU の種類に応じて `*_Linux_x64.AppImage` または `*_Linux_arm64.AppImage` をダウンロード
    - `chmod +x LinguaGacha*.AppImage` で実行権限を付与
    - `./LinguaGacha*.AppImage` を実行
- 信頼できるAIモデルインターフェースを取得（以下のいずれかを選択）：
  - [ [Local API](https://github.com/neavo/OneClickLLAMA) ] (無料、8GB以上のVRAM GPUが必要、Nvidia推奨)
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ] (最安、高速、高品質、NO-GPU)
  - [ [VolcEngine](https://github.com/neavo/LinguaGacha/wiki/VolcEngine) ] (少し高め、**現在最高の翻訳モデル**、NO-GPU)　`👈👈 推奨`
- ソーステキストを準備：
  - `字幕`/`電子書籍`は通常、前処理が不要
  - `ゲームテキスト`は特定のゲームエンジンに適したツールを使用して抽出が必要
- アプリケーションを起動：
  - `翻訳するファイル` をページにドラッグしてプロジェクトを作成
  - `モデル管理` で使用するモデルを設定し、有効化
  - `基本設定` でソース言語、ターゲット言語などの必要な情報を設定
  - `ワークベンチ` で `分析` を実行して用語集を抽出
  - `ワークベンチ` で `翻訳` を実行して翻訳を完了
  - Enjoy!

## 使い方チュートリアル - English 📝
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

## 対応フォーマット 🏷️
- 字幕 (.srt .ass)
- 電子書籍 (.txt .epub)
- Markdown（.md）
- [RenPy](https://www.renpy.org) エクスポート (.rpy)
- [MTool](https://mtool.app) エクスポート (.json)
- [SExtractor](https://github.com/satan53x/SExtractor) エクスポート (.txt .json .xlsx)
- [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools) exports (.json)
- [Translator++](https://dreamsavior.net/translator-plusplus) プロジェクト (.trans)
- [Translator++](https://dreamsavior.net/translator-plusplus) エクスポート (.xlsx)
- [WOLF 公式翻訳ツール](https://silversecond.booth.pm/items/5151747) エクスポート（.xlsx）
- 例については [Wiki - 対応フォーマット](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F) を参照。フォーマットのリクエストは [ISSUES](https://github.com/neavo/LinguaGacha/issues) で提出

## 最近の更新 📅
- 20260604 v0.102.1
  - `ARM On Windows` のパッケージング対応を追加
  - 調整と改善 [#625](https://github.com/neavo/LinguaGacha/issues/625) [#626](https://github.com/neavo/LinguaGacha/issues/626)

- 20260602 v0.102.0
  - `名前フィールド` が基本属性になりました
    - `校正ページ` で変更可能
    - `分析タスク` で抽出可能
    - `翻訳タスク` で用語集に反応可能
    - ……

## 開発ガイド 🛠️
- [Go](https://go.dev) と [`Node.js`](https://nodejs.org) をインストールし、その後 `npm install` を実行します
- 依存関係の更新: `npm update`
- アプリの実行: `npm run dev`
- PRを提出する前に、変更範囲に応じて [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) の対応する検証を実行してください
- 非開発者の方は [リリースページ](https://github.com/neavo/LinguaGacha/releases) からビルド済みバージョンをダウンロードすることをお勧めします

## サポート 😥
- 実行時のログは `log` フォルダに保存されます
- 問題を報告する際は、関連するログを添付してください
- グループに参加して、ディスカッションやフィードバックもできます。
  - Discord - https://discord.gg/pyMRBGse75

## Star History

<a href="https://www.star-history.com/?repos=neavo%2FLinguaGacha&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=neavo/LinguaGacha&type=date&legend=top-left" />
 </picture>
</a>
