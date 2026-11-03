# Pendências

Fora do escopo da "montagem principal" (shell, coleções, exportações, cliente da API). Ordem não é prioridade.

## Compra pelo MYP Cards: ofertas, filtros e carrinho (pedido em 2026-11-02)

**Objetivo:** ao escanear uma carta, mostrar os preços dela no MYP Cards, deixar filtrar por características específicas de cada carta (por exemplo condição, idioma, foil), montar um carrinho dentro do app e enviar para o MYP finalizar o pedido.

**Situação: bloqueada pela API atual** (spec OpenAPI 1.0.0, lida em 2026-11-02):

| Parte | O que a API dá hoje | O que falta |
|---|---|---|
| Preços da carta escaneada | `min_price` e `avg_price` por carta (um valor só, em BRL) | já funciona via `data/myp.json` e `GET /produto/{id}` |
| Filtrar por condição, idioma, foil, edição | nada: o preço não vem separado por versão. Só o `/historico` tem uma "versão padrão" (NM, sem foil) | endpoint de anúncios/ofertas por carta, com filtros |
| Ver quem vende (loja, estoque, preço de cada anúncio) | nada. A spec diz que não expõe estoque nem cópias à venda | mesmo endpoint de ofertas |
| Carrinho e pedido | nada: não há login, carrinho nem escrita | endpoint de carrinho/pedido, ou um link que abra o carrinho já preenchido no site |

**Caminhos possíveis, do mais barato ao mais completo** (depende da resposta do MYP):

1. **Link para a página da carta** (`link` do `Produto`): já disponível, o usuário filtra e compra no site. Dá para ligar já ao botão "Ver no MYP Cards".
2. **Carrinho como lista para colar/abrir no site**, se o MYP tiver uma URL que receba itens (ou o importador de decks levar direto ao carrinho).
3. **Ofertas e carrinho pela API**, se o MYP criar os endpoints. Aí o app teria: tela da carta com ofertas filtráveis, carrinho no aparelho e envio do pedido. Provavelmente exigiria login do usuário no MYP (OAuth ou token por usuário), que a API hoje não tem.

**Perguntas para o MYP** (somar às de `docs/mypcards-api.md`):

1. Existe ou vai existir um endpoint de anúncios por carta, com condição, idioma, foil, preço e loja?
2. Existe uma URL ou fluxo que receba uma lista de itens (anúncios ou cartas) e leve o usuário ao carrinho já preenchido?
3. Há planos de API autenticada por usuário (carrinho, pedido, coleção)? Qual seria o modelo de autorização?
4. Um app de terceiros pode iniciar a compra, ou o pedido precisa ser finalizado no site do MYP?
5. Se o MYP intermediar vendas, há regras de comissão, afiliado ou identificação de origem do pedido?

**Quando destravar:** desenhar a tela da carta (preço MYP com filtros), o carrinho como um novo tipo de lista ao lado das coleções, e o envio. O modelo de coleções em `core.js` e o cliente em `myp.js` já separam dados de interface, então o carrinho entra como mais uma lista sem refazer a base.

## Histórico de preço e variação (inspirado no app de referência, 2026-11-02)

**Feito:** o histórico diário (`data/history.json`, 90 dias, do TCGplayer via TCGCSV), a página "Preços do dia" (queda/alta com filtros) e a variação de 24 h, 7 d e 30 d na tela da carta. Detalhes em `docs/precos-diarios.md`.

**Falta:**
1. **Gráfico de preço** de uma linha na tela da carta (7 d, 30 d, 90 d). Os dados já estão em `history.json`; falta o componente.
2. **Variação nas miniaturas** da grade da Lista, só onde houver dois pontos reais.
3. **Histórico do MYP Cards** (`GET /produto/{id}/historico`) quando o acesso à API sair. Hoje todo o histórico é do TCGplayer, em dólar.

## Tela da carta: texto das regras

O campo `x` do `cards.json` vem sem os ícones (`", : Attach…"`, `"Hide now for to react with later for ."`), então o texto não é mostrado. Precisa de uma fonte que preserve os símbolos de custo e de ação antes de entrar na tela.
