# Preços diários e a página "Preços do dia"

## De onde vêm os preços

TCGplayer, via **TCGCSV** (`tcgcsv.com`, categoria 89 = Riftbound), em dólar. O TCGCSV é um espelho público e não oficial: publica os preços todo dia por volta das **20:00 UTC** (17:00 em Brasília) e guarda um arquivo por dia em `archive/tcgplayer/prices-AAAA-MM-DD.ppmd.7z` (4 MB, todas as categorias).

Regras que mantêm os números coerentes entre a página, a tela da carta e o histórico (`tools/prices_lib.py`):

- **Um só campo de preço:** `marketPrice`. Sem `midPrice` como reserva, porque uma carta que alterna entre os dois campos mostraria uma variação que não existiu. Sem `marketPrice`, o preço é vazio.
- **Uma só data por snapshot:** a data em que o TCGCSV publicou (`Last-Modified`), a mesma do nome do arquivo de arquivo. Nunca a data em que o script rodou. Confirmado em 2026-11-02: o preço ao vivo é idêntico ao arquivo `2026-11-02` (2.118 preços iguais, 0 diferentes).
- **Atualização no meio:** se menos de 80% das edições carregam a data mais nova, o script aborta em vez de gravar um dia misturado. Uma edição isolada atrasada (aconteceu com 15 cartas de um bundle) passa.
- **Um só mapeamento produto → carta:** a carta é dona do produto dela (`t`) e dos produtos alternativos (`a`); o alternativo só vale quando a carta não tem preço próprio no mesmo acabamento.

## Arquivos

| Arquivo | O que é |
|---|---|
| `data/snapshots/AAAA-MM-DD.json` | **Fonte da verdade.** Um arquivo por dia (~30 KB), só se acrescenta: `{produto: [normal, foil]}` em centavos |
| `data/history.json` | Derivado dos snapshots: últimos 90 dias, em colunas, alinhado por `dates`. Só a página de Preços e a tela da carta o carregam |
| `data/prices.json` | Preço de hoje (`{updated, date, p}`), o que a lista e a busca usam. É igual à última coluna do histórico (o script confere) |

Por que snapshots por dia: reescrever um arquivo grande todo dia soma centenas de MB de histórico no git por ano; arquivos pequenos só crescem.

## Rotina

```
python tools/update_prices.py            # o dia de hoje + até 7 dias perdidos
python tools/update_prices.py --no-catchup
tools/.venv/Scripts/python tools/backfill_history.py --days 90   # uma vez, preenche o passado
```

O backfill precisa de `py7zr` (`pip install py7zr`; `tools/.venv` já tem). Os arquivos diários ficam atrás de um limite de requisições do CloudFront (HTTP 429): o script baixa um por vez, espera entre eles e, se um dia falhar, pula e tenta de novo na próxima execução.

### Todo dia, automático

`.github/workflows/prices.yml` ("Daily data") roda às **21:15 UTC** (e de novo às 23:15, caso a primeira falhe) e faz, nesta ordem:

1. **Cartas e edições** (`python tools/build_data.py --refresh-cards`): acrescenta ao `data/cards.json` o que o TCGCSV lista e o arquivo ainda não tem, ou seja, edição nova, produtos novos e as datas de lançamento (o app ordena as edições por elas). **Só acrescenta:** cartas existentes nunca são alteradas nem removidas, e uma falha de rede deixa o arquivo como estava. Cartas novas chegam sem o texto de regras e sem o domínio, que só o Riftcodex tem; o que o TCGCSV traz (nome, número, raridade, imagem, preço) já basta para aparecerem no app.
2. **Preços, histórico e snapshots** (`tools/update_prices.py`), já incluindo as cartas novas.
3. Faz commit só se algo mudou.

Uma edição nova aparece no app em até um dia, sem ninguém mexer. Para refazer o catálogo completo com o Riftcodex (texto de regras, domínios), rode `tools/fetch_cards.py` e `python tools/build_data.py --cards` à mão.

**Duas condições para funcionar:**

1. O arquivo precisa estar na branch `main` e ter sido enviado ao GitHub: agendamentos só disparam na branch padrão.
2. O repositório precisa ter o GitHub Actions habilitado e permissão de escrita para o workflow.

O workflow não foi enviado nem habilitado: isso é uma decisão sua.

## Como o app fica em dia (a cada 24 h)

- **Web:** lê `data/` da própria origem. Cada commit diário redeploya o site, então o preço novo chega sozinho. Uma aba aberta por mais de 24 h busca os arquivos de novo quando volta ao primeiro plano.
- **App no celular:** os arquivos do build ficam desatualizados. Com `DATA_BASE` em `config.js` apontando para onde o site está hospedado (ex.: `https://riftscan.vercel.app/`), o app baixa `cards.json`, `prices.json` e `history.json` de lá, no máximo uma vez a cada 24 h, guarda uma cópia e, sem internet, usa a última cópia. **Enquanto `DATA_BASE` estiver vazio, o app do celular usa só os dados do build.** É preciso definir onde hospedar (Vercel, GitHub Pages ou repositório público) antes de publicar.
- **Frescor visível:** a página de Preços e a tela da carta mostram "Preços de 02/11, há 5 h". Passou de 36 h, aparece um aviso e o botão "Atualizar agora" força o download.

## A página "Preços do dia"

Quem mais caiu e subiu: direção (queda/alta), período (24 h, 7 dias, 30 dias), acabamento (Normal/Foil), edição, preço mínimo e ordem (variação %, variação em US$, preço). Regras (`core.js`, com testes):

- Compara o preço da data mais nova com o do dia `N` dias antes. Se esse dia não tem snapshot, usa o mais próximo **anterior** e a página diz quais datas comparou.
- Sem preço hoje, a carta fica de fora. Sem preço na data base, aparece como **"novo"** (nunca +∞%).
- Normal e Foil são séries separadas. A variação é calculada em dólar; o valor em reais usa a cotação de hoje.
- O preço mínimo vale se **qualquer um dos dois lados** o alcança (uma carta que caiu de US$ 50 para US$ 0,60 continua aparecendo). O padrão é US$ 1, para centavos não encherem a lista de ±50%.
- Período maior que o histórico disponível: a página avisa em vez de mostrar uma comparação curta.

**A página da Liga que serviu de modelo** (`ligariftbound.com.br/?view=cards/variacao&show=queda&order=1`) bloqueou a leitura automática (403), então as colunas e os filtros são uma versão razoável, não uma cópia. Se você mandar uma captura de tela dela, eu aproximo.
