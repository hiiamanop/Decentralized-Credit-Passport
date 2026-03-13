# Decentralized Credit Passport for MSMEs (NEAR + AI + Alternative Data)

Prototype untuk membuat “Credit Passport” UMKM: identitas kredit digital yang dihitung dari data transaksi alternatif (QRIS, marketplace, e-wallet, bank) menggunakan AI, lalu diverifikasi dengan hash di blockchain NEAR (tanpa menaruh data sensitif on-chain).

## Ringkasan
- **Data Integration Layer**: gateway ingest multi-sumber + normalisasi + dedupe + cleansing + validasi signature.
- **Feature Engineering**: ekstraksi indikator perilaku finansial (stability, frequency, seasonality, cashflow).
- **AI Scoring**: menghasilkan `credit_score (0–1000)` + `risk_category`.
- **Credit Passport**: payload kredit (fitur + hasil AI + metadata window) → **hash deterministik**.
- **Blockchain Verification (NEAR)**: simpan passport & `verification_hash`, kontrol akses, public opt-in.
- **Dashboard (UI)**: demo flow end-to-end (gateway → score → hash → passport).

## Struktur Project
- [ai-service/](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/ai-service) — Python service untuk scoring (model ML + scoring features).
- [backend/](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/backend) — Node/TS backend: gateway, feature engineering, hashing, NEAR oracle adapter.
- [credit-passport/](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/credit-passport) — Smart contract Rust di NEAR.
- [ui/](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/ui) — React dashboard (Bootstrap).
- [design/UMKM_DATA_INTEGRATION.md](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/design/UMKM_DATA_INTEGRATION.md) — dokumen arsitektur integrasi data.
- [db/schema_postgres.sql](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/db/schema_postgres.sql) — skema konseptual (Postgres) untuk penyimpanan event.

## Quick Start (Paling cepat)

### 1) Jalankan AI + Backend via Docker
1. Buat env file:
```bash
cp .env.docker.example .env.docker
```
2. Jalankan:
```bash
docker compose up -d --build
```

### 2) Ingest demo data (4 sumber)
```bash
docker compose --profile demo run --rm gateway-demo
```

### 3) Score dari Gateway (demo tanpa on-chain)
Secara default Docker menjalankan `SKIP_ONCHAIN_UPDATE=1`, jadi scoring tetap jalan walau private key belum diisi.

```bash
curl -sS -X POST http://localhost:3000/calculate-score-from-gateway \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"ahmadmuzakki.testnet","merchantId":"umkm-001","windowDays":180}'
```

### 4) Jalankan UI (lokal)
```bash
cd ui
npm install
npm run dev -- --host --port 5173
```
Lalu buka UI, set **Backend URL** ke `http://localhost:3000`.

## Mode On-chain (NEAR)
Untuk benar-benar menulis ke smart contract:
- Isi `ORACLE_PRIVATE_KEY` di `.env.docker` dengan format `ed25519:<base58>` (tanpa karakter seperti `_`).
- Set `SKIP_ONCHAIN_UPDATE=0`
- Pastikan `CONTRACT_ID` menunjuk ke contract yang sudah di-deploy.

```bash
docker compose up -d --build --force-recreate
```

## API Utama

### Gateway ingest (butuh signature HMAC)
- `POST /ingest/qris`
- `POST /ingest/marketplace`
- `POST /ingest/ewallet`
- `POST /ingest/bank`

Headers:
- `X-Timestamp`: epoch milliseconds
- `X-Signature`: `sha256=<hmac_hex>`, dengan payload `timestamp + "." + raw_body`

### Konsolidasi gateway
- `GET /gateway/summary`
- `GET /gateway/events?merchantId=umkm-001&limit=50&source=qris`
- `GET /gateway/features?merchantId=umkm-001&windowDays=180`
- `GET /gateway/stream` (SSE)

### Scoring
- `POST /calculate-score-from-gateway` — features dari gateway → AI `/score-features` → hash passport → (opsional) update on-chain.
- `POST /verify-passport-hash` — recompute hash dari payload passport (off-chain check).
- `POST /calculate-score` — legacy scoring (manual input).

### Passport API
- `POST /passport/create`
- `POST /passport/public`
- `GET /passport/summary/:accountId`
- `GET /passport/public/:accountId`

## Smart Contract (NEAR)
Lokasi: [credit-passport/src/lib.rs](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/credit-passport/src/lib.rs)

Peran contract:
- Simpan struktur `CreditPassport` (business_id, owner, score, risk_level, verification_hash, last_updated).
- Kontrol akses update score (oracle).
- Public opt-in untuk detail publik.
- Verifikasi hash (`verify_credit_passport`).

## Testing

### Backend
```bash
cd backend
npm run build
npm test
```

### Contract (Rust)
```bash
cd credit-passport
cargo check --target wasm32-unknown-unknown
```

## Dokumen tambahan
- Panduan Docker: [DOCKER.md](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/DOCKER.md)
- Arsitektur integrasi data: [UMKM_DATA_INTEGRATION.md](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/design/UMKM_DATA_INTEGRATION.md)
- Pitch deck: [PITCH_DECK.md](file:///Users/ahmadnaufalmuzakki/Documents/KERJAAN/Meetsin.Id/2026/Hackaton/PITCH_DECK.md)

## Catatan keamanan (prototype)
- Jangan commit `.env.docker` atau private key.
- Signature webhook/gateway sudah ada untuk menghindari spoofing + replay (timestamp).
- On-chain hanya menyimpan hash verifikasi (bukan data transaksi mentah).
