# FreezeDryMachine Uygulama Plani

Bu dokuman projenin sade, kullanisli ve web-oncelikli uygulama planidir.
`initPlan.md` taslagindaki fikirler ve `LogFile_2026_01_26.csv` ornek verisi
esas alinarak olusturulmustur.

## Urun Yonu

Ilk hedef masaustu uygulamasi degil, lokal calisabilen web uygulamasidir.

Beklenen kullanim:

- Operator bilgisayari makineye kabloyla veya dosya aktarimi ile baglanir.
- Rust collector/API lokal calisir.
- React arayuz tarayicida acilir.
- Veriler lokal SQLite dosyasina yazilir.
- Internet olmasa da daha once kurulmus uygulama veri kaydedebilir ve grafik
  gosterebilir.

Masaustu paketleme simdilik ikincil hedeftir. Tauri 2 repo icinde kalabilir,
ama MVP kararlarini Tauri'ye baglamayacagiz. Ileride tek tikla acilan uygulama
gerekirse ayni web UI Tauri kabuguna alinabilir.

## Sade Mimari

MVP icin hedef mimari:

```text
Browser / React UI
        |
        | HTTP
        v
Rust Axum API + static frontend server
        |
        v
SQLite database
```

Gelistirme sirasinda Vite ayri calisir:

```text
React + Vite  ->  http://127.0.0.1:5173
Axum API      ->  http://127.0.0.1:4777
SQLite        ->  data/freezedry.db
```

Uretim/lokal kullanimda hedef:

```text
collector binary
  - /api/* endpointleri
  - built frontend dosyalarini serve eder
  - SQLite dosyasini yonetir
```

Bu sayede Tauri olmadan da makineye bagli bir bilgisayarda lokal web arayuzu
calisir.

## Ornek CSV'den Cikan Gercekler

Dosya: `LogFile_2026_01_26.csv`

- 144 veri satiri var.
- 10 olcum kanali var.
- Toplam 1.440 olcum degeri var.
- Zaman araligi: `2026-01-26-11:08:17.626` ile
  `2026-01-26-18:51:16.967`.
- Yaklasik sure: 7 saat 43 dakika.
- Medyan ornekleme araligi: 180 saniye.
- En uzun zaman boslugu: 967 saniye.
- 240 saniyeden buyuk 7 bosluk var.
- `RAF3` kanalinda 4 adet `850.0` degeri var.
- `VACUM` kanali hem `1.6E-05` seviyesinde hem de yaklasik `287`
  seviyesinde degerler iceriyor.
- `SERP2` ve `SERP4` bu dosyada birebir ayni.
- Zaman kolonunda saat dilimi bilgisi yok.

Kolonlar:

```text
TARIH SAAT
RAF1
RAF2
RAF3
RAF4
L_PRES
H_PRES
VACUM
SERP2
SERP4
KONDANSER
```

Bu veri hacmi cok kucuk. Ilk surum icin PostgreSQL, TimescaleDB, InfluxDB,
Parquet, DuckDB veya mikroservis mimarisi gerekmiyor.

## MVP Kapsami

MVP su isi iyi yapmali:

1. CSV dosyasi import edilsin.
2. Dosya yapisi dogrulansin.
3. Veriler SQLite'a kalici olarak yazilsin.
4. Gecmis kosular listelensin.
5. Bir kosunun grafikleri acilsin.
6. Kanal secme/acma/kapama olsun.
7. Zaman ekseninde zoom ve kaydirma olsun.
8. Zaman bosluklari grafikte gorunsun.
9. Supheli degerler normal cizgiyi bozmasin.
10. Ayni dosya tekrar import edilirse veri ciftlenmesin.

MVP disinda kalacaklar:

- Kullanici hesabi ve rol sistemi
- Cloud senkronizasyon
- PostgreSQL
- Python sidecar
- Parquet/DuckDB
- Gelismis raporlama
- Makine ogrenmesi
- Cok makine/cok kullanici mimarisi
- Tauri installer

## Veri Modeli Karari

Ilk taslakta CSV kolonlarini dogrudan genis `samples` tablosuna almak
dusunulmustu. Ancak veri tipi ve kanal seti ileride degisebilecegi icin MVP'de
hafif esnek model kullanilacak: zaman satiri `sample_frames`, kanal degerleri
`measurements` tablosunda tutulacak.

