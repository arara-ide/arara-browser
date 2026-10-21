# Arara Browser

> **Repositório descontinuado e arquivado (21/10/2026).** O Arara Code passou a conversar com o ChatGPT de forma nativa, direto da IDE: login oficial pelo *Sign in with ChatGPT* (OAuth, escopo `chatgpt.tokens.use.direct`) e inferência pela Responses API, sem extensão de navegador. Com isso, este conector ficou ocioso: não é mais baixado, instalado nem exigido pela IDE. O repositório fica aqui apenas como referência histórica e está **arquivado** (somente leitura). Não há mais releases, builds ou manutenção. O conteúdo abaixo descreve o método antigo, preservado para registro.

Extensão Manifest V3, open source (MIT), que conectava a sessão do ChatGPT no Chrome/Edge ao Arara Code. O navegador mantinha o login; a IDE executava ferramentas e controlava permissões. **Esse método foi substituído pela integração nativa descrita acima.**

## Branches e contribuição

A branch estável e padrão é `main`, seguindo a nomenclatura atual do GitHub. O trabalho diário fica em `development`; este é o checkout recomendado no notebook. Branches representam etapas do código, e não ambientes de execução.

| Branch | Origem | Uso e destino |
|---|---|---|
| `main` | — | Código aprovado para distribuição; recebe PRs de `development`, `release/*` ou `hotfix/*`. |
| `development` | `main` | Integração contínua e trabalho diário; recebe funcionalidades e correções. |
| `feature/<assunto>` | `development` | Funcionalidade isolada; PR para `development`. |
| `fix/<assunto>` | `development` | Correção comum; PR para `development`. |
| `release/<versao>` | `development` | Preparação opcional de versão; PR para `main`, seguido de sincronização com `development`. |
| `hotfix/<assunto>` | `main` | Correção urgente de uma versão distribuída; PR para `main` e incorporação também em `development`. |

Somente `main` e `development` são permanentes. Crie as demais quando houver trabalho concreto e remova-as após integrar seus commits. Branches anteriores à adoção deste fluxo são históricas: confira os commits antes de integrar ou excluir.

Para trabalhar no notebook:

```sh
git switch development
git pull --ff-only origin development
# Opcional, para isolar uma tarefa:
git switch -c feature/nome-da-tarefa
```

Trabalho individual pode ser commitado diretamente em `development`. Use Conventional Commits e PRs para promover código a `main`. Após uma promoção ou hotfix, incorpore `main` em `development` por merge, preservando o histórico; não use force push nem mova tags publicadas.

CI de produto executa em `main` e `development`. Releases, tags de distribuição e publicação no registro Docker continuam exclusivas da `main`. Em `development`, os pacotes são disponibilizados somente como **Artifacts do GitHub Actions**, com SHA-256 e retenção de 14 dias; não são releases nem pré-releases e não entram nas consultas dos atualizadores. O workflow de segurança continua analisando PRs destinados a `main` e `development`, além da linha de base em `main`. A `main` é protegida por PR obrigatório e verificações de segurança.

Este repositório é público. Mantenha código privado, prompts internos e credenciais fora de todas as branches e PRs.

## Builds de development

Pushes em `development` executam testes e build. A execução manual também aceita essa branch; o botão **Run workflow** depende da definição com `workflow_dispatch` estar na branch padrão do GitHub. Na aba **Actions**, selecione uma execução bem-sucedida de `development` e baixe o pacote na seção **Artifacts**. É necessário estar conectado ao GitHub e ter acesso de leitura ao repositório. Os arquivos expiram após 14 dias; execute novamente o workflow se precisar de outro pacote. Não há publicação em GitHub Releases, criação de tags ou atualização automática para esses builds.

O artifact `arara-browser-development` contém o ZIP no formato STORE e `SHA256SUMS`, iguais ao formato de instalação já suportado pela IDE. Extraia o ZIP e use **Carregar sem compactação** no navegador para testar manualmente.

