# CSV Klasor Izleme ve Gunluk Dosya Rotasyonu

Bu dokuman, fabrika PC'sinde makinenin surekli guncelledigi CSV dosyalarini
web uygulamasindan izleme ozelliginin uygulanmis planini ve saha kullanim
sozlesmesini kaydeder.

## Durum

- Dayanikli tarayici aktarimi 15 Agustos 2026 tarihinde tamamlandi.
- Hedef kaynak tipi `csv_tail`.
- Backend/frontend testleri, production build ve dort gercek saha CSV'siyle
  HTTP aktarim senaryosu basarili.

## Kullanici Akisi

1. Merkezi collector ve web uygulamasi HTTPS uzerinden yayinlanir.
2. Fabrika PC'si Chrome/Edge ile uygulamayi acar ve **Islemler > Kaynak**
   bolumunden makine log klasorunu secer. Klasor map edilmis bir network share
   olabilir.
3. Fabrika tarayicisi eski CSV'leri deterministik dosya sirasiyla sunucuya
   aktarir, sonra en yeni dosyayi artimli izler.
4. Makine dosyaya veri ekledikce yalnizca yeni, satir sonu tamamlanmis kayitlar
   SQLite'a yazilir.
5. Uzak operatorler ayni web adresini acar; klasor izni vermeden sunucuda
   birikmis ve canli veriyi gorur.
6. Yeni gunluk CSV gecerli header ile olustugunda aktif run korunur ve ayni
   source sequence zincirine devam edilir.
7. Yeniden tarama veya baglanti kopmasinda sunucudaki byte/sequence
   checkpoint'inden devam edilir.

File System Access API guvenli baglam ister; saha akisi Chrome/Edge ve HTTPS ile
calisir. Klasor handle'i fabrika tarayicisinda saklanir, byte ve sequence
checkpoint'i merkezi SQLite'ta tutulur. Fabrika sekmesi kapaliyken yeni veri
aktarilmaz; yeniden acilip izin verildiginde kaldigi yerden devam eder.

## Uygulanan Mimari

```text
Makine -> gunluk CSV klasoru -> fabrika Chrome/Edge sekmesi
                                      |
                                      | HTTPS, yeni tamamlanmis byte'lar
                                      v
                              merkezi Rust collector
                                      |
                                      | ortak ingest + checkpoint
                                      v
                                    SQLite
                                      |
                                      | artimli HTTP sample sorgusu
                                      v
                         fabrika ve uzak operator ekranlari
```

Ilk surum bilerek tek klasor, `*.csv`, 30.000 ms scan ve UI polling ile
sinirlidir. Filesystem notification, WebSocket, coklu makine ve servis kurulum
katmani eklenmedi.

## Sabit Kurallar

- Ilk surum ayni anda tek klasor izler.
- Ayni kaynak klasorundeki gunluk CSV'ler tek, surekli `running` run'da tutulur.
- Eski dosyalar tarih sirasiyla ayni source-sequence zincirine bir kez eklenir.
- Aktif dosya `source_kind = csv_tail` ile saklanir.
- Dosya her turda bastan okunmaz; byte offset ve source sequence saklanir.
- Yarim satir islenmez ve checkpoint yarim satirin sonrasina ilerlemez.
- Tum chunk ingest'i basarisiz olursa checkpoint ilerlemez; tekil bozuk satir
  karantinaya alinir ve checkpoint sonraki fiziksel satira ilerler.
- Dosya checkpoint'ten daha kucuk hale gelirse otomatik rewind yapilmaz;
  kaynak `degraded` olur.
- Yeni dosya bos veya header'i eksikse eski dosya aktif kalir.
- Rotasyondan once eski dosya son kez okunur.
- Stop aktif run'i silmez veya tamamlamaz; tekrar start ayni checkpoint'ten
  devam eder.
- Enabled ayari SQLite'ta saklanir ve collector restart'inda otomatik baslar.

## Zaman Ekseni ve Eksik Olcum

