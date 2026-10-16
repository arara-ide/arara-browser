# Arara Browser

Repositório público MIT. Nunca incluir código do agente, prompts internos, credenciais ou arquivos dos repositórios privados. Commits/push conforme autorização do usuário.

A extensão fica em `extension/`; não adicionar dependências de runtime ou scripts remotos. Preservar autenticação em loopback, isolamento das abas e entrega sem reenvio incerto.

Versões em package.json e manifest.json devem coincidir. Execute npm test, npm run build, npm run test:content e npm run test:compatibility. A suíte de navegador usa páginas simuladas; não declarar compatibilidade com a interface real do ChatGPT sem teste manual.

O ZIP público usa arquivos planos com método STORE; mudanças do formato de distribuição precisam ser coordenadas com o instalador no arara-ai.

## Fluxo de branches

Por orientação explícita do usuário em 16/10/2026, este repositório segue a seção **Branches e contribuição** do README. Esta regra substitui a orientação geral antiga de desenvolver somente na `main`.

- `main`: linha estável e padrão do GitHub; promoção por PR.
- `development`: trabalho diário e checkout do notebook.
- `feature/*` e `fix/*`: saem de `development` e voltam para ela.
- `release/*`: preparação opcional, de `development` para `main`.
- `hotfix/*`: sai de `main` e deve ser incorporada em `main` e `development`.
- Não publicar a partir de branches de desenvolvimento, apagar branches históricas sem verificar seus commits ou reescrever o histórico.
- Commit e push continuam dependendo de autorização do usuário. Esta política não altera os fluxos dos repositórios `ac-*`.

## Encerramento e autoria

- Ao concluir trabalho em uma branch temporária, valide, mescle na branch de destino e confirme o merge no remoto. Uma tarefa não está concluída com a feature isolada; se o merge estiver pendente, informe isso ao usuário.
- Após confirmar o merge, remova a branch temporária local e remota, usando `git branch -d` localmente, e atualize as referências com `git fetch --prune`. Preserve branches permanentes, de ambiente e qualquer branch com trabalho ainda não integrado. Habilite a exclusão automática após merge somente com as branches permanentes protegidas contra exclusão. Quando o plano do GitHub não permitir essa proteção, mantenha a exclusão automática desabilitada e remova manualmente apenas branches temporárias já mescladas.
- Nunca atribua autoria ou coautoria a IA em commits ou PRs: sem trailers `Co-authored-by` para assistentes/modelos/serviços e sem assinaturas de IA. Preserve autores humanos, licenças e avisos legítimos; não reescreva histórico publicado para aplicar essa regra.
- Releases e CI de produto somente em `main`. Exceção autorizada em 16/10/2026: `security.yml` analisa PRs para `main` e `development` com CodeQL e revisão de dependências, sem executar scripts do PR nem receber segredos de release. Não usar `pull_request_target`. `Security gate` e resultados do CodeQL são requisitos de merge na `main`.