Onerilen tablolar:

### `runs`

Bir CSV importu veya canli kayit oturumu.

```text
id
name
source_kind          -- csv_import, csv_tail, replay, live
source_name          -- dosya adi veya baglanti adi
started_at
finished_at
status
notes
created_at
```

### `import_files`

Ayni dosyanin tekrar import edilmesini engellemek ve izlenebilirlik icin.

```text
id
run_id
file_name
file_sha256
row_count
warning_count
error_count
imported_at
```

### `channels`

Olcum kanallarinin kodu ve gosterim bilgisi.

```text
id
code
display_name
unit
group_name
value_type
created_at
```

### `sample_frames`

CSV'deki tek zaman satiri.

```text
id
run_id
sampled_at
source_timestamp_text
source_row_number
created_at
```

### `measurements`

Bir frame icindeki tek kanal degeri. Ham metin her zaman saklanir; sayisal
parse basariliysa `numeric_value` dolar, ileride metin/bool gibi tipler
gelirse `value_text` ve `value_type` kullanilir.

```text
id
frame_id
channel_id
raw_text
numeric_value
value_text
value_type
quality
quality_reason
created_at
```

### `quality_events`

Zaman boslugu, supheli deger, parse uyarisi gibi olaylar.

```text
id
run_id
frame_id
channel_id
event_type
severity
message
metadata_json
created_at
```

### `settings`

Uygulama ve makine profili ayarlari.

```text
key
value_json
updated_at
```

Bu model genis tablo kadar basit degil, ama veri tipi ve kanal degisimlerine
daha hazir. Yine de mikroservis veya time-series database seviyesinde
overengineering sayilmaz.

## Veri Kalitesi Kurallari

Ilk kural: ham veri silinmez.

Supheli veya hatali gorunen degerler veritabaninda kalir, ama grafik davranisi
ayri olur.

Baslangic kurallari:

- Tarih parse edilemiyorsa satir import edilmez, rapora hata yazilir.
- Sayisal kolon parse edilemiyorsa satir import edilmez veya kanal `null`
  olarak isaretlenir; karar import ekraninda net raporlanir.
- Ornekleme araligi medyanin belirgin ustundeyse `time_gap` event'i olusur.
- `RAF3 = 850.0` simdilik `suspect` sayilir.
- `VACUM` icin bilimsel gosterim desteklenir.
- `SERP2` ve `SERP4` ayni geldigi icin bu durum uyaridir, hata degildir.

Grafikte:

- Supheli `RAF3=850` ana sicaklik cizgisine dahil edilmemeli.
- Ham deger tooltip veya uyari noktasi olarak gorulebilmeli.
- Zaman bosluklarinda cizgi kesilmeli veya bosluk isareti gosterilmeli.

## Ekranlar

### 1. Gecmis Kosular

- Import edilen kosular listelenir.
- Dosya adi, baslangic, bitis, satir sayisi, uyari sayisi gorunur.
- Bir kosuya tiklayinca detay/grafik ekranina gidilir.

### 2. CSV Import

- Kullanici CSV dosyasi secer.
- Uygulama dosyayi analiz eder.
- Basliklar, satir sayisi, zaman araligi ve uyarilar gosterilir.
- Kullanici onay verirse import baslar.
- Ayni dosya hash ile yakalanir ve tekrar import engellenir.

### 3. Kosu Detayi ve Grafik

Baslangic grafik gruplari:

- Raflar: `RAF1`, `RAF2`, `RAF3`, `RAF4`
- Basinclar: `L_PRES`, `H_PRES`
- Vakum: `VACUM`
- Sogutma/serpantin: `SERP2`, `SERP4`, `KONDANSER`

Kontroller:

- Kanal ac/kapat
- Zoom/kaydirma
- Tooltip
- Supheli degerleri goster/gizle
- CSV export

### 4. Ayarlar

Baslangicta sadece gerekli ayarlar:

- Varsayilan saat dilimi: `Europe/Istanbul`
- Beklenen CSV delimiter: `;`
- Beklenen zaman formati: `yyyy-MM-dd-HH:mm:ss.SSS`
- Supheli deger kurallari

## Canli Veri Stratejisi

Gercek makine baglantisi netlesmeden Modbus/serial kodunu buyutmek gereksiz.
Sirali yol:

### Asama A: CSV import

