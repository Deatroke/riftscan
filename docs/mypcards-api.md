# MYP Cards API: o que ela é, como pedir acesso e como o Riftscan usa

Fonte: especificação OpenAPI 3.1 em `https://mypcards.github.io/mypcards-api/swagger.yaml` (a página do Swagger UI só monta a tela com JavaScript, por isso a spec é lida direto). Lida em 2026-11-02.

## O que a API é (e o que não é)

**Somente leitura: catálogo e preços.** Não existe usuário, coleção, login nem endpoint de escrita/importação. Duas consequências para o app:

- **Coleções ficam no aparelho** (localStorage) e não são sincronizadas com o MYP Cards.
- **"Exportar para o MYP" é texto para colar** no importador de decks do site, não uma chamada de API. O campo `deck_labels` de cada carta traz a grafia exata que o importador aceita (ver abaixo).

Base: `https://mypcards.com/api/v1`. Jogo do Riftscan: `riftbound`.

| Endpoint | Para quê | Observação |
|---|---|---|
| `GET /jogos` | lista de jogos e slugs | sem paginação |
| `GET /riftbound/precos?page_number&page_size` | cartas **com estoque**, com preço | máx. 50 por página; sem total, pagine até `cards` vir vazio |
| `GET /riftbound/precos/{codigo}` | uma carta por `card_code` em **Base64** | devolve mesmo sem estoque (preços `null`) |
| `GET /riftbound/carta/{nome}` | nome **exato**, em PT ou EN | busca sem resultado = 200 com `cards: []` |
| `GET /riftbound/edicoes` | todas as edições | sem paginação |
| `GET /riftbound/edicoes/{id}/precos` | valor do set na última semana | `edition_id` numérico |
| `GET /produto/{id}` | produto pelo `internal_code` | devolve mesmo sem estoque |
| `GET /produto/{id}/historico` | série de 90 dias (mín. e mediana) | só carta avulsa |

Campos de `Produto` que importam: `internal_code`, `card_code`, `tcg_productId` (chave de ligação com o TCGplayer), `name_pt/en`, `edition_code`, `deck_labels[]`, `min_price` e `avg_price` (strings em BRL, `null` sem estoque), `img_pt/en`, `link`.

### Regras que o app precisa respeitar

- **Autenticação:** nenhum endpoint exige token. O header `X-Api-Token` só aumenta o limite. Token inválido vale como nenhum.
- **Limite:** 60 req/min com token, 10 sem, **por IP e por rota**. Respostas trazem `X-Rate-Limit-Limit` e `X-Rate-Limit-Remaining`; acima do limite, 429 (`rate_limited`).
- **Atribuição obrigatória:** onde os dados aparecem, dizer que vêm do MYP Cards, com link para https://mypcards.com. **Sem isso o acesso pode ser pausado.**
- **Erros:** JSON `{error, code, status}` com `code` estável. Exceção: ID não numérico em `/edicoes/{id}/precos` e `/produto/{id}/historico` devolve uma página HTML 404.
- **Cache:** preços vêm de estatísticas em cache de 5 minutos no servidor.

### `deck_labels` e o "exportar para o MYP"

A spec diz para usar a **primeira** grafia ao montar uma lista para colar: ela resolve uma única impressão, enquanto o nome puro costuma casar várias e obriga o usuário a desempatar linha a linha. E manda **não** montar a string a partir de `name_*` + `edition_code`. Por isso o export usa `deck_labels[0]` gravado no `data/myp.json` e, só quando a carta não tem grafia, cai no nome puro (e avisa quantas linhas ficaram assim).

Suposição **não verificada**: o formato de cada linha é `quantidade grafia` (ex.: `3 Dark Magician [LOB] 1`). A spec não descreve o importador; confirmar com o MYP.

## Como pedir acesso

A página https://mypcards.com/acesso-api respondeu 403 (Cloudflare) para a minha leitura automática, então **não sei os campos exatos do formulário**. O que a spec confirma:

