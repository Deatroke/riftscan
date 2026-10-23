# Riftscan

PWA para escanear cartas de Riftbound e gerar a lista de importacao da LigaRiftbound (CSV ou so os nomes).

Status: em desenvolvimento. Sem login por enquanto; roda local, deploy na Vercel depois.

## Decisoes

- Static HTML/CSS/JS, sem build. Funciona no celular e no PC.
- Cartas: Riftcodex (`api.riftcodex.com`), salvas em `data/`.
- Precos: TCGCSV (TCGplayer, categoria 89) em USD, com conversao direta para BRL. Os precos nao vao para a Liga.
- Exportacao: CSV no formato da exportacao da Liga, ou lista so com os nomes.

## Skills usadas no desenvolvimento

`find-skills` (vercel-labs/skills) e `design-taste-frontend` (Leonxlnx/taste-skill) ficam em `.claude/skills/` e nao sao versionadas.