Mevcut ornek dosya ile kalici veri ve grafik akisi tamamlanir.

### Asama B: Replay mode

Import edilen CSV, canli veri gibi oynatilir.

```text
CSV rows -> replay timer -> API -> SQLite -> live chart
```

Bu sayede gercek makine olmadan canli grafik davranisi test edilir.

### Asama C: CSV tail

Makine bir CSV dosyasina surekli satir ekliyorsa:

- Son okunan byte konumu saklanir.
- Yeni satirlar okunur.
- Yarim yazilmis satir bekletilir.
- Dosya yenilenirse durum raporlanir.

### Asama D: Kablolu cihaz baglantisi

Makine protokolu kesinlesince eklenir:

- Seri port ise `tokio-serial`
- Modbus RTU/TCP ise `tokio-modbus`
- Ureticiye ozel TCP ise ayri adapter

Bu kisim MVP degil.

## Web ve Offline Karari

"Web oncelikli" demek cloud zorunlu demek degil. Ilk surum lokal web
uygulamasi olacak.

Internet gerektirmeyen kullanim hedefi:

- Uygulama bir kez kurulur.
- Rust collector lokal calisir.
- Browser `localhost` uzerinden UI'a girer.
- SQLite lokal diskte kalir.
- Makine kabloyla baglansa da internet gerekmez.

Ileride merkezi sistem gerekirse ayni UI ve API mantigi sunucuya tasinabilir.
PostgreSQL yalnizca bu asamada dusunulmeli.

## Hemen Uygulanacak Yol Haritasi

Bu bolum task listesi gibi kullanilabilir. Her adim kucuk, test edilebilir ve
bir sonraki adimi acacak sekilde yazilmistir.

### 0. Kararlari Sabitle

Bu adim koddan once netlik saglar.

- Ana kullanim: browser UI + lokal Axum API.
- CSV secimi: browser dosya seciciden upload edilir; server yerel dosya path'i
  beklemez.
- Tauri: simdilik paketleme opsiyonu, MVP akisini belirlemez.
- Veri modeli: `sample_frames` + `measurements` ile hafif esnek model.
- Demo seed kaldirilir; gercek veri akisi CSV import ile baslar.

Kabul:

- Plan ve README ayni yonu soyluyor.
- MVP icin Tauri, PostgreSQL, Parquet, Python ve Modbus isleri acikca park
  edilmis durumda.

### 1. Veritabani Semasini CSV'ye Uydur

Mevcut demo semasi yerine CSV'ye uygun ama kanal degisimlerine hazir sema
kullanilacak.

Dosyalar:

- `migrations/20260623143000_initial.sql`
- `collector/src/db.rs`
- `collector/src/routes.rs`

Yapilacaklar:

- `runs` tablosuna `source_kind`, `source_name`, `started_at`, `finished_at`,
  `status`, `notes` alanlari ver.
- `import_files` tablosunu ekle.
- `channels`, `sample_frames` ve `measurements` tablolarini ekle.
- `measurements` icinde `raw_text`, `numeric_value`, `value_text`,
  `value_type`, `quality`, `quality_reason` alanlarini tut.
- `quality_events` tablosunu ekle.
- `file_sha256` icin unique index koy.
- Demo veri seed'ini kaldir.

Kabul:

- Bos veritabaninda migration calisir.
- `cargo check -p collector` gecer.
- Gerekirse dev veritabani `data/freezedry.db` silinip yeniden olusturulabilir.

### 2. CSV Parser'i Backend'e Ekle

Ilk gercek is CSV dosyasini guvenilir okumak.

Dosyalar:

- `collector/src/csv_import.rs`
- `collector/src/routes.rs`
- `collector/Cargo.toml`

Bagimliliklar:

- `csv`
- `sha2`
- Gerekirse `uuid`

Yapilacaklar:

- `;` delimiter kullan.
- Beklenen header listesini kontrol et.
- `TARIH SAAT` alanini `%Y-%m-%d-%H:%M:%S%.3f` formatinda parse et.
- Saat dilimi bilgisi olmadigi icin ilk asamada kaynak timestamp metnini de
  sakla.
- `1.607629E-05` gibi bilimsel gosterimli sayilari parse et.
- Satir numarasini sakla.
- Dosya SHA-256 hesapla.
- Medyan ornekleme araligini hesapla.
- 240 saniyeden buyuk bosluklari raporla.
- `RAF3=850.0` degerlerini `suspect` olarak isaretle.

