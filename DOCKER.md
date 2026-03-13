# Docker (AI + Backend) — Tanpa UI

Dokumen ini membungkus `ai-service` dan `backend` ke Docker. UI tetap dijalankan lokal (Vite).

## Prasyarat
- Docker Desktop
- `docker compose` tersedia

## 1) Set env untuk backend container
Buat file `.env.docker` di root project (lihat contoh: `.env.docker.example`):

```
ORACLE_ACCOUNT_ID=ahmadmuzakki.testnet
ORACLE_PRIVATE_KEY=ed25519:... (base58, tanpa karakter seperti "_" )
CONTRACT_ID=ahmadmuzakki.testnet

AI_HOST_PORT=5001
BACKEND_HOST_PORT=3000
```

Catatan:
- Jangan commit file ini.
- AI Service port 5001, Backend port 3000.

## 2) Jalankan container
```bash
docker compose up -d --build
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

## 4) Jalankan demo ingest (QRIS/Marketplace/E-wallet/Bank)
Service demo memakai profile `demo`.

```bash
docker compose --profile demo run --rm gateway-demo
```

## 5) Score dari Gateway (tanpa on-chain untuk demo)
Secara default, mode docker menjalankan `SKIP_ONCHAIN_UPDATE=1` agar demo tetap jalan walau private key belum diisi.

Untuk mencoba:
```bash
curl -sS -X POST http://localhost:3000/calculate-score-from-gateway \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"ahmadmuzakki.testnet","merchantId":"umkm-001","windowDays":180}'
```

Jika ingin update on-chain sungguhan:
- Isi `ORACLE_PRIVATE_KEY` di `.env.docker`
- Set `SKIP_ONCHAIN_UPDATE=0`

## 6) Jalankan UI lokal
```bash
cd ui
npm install
npm run dev -- --host --port 5173
```

UI akan memanggil backend di:
- `http://localhost:${BACKEND_HOST_PORT:-3000}`

## Troubleshooting
- Jika model AI tidak ada di `ai-service/models`, endpoint `/predict-score` akan gagal. Pastikan file model tersedia di folder tersebut atau mount volume sudah benar.