- CSV header'inda `TARIH SAAT` veya `SAAT` kolonlarindan tam biri bulunmalidir.
- `TARIH SAAT` icin `2026-07-14-10:06:00.000`; `SAAT` icin `00:03`,
  `00:03:15` veya `00:03:15.250` desteklenir.
- Yalniz `SAAT` varsa tarih `LogFile_YYYY_MM_DD.csv` adindan uretilir.
- `sampled_at` polling anindan degil bu kolonun degerinden uretilir.
- Bir olcum atlanirsa sonraki veri kendi CSV saatiyle saklanir; sistem araya
  sentetik sample koymaz ve zamani onceki periyoda kaydirmaz.
- Ardisik iki sample arasinda 360 saniyeden fazla fark varsa `time_gap`
  quality event'i yazilir.
- Grafik zaman ekseninde gercek `sampled_at` degerini kullanir ve 360 saniyeyi
  asan boslukta cizgiyi keser.

Ornek: 10:00 kaydindan sonra sonraki satir 10:07 olursa ikinci nokta tam
10:07'ye yazilir; araya sample uretilmez ve onceki satir tekrar gosterilmez.

Gecersiz sayisal hucre ham metinle `invalid` saklanir. Eksik hucreli satirin
bilinen alanlari korunur. Gecersiz timestamp veya dolu fazladan alan iceren
satir `csv_row_*` kalite olayi olarak karantinaya alinir; kalan satirlar
islenmeye devam eder.

## Veri Modeli

Migration: `migrations/20260714100000_csv_tail_sources.sql`

### `csv_tail_sources`

Singleton kaynak ayarini ve aktif dosyayi saklar:

```text
id, name, directory_path, file_pattern, scan_interval_ms, enabled,
active_file_path, active_run_id, last_scan_at, last_error,
created_at, updated_at
```

Path backend tarafinda canonical hale getirilir. Scan araligi 250-60.000 ms,
enabled degeri 0/1 ile sinirlidir.

### `csv_tail_checkpoints`

Her gorulen dosyanin okuma konumunu saklar:

```text
source_id, file_path, run_id, byte_offset, last_source_sequence,
header_line, file_size, completed, created_at, updated_at
```

`(source_id, file_path)` unique'tir. Offset, sequence ve file size negatif
olamaz.

## Dosya Secimi ve Rotasyon

1. Normal dosyalar pattern ile filtrelenir.
2. Klasordeki tum adaylar `LogFile_YYYY_MM_DD.csv` formatindaysa adlarindaki
   tarih kullanilir. Boylece eski bir dosyanin sonradan kopyalanmasi gunluk
   akis sirasini bozmaz. Baska adlar da varsa geriye uyumluluk icin modified
   time, esitlik halinde path ile deterministik siralama kullanilir.
3. En yeni gecerli dosya aktif adaydir.
4. Ilk scan'de daha eski dosyalar deterministik sirayla ayni run'a backfill
   edilir.
   Header veya dosyanin tamami okunamazsa daha yeni dosyaya atlanmaz. Tekil
   bozuk satirlar ise karantinaya alinir ve daha yeni satir/dosyalar islenir.
5. Aktif dosyanin header'i checkpoint'e yazilir ve mevcut tamamlanmis satirlar
   ingest edilir.
6. Sonraki scan'lerde `byte_offset` sonrasindaki byte'lar okunur.
7. Yeni aday gecerli header'a sahip oldugunda eski dosya EOF'a kadar drain
   edilir, eski checkpoint tamamlanir ve yeni dosya ayni run ile acilir.

Dosya adinda tarih bulunmasi zorunlu degildir. Fabrika formati
`LogFile_YYYY_MM_DD.csv` tarih sirasini garanti eder; karma/ozel adlarda secim
modified time ve path ile yapilir.

## Runtime Durumlari

```text
stopped    izleme kapali
scanning   klasor taraniyor
tailing    aktif dosya okunuyor
switching  gunluk yeni dosyaya geciliyor
degraded   path, izin, CSV veya truncation hatasi var
```

