# FreezeDryMachine Uygulama Plani

Bu dokuman projenin sade, kullanisli ve web-oncelikli uygulama planidir.
`initPlan.md` taslagindaki fikirler ve `LogFile_2026_01_26.csv` ornek verisi
esas alinarak olusturulmustur.

27 Temmuz 2026 revizyonu: Excel loop analiziyle `850` degerinin RAF kapali
kodu oldugu kesinlestirildi ve gunluk CSV'lerin ayni fiziksel proses run'inda
devam etmesi saglandi. Ayrintili guncel kurallar icin
[fd750-analysis-rules.md](fd750-analysis-rules.md) esas alinmalidir.

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
- `RAF3` kanalinda 4 adet `850.0` raf-kapali kodu var.
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
source_kind          -- csv_import, csv_tail, replay, http_push, webhook...
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

## Recete ve Proses State Stratejisi

Ileride recete yapisi eklendiginde sistem sadece "grafikte veri gosterme"
uygulamasi olmayacak; kosunun receteye gore hangi state/asamada oldugunu ve o
state icin guvenli araliklarin disina cikilip cikilmadigini de yorumlayacak.

Bu nedenle recete modeli telemetry modelinden ayri tutulmali:

- `sample_frames` ve `measurements` ham zaman serisi gercegidir; recete
  degisse bile bu veri yeniden yazilmaz.
- Makineden gelen aktif recete/state/adim bilgisi de ham proses bilgisi olarak
  saklanir; dogrudan bizim recete katalog tablolarina zorla map edilmez.
- Recete, state ve guvenli araliklar yorum katmanidir; ayni run farkli recete
  versiyonu veya farkli limit setiyle tekrar degerlendirilebilir.
- Guvenli aralik ihlalleri `quality_events` icinde yeni event tipleri olarak
  tutulabilir, ama ihlal kurali ve recete versiyonu metadata'da izlenebilir
  olmalidir.

Gelecekte eklenecek temel kavramlar:

### `recipes`

Recete katalog kaydi. Sistemde birden fazla recete olabilir.

```text
id
name
status              -- draft, active, archived
description
created_at
```

### `recipe_versions`

Recetenin degismez versiyon snapshot'i. Limitler veya state akisi degisirse
eski kosularin yorumu bozulmasin diye mevcut versiyon guncellenmez, yeni
versiyon acilir.

```text
id
recipe_id
version
status              -- draft, active, archived
created_at
notes
```

### `recipe_states`

Recetenin proses state/asama tanimlari. Ornek: pre-freeze, primary drying,
secondary drying, hold, vent.

```text
id
recipe_version_id
code
display_name
sort_order
expected_duration_seconds
transition_rule_json
```

Makineden gelen state kodlari bizim internal `code` degerimizle birebir ayni
olmayabilir. Bu nedenle state taniminda ileride `external_code` veya
`external_aliases_json` gibi esleme alanlari gerekebilir.

### `recipe_channel_limits`

Her state icin kanal bazli beklenen/guvenli araliklar.

```text
id
recipe_state_id
channel_code
min_value
max_value
target_value
warning_min
warning_max
alarm_min
alarm_max
unit
rule_json
```

Basit araliklar kolonlarda tutulur; daha karmasik kosullar `rule_json` ile
eklenir. Ilk uygulamada bu alanin sadece saklama ve gosterim icin kalmasi,
kurallar netlesince degerlendirme motoruna baglanmasi daha dogru olur.

### `run_recipe_assignments`

Bir kosunun hangi recete versiyonu ile yorumlandigini tutar. Bir run icin
birden fazla assignment olabilir; ornegin operatorun sectigi aktif recete,
alternatif karsilastirma recetesi veya gecmis veriyi yeniden yorumlayan bir
analiz seti. UI ilk etapta tek `primary` assignment'i gosterir, ama veri modeli
coklu recete karsilastirmasina kapali kalmaz.

```text
id
run_id
recipe_version_id
role                -- primary, candidate, comparison
status              -- active, archived
assigned_at
```

### `run_state_observations`

Makineden, dosyadan veya dis kaynaktan gelen "su anda recetenin/adimin hangi
state'indeyiz" bilgisinin ham kaydi. Bu tablo kaynak gercegini saklar; bizim
recete katalog state'imizle eslesip eslesmemesi ayri bir yorum isidir.

