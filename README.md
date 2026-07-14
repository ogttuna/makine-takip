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
- CSV import, otomatik CSV klasor izleme ve kaynak bagimsiz canli ingest API'si
- SQLx + SQLite migration, WAL ve STRICT tablolar

## Hedef

Bu proje ilk asamada tek makineye baglanan yerel bir web operator uygulamasi
olarak tasarlanir. Ana hedefler:

- Makineden gelen sensor ve proses verilerini guvenilir sekilde kaydetmek.
- Canli ve gecmis proses grafiklerini operator ekraninda gostermek.
- Her kurutma kosusunu tarih, recete, parti ve notlarla takip etmek.
- Ileride recete state'lerine gore guvenli aralik ve limit ihlali yorumu
  yapabilmek.
- Veriyi once yerel SQLite uzerinde tutmak, ileride analiz ihtiyacina gore
  Parquet/DuckDB veya merkezi PostgreSQL'e genisletmek.
- Verinin nereden gelecegi netlesmeden UI ve storage katmanini tek protokole
  kilitlememek.

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
- CSV import
- Kaynak bagimsiz HTTP ingest endpointleri
- tokio-modbus / tokio-serial, ileride donanim adapterleri icin
- Serde

### Storage

- SQLite + SQLx
- WAL
- STRICT tablolar

### Ileride

- Recete/state modeli ve state bazli guvenli aralik kontrolleri
- Parquet + DuckDB
- Python sidecar
- PostgreSQL, yalnizca merkezi veya cok kullanicili sisteme gecilirse

Detayli teknik tanim icin bkz. [docs/tech-stack.md](docs/tech-stack.md).
Uygulama plani icin bkz. [docs/implementation-plan.md](docs/implementation-plan.md).
CSV klasor izleme ve gunluk dosya rotasyonu icin bkz.
[docs/csv-tail-implementation-plan.md](docs/csv-tail-implementation-plan.md).

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

Vite olmadan lokal production modda calistir:

```sh
npm run local:serve
```

Bu komut frontend'i `dist/` altina build eder ve collector UI ile API'yi
`http://127.0.0.1:4777` uzerinden birlikte serve eder.

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
- `npm run local:serve`: Frontend build + collector static serve
- `npm run tauri:dev`: Tauri 2 masaustu uygulamasi
- `npm run check`: Frontend build ve collector check

## Ortam Degiskenleri

`.env.example` dosyasindaki degerler varsayilan gelistirme ayarlaridir:

- `VITE_COLLECTOR_URL`: Frontend'in kullanacagi collector API adresi
- `FREEZEDRY_BIND_ADDR`: Collector bind adresi
- `FREEZEDRY_DB_URL`: SQLite dosya adresi

## Veri Girisi

### Canli CSV klasoru

Fabrika PC'sinde collector'i calistirin, web arayuzunde **Islemler > Kaynak**
sekmesini acin ve makinenin CSV yazdigi klasorun tam path'ini girin. Bu path
tarayicinin calistigi cihaza degil, collector'in calistigi fabrika PC'sine
aittir. **Kaydet ve baslat** sonrasinda collector:

- klasordeki eski `*.csv` dosyalarini bir kez import eder,
- en yeni dosyayi artimli okumaya baslar,
- yalnizca satir sonu tamamlanmis yeni kayitlari isler,
- byte checkpoint'i SQLite'ta saklayip restart sonrasinda kaldigi yerden devam
  eder,
- yeni gunluk CSV gecerli bir header ile olustugunda eski run'i tamamlayip yeni
  dosyaya otomatik gecer,
- aktif run seciliyken grafigi 30 saniyede bir gunceller.

Path'in collector tarafindan okunabilir ve bir klasor olmasi gerekir. Varsayilan
dosya filtresi `*.csv`, tarama araligi 30 saniyedir. Izleme durumu, aktif dosya,
son satir, son veri zamani ve hata mesaji ayni panelde gorulur. Ayar SQLite'ta
saklandigi icin izleme acikken collector yeniden baslatilirsa otomatik devam
eder.