Kabul:

- `LogFile_2026_01_26.csv` icin parser su sonucu verir:
  - 144 sample
  - 10 kanal
  - baslangic `2026-01-26-11:08:17.626`
  - bitis `2026-01-26-18:51:16.967`
  - 7 adet 240 saniye ustu time gap
  - 4 adet `RAF3=850.0` suspect

### 3. Import API'sini Yaz

Web UI dosya upload edecegi icin endpoint multipart veya raw file upload kabul
etmeli. En sade yol tek endpoint ile import etmektir; preview daha sonra
ayrilabilir.

Endpointler:

```text
POST /api/imports/csv
GET  /api/imports/:id
GET  /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/samples
GET  /api/runs/:id/quality-events
```

`POST /api/imports/csv` cevabi:

```json
{
  "run_id": 1,
  "file_sha256": "...",
  "row_count": 144,
  "warning_count": 11,
  "error_count": 0,
  "started_at": "2026-01-26T11:08:17.626",
  "finished_at": "2026-01-26T18:51:16.967"
}
```

Yapilacaklar:

- Import transaction icinde calissin.
- Ayni `file_sha256` varsa veri cogalmasin; mevcut run id donsun.
- Parse hatalari response icinde raporlansin.
- `quality_events` import sirasinda olussun.
- `/api/runs/:id/samples` ham sample listesini dondursun.

Kabul:

- Ornek CSV import edilir.
- Ayni CSV ikinci kez import edilince `samples` sayisi artmaz.
- `/api/runs` import edilen run'i listeler.
- `/api/runs/:id/samples` 144 satir dondurur.

### 4. Backend Testlerini Ekle

Kod ilerledikce parser davranisini sabitlemek gerekir.

Dosyalar:

- `collector/tests/csv_import.rs`
- `fixtures/LogFile_2026_01_26.csv`

Yapilacaklar:

- Ornek CSV'yi `fixtures/` altina kopyala.
- Parser unit/integration testi yaz.
- Duplicate import testi yaz.
- Quality event sayilarini test et.

Kabul:

```sh
cargo test -p collector
cargo check -p collector
```

ikisi de gecer.

### 5. Frontend API Tiplerini Gercek Veriye Cevir

Demo snapshot yerine gercek CSV veri tipleri kullanilacak.

Dosyalar:

- `src/api.ts`
- `src/App.tsx`
- `src/demoData.ts`

Yapilacaklar:

- `RunSummary`, `ImportReport`, `SampleRow`, `QualityEvent` Zod semalarini
  ekle.
- `fetchRuns`, `fetchRunSamples`, `uploadCsv` fonksiyonlarini yaz.
- Demo datayi kaldir veya yalnizca backend kapaliyken bos-state icin kullan.

Kabul:

- `npm run build` gecer.
- Frontend API tipleri backend response'lariyla uyumlu olur.

### 6. Import Ekranini Yap

Ilk kullanici degeri burada ortaya cikacak.

Dosyalar:

- `src/App.tsx`
- `src/features/import/ImportPanel.tsx`
- `src/styles.css`

Yapilacaklar:

- Dosya secme input'u ekle.
- Upload progress veya loading state goster.
- Import sonucu kartini goster:
  - satir sayisi
  - zaman araligi
  - uyari sayisi
  - hata sayisi
- Basarili importtan sonra runs listesini yenile.
- Hata durumlarini okunur goster.

Kabul:

- Browser'dan ornek CSV secilip import edilir.
- Import sonrasi run listede gorunur.
- Ayni dosya tekrar secilince veri cogalmaz ve kullaniciya bilgi verilir.

### 7. Gecmis Kosular Ekranini Ayir

Ana ekran tek sayfa kalabilir ama bolumler net ayrilmali.

Dosyalar:

- `src/features/runs/RunList.tsx`
- `src/features/runs/RunDetail.tsx`
- `src/App.tsx`

Yapilacaklar:

- Run listesi gercek `/api/runs` endpointinden beslensin.
- Run secilince sample ve quality event sorgulari calissin.
- Secili run URL state veya local React state ile tutulabilir.

Kabul:

- Sayfa yenilenince import edilmis kosular kaybolmaz.
- Run secilince grafik bolumu o run'in verisini kullanir.

### 8. Grafik Ekranini CSV Kanallarina Gore Kur