```text
id
run_id
sampled_at
source_sequence
source_recipe_code
source_recipe_version
source_state_code
source_state_name
source_payload_json
created_at
```

Bu bilgi ingest akisina olcumlerle beraber veya ayri state/event mesaji olarak
gelebilir. Adapter once kaynak state bilgisini bu ham forma normalize eder.
Sonra esleme kurallari uygunsa `run_state_segments` uretilir.

### `run_state_segments`

Run icinde hangi zaman araliginda hangi recete state'inin gecerli oldugunu
tutar. Bu bilgi makineden gelebilir, operator tarafindan isaretlenebilir veya
ileride otomatik state detection ile uretilebilir.

```text
id
run_recipe_assignment_id
recipe_state_id
started_at
finished_at
source              -- machine, operator, inferred, replay
confidence
metadata_json
```

Makineden gelen state bilgisinden segment uretirken:

- Ardarda ayni `source_state_code` geliyorsa segment uzatilir.
- State kodu bilinen recete state'i ile eslesirse `recipe_state_id` dolar.
- Eslesme yoksa ham observation korunur ve `state_unmapped` quality event'i
  uretilebilir.
- Makine state bilgisini hic gondermezse operator/inferred segment uretimi
  daha sonra devreye girebilir.

### Receteye gore kalite olaylari

State bazli guvenli aralik disina cikma olaylari `quality_events` icinde
asagidaki event tipleriyle baslayabilir:

```text
state_limit_warning
state_limit_alarm
state_missing
state_unmapped
state_transition_gap
```

`metadata_json` icinde en az sunlar tutulmali:

```json
{
  "recipe_id": 1,
  "recipe_version_id": 3,
  "recipe_version": "1.0",
  "run_recipe_assignment_id": 12,
  "recipe_state_code": "primary_drying",
  "channel_code": "RAF1",
  "numeric_value": -18.4,
  "warning_min": -35.0,
  "warning_max": -20.0,
  "alarm_min": -40.0,
  "alarm_max": -10.0
}
```

Grafik davranisi:

- X ekseninde state segmentleri arka plan bandi veya ust zaman seridi olarak
  gosterilebilir.
- Her kanal icin secili state'in guvenli araligi cizgi/bant olarak
  bindirilebilir.
- Tooltip, olcum degerinin yaninda o anda aktif state'i ve limit araligini
  gosterebilir.
- Operator "bu state'te sinir disinda miyiz?" sorusuna grafikten cevap
  alabilmeli.

Bu kisim ilk CSV MVP'sinin icine zorla sokulmayacak. Ancak mevcut esnek
measurement modeli ve `quality_events` yapisi bu recete/state yorum katmanina
engel olmayacak sekilde korunacak.

## Veri Kalitesi Kurallari

Ilk kural: ham veri silinmez.

Supheli veya hatali gorunen degerler veritabaninda kalir, ama grafik davranisi
ayri olur.

Baslangic kurallari:

- Tarih parse edilemiyorsa satir import edilmez, rapora hata yazilir.
- Sayisal kolon parse edilemiyorsa satir import edilmez veya kanal `null`
  olarak isaretlenir; karar import ekraninda net raporlanir.
- Ornekleme araligi medyanin belirgin ustundeyse `time_gap` event'i olusur.
- `RAF1..RAF4 = 850 +/- 0.5` raf-kapali kodudur; `suspect` sayilmaz.
- `VACUM` icin bilimsel gosterim desteklenir.
- `SERP2` ve `SERP4` ayni geldigi icin bu durum uyaridir, hata degildir.

Grafikte:

- `RAF=850` aktif raf ortalamasina dahil edilmemeli.
- Ham `850` degeri DB/API'de korunmali; grafik olcegini bozmamasi icin hedef
  cizgisinden cikarilmali.
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

Gercek makine baglantisi netlesmeden Modbus/serial, vendor TCP veya internet
kaynagi kodunu UI/storage katmanina yaymak dogru degil. Canli veri icin
collector icinde kaynak bagimsiz bir ingest siniri kullanilir.

Mevcut ortak ingest modeli:

