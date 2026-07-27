# CSV Klasor Izleme ve Gunluk Dosya Rotasyonu

Bu dokuman, fabrika PC'sinde makinenin surekli guncelledigi CSV dosyalarini
web uygulamasindan izleme ozelliginin uygulanmis planini ve saha kullanim
sozlesmesini kaydeder.

## Durum

- Sade ilk surum 14 Temmuz 2026 tarihinde tamamlandi.
- Hedef kaynak tipi `csv_tail`.
- Backend testleri, web/desktop build ve gercek HTTP polling/rotation smoke
  senaryosu basarili.
- Ilk saha denemesine hazir.

## Kullanici Akisi

1. Rust collector CSV klasorunun bulundugu fabrika PC'sinde calisir.
2. Operator web arayuzunde **Islemler > Kaynak** bolumune klasorun tam path'ini
   girip **Kaydet ve baslat** der. Tauri masaustu uygulamasinda klasoru drop
   alanina birakmak ayni islemi otomatik yapar.
3. Collector eski CSV'leri deterministik dosya sirasiyla ayni run'a ekler ve en
   yeni CSV'yi aktif dosya olarak acar.
4. Makine dosyaya veri ekledikce yalnizca yeni, satir sonu tamamlanmis kayitlar
   SQLite'a yazilir.
5. Web arayuzu aktif run'i takip eder ve grafigi 30 saniyede bir yeniler.
6. Yeni gunluk CSV gecerli header ile olustugunda aktif run korunur ve collector
   yeni dosyadan ayni source sequence zincirine devam eder.
7. Collector yeniden baslarsa kayitli byte checkpoint'inden devam eder.

Browser keyfi bir yerel klasoru dogrudan okuyamaz. Path'i okuyan web sayfasi
degil, ayni fabrika PC'sinde calisan collector servisidir. Bu nedenle ozellik
bir web projesi uzerinden kullanilirken collector'in CSV klasorune dosya sistemi
erisimi olmalidir. Native Tauri webview'i klasor drop olayinda mutlak path'i
verebildigi icin surukle-birak yalniz masaustu kabugunda otomatik
konfigurasyona donusturulur; normal browser'da path elle girilir.

## Uygulanan Mimari

```text
Makine -> gunluk CSV klasoru
                    |
                    | 30 sn polling + byte checkpoint
                    v
              Rust CsvTailManager
                    |
                    | ortak ingest modeli
                    v
                  SQLite
                    |
                    | HTTP API, aktif run icin 30 sn polling
                    v
            React + TanStack Query + ECharts
```

Ilk surum bilerek tek klasor, `*.csv`, 30.000 ms scan ve UI polling ile
sinirlidir. Filesystem notification, WebSocket, coklu makine ve servis kurulum
katmani eklenmedi.

## Sabit Kurallar

- Ilk surum ayni anda tek klasor izler.
- Her gunluk CSV ayri bir run'dir.
- Eski dosyalar tam CSV import akisi ve SHA-256 duplicate korumasiyla bir kez
  alinir.
- Aktif dosya `source_kind = csv_tail` ile saklanir.
- Dosya her turda bastan okunmaz; byte offset ve source sequence saklanir.
- Yarim satir islenmez ve checkpoint yarim satirin sonrasina ilerlemez.
- Ingest basarisiz olursa checkpoint ilerlemez.
- Dosya checkpoint'ten daha kucuk hale gelirse otomatik rewind yapilmaz;
  kaynak `degraded` olur.
- Yeni dosya bos veya header'i eksikse eski dosya aktif kalir.
- Rotasyondan once eski dosya son kez okunur.
- Stop aktif run'i silmez veya tamamlamaz; tekrar start ayni checkpoint'ten
  devam eder.
- Enabled ayari SQLite'ta saklanir ve collector restart'inda otomatik baslar.

## Zaman Ekseni ve Eksik Olcum

- CSV header'inda `TARIH SAAT` kolonu bulunmalidir.
- Desteklenen kaynak ornegi `2026-07-14-10:06:00.000` bicimindedir.
- `sampled_at` polling anindan degil bu kolonun degerinden uretilir.
- Bir olcum atlanirsa sonraki veri kendi CSV saatiyle saklanir; sistem araya
  sentetik sample koymaz ve zamani onceki periyoda kaydirmaz.
- Ardışık iki sample arasinda 240 saniyeden fazla fark varsa `time_gap`
  quality event'i yazilir.