Grafik zamani polling anindan degil CSV'deki `TARIH SAAT` kolonundan gelir.
Desteklenen kaynak bicimi `2026-07-14-10:06:00.000` seklindedir. Ornegin
10:00 kaydindan sonra 10:03 satiri gelmeyip sonraki kayit 10:06 olarak gelirse
sistem 10:06 kaydini kendi saatine yazar; araya veri uydurmaz veya zamani
kaydirmaz. 240 saniyeden buyuk aralik `time_gap` uyarisi olur ve grafik cizgisi
bu boslukta kesilir.

Ilgili endpointler:

```text
GET  /api/csv-tail
PUT  /api/csv-tail
POST /api/csv-tail/start
POST /api/csv-tail/stop
POST /api/csv-tail/rescan
GET  /api/runs/:id/samples?latest=5000
GET  /api/runs/:id/samples?after_sequence=162&limit=1000
```

### Manuel CSV import

Tek seferlik gecmis dosya yuklemek icin CSV import akisi da kullanilabilir:

```text
POST /api/imports/csv
```

Canli veya parca parca gelen veri icin collector tarafinda kaynak bagimsiz bir
ingest siniri vardir:

```text
POST /api/runs
PATCH /api/runs/:id/status
POST /api/runs/:id/samples
GET /api/runs/:id/samples?from=...&to=...&limit=...
GET /api/runs/:id/state-observations
GET /api/runs/:id/state-segments
```

Bu endpointler kaynagin CSV tail, replay, HTTP push, webhook, seri port,
Modbus veya ureticiye ozel TCP olmasina bagli degildir. Adapter hangi
kaynaktan okursa okusun veriyi `sampled_at`, `source_sequence` ve kanal bazli
`measurements` listesine cevirip ayni yoldan SQLite'a yazar.

Onemli kurallar:

- `source_kind` serbest metindir; bugun `csv_import`, `http_push`, `webhook`,
  `csv_tail`, `replay` gibi degerler kullanilabilir.
- `source_sequence` ayni kosu icinde idempotency anahtaridir. Ayni sira tekrar
  gelirse sample ikinci kez yazilmaz.
- Bir sample icinde ayni `channel_code` ikinci kez gonderilmez.
- `raw_text` her zaman saklanir; sayisal parse basariliysa `numeric_value`
  dolar.
- `numeric_value` finite olmalidir; `NaN` veya sonsuz degerler kabul edilmez.
- Kosu `running` durumundaysa frontend sample ve kalite olaylarini periyodik
  yenileyerek dinamik grafik akisini destekler.
- Uzun canli kosular icin sample/state sorgulari zaman penceresi ve limit ile
  okunabilir.

Internet uzerinden gelen veri hedeflenirse de varsayilan karar lokal-first
kalir: uzaktaki kaynakla konusan adapter collector icinde veya collector'a
yakin bir katmanda yer alir, operator UI dogrudan o kaynaga baglanmaz.

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
- `csv_tail_sources`
- `csv_tail_checkpoints`

Recete/state katmani sonraki fazda ayrica eklenecek. Hedef modelde birden
fazla recete ve recete versiyonu bulunabilir. Ham telemetry tablolari degismeden
kalir; recete state'leri, state bazli kanal limitleri ve kosu icindeki state
segmentleri ayri tablolarla tutulur. Makine aktif recete adimini disaridan
gonderirse bu bilgi once ham `run_state_observations` kaydi olarak saklanir,
sonra recete katalog state'leriyle eslestirilir. Bir kosu bir primary recete
ile yorumlanabilir, ileride ayni kosu alternatif recete versiyonlariyla da
karsilastirilabilir. Limit ihlalleri `quality_events` uzerinden grafikte ve
uyari listesinde gosterilir.
