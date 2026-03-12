# Docker (AI + Backend) — Tanpa UI

Dokumen ini membungkus `ai-service` dan `backend` ke Docker. UI tetap dijalankan lokal (Vite).

## Prasyarat
- Docker Desktop
- `docker compose` tersedia

## 1) Set env untuk backend container
Buat file `.env.docker` di root project (lihat contoh: `.env.docker.example`):

```
ORACLE_ACCOUNT_ID=ahmadmuzakki.testnet
ORACLE_PRIVATE_KEY=ed25519:...
CONTRACT_ID=ahmadmuzakki.testnet

AI_HOST_PORT=5001
BACKEND_HOST_PORT=3000
```

Catatan:
- Jangan commit file ini.
- AI Service port 5001, Backend port 3000.

## 2) Jalankan container
```bash
docker compose --env-file .env.docker up --build
```

## 3) Smoke test
```bash
curl -sS http://localhost:${AI_HOST_PORT:-5001}/
curl -sS http://localhost:${BACKEND_HOST_PORT:-3000}/config
```

Alternatif:
```bash
bash scripts/docker-smoke.sh .env.docker
```

## 4) Jalankan UI lokal
```bash
cd ui
npm install
npm run dev -- --host --port 5173
```

UI akan memanggil backend di:
- `http://localhost:${BACKEND_HOST_PORT:-3000}`

## Troubleshooting
- Jika model AI tidak ada di `ai-service/models`, endpoint `/predict-score` akan gagal. Pastikan file model tersedia di folder tersebut atau mount volume sudah benar.