- Grafik zaman ekseninde gercek `sampled_at` degerini kullanir ve 240 saniyeyi
  asan boslukta cizgiyi keser.

Ornek: 10:00 kaydindan sonra 10:03 gelmez ve sonraki satir 10:06 olursa ikinci
nokta tam 10:06'ya yazilir; 6 dakikalik aralik uyarili bir bosluk olarak kalir.

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
   Bir tarihsel dosya okunamazsa daha yeni dosyaya atlanmaz; kaynak `degraded`
   olur ve duzeltilen dosya ayni run uzerinden yeniden denenir.
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
dondurur. `after_sequence` daha sonra cursor-cache optimizasyonuna gecmek icin
backend ve TypeScript istemcisinde hazirdir.

## Web Arayuzu

`CsvTailPanel` su kontrolleri sunar:

- collector PC'sindeki klasor path'i,
- kaydet ve baslat,
- durdur,
- yeniden tara,
- canli grafigi ac.

Panel stopped/scanning/tailing/switching/degraded durumunu, aktif dosyayi, son
satiri, son veri zamanini ve hatayi gosterir. Sade operator deneyimi icin
pattern `*.csv` ve scan araligi 30.000 ms sabittir.

Aktif run icin son 5.000 sample 30 saniyede bir yeniden alinir. Bu ilk surumde
sinirli ve deterministik bir maliyet saglar. Operator gecmis bir run'i bilerek
secerse `followLive` kapanir; yeni gunluk dosya onu canliya geri firlatmaz.

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
- [x] Tek worker, start/stop/rescan ve startup auto-resume ekle.

### API ve web

- [x] CSV tail config/status/start/stop/rescan endpointlerini ekle.
- [x] Sample API'sine `latest` ve `after_sequence` ekle.
- [x] Runtime response semalarini Zod ve TypeScript'e ekle.
- [x] Kaynak paneline path ve lifecycle kontrollerini ekle.
- [x] TR/EN durum ve hata metinlerini ekle.
- [x] Aktif run icin 30 saniyelik bounded grafik polling'i ekle.
- [x] Canliyi takip et ve gunluk yeni dosyaya ayni run ile otomatik gec.
- [x] Gecmis run seciminde otomatik takibi kapat.

### Test ve dokumantasyon

- [x] Mevcut CSV import regression sonucunu koru.
- [x] Tamamlanmis/yarim satir, duplicate scan ve restart testini ekle.
- [x] Bos yeni dosyada bekleme ve otomatik rotasyon testini ekle.
- [x] Eski dosya backfill ve duplicate koruma testini ekle.
- [x] CSV saatini koruma ve 6 dakikalik bosluk uyarisi testini ekle.
- [x] Gecici SQLite ve klasorle gercek HTTP polling smoke testi yap.
- [x] Satir append, latest/cursor API ve gunluk dosya rotation'ini smoke et.
- [x] Collector testleri, web production build ve desktop check'i calistir.
- [x] README kullanimini guncelle.

## Dogrulama Kaydi

14 Temmuz 2026 tarihinde:

- `cargo test -p collector`: 13 test gecti.
- CSV tail entegrasyon testleri: 4/4 gecti.
- `npm run build`: TypeScript ve Vite production build gecti.
- `cargo check -p freezedry-desktop`: gecti.
- `cargo fmt --all` ve `git diff --check`: gecti.
- Mevcut `data/freezedry.db` dosyasinin gecici kopyasi yeni migration'larla
  acildi; veri kaybetmeden health ve CSV tail status endpointleri calisti.
- Gecici collector/SQLite/CSV klasoru smoke senaryosunda health ve statik web
  200 dondu; eklenen satir okundu; `latest` ve `after_sequence` dogrulandi;
  yeni CSV'de run 1 completed, run 2 running oldu.

## Definition of Done

- [x] Operator web UI'dan fabrika PC'sindeki path'i kaydedebilir.
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
- [x] Test, build ve production smoke kontrolleri gecer.

## Saha Sonrasi Opsiyonlar

Yalnizca gercek kullanim ihtiyaci olusursa:

- frontend polling'i `after_sequence` cursor cache'e cevirmek,
- filesystem notification veya SSE/WebSocket eklemek,
- coklu klasor/makine destegi,
- Windows service installer ve otomatik baslatma,
- UNC/network share credentials yonetimi,
- retention ve otomatik arsivleme,
- dosya adina ozel tarih parser'i.

Bu maddeler ilk surumun tamamlanma kosulu degildir.