Hata worker'i veya HTTP API'yi dusurmez. Hata status response'unda ve web
panelinde gorulur; sonraki scan veya manuel rescan yeniden dener.

## API

```text
GET  /api/csv-tail
PUT  /api/csv-tail
POST /api/csv-tail/start
POST /api/csv-tail/stop
POST /api/csv-tail/rescan

GET /api/runs/:id/samples?latest=5000
GET /api/runs/:id/samples?after_sequence=162&limit=1000
```

Ornek config:

```json
{
  "name": "Freeze dryer CSV",
  "directory_path": "C:\\MachineLogs\\FreezeDryer",
  "file_pattern": "*.csv",
  "scan_interval_ms": 30000
}
```

`latest` DB'de en yeni frame'leri secer ve response'u tekrar kronolojik sirada
dondurur. Ilk yuklemeden sonra istemci `after_sequence` ile yalnizca yeni
frame'leri alir, source sequence'e gore tekillestirir ve son 5.000 sample'lik
pencereyi korur.

## Web Arayuzu

`CsvTailPanel` su kontrolleri sunar:

- fabrika tarayicisinda klasor secimi,
- izin ver ve devam et,
- durdur,
- yeniden tara,
- canli grafigi ac.

Panel stopped/permission-required/scanning/tailing/offline/degraded durumunu, aktif dosyayi, son
satiri, son veri zamanini ve hatayi gosterir. Sade operator deneyimi icin
pattern `*.csv` ve scan araligi 30.000 ms sabittir.

Aktif run icin ilk istekte son 5.000 sample alinir; sonraki 30 saniyelik
isteklerde yalniz son source sequence'ten sonraki sample'lar eklenir. Yeni veri
yoksa cache degismez. Operator gecmis bir run'i bilerek secerse `followLive`
kapanir; yeni gunluk dosya onu canliya geri firlatmaz.

## Tamamlanan Actionable Item'lar

### Veri ve collector

- [x] Singleton source ve dosya checkpoint migration'ini ekle.
- [x] Path canonicalization, okunabilirlik ve interval validation ekle.
- [x] Deterministik `*.csv` kesfi ve eski dosya backfill'i ekle.
- [x] Aktif CSV'yi byte offset'ten artimli oku.
- [x] Yalnizca tamamlanmis satirlari ortak ingest yoluna gonder.
- [x] Duplicate scan ve manager restart'inda idempotency sagla.
- [x] Truncation ve parser hatalarini `degraded` olarak raporla.
- [x] Yeni bos dosyada bekle, gecerli hale gelince otomatik rotate et.
- [x] Gunluk rotasyonda ayni run ve kesintisiz source sequence'i koru.
- [x] `SAAT` kolonlu gunluk dosyalarda tarihi dosya adindan uret.
- [x] Bozuk satiri karantinaya alip sonraki satirlarla devam et.
- [x] Recete no/adim gozlemlerini tarayici aktariminda koru.
- [x] Tek worker, start/stop/rescan ve startup auto-resume ekle.

### API ve web

- [x] CSV tail config/status/start/stop/rescan endpointlerini ekle.
- [x] Sample API'sine `latest` ve `after_sequence` ekle.
- [x] Runtime response semalarini Zod ve TypeScript'e ekle.
- [x] Kaynak paneline path ve lifecycle kontrollerini ekle.
- [x] TR/EN durum ve hata metinlerini ekle.
- [x] Aktif run icin `after_sequence` tabanli bounded grafik polling'i ekle.
- [x] Canliyi takip et ve gunluk yeni dosyaya ayni run ile otomatik gec.
- [x] Gecmis run seciminde otomatik takibi kapat.

### Test ve dokumantasyon

