# JobSignal

Monitor pessoal de vagas de TI. O JobSignal reúne páginas de carreira cadastradas manualmente, consulta fontes compatíveis duas vezes ao dia e organiza vagas de estágio, trainee, júnior e analista júnior. Uma vaga só é apresentada como elegível quando há indícios suficientes de trabalho remoto para quem reside no Brasil.

O projeto usa **Angular** na interface e **Cloudflare Workers, D1, Queues e Cron Triggers** na aplicação. O código pode ser versionado no GitHub; build e publicação podem ser executados diretamente do computador, sem GitHub Actions.

## 🌐 Endereco de producao

O JobSignal esta disponivel em `https://jobsignal.lchub.workers.dev/`. `jobsignal` e o nome deste Worker; `lchub` e o subdominio compartilhado da conta Cloudflare. O banco `jobsignal-db` e a fila `jobsignal-buscas` pertencem exclusivamente a este projeto e nao sao utilizados pelo LJV.

Ao alterar o endereco da conta, atualize favoritos ou atalhos que usem a URL anterior. O nome do Worker em `wrangler.jsonc` permanece `jobsignal`, portanto as publicacoes futuras continuam atualizando o mesmo sistema.

## ✨ Funcionalidades

- 🧭 **Painel:** resumo das fontes, vagas elegíveis, pendências e próxima busca.
- 🔗 **Sites monitorados:** cadastro, edição, pausa e exclusão lógica de páginas de vagas.
- 🔎 **Busca automática:** dois horários editáveis pelo painel, no fuso `America/Sao_Paulo`.
- 🎯 **Tipos de vaga:** estágio, trainee, júnior e analista júnior, selecionáveis individualmente; variações como “Junior”, “Jr.” e “Estagiária” são reconhecidas.
- 🌎 **Regra fixa:** somente oportunidades de TI, remotas e disponíveis para residentes no Brasil podem ser elegíveis.
- 🗂️ **Vagas:** separação entre elegíveis e pendentes de verificação; acompanhamento de interesse e candidatura.
- 📈 **Histórico:** registro das buscas e de falhas por fonte.
- 🔐 **Acesso pessoal:** a API exige uma chave configurada como segredo do Worker. Não há cadastro público.

## 🧱 Organização

```text
JobSignal/
├── src/                    Interface Angular responsiva
│   └── app/                Telas e interação com a API
├── worker/                 API, agendamento, coleta e classificação
│   ├── index.ts            Rotas, execução e tarefas
│   ├── fontes.ts           Integrações de plataformas de vagas
│   └── classificador.ts    Regras de elegibilidade
├── migrations/             Evolução versionada do banco D1
│   └── 0001_inicial.sql    Tabelas e índices iniciais
├── public/                 Imagens estáticas, incluindo a logo
├── docs/                   Explicações técnicas e das fontes
└── wrangler.jsonc          Configuração dos recursos Cloudflare
```

O banco `jobsignal-db` contém as tabelas de configuração, fontes, vagas, execuções e tarefas. O arquivo `0001_inicial.sql` cria a primeira versão dessas tabelas; **não é um segundo banco**. Todos os recursos do JobSignal são próprios e não têm conexão com o sistema LJV. A conta Cloudflare é a única coisa em comum.

## 🛠️ Requisitos para desenvolvimento

- Node.js e npm recentes.
- Conta Cloudflare autenticada no Wrangler para operar recursos remotos.
- Chave de acesso pessoal com pelo menos 24 caracteres.

Instale as dependências:

```powershell
npm install
```

Copie `.dev.vars.example` para `.dev.vars` e substitua o valor de `ACESSO_TOKEN` por uma chave longa e aleatória. Esse arquivo é ignorado pelo Git e serve apenas ao desenvolvimento local.

Crie as tabelas no banco local e compile a interface:

```powershell
npm run db:local
npm run build
```

Inicie o Worker local, que serve a interface compilada e a API na mesma origem:

```powershell
npm run dev:worker
```

Abra o endereço exibido pelo Wrangler e informe a chave configurada em `.dev.vars`. O botão **Buscar agora** permite testar uma rodada manual. Para testar o agendamento local, use a rota de testes de eventos agendados fornecida pelo Wrangler.

## ☁️ Recursos e publicação manual

Os recursos usam estes nomes:

| Recurso | Nome |
|---|---|
| Worker e interface | `jobsignal` |
| Banco D1 | `jobsignal-db` |
| Fila | `jobsignal-buscas` |

Para preparar uma conta nova, crie o banco D1 e a fila com Wrangler e substitua no `wrangler.jsonc` o identificador do banco retornado pelo comando de criação. Na conta usada neste projeto, o banco e a fila já foram criados.

```powershell
npx wrangler d1 create jobsignal-db
npx wrangler queues create jobsignal-buscas
npm run db:remoto
npx wrangler secret put ACESSO_TOKEN
npm run publicar
```

O comando de publicação executa o build Angular e publica o Worker e os arquivos estáticos juntos. **Não execute `d1 create` novamente na mesma conta**. Para atualizar a aplicação, rode somente `npm run publicar`; para novas alterações no banco, crie uma migração versionada e execute `npm run db:remoto` antes da publicação.

## 🔗 Fontes de vagas

Cadastre a **página com a listagem das vagas**, como uma página de carreiras. A primeira versão consulta fontes hospedadas em **Greenhouse** e **Lever**, usando as APIs públicas dessas plataformas. Se uma URL não corresponder a uma integração disponível, ela fica marcada como **integração pendente** e não é consultada automaticamente.

Os dados exibidos vêm das fontes reais cadastradas. Na primeira consulta de cada fonte, as vagas existentes são carregadas sem tratá-las como alertas novos. O projeto não inclui envio externo por Telegram ou e-mail, porque esse canal ainda não foi escolhido; a organização e o acompanhamento das vagas estão no painel.

Consulte [Fontes e classificação](docs/fontes-e-classificacao.md) para exemplos de links, regras e limitações da leitura automática.

## 🔒 Segurança e dados

- A chave de acesso deve ser guardada como **Secret** no Worker e em `.dev.vars` apenas para testes locais.
- A interface não contém segredos embutidos. A chave digitada fica em `sessionStorage`, até a aba ou sessão terminar.
- A API exige autorização em todas as rotas; não há registro público de usuários.
- A coleta usa apenas endpoints conhecidos das plataformas suportadas. Links de outros sites são armazenados como pendentes, sem fazer requisições arbitrárias a eles.
- Não armazene currículos, páginas inteiras ou dados pessoais desnecessários nesse banco.

Para uso público mais amplo, avalie acrescentar Cloudflare Access e uma revisão específica de autenticação antes de divulgar o endereço da aplicação.

## ✅ Verificação

```powershell
npm test
npm run verificar:worker
npm run build
```

Esses comandos testam regras centrais de classificação, verificam os tipos do Worker e compilam o Angular. Antes de considerar uma nova fonte suportada, valide sua integração com dados reais e confira os resultados no painel.

## 🚧 Estado do projeto

O núcleo foi criado e está separado do LJV. A classificação automática é conservadora: quando o anúncio não confirma algum critério, a vaga fica em **pendentes**. Novas plataformas de carreiras exigem integrações próprias. O sistema não inventa vagas e não considera qualquer URL automaticamente compatível.
