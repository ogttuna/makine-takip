# FreezeDryMachine Baslangic Plani

Bu dosya ilk taslagin temizlenmis halidir. Ayrintili task listesi icin
`docs/implementation-plan.md` ana kaynak kabul edilir.

## Ana Karar

Ilk hedef masaustu uygulamasi degil, lokal calisabilen web uygulamasidir.

```text
React + TypeScript + Vite
          |
          | HTTP
          v
Rust + Axum collector/API
          |
          v
SQLite
```

Tauri 2 repo icinde kalabilir, ama MVP'nin ana yolu degildir. Ileride tek tikla
acilan masaustu paket gerekirse ayni web arayuzu Tauri kabuguna alinabilir.

Bu karar su nedenlerle daha sade:

- Browser uzerinden dosya secmek ve grafik gostermek hizli ilerletir.
- Lokal Axum API internet olmadan calisabilir.
- SQLite tek makine ve tek operator icin yeterlidir.
- Tauri, Modbus, Python, Parquet ve PostgreSQL kararlarini erken kilitlemez.

## Ornek CSV'den Cikanlar

Dosya: `LogFile_2026_01_26.csv`

- 144 veri satiri var.
- 10 olcum kanali var.
- Toplam 1.440 olcum degeri var.
- Zaman araligi: `2026-01-26-11:08:17.626` ile
  `2026-01-26-18:51:16.967`.
- Yaklasik sure: 7 saat 43 dakika.
- Medyan ornekleme araligi: 180 saniye.
- En uzun zaman boslugu: 967 saniye.
- 240 saniyeden buyuk 7 zaman boslugu var.
- `RAF3` kanalinda 4 adet `850.0` degeri var.
- `VACUM` bilimsel gosterim ve buyuk seviye degisimi iceriyor.
- `SERP2` ve `SERP4` bu dosyada birebir ayni.
- Zaman kolonunda saat dilimi bilgisi yok.

Beklenen kolonlar:

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

Bu veri hacmi kucuk. Ilk surumde time-series database, microservice, queue,
cloud veya ayri analitik motor gerekmez.

## MVP

Ilk kullanisli surum su akisi tamamlamali:

1. Kullanici browser'dan CSV dosyasi secer.
2. Frontend dosyayi lokal Axum API'ye upload eder.
3. Backend dosyayi parse eder ve dogrular.
4. Veriler SQLite'a yazilir.
5. Gecmis kosular listelenir.
6. Secili kosunun grafikleri acilir.
7. Kanal ac/kapat, zoom ve tooltip calisir.
8. `RAF3=850` grafigi bozmaz, supheli deger olarak gosterilir.
9. Zaman bosluklari grafikte fark edilir.
10. Ayni dosya tekrar import edilirse veri ciftlenmez.
11. Vite dev server olmadan collector `dist/` UI dosyalarini serve eder.

## Veri Modeli

Ilk taslaktaki tamamen normalize `sample_frames` + `measurements` modeli su an
gereksiz karmasik. Mevcut makine CSV kolonlari belli oldugu icin baslangicta
genis `samples` tablosu kullanilacak.

### `runs`

Bir CSV importu veya gelecekte canli kayit oturumu.

```text
id
name
source_kind
source_name
started_at
finished_at
status
notes
created_at
```

### `import_files`

Dosya tekrar importunu engellemek ve izlenebilirlik icin.

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

CSV satirinin genis tablo hali.

```text
id
run_id
sampled_at
source_timestamp_text
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

Zaman boslugu, supheli deger ve parse uyarilari.

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

## Veri Kalitesi

Ham veri silinmez. Supheli veri saklanir, ama grafik davranisi ayrilir.

Baslangic kurallari:

- Header beklenen kolonlarla eslesmeli.
- `TARIH SAAT` parse edilebilmeli.
- Sayilar bilimsel gosterim dahil parse edilebilmeli.
- 240 saniyeden buyuk araliklar `time_gap` event'i uretmeli.
- `RAF3=850.0` `suspect` event'i uretmeli.
- Zaman alaninda saat dilimi olmadigi icin kaynak timestamp metni saklanmali.

Grafikte:

- Supheli `RAF3=850` ana cizgiye dahil edilmez.
- Supheli ham deger warning marker veya tooltip olarak gorunur.
- Zaman bosluklarinda cizgi kesilir veya bosluk isareti gosterilir.

## Ekranlar

### Import

- CSV secme
- Upload/import loading state
- Import raporu
- Hata ve uyarilar
- Duplicate dosya bilgisi

### Gecmis Kosular

- Run listesi
- Dosya adi
- Baslangic/bitis
- Satir sayisi
- Uyari sayisi

### Kosu Detayi

Grafik gruplari:

- Raflar: `RAF1`, `RAF2`, `RAF3`, `RAF4`
- Basinclar: `L_PRES`, `H_PRES`
- Vakum: `VACUM`
- Sogutma: `SERP2`, `SERP4`, `KONDANSER`

Kontroller:

- Kanal ac/kapat
- Zoom/kaydirma
- Tooltip
- Supheli degerleri goster/gizle
- CSV export

## Implementasyon Sirasi

1. SQLite migration'i gercek CSV semasina uydur.
2. CSV parser modulu yaz.
3. Ornek CSV icin parser testleri ekle.
4. Import API endpoint'ini yaz.
5. Duplicate import korumasi ekle.
6. Runs, samples ve quality endpointlerini tamamla.
7. Frontend Zod semalarini backend response'larina uydur.
8. Import panelini yap.
9. Gecmis kosular ve run secimini yap.
10. Grafik kanal gruplarini kur.
11. Supheli deger ve zaman boslugu gosterimini ekle.
12. CSV export ekle.
13. Axum production modda built frontend'i serve etsin.
14. README calistirma komutlarini guncelle.

## Simdilik Yapilmayacaklar

Bu maddeler faydali olabilir ama MVP icin erken:

- PostgreSQL
- TimescaleDB veya InfluxDB
- Parquet/DuckDB
- Python sidecar
- Cloud senkronizasyon
- Kullanici/rol/oturum sistemi
- Docker zorunlulugu
- Mikroservis mimarisi
- Tauri installer
- Gercek seri port veya Modbus adapteri
- Makine ogrenmesi tabanli anomali tespiti

## Sonraki Fazlar

### Replay

Import edilen CSV canli veri gibi oynatilir. Bu, gercek makine baglantisi
olmadan canli grafik akisini test etmeyi saglar.

### CSV Tail

Makine surekli ayni CSV dosyasina satir ekliyorsa yeni satirlar okunur, son
okunan byte konumu saklanir ve yarim satirlar bekletilir.

### Kablolu Baglanti

Makine protokolu kesinlesince adapter eklenir:

- Seri port: `tokio-serial`
- Modbus RTU/TCP: `tokio-modbus`
- Ureticiye ozel TCP: ayri adapter

Bu adapterlerin hepsi ayni veritabanina ve ayni grafik API'sine veri yazar.

## Basari Olcutu

Ilk surum, `LogFile_2026_01_26.csv` dosyasini import edip kalici olarak
saklayabiliyorsa, grafikte tum kanallari inceletebiliyorsa, `RAF3=850`
degerlerini grafigi bozmadan gosteriyorsa ve internet olmadan lokal calisiyorsa
dogru yoldadir.