- [x] Mevcut CSV import regression sonucunu koru.
- [x] Tamamlanmis/yarim satir, duplicate scan ve restart testini ekle.
- [x] Bos yeni dosyada bekleme ve otomatik rotasyon testini ekle.
- [x] Eski dosya backfill ve duplicate koruma testini ekle.
- [x] CSV saatini koruma ve 6 dakikadan buyuk bosluk uyarisi testini ekle.
- [x] Zaman-kolon varyantlari ve bozuk satir izolasyonu testlerini ekle.
- [x] Gecici SQLite ve klasorle gercek HTTP polling smoke testi yap.
- [x] Satir append, latest/cursor API ve gunluk dosya rotation'ini smoke et.
- [x] Collector testleri, web production build ve desktop check'i calistir.
- [x] README kullanimini guncelle.

## Dogrulama Kaydi

15 Agustos 2026 tarihinde:

- `cargo test --workspace --all-targets --locked`: 37 collector testi ve
  Tauri masaustu hedefi gecti.
- `npm run test:frontend`: 10 test gecti.
- `npm run build`: TypeScript ve Vite production build gecti.
- `cargo +1.94.1 fmt --all -- --check` ve `git diff --check`: gecti.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: gecti.
- `npm audit --audit-level=moderate`: sifir bilinen acikla gecti.
- `docker compose build app`: production imaji olustu; container health, UI,
  SQLite ve yetkisiz kullanici (`uid=10001`) smoke testi gecti.
- Gercek Chromium testinde API istekleri 200, console hata/uyari sayisi sifir;
  dosya seciciden gercek Agustos CSV importu ve bozuk-satir kalite gorunumu
  dogrulandi.
- Dort gercek dosya manuel import ve tarayici-tail HTTP akisi ile dogrulandi:
  `LogFile_2026_06_11.csv` (479), `LogFile_2026_06_14.csv` (397),
  `LogFile_2026_08_13.csv` (288), `LogFile_2026_08_14.csv` (288).
- Tarayici akisi tek `running` run'da 1.452 frame, kesintisiz son sequence 1.453
  ve Agustos dosyalarindan 576 recete/adim observation'i sakladi.
- Dordunde de parse/rejected-row sayisi sifirdi; Haziran 14 dosyasindaki dort
  gercek zaman boslugu warning olarak kaydedildi.
- Hata enjeksiyonunda eksik hucre korundu; dolu fazla alan ve bozuk timestamp
  karantinaya alindi; bozuk UTF-8 byte'i sonraki satirlari veya byte
  checkpoint'ini durdurmadi.

## Definition of Done

- [x] Operator fabrika Chrome/Edge tarayicisindan network klasorunu secebilir.
- [x] Collector eski ve aktif CSV'leri duplicate olmadan isler.
- [x] Yeni tamamlanmis satir en gec sonraki 30 saniyelik kontrolde SQLite ve
  grafikte gorunur.
- [x] Yarim satir tamamlanmadan yazilmaz.
- [x] Collector restart sonrasi checkpoint'ten devam eder.
- [x] Yeni gunluk CSV otomatik algilanir.
- [x] Gunluk dosya degisiminde aktif run running kalir.
- [x] Canli takip modu ayni run'da yeni dosyayi izlemeye devam eder.
- [x] Gecmis run incelemesi otomatik secim tarafindan bozulmaz.
- [x] Kaynak hatalari collector'i dusurmeden UI'da gorunur.
- [x] Tekil bozuk satir kalan veri akisini durdurmaz.
- [x] Uzak operatorler ayni merkezi run'i salt web arayuzunden gorebilir.
- [x] Test, build ve production smoke kontrolleri gecer.

## Saha Sonrasi Opsiyonlar

Yalnizca gercek kullanim ihtiyaci olusursa:

- filesystem notification veya SSE/WebSocket eklemek,
- coklu klasor/makine destegi,
- Windows service installer ve otomatik baslatma,
- UNC/network share credentials yonetimi,
- retention ve otomatik arsivleme,
- farkli uretici dosya-ad/timestamp bicimleri.

Bu maddeler ilk surumun tamamlanma kosulu degildir.
