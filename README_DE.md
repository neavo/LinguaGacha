<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Ein Textübersetzer der nächsten Generation, der Romane, Spiele, Untertitel und mehr mit KI auf Knopfdruck übersetzt</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ] | [ [한국어](./README_KO.md) ] | [ [Deutsch](./README_DE.md) ]

## Überblick 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/) ist ein KI-gestützter Textübersetzer der nächsten Generation
- Sofort einsatzbereit, (fast) ohne Einrichtung: Leistungsstarke Funktionen brauchen keine komplizierten Einstellungen
- Übersetzt auf Knopfdruck zwischen 16 Sprachen, darunter `Chinesisch`, `Englisch`, `Japanisch`, `Koreanisch`, `Russisch`, `Deutsch`, `Französisch` und `Italienisch`
- Unterstützt verschiedene Textarten und Formate wie `Untertitel`, `E-Books` und `Spieltexte`
- Unterstützt lokale und Online-Schnittstellen wie `OpenAI`, `Google`, `Anthropic` und `SakuraLLM`

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## Besondere Hinweise ⚠️
- Wenn Sie [LinguaGacha](https://github.com/neavo/LinguaGacha) für Ihre Übersetzung verwenden, weisen Sie bitte an gut sichtbarer Stelle in den Werkangaben oder auf der Veröffentlichungsseite darauf hin!
- Wenn Ihr Projekt kommerzielle Aktivitäten oder Einnahmen umfasst, kontaktieren Sie bitte vor der Nutzung von [LinguaGacha](https://github.com/neavo/LinguaGacha) den Autor, um eine Genehmigung einzuholen!

## Vorteile 📌
- Beste Übersetzungsqualität und höchste Übersetzungsgeschwindigkeit
  - Erhält die Formatierung verschiedener `Untertitel` und `E-Books` vollständig
  - Erstellt automatisch ein Glossar, damit Eigennamen im gesamten Werk einheitlich übersetzt werden
  - Untertitel in zehn Sekunden, ein Roman in einer Minute, ein Spiel in fünf Minuten
- Integrierter `AGENT`-Modus, der verschiedene Aufgaben automatisch im Dialog erledigt　`👈👈 Exklusive Funktion`
  - Keine technischen Kenntnisse erforderlich: übersetzen und sofort spielen
  - Unterstützt alle gängigen Engines: `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `ACTION GAME MAKER`

## Erste Schritte 🛸
- Laden Sie die Anwendung von der [Release-Seite](https://github.com/neavo/LinguaGacha/releases) herunter
  - Windows:
    - Laden Sie je nach CPU-Typ `*_Windows_x64.zip` oder `*_Windows_arm64.zip` herunter
    - Entpacken Sie das Archiv und starten Sie die Anwendung per Doppelklick auf `app.exe`
  - <details>
    <summary>macOS:</summary>
    - Laden Sie je nach CPU-Typ `*_macOS_x64.dmg` oder `*_macOS_arm64.dmg` herunter
    - Ziehen Sie die Anwendung in den Programme-Ordner, starten Sie sie aber noch nicht
    - Öffnen Sie das Terminal, geben Sie `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` ein und drücken Sie die Eingabetaste
    - Geben Sie Ihr Systempasswort ein und schließen Sie das Terminal. Sie können die Anwendung jetzt normal starten
    </details>
  - <details>
    <summary>Linux:</summary>
    - Laden Sie je nach CPU-Typ `*_Linux_x64.AppImage` oder `*_Linux_arm64.AppImage` herunter
    - Erteilen Sie mit `chmod +x LinguaGacha*.AppImage` die Ausführungsberechtigung
    - Führen Sie `./LinguaGacha*.AppImage` aus
    </details>
- Besorgen Sie sich Zugang zu einer zuverlässigen KI-Modellschnittstelle. Empfehlung:
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ], keine Grafikkarte erforderlich
- Starten Sie die Anwendung
  - Ziehen Sie die `zu übersetzenden Dateien` auf die Seite, um ein Projekt zu erstellen
  - Legen Sie auf der Seite `Grundeinstellungen` die Ausgangs- und Zielsprache sowie weitere erforderliche Angaben fest
  - Wählen Sie auf der Seite `AGENT` ein Modell aus und klicken Sie nacheinander auf die vorgegebenen Anweisungen, um folgende Schritte auszuführen:
    - `Terminologie extrahieren`　`👈👈 Optional, aber empfohlen; wichtig für die Qualität`
    - `Vollständigen Text übersetzen`
    - `Automatisch Korrektur lesen`　`👈👈 Optional, aber empfohlen; wichtig für die Qualität`
  - Klicken Sie auf der Seite `AGENT` oder `Werkbank` auf die Option zum Generieren der Übersetzung

## Anleitungen 📝
- Einstieg
  - [Grundlagen-Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈 Schritt für Schritt erklärt, leicht verständlich und für Einsteiger empfohlen`
  - [Unterstützte Dateiformate](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormat)
- Modelleinrichtung
  - [Modellverwaltung](https://github.com/neavo/LinguaGacha/wiki/ModelManagement)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)
- Funktionsbeschreibungen
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/Agent)　　[Korrekturlesen](https://github.com/neavo/LinguaGacha/wiki/Proofreading)
  - [Glossar](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[Textschutz](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[Textersetzung](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [MTool-Optimierer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[Befehlszeilenmodus](https://github.com/neavo/LinguaGacha/wiki/CLIMode)　　[Erweiterte Funktionen](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeatures)
- Engine-Praxis
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von Godot-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von RenPy-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von Tyrano-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von WOLFRPG-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von RPGMAKER-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- Erfahrungen der Community
  - [Notizen zur maschinellen Übersetzung von Kirikiri-Spielen ohne komplexe Verschlüsselung](https://github.com/neavo/LinguaGacha/discussions/181)
- Ausführlichere Informationen zu den Funktionen finden Sie im [Wiki](https://github.com/neavo/LinguaGacha/wiki)

## Unterstützte Formate 🏷️
| Typ | Format | Hinweise |
|:---|:---|:---|
| Untertitel | `.srt` `.ass` `.ssa` `.vtt` `.lrc` | - |
| E-Books | `.txt` `.pdf` `.epub` | - |
| Markdown | `.md` | - |
| `KV-JSON` Spieltexte | `.json` | Quelle: [[MTool](https://mtool.app)] [[SExtractor](https://github.com/satan53x/SExtractor)] |
| `Message-JSON` Spieltexte | `.json` | Quelle: [[SExtractor](https://github.com/satan53x/SExtractor)] [[VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)] |
| `Godot` Spieldateien | `.exe` oder Spielverzeichnis | Anleitung: [[Bewährte Vorgehensweisen für hochwertige Übersetzungen von Godot-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodot)] |
| `RenPy` Spieldateien | `.exe` oder Spielverzeichnis | Anleitung: [[Bewährte Vorgehensweisen für hochwertige Übersetzungen von RenPy-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)] |
| `Tyrano` Spieldateien | `.exe` oder Spielverzeichnis | Anleitung: [[Bewährte Vorgehensweisen für hochwertige Übersetzungen von Tyrano-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyrano)] |
| `WOLFRPG` Spieldateien | `.exe` oder Spielverzeichnis | Anleitung: [[Bewährte Vorgehensweisen für hochwertige Übersetzungen von WOLFRPG-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPG)] |
| `RPGMAKER MV/MZ` Spieldateien | `.exe` oder Spielverzeichnis | Anleitung: [[Bewährte Vorgehensweisen für hochwertige Übersetzungen von RPGMAKER-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)] |
| `RPGMAKER XP/VX/VXAce` Spieldateien | `.exe` oder Spielverzeichnis | Anleitung: [[Bewährte Vorgehensweisen für hochwertige Übersetzungen von RPGMAKER-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)] |
| `.rpy` Spieltexte | `.rpy` | `👈 Unterstützung endet bald` |
| `.xlsx` Spieltexte | `.xlsx` | Quelle: [SExtractor](https://github.com/satan53x/SExtractor) [Translator++](https://dreamsavior.net/translator-plusplus) [offizielles WOLF-Übersetzungswerkzeug](https://silversecond.booth.pm/items/5151747)　`👈 Unterstützung endet bald` |
| `.trans` Projektdateien | `.trans` | Quelle: [Translator++](https://dreamsavior.net/translator-plusplus)　`👈 Unterstützung endet bald` |

## Neueste Updates 📅
- 20261029 v0.132.1
  - Korrekturen und Verbesserungen [#1049](../../issues/1049) [#1050](../../issues/1050) [#1052](../../issues/1052) [#1053](../../issues/1053) [#1054](../../issues/1054)

## Entwicklung 🛠️
- Installieren Sie [Go](https://go.dev) und [`Node.js`](https://nodejs.org)
- Abhängigkeiten installieren: `npm install`
- Abhängigkeiten aktualisieren: `npm ci`
- Anwendung starten: `npm run dev`
- Release erstellen: `npm run build`
- Führen Sie vor dem Einreichen eines PR die zum Änderungsumfang passenden Prüfungen aus [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) aus
- Wenn Sie nicht selbst entwickeln möchten, laden Sie die fertige Version direkt von der [Release-Seite](https://github.com/neavo/LinguaGacha/releases) herunter

## Probleme melden 😥
- Laufzeitprotokolle werden unter anderem im Ordner `log` im Stammverzeichnis der Anwendung gespeichert
- Fügen Sie diese Protokolldateien bitte Ihrer Fehlermeldung bei
- Sie können auch unseren Gruppen beitreten, um sich auszutauschen und Feedback zu geben
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
