## Internacionalização e localização — obrigatório

- Toda interface deve oferecer português (`pt-BR`/`pt`), inglês (`en`) e espanhol (`es`), com mensagens em arquivos de tradução estruturados. Toda alteração futura em texto visível exige atualizar os três catálogos na mesma mudança, inclusive títulos, comandos, configurações, validações, notificações, estados vazios e nomes acessíveis.
- Não misture idiomas, concatene fragmentos traduzidos nem traduza identificadores, comandos, caminhos, marcas, conteúdo do usuário ou contratos de ferramentas. Use mensagens completas com parâmetros; preserve os mesmos parâmetros e chaves nos três idiomas e trate plurais quando necessário.
- Datas, horas, números, percentuais e moedas seguem o locale efetivo com `Intl`; moeda, fuso e valores dos dados não mudam com o idioma. Não fixe `pt-BR` em formatadores da interface.
- Verifique paridade de chaves/parâmetros, fallback e variantes regionais, além dos testes/builds pertinentes. Catálogo incompleto ou texto ainda fixo deve ser informado como pendência, nunca declarado traduzido.
- Esta é uma extensão de navegador Manifest V3: use `chrome.i18n` e `_locales/{en,pt_BR,es}/messages.json`, com idioma do navegador e fallback definido em `default_locale`. Não adicione scripts remotos nem dependências de runtime. Traduza popup, manifesto e mensagens exibidas ao usuário, preservando protocolo e seletores externos.

- Catálogos e validação: `extension/_locales/{en,pt_BR,es}/messages.json`; use `chrome.i18n`, `data-i18n` e `__MSG_*__` no manifesto. Valide com `npm test && npm run build && npm run test:compatibility`.

# Arara Browser

Repositório público MIT. Nunca incluir código do agente, prompts internos, credenciais ou arquivos dos repositórios privados. Commits/push conforme autorização do usuário.

A extensão fica em `extension/`; não adicionar dependências de runtime ou scripts remotos. Preservar autenticação em loopback, isolamento das abas e entrega sem reenvio incerto.

Versões em package.json e manifest.json devem coincidir. Execute npm test, npm run build, npm run test:content e npm run test:compatibility. A suíte de navegador usa páginas simuladas; não declarar compatibilidade com a interface real do ChatGPT sem teste manual.

O ZIP público usa método STORE, arquivos planos de runtime e somente `_locales/{en,pt_BR,es}/messages.json` como subpastas permitidas; mudanças do formato de distribuição precisam ser coordenadas com o instalador no arara-ai.

## Fluxo de branches

Por orientação explícita do usuário em 16/10/2026, este repositório segue a seção **Branches e contribuição** do README. Esta regra substitui a orientação geral antiga de desenvolver somente na `main`.

- `main`: linha estável e padrão do GitHub; promoção por PR.
- `development`: trabalho diário e checkout do notebook.
- `feature/*` e `fix/*`: saem de `development` e voltam para ela.
- `release/*`: preparação opcional, de `development` para `main`.
- `hotfix/*`: sai de `main` e deve ser incorporada em `main` e `development`.
- Não publicar releases a partir de branches de desenvolvimento, apagar branches históricas sem verificar seus commits ou reescrever o histórico. Builds de `development` são entregues exclusivamente como Artifacts, conforme autorização do usuário em 16/10/2026.
- Commit e push continuam dependendo de autorização do usuário. Esta política não altera os fluxos dos repositórios `ac-*`.

## Encerramento e autoria

- Ao concluir trabalho em uma branch temporária, valide, mescle na branch de destino e confirme o merge no remoto. Uma tarefa não está concluída com a feature isolada; se o merge estiver pendente, informe isso ao usuário.
- Após confirmar o merge, remova a branch temporária local e remota, usando `git branch -d` localmente, e atualize as referências com `git fetch --prune`. Preserve branches permanentes, de ambiente e qualquer branch com trabalho ainda não integrado. Habilite a exclusão automática após merge somente com as branches permanentes protegidas contra exclusão. Quando o plano do GitHub não permitir essa proteção, mantenha a exclusão automática desabilitada e remova manualmente apenas branches temporárias já mescladas.
- Nunca atribua autoria ou coautoria a IA em commits ou PRs: sem trailers `Co-authored-by` para assistentes/modelos/serviços e sem assinaturas de IA. Preserve autores humanos, licenças e avisos legítimos; não reescreva histórico publicado para aplicar essa regra.
- CI de produto em `main` e `development`, inclusive execução manual nessas branches. Checkouts de componentes irmãos usam a mesma branch. Em `development`, entregar somente Artifacts com retenção de 14 dias e SHA-256; nunca criar releases, pré-releases, tags ou publicar no registro. Releases e jobs com permissão de escrita continuam restritos à `main`. Exceção de segurança autorizada em 16/10/2026: `security.yml` analisa PRs para `main` e `development` com CodeQL e revisão de dependências, sem executar scripts do PR nem receber segredos de release. Não usar `pull_request_target`. `Security gate` e resultados do CodeQL são requisitos de merge na `main`.