1. É preciso ter conta no MYP Cards (login em https://mypcards.com/#login-form).
2. Solicitar em https://mypcards.com/acesso-api.
3. Depois da aprovação, você mesmo gera a chave no painel de acesso à API. **Ela aparece uma única vez**: copie para um `.env.local` (ignorado pelo git) como `MYP_API_TOKEN=...`.

### Rascunho do que informar no pedido

Cole os campos reais do formulário que eu ajusto o texto. Base para preencher:

- **Projeto:** Riftscan, aplicativo de celular (Android/iOS) e web para escanear cartas de Riftbound, montar coleções e exportar listas.
- **Jogo:** `riftbound`.
- **Endpoints:** `GET /riftbound/precos` (sincronização em lote do catálogo), `GET /riftbound/precos/{codigo}`, `GET /riftbound/carta/{nome}`, `GET /produto/{id}` (atualização de preço sob demanda) e, mais adiante, `GET /produto/{id}/historico`.
- **Volume esperado:** sincronização do catálogo (~1.700 cartas, ~35 páginas de 50) feita fora do app, em lote e abaixo de 60/min; no app, consultas pontuais por coleção. Sempre respeitando `X-Rate-Limit-Remaining`.
- **Plataformas:** app Android/iOS (Capacitor) e versão web.
- **Atribuição:** "Dados de preço: MYP Cards" com link para mypcards.com em todas as telas com preço (resultados, lista, exportação) e rodapé fixo.
- **Benefício para o MYP:** cada coleção pode ser exportada como lista com a grafia exata (`deck_labels`) para o importador de decks do site, levando o usuário ao MYP Cards.

### Perguntas para o MYP

1. **Cloudflare:** a API respondeu a um cliente que não é navegador com um desafio HTML (403, `Cf-Mitigated: challenge`) em vez de JSON. Clientes de API com token passam por esse desafio? Existe regra/allowlist para quem usa `X-Api-Token`?
2. **CORS:** a versão web (outra origem) e o WebView do app (`https://localhost`) podem chamar a API direto do cliente?
3. **Onde pode ficar o token:** como o limite é por IP, um proxy nosso com o token juntaria todos os usuários num único limite de 60/min; já o token dentro do app distribui o limite por IP, mas fica extraível do APK. Qual modelo vocês aceitam?
4. **Importador de decks:** o formato aceito é `quantidade grafia`? Foil, condição e idioma entram na linha?
5. **Escrita:** há planos de endpoint para importar coleção/lista direto na conta do usuário? Hoje o export é só texto para colar.
6. **`min_price`:** é o menor preço entre todas as versões (foil e normal) ou só a versão padrão? O app trata como único valor por carta.
7. **Compra:** ofertas filtráveis, carrinho e envio de pedido. Perguntas e situação em `docs/pendencias.md`.

## Como o Riftscan usa a API hoje

- `tools/sync_myp.py` pagina `/riftbound/precos`, liga cada carta ao catálogo local por `tcg_productId` (o `t` do `cards.json`) e grava `data/myp.json` com `{ic, min, avg, label, link}`. Token em `MYP_API_TOKEN` (ambiente ou `.env.local`).
- `python tools/sync_myp.py --mock` gera dados **fictícios** para a demonstração enquanto o acesso não sai; o app marca "DADOS DE EXEMPLO".
- `/precos` só lista cartas com estoque, então cartas sem estoque ficam fora do arquivo e o app mostra o preço do TCGplayer para elas.
- `myp.js` é o cliente (token opcional, leitura dos headers de limite, erros `rate_limited`/`blocked`/`network`). No app, "Atualizar preços desta coleção" chama `GET /produto/{id}` por carta e guarda o resultado no aparelho.
- **Não verificado contra a API real:** o formato do `card_code` do Riftbound (necessário para `/precos/{codigo}`) e se `tcg_productId` bate com o `t` do TCGplayer. Validar com uma resposta real assim que houver acesso.
