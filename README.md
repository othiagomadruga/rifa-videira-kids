# Rifa Videira Kids

Rifa online para arrecadar fundos para investir no espaço Videira Kids.

Sistema de gestão da campanha: API (Hono num Cloudflare Worker, banco D1) e site React (Vite) servidos pelo mesmo Worker.

## Como rodar

Requer Node 22 (veja `.nvmrc`). Não precisa de conta Cloudflare para desenvolver.

```sh
npm ci
npm run dev   # API + site em http://localhost:5173 (status da API em /api/health)
npm test
```

Comandos, estrutura de pastas e stack: seção "Stack e comandos" do [CLAUDE.md](CLAUDE.md).
Processo, regras e convenções do time: [CLAUDE.md](CLAUDE.md). Decisões técnicas: [docs/decisions.md](docs/decisions.md).
