<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Agent Harness especializado em tradução de romances, jogos, documentos, áudio e vídeo</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## Visão Geral 📢
- O [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/) é um `Agent Harness` de última geração projetado especificamente para localização de alta qualidade em múltiplos formatos
- Pronto para uso, (quase) sem necessidade de configuração; ser poderoso não significa ter opções complicadas
- Suporta tradução com um clique entre 16 idiomas
  - incluindo `Chinês`, `Inglês`, `Japonês`, `Coreano`, `Russo`, `Alemão`, `Francês`, `Italiano`, `Português`, etc.
- Suporte nativo para `Legendas`, `E-Books`, `Engines de Jogos`, `Áudio (ASMR)` e `Vídeo (Motion Comics / Anime)`, além de formatos incomuns ou personalizados que podem ser analisados e gravados de volta diretamente no espaço do `AGENT`
- Compatível com interfaces locais e online compatíveis com `OpenAI`, `Google`, `Anthropic`, `SakuraLLM`

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## Aviso Especial ⚠️
- Se você usar o [LinguaGacha](https://github.com/neavo/LinguaGacha) durante a tradução, inclua a atribuição clara em locais de destaque nas informações ou páginas de lançamento do seu trabalho!
- Para projetos comerciais ou com fins lucrativos, entre em contato com o autor para autorização antes de utilizar o [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Vantagens e Recursos 📌
- Qualidade de tradução ideal e velocidade de tradução ultrarrápida
  - Preserva totalmente os estilos de formatação de `Legendas` e `E-books`
  - Gera glossários automaticamente para manter os nomes próprios e termos consistentes em toda a obra
  - Legendas em dez segundos, um romance em um minuto, um jogo em cinco minutos
- Modo `AGENTE` integrado que conclui tarefas automaticamente via conversa `👈👈 Recurso Exclusivo`
  - Não requer conhecimento técnico: basta traduzir e jogar
  - Suporta os principais motores: `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `Unity` `Bakin` `RealLive` `Escude` `ACTION GAME MAKER`
  - **`Tradução completa de Áudio e Vídeo (ASMR / Motion Comics)`**: ASR local + detecção de texto na tela com legendas `.ass` bilíngues que desviam de balões e rostos, além de vídeos `.mp4` bilíngues em `1920×1080` com espectro visual para arquivos apenas de áudio

## Demonstração ✨
<table>
  <tbody>
    <tr><td><details><summary><b>🎬 Vídeo (Motion Comics) - Linha do tempo precisa com alinhamento por diálogo</b></summary><br><img width="1280" alt="Exemplo de legendas bilíngues para vídeo e motion comics" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/video.jpg" /></details></td></tr>
    <tr><td><details><summary><b>🎧 Áudio (ASMR) - Legendas bilíngues + vídeo com espectro visual</b></summary><br><img width="1280" alt="Exemplo de vídeo bilíngue com espectro de áudio" src="https://raw.githubusercontent.com/wiki/neavo/LinguaGacha/assets/audio.jpg" /></details></td></tr>
  </tbody>
</table>

> 💡 **Formatos comuns funcionam prontos para uso, enquanto formatos personalizados ou scripts podem ser entregues diretamente ao espaço de trabalho do `AGENTE`** — veja [[Formatos de Arquivo Suportados](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)]
>
> - **E-books e Legendas**: `.txt` `.md` `.epub` `.pdf`, `.srt` `.ass` `.ssa` `.vtt` `.lrc`
> - **Áudio e Vídeo**: Áudios comuns (ASMR / voz) e vídeos (anime / motion comics)
> - **Engines de Jogos e Texto**: `Godot` / `ACTION GAME MAKER`, `RenPy`, `Tyrano`, `WOLFRPG`, `RPGMAKER`, `KV-JSON` / `Message-JSON`

## Fluxo Básico de Uso 🛸
- Baixe o aplicativo na [página de Releases](https://github.com/neavo/LinguaGacha/releases)
  - Windows:
    - Baixe `*_Windows_x64.zip` ou `*_Windows_arm64.zip` de acordo com seu processador
    - Extraia o arquivo e clique duas vezes em `app.exe` para iniciar
  - <details>
    <summary>macOS:</summary>
    - Baixe `*_macOS_x64.dmg` ou `*_macOS_arm64.dmg` de acordo com seu processador
    - Arraste-o para a pasta Aplicativos, mas ainda não abra
    - Abra o Terminal, digite `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` e pressione Enter
    - Digite sua senha de sistema, feche o Terminal e abra o aplicativo normalmente
    </details>
  - <details>
    <summary>Linux:</summary>
    - Baixe `*_Linux_x64.AppImage` ou `*_Linux_arm64.AppImage` de acordo com seu processador
    - Conceda permissão de execução com `chmod +x LinguaGacha*.AppImage`
    - Execute `./LinguaGacha*.AppImage`
    </details>
- Obtenha uma interface de modelo de IA confiável. Recomendado:
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN) ] (Não requer GPU dedicada)
- Inicie o aplicativo, crie um projeto, arraste `arquivos`, `pasta do jogo` ou `áudio/vídeo` para a caixa de entrada do `AGENTE` e pressione Enter!

## Guia do Usuário 📝
- **Primeiros Passos**
  - [Tutorial Básico](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈 Tutorial passo a passo, leitura obrigatória para iniciantes`
  - [Gerenciamento de Modelos](https://github.com/neavo/LinguaGacha/wiki/ModelManagementEN)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN)　　[Formatos de Arquivo Suportados](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)　　[FAQ](https://github.com/neavo/LinguaGacha/wiki/FAQEN)
- **Recursos**
  - [AGENTE](https://github.com/neavo/LinguaGacha/wiki/AgentEN)　　[Revisão](https://github.com/neavo/LinguaGacha/wiki/ProofreadingEN)　　[Glossário](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[Preservação de Texto](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[Substituição de Texto](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [Prompts Personalizados](https://github.com/neavo/LinguaGacha/wiki/CustomPromptEN)　　[Laboratório](https://github.com/neavo/LinguaGacha/wiki/LaboratoryEN)　　[Configurações](https://github.com/neavo/LinguaGacha/wiki/SettingsEN)　　[Otimizador MTool](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)　　[Modo CLI](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)　　[Recursos Avançados](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeaturesEN)
- **Melhores Práticas**
  - [Melhores Práticas para Áudio e Vídeo](https://github.com/neavo/LinguaGacha/wiki/MediaEN)
  - [Melhores Práticas para Jogos em Godot Engine](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)
  - [Melhores Práticas para Jogos em RenPy Engine](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)
  - [Melhores Práticas para Jogos em Tyrano Engine](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyranoEN)
  - [Melhores Práticas para Jogos em WOLFRPG Engine](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)
  - [Melhores Práticas para Jogos em RPGMAKER Engine](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- Mais detalhes sobre cada recurso podem ser encontrados na [Wiki](https://github.com/neavo/LinguaGacha/wiki)

## Atualizações Recentes 📅
- 20261113 v0.141.2
  - Melhorada a tradução de `áudio e vídeo` [1095](../../issues/1092)
  - Correções e melhorias [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - Melhorada a tradução de `áudio e vídeo` [#1092](../../issues/1092)
  - Correções e melhorias [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - Adicionada tradução de `áudio (ASMR)` [#1085](../../pull/1085)
  - Adicionada tradução de `vídeo` [#1085](../../pull/1085)
  - Correções e melhorias [#1083](../../issues/1083) [#1084](../../issues/1084)

## Guia de Desenvolvimento 🛠️
- Instale [Go](https://go.dev) e [`Node.js`](https://nodejs.org)
- Instale as dependências: `npm install`
- Atualize as dependências: `npm ci`
- Execute a aplicação: `npm run dev`
- Compile o pacote de distribuição: `npm run build`
- Antes de submeter um PR, execute as verificações correspondentes em [`docs/WORKFLOW.md`](./docs/WORKFLOW.md)
- Para usuários comuns, faça o download da versão empacotada diretamente na [página de Releases](https://github.com/neavo/LinguaGacha/releases)

## Suporte 😥
- Os registros de execução são armazenados na pasta `log`
- Ao reportar problemas, anexe os registros correspondentes
- Participe dos grupos da comunidade para discussões e feedback:
  - Discord - https://discord.gg/pyMRBGse75
