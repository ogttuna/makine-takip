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

Taslak plandaki tamamen normalize `sample_frames` + `measurements` modeli
esnek ama bu asama icin gereksiz karmasik. Mevcut makine CSV'sinde kolonlar
biliniyor. MVP icin daha sade bir model yeterli.

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

### `samples`

Ilk surum icin genis tablo. CSV kolonlari dogrudan burada tutulur.

```text
id
run_id
sampled_at
source_row_number
raf1
raf2
raf3
raf4
l_pres
h_pres
vacum
serp2
serp4
kondanser
quality_flags_json
created_at
```

### `quality_events`

Zaman boslugu, supheli deger, parse uyarisi gibi olaylar.

```text
id
run_id
sample_id
channel_code
event_type
severity
message
created_at
```

### `settings`

Uygulama ve makine profili ayarlari.

```text
key
value_json
updated_at
```

Bu model sade ve sorgulanabilir. Ileride farkli makineler veya dinamik kanal
setleri gerekirse normalize modele gecilebilir.

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

## Mevcut Repo Icin Ilk Duzeltmeler

Mevcut scaffold iyi bir baslangic ama su degisiklikler oncelikli:

1. Demo `samples` semasini gercek CSV kolonlarina gore degistir.
2. `collector` icine CSV import endpoint'i ekle.
3. Frontend'e import ekrani ekle.
4. Gecmis kosu listesini gercek SQLite verisinden besle.
5. ECharts grafigini CSV kolon gruplarina gore yeniden kur.
6. `RAF3=850` ve zaman bosluklari icin quality event uret.
7. Production modda Axum'un built frontend'i serve etmesini sagla.
8. Tauri'yi simdilik yalnizca opsiyonel paketleme olarak tut.

## Uygulama Sirasi

### Sprint 1: CSV import ve gercek sema

- Migration'i CSV kolonlarina gore yenile.
- Rust `csv` parser ekle.
- Dosya hash'i hesapla.
- Import preview endpoint'i yaz.
- Import commit endpoint'i yaz.
- Ornek CSV icin kabul kriterlerini sagla:
  - 144 sample
  - 10 kanal
  - 4 adet `RAF3=850` suspect event
  - 7 adet 240 saniye ustu time gap event

### Sprint 2: Web arayuz import/gecmis

- Import ekranini ekle.
- Import raporunu goster.
- Gecmis kosular ekranini gercek API'ye bagla.
- Ayni dosya importunu engelle.

### Sprint 3: Grafik ekrani

- Kanal gruplarina gore ECharts ekranini kur.
- Kanal ac/kapat kontrolleri ekle.
- Zoom ve tooltip'i duzenle.
- Supheli degerleri ana cizgiden ayir.
- Zaman bosluklarini gorunur yap.

### Sprint 4: Replay ve basit canli izleme

- Import edilen run'i replay modunda oynat.
- Canli grafik update akisini test et.
- SQLite'a yazarken UI'in donmadigini dogrula.

### Sprint 5: Lokal production calisma

- `npm run build` sonrasi Axum frontend serve etsin.
- Tek komutla lokal calisma akisi olussun.
- README kurulum/komutlari buna gore guncellensin.

## Basari Kriterleri

Ilk kullanisli surum su senaryoyu tamamlamali:

1. Kullanici `LogFile_2026_01_26.csv` dosyasini secer.
2. Uygulama dosyayi analiz eder ve uyarilari gosterir.
3. Kullanici import eder.
4. Run gecmis listesine eklenir.
5. Uygulama kapatip acinca run kaybolmaz.
6. Grafik ekraninda tum kanallar incelenebilir.
7. `RAF3=850` grafigi bozmaz.
8. Zaman bosluklari fark edilir.
9. Ayni dosya ikinci kez veri cogaltmaz.
10. Internet olmadan lokal bilgisayarda calisir.

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
