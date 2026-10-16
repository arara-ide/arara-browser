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
