# Fontes e classificação

## 🔗 Cadastro de sites

Informe o nome da empresa e a URL da **página que lista suas vagas**. Exemplos de formato:

- `https://jobs.lever.co/empresa`
- `https://job-boards.greenhouse.io/empresa`

Esses endereços são exemplos de formato, não fontes reais configuradas no sistema. O adaptador identifica a plataforma e usa sua API pública. Uma URL fora das plataformas suportadas permanece em integração pendente. Não há coletor universal para sites com login, CAPTCHA ou páginas que dependem de navegador completo.

## 🎯 Elegibilidade

O título é usado para identificar estágio, trainee, júnior e analista júnior, incluindo variações de acento e abreviação. O texto da vaga ajuda a verificar a área de TI, a modalidade remota e a possibilidade de trabalhar residindo no Brasil.

Os resultados possíveis são:

| Estado | Significado |
|---|---|
| Elegível | Os critérios escolhidos e as regras fixas estão confirmados no anúncio. |
| Pendente | O anúncio não informa tudo o que é necessário. |
| Descartada | Há incompatibilidade clara ou o tipo foi desativado. |

As vagas pendentes não são apresentadas como elegíveis. A análise automática não substitui a leitura do anúncio original antes de se candidatar. Alterações nas opções de tipo serão aplicadas às vagas ao serem consultadas novamente.

## 🧩 Ampliar integrações

Cada nova plataforma deve ter um adaptador próprio em `worker/fontes.ts`. Valide a URL, use APIs oficiais quando disponíveis, limite o tamanho da resposta e normalize identificador, título, empresa, link e localização. Fontes com muitos resultados precisam de paginação antes de serem habilitadas. Mantenha consultas sem autenticação indevida e respeite respostas de erro das plataformas.