```sh
gh run list -R arara-ide/arara-browser --workflow ci.yml --branch development --status success
gh run download <RUN_ID> -R arara-ide/arara-browser -n arara-browser-development -D ./build-development
```

## Conclusão de tarefas e autoria

Uma tarefa em `feature/*`, `feat/*` ou `fix/*` só termina depois de validar e mesclar a branch na branch de destino definida pelo fluxo do repositório. Não deixe trabalho concluído isolado em uma branch: isso dificulta encontrar o código que realmente será distribuído e acumula branches obsoletas.

Após confirmar o merge no remoto, apague a branch temporária no GitHub e localmente (`git branch -d <branch>`) e rode `git fetch --prune`. Habilite a exclusão automática após merge somente com as branches permanentes protegidas contra exclusão. Quando o plano do GitHub não permitir essa proteção, mantenha a exclusão automática desabilitada e remova manualmente apenas branches temporárias já mescladas. Nunca apague uma branch com commits ainda não integrados; informe a pendência ao responsável. Branches permanentes e branches de ambiente são preservadas. Merge de feature encerra a tarefa na linha de desenvolvimento; a promoção para distribuição segue o fluxo de release.

Não cite assistentes, modelos ou serviços de IA como autores ou coautores de commits ou PRs. Não adicione trailers `Co-authored-by` para IA nem assinaturas de ferramentas de IA. A autoria fica com os responsáveis humanos; preserve atribuições humanas legítimas, licenças e avisos de terceiros. Esta regra vale para novos registros e não autoriza reescrever histórico publicado.

## Integração independente: uso autorizado e responsabilidade

### Natureza da extensão

O Arara Browser é um conector independente entre a interface do ChatGPT no navegador e a IDE pareada. Ele pode interagir com elementos da página para enviar solicitações e obter respostas para a ponte local. **Não é uma API pública de automação do ChatGPT, um produto oficial da OpenAI ou uma declaração de autorização para automatizar o serviço.** Compatibilidade técnica e instalação em modo de desenvolvedor não equivalem à aprovação da OpenAI, do Google, da Microsoft ou de uma loja de extensões.

ChatGPT, Codex, OpenAI, Chrome, Chromium, Google, Edge e Microsoft são nomes ou marcas dos respectivos titulares. O projeto não afirma afiliação, patrocínio, certificação, parceria ou endosso dessas organizações. Sua licença MIT cobre somente os direitos que os licenciantes podem conceder sobre o código distribuído; não licencia o ChatGPT, contas, modelos, marcas, conteúdo ou software de terceiros.

### Conta paga não é autorização irrestrita

O login é mantido pelo navegador e o acesso depende da conta e do serviço. Ter uma assinatura paga, usar a própria conta, não compartilhar credenciais, não revender acesso ou não pretender causar prejuízo **não dispensa o cumprimento dos termos da plataforma nem substitui autorização específica quando exigida**. A capacidade de enviar uma mensagem ou ler uma resposta não demonstra que o método utilizado é permitido.