```text
POST /api/runs
PATCH /api/runs/:id/status
POST /api/runs/:id/samples
GET /api/runs/:id/samples?from=...&to=...&limit=...
GET /api/runs/:id/state-observations?from=...&to=...&limit=...
GET /api/runs/:id/state-segments?from=...&to=...&limit=...
```

`POST /api/runs` yeni bir `running` kosu olusturur. `source_kind` serbest
metindir; `csv_import`, `csv_tail`, `replay`, `http_push`, `webhook`,
`modbus_tcp`, `serial` veya ureticiye ozel adapter isimleri kullanilabilir.
Bu alan migration seviyesinde sabit enum degildir.

`POST /api/runs/:id/samples` bir veya daha fazla sample ekler:

```json
{
  "samples": [
    {
      "sampled_at": "2026-06-24T10:00:00.000",
      "source_timestamp_text": "2026-06-24T10:00:00.000",
      "source_sequence": 1,
      "measurements": [
        {
          "channel_code": "RAF1",
          "raw_text": "10.25",
          "numeric_value": 10.25
        }
      ]
    }
  ]
}
```

Makine aktif recete/state bilgisini de gonderiyorsa ayni kaynak adapteri bunu
ayri bir `state_observation` olarak normalize etmelidir. Bu bilgi sensor
kanali gibi `measurements` icine zorla sokulmaz; cunku "adim/state" zaman
serisi olcumu degil, proses baglamidir.

Ileride ingest payload'i su sekilde genisleyebilir:

```json
{
  "samples": [
    {
      "sampled_at": "2026-06-24T10:00:00.000",
      "source_sequence": 1,
      "state_observation": {
        "source_recipe_code": "FD_BASIC",
        "source_recipe_version": "3",
        "source_state_code": "PRIMARY_DRYING",
        "source_state_name": "Primary Drying"
      },
      "measurements": [
        {
          "channel_code": "RAF1",
          "raw_text": "10.25",
          "numeric_value": 10.25
        }
      ]
    }
  ]
}
```

Kurallar:

- `source_sequence` ayni kosu icinde idempotency anahtaridir; tekrar gelen
  sample atlanir.
- Makine state bilgisi varsa ham olarak `run_state_observations` tarafinda
  saklanir; bizim recete state'imizle eslesmesi daha sonra yapilir.
- `channel_code` dinamik tutulur; yeni kanal gelirse `channels` tablosuna
  eklenir.
- Bir sample icinde ayni `channel_code` ikinci kez gelirse istek reddedilir.
- `raw_text` her zaman saklanir, `numeric_value` yalniz parse edilebilen
  degerlerde dolar.
- `numeric_value` finite olmalidir; `NaN` veya sonsuz degerler adapter
  tarafindan `invalid` kaliteye cevrilmelidir.
- `quality` bos gelirse collector temel kaliteyi uretir; adapter gerekirse
  `good`, `suspect` veya `invalid` gonderebilir.
- Zaman boslugu ve supheli deger olaylari `quality_events` tablosuna yazilir.

Frontend tarafinda secili kosu `running` durumundaysa sample ve kalite
endpointleri 30 saniyede bir yenilenir. Bu bugun polling ile yapiliyor; veri hizi
artarsa ayni ingest modeli korunup UI tarafinda SSE veya WebSocket eklenebilir.
Canli grafik `latest=5000` ile sinirli pencere ister; backend daha sonra cursor
cache'e gecmek icin `after_sequence` sorgusunu da destekler.

Sirali yol:

### Asama A: CSV import

Mevcut ornek dosya ile kalici veri ve grafik akisi tamamlanir.

### Asama B: Replay mode

Import edilen CSV, canli veri gibi oynatilir.

```text
CSV rows -> replay timer -> ingest API -> SQLite -> live chart
```

Bu sayede gercek makine olmadan canli grafik davranisi test edilir.

### Asama C: CSV tail

Durum: tamamlandi (14 Temmuz 2026).

Bu asamanin dosya, migration, API, UI ve test bazinda uygulanabilir plani icin
bkz. [csv-tail-implementation-plan.md](csv-tail-implementation-plan.md).

Makine bir CSV dosyasina surekli satir ekliyorsa:

- Son okunan byte konumu saklanir.
- Yeni satirlar okunur.
- Yarim yazilmis satir bekletilir.
- Yeni gunluk dosya olusursa ayni run korunarak yeni dosyaya otomatik gecilir.
- Okunan satirlar dogrudan tabloya yazilmaz; ortak ingest modeline cevrilir.
- Grafik X ekseni polling saatini degil CSV'deki `TARIH SAAT` degerini kullanir.
- Atlanan olcum sonraki noktayi kaydirmaz; 240 saniyeyi asan aralik `time_gap`
  olarak raporlanir ve grafik cizgisi boslukta kesilir.

### Asama D: HTTP push / webhook

Veri internetten veya ag icindeki baska bir servisten gelebilir. Bu durumda
dis kaynak dogrudan UI'a baglanmaz; collector bir HTTP push/webhook adapteri
olarak davranir veya guvenilir bir local bridge'den veri alir.

Notlar:

- Gelen payload once kaynak formatindan ortak sample formatina cevrilir.
- Kaynak zaman metni `source_timestamp_text` olarak korunur.
- Tekrar gonderimlere karsi `source_sequence` veya kaynak tarafindaki stabil
  mesaj id'si kullanilir.
- Kimlik dogrulama, imza kontrolu ve rate limit bu adapterin sorumlulugudur;
  grafik ve storage katmani bu detaylara baglanmaz.

### Asama E: Kablolu cihaz baglantisi

Makine protokolu kesinlesince eklenir:

- Seri port ise `tokio-serial`
- Modbus RTU/TCP ise `tokio-modbus`
- Ureticiye ozel TCP ise ayri adapter
- Adapter okudugu degerleri ortak ingest modeline cevirir.

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
- `RAF1..RAF4=850 +/- 0.5` degerlerini raf-kapali kodu olarak koru.

Kabul:

- `LogFile_2026_01_26.csv` icin parser su sonucu verir:
  - 144 sample
  - 10 kanal
  - baslangic `2026-01-26-11:08:17.626`
  - bitis `2026-01-26-18:51:16.967`
  - 7 adet 240 saniye ustu time gap
  - 4 adet `RAF3=850.0` raf-kapali kodu, 0 suspect

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
  "warning_count": 7,
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
- `RAF=850` aktif raf ortalamasindan cikarilsin ve ham hedef serisinde
  raf-kapali kodu olarak ele alinsin.
- Zaman bosluklarinda cizgi kesilsin.
- Tooltip kalite bilgisini gostersin.

Kabul:

- `RAF=850` grafigin olcegini ve aktif raf ortalamasini bozmaz.
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
16. Recete/state modelini ekle.
17. State bazli kanal limitlerini tanimla.
18. Run icin state segmentlerini kaydet ve grafikte goster.
19. State limit ihlallerini `quality_events` olarak uret.

## Basari Kriterleri

Ilk kullanisli surum su senaryoyu tamamlamali:

1. Kullanici browser'dan `LogFile_2026_01_26.csv` dosyasini secer.
2. Uygulama dosyayi upload eder ve import eder.
3. Import raporu 144 satir, 7 time gap ve 0 suspect degeri gosterir.
4. Run gecmis listesine eklenir.
5. Uygulama kapatip acinca run kaybolmaz.
6. Grafik ekraninda tum kanallar incelenebilir.
7. `RAF=850` raf-kapali kodu grafigi bozmaz.
8. Zaman bosluklari fark edilir.
9. Ayni dosya ikinci kez veri cogaltmaz.
10. Vite dev server olmadan `http://127.0.0.1:4777` uzerinden lokal calisir.

## Daha Sonra Dusunulecekler

Bu maddeler simdilik park edilir:

- Tauri installer
- Serial/Modbus gercek cihaz adapteri
- Recete editoru ve state bazli guvenli aralik motoru
- Parquet/DuckDB export
- Python analiz sidecar
- PostgreSQL merkezi sistem
- Kullanici/rol/oturum sistemi
- Otomatik rapor PDF'i
- Cok makine destegi

Bu planin ana fikri: once CSV import + kalici SQLite + iyi grafik. Bu temel
dogru calisirsa canli kablolu baglanti ve masaustu paketleme daha sonra temiz
sekilde eklenir.
