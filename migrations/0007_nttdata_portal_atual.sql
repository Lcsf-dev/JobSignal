UPDATE OR IGNORE fontes
SET url = 'https://careers.nttdata.com/br/pt/search-results?qcountry=Brazil',
    identificador = 'phenom'
WHERE plataforma = 'nttdata'
  AND url LIKE 'https://careers.emeal.nttdata.com/s/jobs%';
