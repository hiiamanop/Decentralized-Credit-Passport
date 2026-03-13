# Integrasi Sumber Data Digital UMKM (QRIS, Marketplace, E-Wallet, Bank)

## Tujuan
Mengintegrasikan data transaksi UMKM dari empat sumber utama (QRIS transaction, Marketplace, E-wallet payment, dan Bank Transaction) ke platform, lalu mengonsolidasi data secara real-time untuk kebutuhan scoring, analitik, dan dashboard/laporan.

## Evaluasi Kelayakan & Kesesuaian
### Kelayakan teknis per sumber
- QRIS Transaction: sangat layak, umumnya tersedia melalui aggregator/PSP (notifikasi webhook + settlement report). Tantangan: variasi field antar PSP, dan sinkronisasi status (paid/settled/refunded).
- Marketplace: layak bila ada akses API partner/seller center atau export report terjadwal. Tantangan: rate limit, beberapa data hanya tersedia di laporan (batch), dan struktur order-item vs payment.
- E-wallet payment: layak jika lewat provider (midtrans/xendit/dll) atau API wallet. Tantangan: tokenisasi, variasi event status, dan rekonsiliasi settlement.
- Bank transaction: layak untuk statement-based integration (Open Banking/host-to-host) atau upload statement. Tantangan: perizinan, akses API terbatas, format mutasi bervariasi (CSV/MT940), dan identifikasi merchant/party.

### Kesesuaian dengan platform saat ini
Platform saat ini sudah punya:
- AI scoring service (butuh fitur finansial ringkas/terstruktur)
- Backend oracle yang bisa memproses request dan menulis bukti on-chain

Integrasi data transaksi cocok karena:
- Menambah bukti dan fitur agregasi (cashflow, omzet, frequency) untuk scoring
- Menambah transparansi audit (rekap transaksi + lineage sumber)

## Standar Data & Format Umum
### Format transport
- Webhook event: JSON, signed request (HMAC) + timestamp
- Pull API: REST JSON, OAuth2/API key, pagination
- Batch report: CSV/XLSX/JSON Lines, periodic ingestion

### Standar waktu & mata uang
- Timestamp disimpan dalam ISO-8601 UTC (`event_time`), tetap simpan timezone asal bila tersedia
- Mata uang disimpan sebagai `currency` (ISO 4217) + `amount_minor` (integer, minor unit)

## Model Data Kanonik (Internal)
Setiap sumber di-normalisasi menjadi `TransactionEvent`.

### TransactionEvent (inti)
- `event_id` (internal UUID/ULID)
- `idempotency_key` (unik untuk dedupe)
- `source` (qris|marketplace|ewallet|bank)
- `source_event_id` (ID event dari sumber jika ada)
- `source_transaction_id` (ID transaksi/settlement dari sumber)
- `merchant_id` (internal UMKM/tenant)
- `occurred_at` (UTC ISO string)
- `status` (authorized|captured|settled|refunded|failed|unknown)
- `direction` (in|out)
- `currency` (ISO 4217)
- `amount_minor` (integer)
- `fee_minor` (integer, optional)
- `net_amount_minor` (integer, optional)
- `counterparty` (optional: nama/no rekening/no hp masked)
- `raw` (payload asli untuk audit/debug, disimpan terkompresi/terenkripsi bila perlu)

### Dimensi tambahan (untuk analitik)
- `channel` (qris|bank_transfer|ewallet|marketplace)
- `product_category` (marketplace, optional)
- `location` (optional)
- `tags` (array, optional)

## Pemetaan Struktur Data per Sumber
Di bawah ini contoh struktur minimal yang umum ditemui (akan berbeda antar provider). Prinsipnya: lakukan adapter per provider lalu map ke model kanonik.

### 1) QRIS Transaction (contoh)
Contoh payload (webhook):
- `merchant_id` / `store_id`
- `trx_id` / `rrn` / `ref_id`
- `amount` (string/number)
- `currency`
- `status` (PAID/SETTLED/REFUND)
- `paid_at` / `settled_at`
- `issuer` (bank/e-wallet)

Mapping:
- `source=qris`
- `source_transaction_id=trx_id|rrn|ref_id`
- `occurred_at=paid_at/settled_at`
- `direction=in`
- `amount_minor=amount*100` (atau sesuai minor unit)
- `channel=qris`

### 2) Marketplace (contoh)
Struktur umum:
- `order_id`
- `payment_id`
- `order_time`, `paid_time`, `completed_time`
- `items[]` (sku, qty, price)
- `shipping_fee`, `platform_fee`
- `status` (paid/shipped/completed/refunded)

Mapping:
- `source=marketplace`
- `source_transaction_id=payment_id|order_id`
- `occurred_at=paid_time` (untuk cashflow masuk), atau `completed_time` untuk GMV selesai
- `amount_minor=total_paid`
- `fee_minor=platform_fee + payment_fee`
- `net_amount_minor=amount - fee`
- `channel=marketplace`

### 3) E-wallet Payment (contoh)
Struktur:
- `payment_id`
- `wallet_provider`
- `customer_id` (masked)
- `amount`, `fee`, `status`
- `created_at`, `paid_at`, `refunded_at`

