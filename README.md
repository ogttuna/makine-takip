# FreezeDryMachine

Freeze dry makinasindan alinan proses verilerini toplamak, yerel olarak saklamak
ve grafiklerle izlemek icin masaustu odakli bir veri toplama uygulamasi.

## Hedef

Bu proje ilk asamada tek makineye baglanan yerel bir operator uygulamasi olarak
tasarlanir. Ana hedefler:

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