Mevcut demo grafik yerine CSV kolon gruplari gosterilecek.

Dosyalar:

- `src/TelemetryChart.tsx`
- `src/features/charts/ChannelControls.tsx`
- `src/features/charts/channelConfig.ts`

Kanal gruplari:

- Raflar: `RAF1`, `RAF2`, `RAF3`, `RAF4`
- Basinclar: `L_PRES`, `H_PRES`
- Vakum: `VACUM`
- Sogutma: `SERP2`, `SERP4`, `KONDANSER`

Yapilacaklar:

- Kanal ac/kapat kontrolu ekle.
- `VACUM` icin ayri eksen veya ayri panel kullan.
- `RAF3=850` ana cizgide `null` olsun, ayri warning marker olarak gorunsun.
- Zaman bosluklarinda cizgi kesilsin.
- Tooltip kalite bilgisini gostersin.

Kabul:

- `RAF3=850` grafigin olcegini bozmaz.
- 10 kanal secilebilir durumdadir.
- Zoom ve tooltip calisir.

### 9. Basit Export Ekle

Ilk export sadece secili run'i CSV olarak indirsin.

Endpoint:

```text
GET /api/runs/:id/export.csv
```

Yapilacaklar:

- Orijinal kolon sirasi korunur.
- `TARIH SAAT` formatini kaynak formatina yakin dondur.
- Frontend'e export butonu ekle.

Kabul:

- Import edilen run tekrar CSV indirilebilir.

### 10. Lokal Production Modu

Bu adim "internet yokken lokal calissin" hedefini kapatir.

Dosyalar:

- `collector/src/main.rs`
- `collector/src/routes.rs`
- `README.md`
- `package.json`

Yapilacaklar:

- `npm run build` ile `dist/` olussun.
- Collector production modda `dist/` klasorunu static serve etsin.
- Tek komut dokumante edilsin:

```sh
npm run build
cargo run -p collector
```

- Kullanici `http://127.0.0.1:4777` adresinden UI'a girebilsin.

Kabul:

- Vite dev server olmadan UI acilir.
- API ve UI ayni porttan calisir.
- Internet baglantisi gerekmez.

## Sirali Is Listesi

Uygulama sirasinda bu liste takip edilecek.

1. Sema ve migration'i esnek CSV olcum modeline cevir.
2. CSV parser modulu yaz.
3. Parser testlerini ornek CSV ile sabitle.
4. Import API'sini yaz.
5. Duplicate import korumasini ekle.
6. Runs/samples/quality endpointlerini bitir.
7. Frontend Zod semalarini gercek API'ye uydur.
8. Import panelini yap.
9. Run listesi ve run secimini yap.
10. Grafik kanal gruplarini kur.
11. Supheli deger ve zaman boslugu gosterimini ekle.
12. CSV export ekle.
13. Axum static frontend serve etsin.
14. README'i calistirma komutlariyla guncelle.
15. Tauri'yi opsiyonel durumda birak.

## Basari Kriterleri

Ilk kullanisli surum su senaryoyu tamamlamali:

1. Kullanici browser'dan `LogFile_2026_01_26.csv` dosyasini secer.
2. Uygulama dosyayi upload eder ve import eder.
3. Import raporu 144 satir, 7 time gap ve 4 suspect `RAF3` degeri gosterir.
4. Run gecmis listesine eklenir.
5. Uygulama kapatip acinca run kaybolmaz.
6. Grafik ekraninda tum kanallar incelenebilir.
7. `RAF3=850` grafigi bozmaz.
8. Zaman bosluklari fark edilir.
9. Ayni dosya ikinci kez veri cogaltmaz.
10. Vite dev server olmadan `http://127.0.0.1:4777` uzerinden lokal calisir.

## Daha Sonra Dusunulecekler

Bu maddeler simdilik park edilir:

- Tauri installer
- Serial/Modbus gercek cihaz adapteri
- Parquet/DuckDB export
- Python analiz sidecar
- PostgreSQL merkezi sistem
- Kullanici/rol/oturum sistemi
- Otomatik rapor PDF'i
- Cok makine destegi

Bu planin ana fikri: once CSV import + kalici SQLite + iyi grafik. Bu temel
dogru calisirsa canli kablolu baglanti ve masaustu paketleme daha sonra temiz
sekilde eklenir.
