# Arara Browser

Extensão Manifest V3, open source (MIT), que conecta a sessão do ChatGPT no Chrome/Edge ao Arara Code. O navegador mantém o login; a IDE executa ferramentas e controla permissões.

## Instalar

Na IDE, abra **ChatGPT → Conexão com navegador → Salvar extensão…** e escolha uma pasta. A IDE baixa a release pública, verifica SHA-256 e abre `Arara-Browser`. No navegador, abra **Extensões → Modo do desenvolvedor → Carregar sem compactação** e selecione essa pasta.

Também é possível baixar o ZIP em [Releases](https://github.com/arara-ide/arara-browser/releases/latest) e extrair manualmente. Não selecione “Source code”. Chrome/Edge 120 ou superior; Firefox não é suportado.

Abra o ícone da extensão, cole o código da IDE e clique em **Conectar**. Mantenha o navegador aberto e o ChatGPT conectado. Reiniciar a IDE ou o navegador exige parear novamente.

## Atualizar

Cada abertura do popup consulta a última release estável no GitHub. Se houver uma versão maior, **Atualizar** abre o download direto do ZIP daquela release. Extraia na mesma pasta, clique em **Recarregar** na tela de extensões e atualize a aba do ChatGPT mantendo a URL da conversa.

Na IDE, **Atualizar extensão…** baixa e substitui os arquivos na pasta salva, com verificação de integridade e recuperação da versão anterior em caso de falha. Depois, recarregue a extensão e a aba. Para migrar uma instalação antiga, selecione a própria pasta já carregada no navegador ao salvar pela IDE: ela será reconhecida e atualizada no mesmo lugar. **Escolher outra pasta…** permite alterar o destino depois.

Extensões sem compactação não podem substituir seus próprios arquivos. A consulta ao GitHub não envia o código de conexão ou conversas; falhas de rede não impedem o pareamento.

## Desenvolvimento e compatibilidade

```sh
npm ci --ignore-scripts
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:content
npm run test:compatibility
```

Node 22/24. CI executa a matriz em Linux, Windows e macOS. Testes cobrem entrega/retomada de mensagens, seleção de modelos, cancelamento e respostas em página simulada, além de carregar a extensão real no Chromium com Manifest V3, service worker, popup e atualização. Testes não usam contas reais nem dependem da interface ao vivo do ChatGPT. Alterações do site exigem validação manual adicional. Chrome e Edge compartilham o alvo Chromium, mas não são executados separadamente na CI.

O teste integrado com o executor privado fica no `arara-ai`: `ARARA_BROWSER_PATH=/caminho/arara-browser npm run test:chatgpt-browser`. A implementação do agente e seus prompts não são distribuídos aqui.

## Releases

Atualize `version` em `package.json` e `extension/manifest.json` juntos, regenere o lockfile e descreva a versão em `RELEASE.md`. Push na `main` ou tag `vX.Y.Z` passa pela matriz completa antes de publicar o ZIP e `SHA256SUMS`. Versões publicadas são imutáveis: um novo push com a mesma versão só executa testes. A publicação começa em rascunho e só fica visível após os dois assets estarem disponíveis.

O ZIP é determinístico, contém arquivos na raiz e usa o método padrão STORE (sem compressão), aceito pelo instalador da IDE sem dependências de runtime. `dist/` não é versionado.

## Segurança e privacidade

HTTP autenticado somente em `127.0.0.1`; token de pareamento em memória de sessão. Identificadores de abas e URLs de conversas ficam no armazenamento local para retomada. Cookies e tokens do ChatGPT permanecem no site. Nenhum código remoto é executado. Uma entrega incerta não é reenviada automaticamente.

Permissões: `storage` (sessão e vínculo de abas), `tabs` (conversas), `alarms` (ponte), acesso ao ChatGPT, loopback e API pública do GitHub (versões).