Mapping:
- `source=ewallet`
- `source_transaction_id=payment_id`
- `occurred_at=paid_at/created_at`
- `direction=in` (umumnya)
- `channel=ewallet`

### 4) Bank Transaction (contoh)
Struktur mutasi:
- `account_number` (masked)
- `transaction_date`, `posting_date`
- `amount` (+/-)
- `description`
- `reference`
- `balance` (optional)

Mapping:
- `source=bank`
- `source_transaction_id=reference|hash(description+amount+date)`
- `occurred_at=posting_date|transaction_date`
- `direction=in` jika amount > 0, `out` jika < 0
- `channel=bank_transfer`

## Penyesuaian Skema Database (untuk data heterogen)
Pendekatan disarankan: schema kanonik + raw payload terpisah.

### Tabel inti
- `merchants` (UMKM/tenant)
- `source_connections` (konfigurasi koneksi per sumber: provider, status, token metadata terenkripsi)
- `transaction_events` (kanonik)
- `transaction_raw` (payload asli + metadata, optional)
- `idempotency_keys` (dedupe/replay protection)

### Prinsip desain
- Simpan data kanonik yang query-friendly (amount_minor, occurred_at, status, direction, channel)
- Simpan payload asli untuk audit (opsional, bisa dienkripsi)
- Punya unique constraint untuk dedupe (source + source_transaction_id + status_event) atau idempotency_key

## API Gateway (Real-time Consolidation)
### Model integrasi
- Push (webhook): sumber mengirim event ke gateway
- Pull (scheduler): gateway menarik data berkala dari sumber (untuk marketplace/bank statement)

### Komponen gateway
- Ingestion endpoints per sumber (`/ingest/qris`, `/ingest/marketplace`, `/ingest/ewallet`, `/ingest/bank`)
- Normalizer/adapter per sumber → menghasilkan `TransactionEvent`
- Validator: cek schema minimum, tipe data, range amount, timestamp
- Deduper: idempotency key + unique source transaction
- Cleansing: normalisasi currency, timestamp, trimming, status mapping
- Persistor: simpan ke DB (atau storage sementara untuk demo)
- Publisher: kirim update ke dashboard (SSE/WebSocket) untuk real-time

## Mekanisme Validasi, Dedup, Cleansing
### Validasi
- Wajib: `merchant_id`, `source_transaction_id`, `occurred_at`, `amount`, `currency`
- Range: amount > 0 untuk `direction=in`, amount < 0 untuk `direction=out` (atau disimpan absolute + direction)
- Timestamp: reject jika terlalu jauh dari sekarang (kecuali batch mode)
- Enum mapping: status dari sumber dimapping ke enum internal

### Dedup
- `idempotency_key = hash(source + provider + source_transaction_id + event_type/status + occurred_at)`
- Simpan idempotency key dengan TTL (mis. 7–30 hari) untuk menangkap replay
- Gunakan unique constraint di DB untuk perlindungan lapis kedua

### Cleansing
- Normalisasi amount: string “10.000,50” → minor integer
- Normalisasi timestamp: convert ke UTC
- Masking: counterparty/account/phone disimpan masked bila tampil di UI
- Rekonsiliasi: status settlement vs paid dipisah sebagai event berbeda bila perlu

## Keamanan Transaksi (Policy)
- Semua endpoint ingestion wajib signature (HMAC) + timestamp
- Rotasi secret per sumber, minimal 90 hari
- Replay protection: timestamp drift ±300s + store nonce/idempotency
- Logging tanpa data sensitif (masking)
- Rate limit per source (IP + key), dan circuit breaker jika error bertubi-tubi

## Autentikasi & Otorisasi per Sumber
### Webhook (Push)
- Header: `X-Source`, `X-Timestamp`, `X-Signature`
- `X-Signature = HMAC_SHA256(secret, timestamp + "." + raw_body)`

### Pull API
- OAuth2 client credentials / API key
- Token disimpan terenkripsi (KMS/secret manager), minimal disimpan sebagai placeholder metadata untuk demo

### Dashboard/Reporting API
- Read-only API key untuk dashboard (`Authorization: Bearer <token>`) atau internal-only

## Alur Integrasi (End-to-End)
1. Source event masuk ke gateway
2. Gateway validasi signature + timestamp
3. Normalisasi ke `TransactionEvent`
4. Validasi schema internal
5. Dedup check
6. Cleansing + enrichment (optional)
7. Persist ke storage
8. Publish update real-time ke dashboard
9. Dashboard menampilkan ringkasan dan daftar transaksi

## Rencana Pengujian Integrasi
### Jenis test
- Contract test per sumber: payload contoh → normalize → lulus validasi
- Dedup test: payload sama dikirim dua kali → hanya satu tersimpan
- Cleansing test: variasi format amount/time → hasil kanonik benar
- Security test: signature salah / timestamp replay → ditolak
- E2E test: ingest → dashboard summary berubah sesuai

### Deliverable pengujian
- Koleksi payload contoh untuk 4 sumber
- Test runner otomatis (CI opsional)
- Laporan hasil uji: jumlah event, dedupe count, invalid count
