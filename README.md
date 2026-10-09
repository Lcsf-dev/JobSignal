# JobSignal

Monitor pessoal de vagas de TI. O JobSignal reúne páginas de carreira cadastradas manualmente, consulta fontes compatíveis duas vezes ao dia e organiza vagas de estágio, trainee, júnior e analista júnior. Uma vaga só é apresentada como elegível quando há indícios suficientes de trabalho remoto para quem reside no Brasil.

O projeto usa **Angular** na interface e **Cloudflare Workers, D1, Queues e Cron Triggers** na aplicação. O código pode ser versionado no GitHub; build e publicação podem ser executados diretamente do computador, sem GitHub Actions.

## 🖥️ Prévia da interface

![Painel inicial do JobSignal](docs/screenshots/painel-jobsignal.png)

## ✨ Funcionalidades

- 🧭 **Painel:** resumo das fontes, vagas elegíveis, pendências e próxima busca.
- 🔗 **Sites monitorados:** cadastro, edição, pausa e exclusão lógica de páginas de vagas.
- 🔎 **Busca automática e manual:** duas buscas diárias configuráveis e início manual a qualquer hora, com andamento acompanhado no painel.
- 🎯 **Tipos de vaga:** estágio, trainee, júnior e analista júnior, selecionáveis individualmente; variações como “Junior”, “Jr.” e “Estagiária” são reconhecidas.
- 🌎 **Regra fixa:** somente oportunidades de TI, remotas e disponíveis para residentes no Brasil podem ser elegíveis.
- 🗂️ **Vagas:** separação entre elegíveis e pendentes de verificação; acompanhamento de interesse e candidatura.
- 📈 **Histórico:** registro das buscas e de falhas por fonte.
- ✉️ **Avisos por e-mail:** remetente e destinatário editáveis; alertas com link original quando uma busca termina com vagas elegíveis.
- 🔐 **Acesso pessoal:** a API exige uma chave configurada como segredo do Worker. Não há cadastro público.

## 🧱 Organização

```text
JobSignal/
├── src/                    Interface Angular responsiva
│   └── app/                Telas e interação com a API
├── worker/                 API, agendamento, coleta e classificação
│   ├── index.ts            Rotas, execução e tarefas
│   ├── fontes.ts           Integrações e identificação das fontes
│   ├── fontes-html.ts      Leitura e normalização de listagens públicas
│   ├── email.ts            Montagem e envio de alertas pelo Gmail API
│   └── classificador.ts    Regras de elegibilidade
├── migrations/             Evolução versionada do banco D1
│   └── 0001_inicial.sql    Tabelas e índices iniciais
│   └── 0002_buscas_email.sql  Campos de busca e aviso por e-mail
│   └── 0003_data_publicacao.sql  Data informada pela fonte da vaga
├── public/                 Imagens estáticas, incluindo a logo
├── docs/                   Explicações técnicas e das fontes
└── wrangler.jsonc          Configuração dos recursos Cloudflare
```

O banco `jobsignal-db` contém as tabelas de configuração, fontes, vagas, execuções e tarefas. O arquivo `0001_inicial.sql` cria a primeira versão dessas tabelas; **não é um segundo banco**.

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

Cadastre a **página com a listagem das vagas**, como uma página de carreiras. Há integrações para **Greenhouse**, **Lever**, **Recrut.ai**, **CI&T**, **CWI** e listagens públicas da **Remotar**. As fontes reconhecidas anteriormente são identificadas novamente na próxima carga do painel ou busca. NTT DATA e outros endereços não reconhecidos continuam como integração pendente até uma implementação e validação próprias.

Os dados exibidos vêm das fontes públicas cadastradas. Cada plataforma tem um adaptador limitado à forma atual da página ou API; alterações feitas pelos sites podem interromper a leitura e aparecerão como erro no histórico. A candidatura continua manual no endereço original da vaga.

## ✉️ Avisos por Gmail

Os campos de remetente e destinatário ficam editáveis em **Ajustes**. Os valores iniciais são `yugi.lucas@gmail.com` e `lucas.lcsf.dev@gmail.com`. O remetente precisa ser a conta Google autorizada no Gmail API ou um endereço permitido como alias dessa conta. Não é necessário comprar domínio nem usar Email Routing.

O envio usa Gmail API OAuth 2.0; nenhuma senha é guardada no banco ou no código. Para ativar:

1. No Google Cloud, crie/seleciona um projeto, habilite **Gmail API** e crie credenciais OAuth 2.0 para aplicativo Web.
2. Gere uma autorização offline com escopo `https://www.googleapis.com/auth/gmail.send` para a conta remetente e obtenha o `refresh_token`. No modo de teste do consentimento Google, tokens podem expirar após sete dias.
3. Cadastre os três valores como segredos do Worker, sem colocá-los no Git:

```powershell
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

4. Publique o Worker e abra **Ajustes → Enviar e-mail de teste**. O botão só fica disponível quando os três segredos existem. O histórico informa se o aviso está pendente, foi enviado ou falhou.

O JobSignal reúne vagas elegíveis ainda não notificadas e envia até 50 por mensagem ao final da busca. Falhas são registradas e tentadas novamente em execuções posteriores. Endereços alterados devem corresponder às permissões de envio da conta Google.

Consulte [Fontes e classificação](docs/fontes-e-classificacao.md) para exemplos de links, regras e limitações da leitura automática.

## 🔒 Segurança e dados

- A chave de acesso deve ser guardada como **Secret** no Worker e em `.dev.vars` apenas para testes locais.
- A interface não contém segredos embutidos. A chave digitada fica em `sessionStorage`, até a aba ou sessão terminar.
- A API exige autorização em todas as rotas; não há registro público de usuários.
- A coleta usa somente os domínios e caminhos reconhecidos pelos adaptadores. Links de outros sites ficam pendentes, sem requisições arbitrárias.
- Tokens OAuth do Gmail devem ser cadastrados como **Secrets** no Worker, nunca em `.dev.vars` versionado, no banco ou na interface.
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

O núcleo do sistema está implementado. A classificação automática é conservadora: quando o anúncio não confirma algum critério, a vaga fica em **pendentes**. Novas plataformas de carreiras exigem integrações próprias. O sistema não inventa vagas e não considera qualquer URL automaticamente compatível.
