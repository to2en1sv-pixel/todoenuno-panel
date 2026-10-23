# TODOENUNO OS · Panel v7

Panel de control del ecosistema TODOENUNO. Lee datos reales de Supabase y monitorea
los cron jobs externos alojados en `todoenuno-feed.vercel.app`.

## Setup local
```bash
cp .env.example .env
# completa VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_PANEL_TOKEN
npm install
npm run dev
