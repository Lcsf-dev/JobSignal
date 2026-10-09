# Fontes e classificação

## 🔗 Cadastro de sites

Informe o nome da empresa e a URL da **página que lista suas vagas**. Exemplos de formato:

- `https://jobs.lever.co/empresa`
- `https://job-boards.greenhouse.io/empresa`

Greenhouse e Lever usam as APIs públicas das plataformas. A página de carreiras da CI&T é consultada pela API pública do Lever, com paginação. Também há adaptadores para CWI e listagens públicas da Recrut.ai e da Remotar. A Remotar fornece uma data de cadastro, que é exibida separada da primeira detecção feita pelo JobSignal. Listagens públicas de Gupy, InfoJobs, Catho, APInfo, Nerdin, GeekHunter e Vagas.com têm extratores próprios; a APInfo é pesquisada pelo filtro Home Office.

A Catho é consultada primeiro pela listagem HTML pública e usa o Browser Run como alternativa quando a página não pode ser lida diretamente. A APInfo usa o Browser Run para aplicar Home Office e coletar os cartões exibidos. As chamadas do Browser Run são espaçadas por um limitador persistido no D1 do JobSignal para evitar concorrência entre as fontes deste projeto.

O portal antigo `careers.emeal.nttdata.com/s/jobs` passou a mostrar uma tabela vazia. O JobSignal consulta `careers.nttdata.com/br/pt/search-results?qcountry=Brazil`, que publica os dados da busca no HTML. A coleta percorre as páginas com o parâmetro `from` e aceita tanto o endereço antigo cadastrado quanto o novo, sempre usando o filtro de país Brasil. Uma URL fora das plataformas e caminhos reconhecidos permanece em integração pendente. Não há coletor universal para sites com login, CAPTCHA ou páginas que dependem de navegador completo; bloqueios e mudanças dos próprios sites são registrados como falha da fonte.

## 🎯 Elegibilidade

O título é usado para identificar estágio, trainee, júnior e analista júnior, incluindo variações de acento e abreviação. O texto da vaga ajuda a verificar a área de TI, a modalidade remota e a possibilidade de trabalhar residindo no Brasil.

Os resultados possíveis são:

| Estado | Significado |
|---|---|
| Elegível | Os critérios escolhidos e as regras fixas estão confirmados no anúncio. |
| Pendente | O anúncio não informa tudo o que é necessário. |
| Descartada | Há incompatibilidade clara ou o tipo foi desativado. |

As vagas pendentes não são apresentadas como elegíveis. Vagas descartadas pela classificação automática podem ser consultadas na aba **Descartadas**, que mostra o motivo e a evidência de modalidade/localidade identificada. Na aba de elegíveis, o acompanhamento manual é confirmado pelo botão **OK**: **Nova** e **Tenho interesse** permanecem no painel; **Me candidatei** e **Descartada por mim** vão para o **Histórico de vagas** e não voltam às elegíveis em consultas futuras. O usuário pode restaurar uma vaga do histórico, redefinindo seu acompanhamento para **Nova**. Vagas explicitamente afirmativas para PcD ou mulheres recebem marcadores e têm opções próprias em Ajustes; as opções são aplicadas ao consultar a fonte novamente. A análise automática não substitui a leitura do anúncio original antes de se candidatar. Alterações nas opções de tipo serão aplicadas às vagas ao serem consultadas novamente.

## 🧩 Ampliar integrações

Cada nova plataforma deve ter um adaptador próprio em `worker/fontes.ts`. Valide a URL, use APIs públicas quando disponíveis, limite o tamanho da resposta e normalize identificador, título, empresa, link e localização. Fontes com muitos resultados precisam de paginação antes de serem habilitadas. Mantenha consultas sem autenticação indevida e respeite respostas de erro das plataformas. As páginas públicas podem mudar; confira erros e resultados no histórico antes de confiar numa nova integração.
