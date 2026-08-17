# FreezeDryMachine

Freeze dry makinasindan alinan proses verilerini toplamak, yerel olarak saklamak
ve grafiklerle izlemek icin web-oncelikli yerel veri toplama uygulamasi.

## Durum

Bu repo su an calisan bir ilk iskelet icerir:

- Vite + React + TypeScript operator arayuzu
- Apache ECharts ile zaman serisi grafigi
- TanStack Query ile collector API polling
- Zod ile runtime API dogrulama
- Tauri 2 masaustu operator uygulamasi
- Tauri acilisinda otomatik baslayan gomulu collector
- Rust/Tokio/Axum collector API
- CSV import, otomatik CSV klasor izleme ve kaynak bagimsiz canli ingest API'si
- Excel analizinden cikarilan, versiyonlu FD-750 dongu ve proses-state motoru
- Dongu/state ozeti, tani olaylari ve grafik uzerinde proses-state bantlari
- SQLx + SQLite migration, WAL ve STRICT tablolar

## Hedef

Bu proje ilk asamada tek makineye baglanan yerel bir web operator uygulamasi
olarak tasarlanir. Ana hedefler:

- Makineden gelen sensor ve proses verilerini guvenilir sekilde kaydetmek.
- Canli ve gecmis proses grafiklerini operator ekraninda gostermek.
- Her kurutma kosusunu tarih, recete, parti ve notlarla takip etmek.
- FD-750 proses dongulerini ve state gecislerini ham veriden tekrar
  uretilebilir kurallarla yorumlamak.
- Ileride recete state'lerine gore guvenli aralik ve limit ihlali yorumu
  eklemek.
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

- Recete/state kataloglari icin operator editoru ve state bazli limit kontrolleri
- Parquet + DuckDB
- Python sidecar
- PostgreSQL, yalnizca merkezi veya cok kullanicili sisteme gecilirse

Detayli teknik tanim icin bkz. [docs/tech-stack.md](docs/tech-stack.md).
Uygulama plani icin bkz. [docs/implementation-plan.md](docs/implementation-plan.md).
CSV klasor izleme ve gunluk dosya rotasyonu icin bkz.
[docs/csv-tail-implementation-plan.md](docs/csv-tail-implementation-plan.md).
FD-750 analiz kurallari icin bkz.
[docs/fd750-analysis-rules.md](docs/fd750-analysis-rules.md).

## Kurulum

Gerekenler:

