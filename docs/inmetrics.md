# Inmetrics

A fonte `https://inmetrics.gupy.io/` usa o adaptador específico em `worker/inmetrics.ts`, com a plataforma `gupy` e o identificador `inmetrics`. A migração `0010_inmetrics.sql` cadastra a empresa ou reativa o cadastro já existente, sem duplicar a fonte.

O HTML público contém a lista completa em `props.pageProps.jobs`, mesmo quando a interface mostra dez anúncios por página. A coleta compara a quantidade recebida com o total exibido e recusa resultados parciais, duplicados ou acima de 500 anúncios. Se o formato do portal mudar, a fonte registra erro em vez de assumir que não há vagas.

Os detalhes dos títulos com estágio, trainee, júnior ou JR são consultados no próprio portal, com limite de 30 consultas por execução. Modalidade, país, descrição e data de publicação são preservados quando informados. Os filtros existentes continuam decidindo quais vagas são elegíveis; coletar um anúncio não significa que ele atende aos critérios.

A integração utiliza apenas páginas públicas, sem Browser Run ou serviços pagos de coleta.
