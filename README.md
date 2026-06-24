# AgentPass Backend

Express.js API server for AgentPass — portable AI memory protocol on 0G.

## Endpoints

| Route | Method | Body | Description |
|-------|--------|------|-------------|
| `/health` | GET | — | Health check |
| `/api/context/store` | POST | `{ content, modelName, description, isPublic }` | Store context to 0G Storage |
| `/api/context/load` | POST | `{ contextId }` | Load context by blob ID |
| `/api/context/list` | GET | — | List public contexts |
| `/api/context/chat` | POST | `{ contextId, query }` | Chat using context via 0G Compute |
| `/api/context/:id/metadata` | GET | — | Get context metadata |
| `/api/context/stats` | GET | — | Network stats |

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Deploy on Railway

1. Push to GitHub
2. New Railway project → Deploy from GitHub → select this repo
3. Add environment variables from `.env.example`
4. Railway auto-deploys on every push

## Environment Variables

See `.env.example` for all required variables.

The backend works in **demo mode** without `BACKEND_PRIVATE_KEY` and `ZERO_G_COMPUTE_API_KEY` — useful for local testing. Set them for full 0G integration.