Antes de parear a extensão, confira os termos aplicáveis à sua modalidade de acesso, região, organização e finalidade. Os termos da OpenAI contêm restrições sobre extração automatizada ou programática de dados e resultados, bem como sobre contorno de limites e medidas de proteção. Não presuma que permissões para APIs, CLIs ou MCP se estendam à automação da interface web. O projeto não certifica que este conector ou todo fluxo que ele permite seja compatível com esses termos. Não use fluxos proibidos; se houver necessidade de autorização, obtenha-a diretamente do provedor antes do uso. [Termos da OpenAI](https://openai.com/policies/terms-of-use/).

### Uso pretendido e condutas não autorizadas

A finalidade do projeto é apoiar fluxos de trabalho autorizados com uma IDE controlada pelo usuário. Não use a extensão para contornar pagamento, autenticação, cotas, limites de uso, restrições de conta, recusas de segurança ou mecanismos de proteção. Trocar de aba, conversa, conta ou instalação não concede permissão para contornar uma restrição. O pareamento local tampouco autoriza acesso a arquivos, sistemas, contas ou dados de terceiros.

Se um fluxo for restringido, gerar alerta de política ou exigir esclarecimento do provedor, interrompa-o e utilize os canais oficiais de suporte ou recurso. O projeto não garante proteção contra alertas, suspensão, encerramento de conta, revogação de acesso ou medidas adotadas por terceiros. Não oferece recuperação garantida de contas, créditos, histórico ou valores pagos aos provedores.

### Dados, pareamento e ações da IDE

Pareie somente com uma IDE sob seu controle e proteja o código de conexão, o computador e o perfil do navegador. O conector transmite solicitações e respostas entre a página e a IDE; a IDE pode executar ferramentas conforme as permissões concedidas nela. Verifique o conteúdo enviado, o contexto anexado e as ações autorizadas. Não transmita dados pessoais, segredos, código de clientes ou informações confidenciais sem as permissões necessárias.

A manutenção dos cookies e do login no site, o transporte em loopback e os controles de pareamento não constituem promessa de segurança absoluta, isolamento contra um computador comprometido ou autorização contratual para acessar o serviço. Dados recebidos por serviços externos continuam sujeitos às políticas e contratos desses serviços. O usuário deve avaliar as configurações de privacidade e as regras da sua organização.

### Compatibilidade, resultados e custos

A interface do ChatGPT pode mudar sem aviso e quebrar leitura, envio, retomada, seleção de modelos ou cancelamento. Testes em páginas simuladas não certificam compatibilidade contínua com a página real nem conformidade contratual. Confira se uma mensagem foi enviada antes de repeti-la e revise respostas e ações automatizadas. Resultados de IA podem ser incorretos, inseguros ou exigir revisão de direitos e licenças. Mantenha backups; nenhuma integração substitui supervisão adequada.

Planos, recursos, limites, cobrança e disponibilidade são definidos pelos provedores. Instalar esta extensão não inclui uma assinatura do ChatGPT, créditos, cotas adicionais ou garantia de qualquer modelo. Suporte ou contribuições ao Arara não modificam o contrato do usuário com a OpenAI ou com outros serviços.

### Ausência de garantias e limites da responsabilidade

Na máxima extensão permitida pela legislação aplicável, o software é fornecido no estado em que se encontra e conforme disponível, sem garantias expressas ou implícitas, incluindo qualidade comercial, adequação a uma finalidade, não violação de direitos, segurança absoluta, precisão, disponibilidade ou funcionamento ininterrupto. A distribuição segue a [licença MIT](LICENSE), preservadas as licenças dos componentes de terceiros.

Na mesma extensão, autores, titulares, mantenedores e contribuidores não assumem responsabilidade por reclamações, danos ou perdas decorrentes do uso, mau uso ou impossibilidade de uso da extensão, incluindo perda ou exposição de dados, respostas ou ações incorretas, interrupção de trabalho, perda de lucros, custos de terceiros, restrições de conta ou mudanças dos serviços. A responsabilidade por dados fornecidos, permissões concedidas e usos escolhidos será determinada pelos contratos e pela legislação aplicáveis; este aviso não transfere ao usuário obrigações que a lei imponha aos próprios responsáveis pelo projeto.

Este aviso não afasta responsabilidades legalmente inderrogáveis, direitos de consumidores ou de terceiros, nem impede titulares ou autoridades de exercerem seus direitos. Não garante imunidade jurídica aos mantenedores ou usuários, não concede autorização em nome de terceiros e não transforma usos proibidos em permitidos. Nenhuma declaração de boa intenção, ausência de prejuízo ou pagamento de assinatura substitui a análise dos termos e da legislação pertinentes.

### Relatos e referências

Questões de compatibilidade ou possíveis violações de direitos podem ser comunicadas pelos canais deste repositório, com identificação do componente e informações suficientes para análise. Não publique credenciais, conversas privadas ou dados pessoais em issues. Funcionalidades podem ser corrigidas, restringidas ou removidas; receber um relato não implica reconhecer responsabilidade ou garantir determinada solução.

Consulte os [Termos de Uso](https://openai.com/policies/terms-of-use/), os [termos regionais europeus, quando aplicáveis](https://openai.com/policies/eu-terms-of-use/), os [Service Terms](https://openai.com/policies/service-terms/), as [Usage Policies](https://openai.com/policies/usage-policies/) e a [política de privacidade da OpenAI](https://openai.com/policies/privacy-policy/), além do contrato específico da sua organização. Esta lista é informativa; os documentos vigentes e o contrato efetivo prevalecem.

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

Atualize `version` em `package.json` e `extension/manifest.json` juntos, regenere o lockfile e descreva a versão em `RELEASE.md`. Push na `main` passa pela matriz completa antes de publicar o ZIP e `SHA256SUMS`. Versões publicadas são imutáveis: um novo push com a mesma versão só executa testes. A publicação começa em rascunho e só fica visível após os dois assets estarem disponíveis.

O ZIP é determinístico, contém arquivos na raiz e usa o método padrão STORE (sem compressão), aceito pelo instalador da IDE sem dependências de runtime. `dist/` não é versionado.

## Segurança e privacidade

HTTP autenticado somente em `127.0.0.1`; token de pareamento em memória de sessão. Identificadores de abas e URLs de conversas ficam no armazenamento local para retomada. Cookies e tokens do ChatGPT permanecem no site. Nenhum código remoto é executado. Uma entrega incerta não é reenviada automaticamente.

Permissões: `storage` (sessão e vínculo de abas), `tabs` (conversas), `alarms` (ponte), acesso ao ChatGPT, loopback e API pública do GitHub (versões).

## Revisão e segurança dos PRs

A `main` exige pull request, resolução das conversas de revisão e preservação do histórico (sem force push). A proteção não concede exceção de push direto a administradores ou bots. A configuração inicial permite merge pelo mantenedor único sem exigir a aprovação de uma segunda pessoa; contribuições externas devem ser revisadas pelo mantenedor antes do merge.

O CodeRabbit tem configuração em `.coderabbit.yaml` para resumos e revisão em português. O [GitHub App](https://github.com/apps/coderabbitai) está instalado na organização com acesso a repositórios selecionados; mantenha este público selecionado para receber as revisões. Não autorize acesso aos repositórios privados. O serviço oferece revisão gratuita para projetos open source; confira as condições ao instalar.

Alertas do Dependabot, detecção de segredos e proteção de push com segredos estão habilitados. Análise automática ajuda a detectar vulnerabilidades e alterações suspeitas, mas não certifica ausência de malware, backdoors ou problemas de licença. Alterações em comandos, rede, instaladores, atualizadores e workflows exigem revisão humana cuidadosa.

Os workflows de release não fazem push diretamente na `main`. Prepare mudanças de versão e changelog por PR antes de publicar.

O workflow `PR security` analisa JavaScript/TypeScript e workflows do GitHub Actions com CodeQL (`security-extended`). A revisão de dependências bloqueia dependências novas com vulnerabilidades conhecidas de severidade moderada ou superior. A `main` exige `Security gate` bem-sucedido e resultados do CodeQL sem novos alertas de segurança altos/críticos ou erros que atinjam o bloqueio configurado. Corrija os achados e envie novos commits ao PR para executar novamente.

O workflow usa `pull_request`, permissões mínimas e Actions fixadas por SHA; não instala dependências, não executa scripts do PR e não recebe credenciais de release. PRs de forks podem aguardar autorização do mantenedor para executar Actions. O CodeRabbit comenta e recomenda; a decisão de merge continua com o mantenedor. CodeQL não analisa integralmente shell scripts, arquivos binários ou código contido em patches: essas mudanças precisam de revisão humana.
