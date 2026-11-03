# Riftscan

App (PWA e Android via Capacitor) para escanear cartas de Riftbound, montar colecoes e exportar para a LigaRiftbound (CSV) e para o MYP Cards (lista para colar).

Status: em desenvolvimento. Sem login por enquanto; os dados ficam no aparelho. Publicar na Vercel: `docs/publicar-web.md`.

## Decisoes

- Static HTML/CSS/JS, sem build. Funciona no celular e no PC.
- Cartas: Riftcodex (`api.riftcodex.com`), salvas em `data/`.
- Precos: TCGCSV (TCGplayer, categoria 89) em USD, com conversao direta para BRL. Os precos nao vao para a Liga.
- Exportacao: CSV no formato da Liga, lista para o importador de decks do MYP Cards (`deck_labels`), ou so os nomes.
- Colecoes: varias listas nomeadas no aparelho (localStorage), uma ativa por vez.
- MYP Cards: API so de leitura (catalogo e precos). Detalhes, pedido de acesso e perguntas para eles em `docs/mypcards-api.md`. Todo lugar que mostra dado do MYP precisa creditar o MYP Cards com link.
- Visual: neutros azulados em tema claro e escuro (segue o aparelho; botao no topo e painel Aparencia em Colecoes), um azul so nos dados, fonte Geist empacotada em `fonts/` (licenca OFL).
- Lista em grade com a arte da carta (alterna com a lista de linhas), tela da carta (`#card/<id>`, preco por fonte, versoes, edicao na colecao) e progresso por edicao (so impressao numerada). Imagens pela CDN com `?w=&fm=webp` (~40x menores).
- Precos diarios: `tools/update_prices.py` grava um snapshot por dia (`data/snapshots/`), o historico de 90 dias (`data/history.json`) e `data/prices.json`; o workflow `.github/workflows/prices.yml` roda todo dia depois das 20:00 UTC e também acrescenta ao `data/cards.json` as edições e cartas novas (`python tools/build_data.py --refresh-cards`). A aba Precos mostra quem mais caiu e subiu, e o app mostra a idade dos precos. Detalhes em `docs/precos-diarios.md`.
- Celular: o mesmo HTML/JS embrulhado com Capacitor (`capacitor.config.json`, pasta `android/`). Nao e reescrita.

## Skills usadas no desenvolvimento

`find-skills` (vercel-labs/skills) e `design-taste-frontend` (Leonxlnx/taste-skill) ficam em `.claude/skills/` e nao sao versionadas.



## Pendencias

Lista em `docs/pendencias.md` (hoje: ofertas filtraveis da MYP por carta escaneada, carrinho e envio do pedido, dependem de novos endpoints do MYP).

## Comandos

```
npm test               # core.js (colecoes, exportacoes) e myp.js (cliente)
npm run serve          # versao web em http://localhost:8080
python tools/sync_myp.py --mock   # precos do MYP de exemplo (sem acesso a API)
python tools/sync_myp.py          # precos reais; token em MYP_API_TOKEN ou .env.local
npm run android       # copia o app para www/, sincroniza e abre o Android Studio
```

Build do Android exige JDK 21 e Android Studio com o SDK 36 (ver `docs/mypcards-api.md` para o resto).
