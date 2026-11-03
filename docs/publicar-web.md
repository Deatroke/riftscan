# Publicar a versão web (Vercel)

O app é um site estático. A Vercel roda `npm run build:www` (definido em `vercel.json`), que copia só os arquivos do site para `www/` (cerca de 1,3 MB, sem os snapshots, as ferramentas nem o projeto Android) e publica essa pasta.

## Primeira vez

1. Em vercel.com, entre com a conta do GitHub e escolha **Add New → Project**.
2. Importe o repositório `Deatroke/riftscan` (a Vercel lê repositórios privados da conta pessoal).
3. Não mude nada: o `vercel.json` já define o comando de build, a pasta de saída (`www`) e os cabeçalhos. **Framework Preset: Other.**
4. **Deploy.** A Vercel dá um endereço `https://riftscan-….vercel.app`.

Branch de produção = `main`. Qualquer outra branch (como `feat/app-mobile`) vira um **Preview**, com endereço próprio, útil para testar antes de juntar na `main`.

## Como os dados ficam em dia

O job "Daily data" (`.github/workflows/prices.yml`) faz commit na `main` todo dia com preços, histórico e cartas novas. Cada commit na `main` faz a Vercel publicar de novo, e o app lê `data/` do próprio site. Não precisa mexer em `DATA_BASE`.

Esse job só roda quando o arquivo estiver na `main`; antes disso rode `python tools/update_prices.py` e `python tools/build_data.py --refresh-cards` à mão e faça o commit.

## Usar no iPhone

1. Abrir o endereço no **Safari** (precisa ser o Safari).
2. **Compartilhar → Adicionar à Tela de Início.** O app abre sem as barras do navegador.
3. Usar sempre o ícone da tela de início. **O armazenamento do Safari e o do ícone são separados**: o que for criado numa aba do Safari não aparece no ícone.

## Limites conhecidos

- Os dados (coleções) ficam no navegador do aparelho. Limpar os dados do site ou desinstalar apaga tudo; um backup em arquivo ainda não existe.
- No iPhone o `<dialog>` do menu e o `color-mix` pedem iOS 16.2 ou mais novo.
- Câmera: o navegador pede permissão ao primeiro uso; em HTTPS funciona (`Permissions-Policy` do `vercel.json` libera só para o próprio site).