- Node.js 24+
- npm 11+
- Rust 1.94.1+ (repo `rust-toolchain.toml` ile 1.94.1'i otomatik secer)
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

Masaustu uygulamasi collector'i otomatik baslatir; ayrica
`npm run collector:dev` calistirmak gerekmez. Varsayilan masaustu SQLite dosyasi
isletim sisteminin uygulama veri klasorunde tutulur.

## Komutlar

- `npm run dev`: Vite frontend gelistirme sunucusu
- `npm run build`: TypeScript ve Vite production build
- `npm run preview`: Vite build onizleme
- `npm run collector:dev`: Rust collector API
- `npm run collector:check`: Collector crate derleme kontrolu
- `npm run local:serve`: Frontend build + collector static serve
- `npm run tauri:dev`: Tauri 2 masaustu uygulamasi
- `npm run check`: Frontend birim testleri, üretim derlemesi ve collector check

## Ortam Degiskenleri

`.env.example` dosyasindaki degerler varsayilan gelistirme ayarlaridir:

- `VITE_COLLECTOR_URL`: Frontend'in kullanacagi collector API adresi. Bos
  birakilirsa dev modunda `127.0.0.1:4777`, production web'de sayfanin acildigi
  origin kullanilir.
- `FREEZEDRY_BIND_ADDR`: Collector bind adresi
- `FREEZEDRY_DB_URL`: SQLite dosya adresi

## Veri Girisi

### Canli CSV klasoru

Uzak erisim icin onerilen akis soyledir:

1. Uygulama ve collector, fabrika PC'sinin de uzak izleyicilerin de
   erisebildigi ayni HTTPS adresinde calisir.
2. Fabrika PC'sinde Chrome veya Edge ile bu adres acilir.
3. **Islemler > Kaynak > CSV klasorunu sec** ile makinenin log klasoru secilir.
   Bu klasor yerel disk, map edilmis ag surucusu veya tarayicinin dosya
   secicisinde gorulebilen bir network share olabilir.
4. Fabrika sekmesi acik kaldigi surece yalnizca yeni tamamlanmis CSV satirlari
   sunucuya gonderilir. Uzak bilgisayarlar ayni adrese girip kayitli ve canli
   veriyi gorur; onlarin klasor secmesi gerekmez.

Tarayici klasor izni nedeniyle bu akis Chrome/Edge ve HTTPS ister. `localhost`
gelistirme icin istisnadir. Fabrika sekmesi kapanirsa mevcut veri kaybolmaz;
sekme yeniden acilip klasor izni verildiginde sunucudaki checkpoint'ten devam
eder. Internet'e acik kurulumda uygulamayi VPN veya kimlik dogrulamali reverse
proxy arkasinda yayinlayin.

Klasor secildikten sonra sistem:

- klasordeki eski `*.csv` dosyalarini ayni run'a ekler; gecerli
  `LogFile_YYYY_MM_DD.csv` dosyalarini klasordeki baska bir CSV'nin adindan veya
  kopyalanma zamanindan etkilenmeden adlarindaki tarihe gore siralar,
- `LogFile_YYYY_MM_DD (1).csv` gibi tarayici/indirme kopyalarini ikinci kez
  yazmak yerine atlar, operatoru uyarir ve diger gecerli dosyalari izlemeye
  devam eder,
- en yeni dosyayi artimli okumaya baslar,
- yalnizca satir sonu tamamlanmis yeni kayitlari isler,
- byte ve source-sequence checkpoint'ini sunucudaki SQLite'ta saklar,
- yeni gunluk CSV gecerli bir header ile olustugunda ayni run'i koruyarak yeni
  dosyaya otomatik gecer,
- yeni dosyanin header satiri henuz tamamlanmadiysa onu atlayip veri kaybetmek
  yerine tamamlanmasini bekler; tamamlanmis fakat gecersiz header'li dosyayi
  kalite hatasi olarak kaydedip sonraki gecerli dosyaya devam eder,
- ayni satir tekrar taransa bile source sequence ile ikinci kez yazmaz,
- ayni klasor yeniden yapilandirildiginda mevcut run ve checkpoint'leri korur,
- yeni sample sorgularinda son sequence'ten sonrasini alir; yeni satir yoksa
  grafige eski noktayi yeniden eklemez,
- 30 saniyelik tarama/polling araligini yalnizca goruntuleme gecikmesi olarak
  kullanir; CSV zamanini veya satir kimligini degistirmez.

Desteklenen iki zaman formati vardir:

- `TARIH SAAT`: `2026-07-14-10:06:00.000` gibi tam tarih-saat.
- `SAAT`: `00:03`, `00:03:15` veya `00:03:15.250`. Bu bicimde tarih
  `LogFile_2026_08_13.csv` dosya adindan alinir.

Excel'in guvenli metin bicimi degisiklikleri de kabul edilir: basliklarda
buyuk/kucuk harf ve tirnak, `10,5` gibi virgul ondalik ve
`14.08.2026 00:03:00` gibi yerellesmis tam tarih-saat degerleri ham metin
korunarak normalize edilir.

CSV hatalari satir/hücre seviyesinde izole edilir:

- gecersiz sayisal hucre ham metniyle ve `invalid` kalitesiyle saklanir; satirin
  diger olcumleri kaybolmaz,
- eksik hucreli satirin bilinen kolonlari saklanir ve eksikler kalite olayi
  olur,
- gecersiz timestamp veya dolu fazladan kolon iceren satir karantinaya alinir;
  kalite olayina dosya/satir bilgisi ve ham metin yazilir, sonraki satira devam
  edilir,
- satir verisindeki bozuk UTF-8 byte'i aktarimi kilitlemez; sorunlu deger
  gecersiz olarak isaretlenirken checkpoint kaynak dosyanin gercek byte
  konumuyla ilerler,
- yarim yazilmis son satir tamamlanana kadar bekletilir,
- tamamlanmis header bozuksa veya 64 KiB guvenlik sinirini asiyorsa dosya
  atlanip kalite hatasi olarak gosterilir; klasordeki diger gecerli dosyalar
  takip edilmeye devam eder,
- dosya gecici olarak okunamiyorsa (ornegin ag paylasimi kesintisi) sonraki
  gunluk dosyaya gecilmez; erisim geri geldiginde ayni checkpoint'ten devam
  edilir,
- zaman onceki kayda gore geriye giderse satir kaybedilmez;
  `timestamp_out_of_order` kalite kaydi olusur, run zaman araligi gercek
  minimum/maksimuma genisler ve grafik kronolojik sirada kalir.

Grafik zamani polling anindan degil CSV zamanindan gelir. Ornegin 10:00
kaydindan sonra sonraki kayit 10:07 ise sistem noktayi tam 10:07'ye yazar;
araya veri uydurmaz, onceki satiri tekrar etmez ve zamani kaydirmaz. 360
saniyeden buyuk aralik `time_gap` uyarisi olur ve grafik cizgisi bu boslukta
kesilir.

Grafik cok gunluk bir kosuda eksende tarihi gosterir. Proses-state bantlari
korunur, ancak `START`/`STOP` gibi bir etiket kendi bandina sigmiyorsa ust uste
binmemesi icin gizlenir. Grafik basligi gorunen kayit sayisini ve canli kosuda
o anda izlenen dosyayi gosterir.

Ilgili endpointler:

```text
GET  /api/csv-tail
PUT  /api/csv-tail
POST /api/csv-tail/start
POST /api/csv-tail/stop
POST /api/csv-tail/rescan
GET  /api/runs/:id/samples?latest=5000
GET  /api/runs/:id/samples?after_sequence=162&limit=1000
GET  /api/runs/:id/analysis
POST /api/runs/:id/analysis
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
- Ham telemetry her eklemeden sonra FD-750 profilinin aktif versiyonuyla tekrar
  analiz edilir. `POST /api/runs/:id/analysis` ayni analizi elle yeniler.

## FD-750 Analiz Katmani

`260725_FD750_Tum_Loglar_Loop_Analizli.xlsx` bir anlik log kaynagi olarak
okunmaz. Calisma kitabindaki loop ve paralel degisim sayfalari, versiyonlu
`fd750_loop/1.0.0` kural profilinin kaynagidir. Ham CSV/ingest verisi aynen
saklanir; cikarsanan donguler, state segmentleri, tani olaylari ve turetilmis
olcumler ayri tablolara yazilir.

Temel yorum:

- `850 +/- 0.5` raf hedefi "raf kapali" kodudur; veri hatasi degildir.
- Aktif raf ve `VACUM < 2` START, devam eden aktif raf DRY olarak yorumlanir.
- Raflarin kapanmasi veya `VACUM > 4` STOP gecisini baslatir.
- STOP/WAIT sonrasinda en sicak gecerli `S1..S4 >= 0 C` ise DEFROST baslar.
- DEFROST sirasinda `E.GUC < 5` ise DEFROST_STOP olur.
- 180 dakikadan uzun veri boslugu proses zincirini resetler; 360 saniyelik
  `time_gap` veri-kalitesi uyarisi bundan ayri tutulur.
- S4-S2 ile vakumun 30 dakikalik paralel degisimi tani olayi olarak kaydedilir.

Arayuzde **Analiz** sekmesi profil versiyonunu, son state'i, donguleri ve tani
olaylarini gosterir. Grafik arka planindaki bantlar cikarsanan proses
state'leridir.

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

Standalone collector icin varsayilan SQLite dosyasi `data/freezedry.db` olarak
olusur. Tauri masaustu uygulamasi varsayilan olarak isletim sisteminin uygulama
veri klasorundeki `freezedry.db` dosyasini kullanir. Bu dosyalar Git'e alinmaz.
Migration ilk calismada su tablolari kurar:

- `runs`
- `import_files`
- `channels`
- `sample_frames`
- `measurements`
- `quality_events`
- `settings`
- `csv_tail_sources`
- `csv_tail_checkpoints`
- `analysis_profiles`
- `process_cycles`
- `process_state_segments`
- `diagnostic_events`
- `derived_measurements`

Makinenin `RECETE NO` ve `RECETE ADIM` kolonlari varsa ham
`run_state_observations` olarak da saklanir. FD-750 kural motoru bu gozlemleri
silmez veya kesin proses gercegi saymaz; sensorlerden cikardigi state zincirini
ayri tutar. Boylece profil versiyonu degistiginde ham telemetry yeniden analiz
edilebilir.
