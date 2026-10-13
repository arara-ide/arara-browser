# Arara Browser

Repositório público MIT. Nunca incluir código do agente, prompts internos, credenciais ou arquivos dos repositórios privados. Desenvolver na main; commits/push conforme autorização do usuário.

A extensão fica em `extension/`; não adicionar dependências de runtime ou scripts remotos. Preservar autenticação em loopback, isolamento das abas e entrega sem reenvio incerto.

Versões em package.json e manifest.json devem coincidir. Execute npm test, npm run build, npm run test:content e npm run test:compatibility. A suíte de navegador usa páginas simuladas; não declarar compatibilidade com a interface real do ChatGPT sem teste manual.

O ZIP público usa arquivos planos com método STORE; mudanças do formato de distribuição precisam ser coordenadas com o instalador no arara-ai.
