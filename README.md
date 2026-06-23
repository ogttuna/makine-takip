# FreezeDryMachine

Freeze dry makinasindan alinan proses verilerini toplamak, yerel olarak saklamak
ve grafiklerle izlemek icin web-oncelikli yerel veri toplama uygulamasi.

## Durum

Bu repo su an calisan bir ilk iskelet icerir:

- Vite + React + TypeScript operator arayuzu
- Apache ECharts ile zaman serisi grafigi
- TanStack Query ile collector API polling
- Zod ile runtime API dogrulama
- Tauri 2 masaustu kabugu, ileride opsiyonel paketleme icin
- Rust/Tokio/Axum collector API
- SQLx + SQLite migration, WAL ve STRICT tablolar

## Hedef

Bu proje ilk asamada tek makineye baglanan yerel bir web operator uygulamasi
olarak tasarlanir. Ana hedefler:

- Makineden gelen sensor ve proses verilerini guvenilir sekilde kaydetmek.
- Canli ve gecmis proses grafiklerini operator ekraninda gostermek.
- Her kurutma kosusunu tarih, recete, parti ve notlarla takip etmek.
- Veriyi once yerel SQLite uzerinde tutmak, ileride analiz ihtiyacina gore
  Parquet/DuckDB veya merkezi PostgreSQL'e genisletmek.

## Stack

### Frontend

- React + TypeScript + Vite
- Apache ECharts
- TanStack Query
- Zod

### Desktop

- Tauri 2

### Collector

- Rust + Tokio
- Axum
- tokio-modbus / tokio-serial
- Serde

### Storage

- SQLite + SQLx
- WAL
- STRICT tablolar

### Ileride

- Parquet + DuckDB
- Python sidecar
- PostgreSQL, yalnizca merkezi veya cok kullanicili sisteme gecilirse

Detayli teknik tanim icin bkz. [docs/tech-stack.md](docs/tech-stack.md).
Uygulama plani icin bkz. [docs/implementation-plan.md](docs/implementation-plan.md).

## Kurulum

Gerekenler:

- Node.js 24+
- npm 11+
- Rust 1.95+
- Tauri icin platforma gore gerekli sistem paketleri

Bagimliliklari kur:

```sh
npm install
```

Collector'i calistir:

```sh
npm run collector:dev
```

Ayrica frontend'i calistir:

```sh
npm run dev
```

Tarayicida `http://127.0.0.1:5173` acilir. Collector varsayilan olarak
`http://127.0.0.1:4777` adresinde calisir.

Tauri masaustu kabugunu calistirmak icin:

```sh
npm run tauri:dev
```

## Komutlar

- `npm run dev`: Vite frontend gelistirme sunucusu
- `npm run build`: TypeScript ve Vite production build
- `npm run preview`: Vite build onizleme
- `npm run collector:dev`: Rust collector API
- `npm run collector:check`: Collector crate derleme kontrolu
- `npm run tauri:dev`: Tauri 2 masaustu uygulamasi
- `npm run check`: Frontend build ve collector check

## Ortam Degiskenleri

`.env.example` dosyasindaki degerler varsayilan gelistirme ayarlaridir:

- `VITE_COLLECTOR_URL`: Frontend'in kullanacagi collector API adresi
- `FREEZEDRY_BIND_ADDR`: Collector bind adresi
- `FREEZEDRY_DB_URL`: SQLite dosya adresi

## Proje Yapisi

```text
.
|-- collector/              # Rust + Tokio + Axum collector
|-- migrations/             # SQLx SQLite migration dosyalari
|-- src/                    # React operator arayuzu
|-- src-tauri/              # Tauri 2 masaustu kabugu
|-- docs/                   # Mimari ve stack dokumantasyonu
|-- Cargo.toml              # Rust workspace
|-- package.json            # Frontend/Tauri npm komutlari
`-- vite.config.ts          # Vite ayarlari
```

## Veri Saklama

Varsayilan SQLite dosyasi `data/freezedry.db` olarak olusur. Bu klasor ve
veritabani dosyalari Git'e alinmaz. Migration ilk calismada su tablolari kurar:

- `runs`
- `import_files`
- `channels`
- `sample_frames`
- `measurements`
- `quality_events`
- `settings`
