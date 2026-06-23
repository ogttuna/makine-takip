# Teknik Stack Tanimi

Bu dokuman FreezeDryMachine projesinde kullanilacak ana teknolojileri ve her
katmanin sorumlulugunu tanimlar.

## Uygulama Modeli

Proje, web-oncelikli yerel operator arayuzu ve arka planda calisan veri toplama
katmani seklinde tasarlanir.

- Web arayuzu operator ekranlarini, grafikleri ve kayit yonetimini sunar.
- Collector katmani makineyle haberlesir, gelen veriyi dogrular ve depolamaya
  yazar.
- SQLite yerel ve guvenilir ana veri kaynagi olur.
- Ileride analitik ihtiyaclar buyurse Parquet/DuckDB okunabilir analiz katmani
  olarak eklenir.
- Ileride tek tikla acilan masaustu paket gerekirse ayni web arayuzu Tauri
  kabuguna alinabilir.

## Frontend

### React + TypeScript + Vite

Operator arayuzu React ile gelistirilir. TypeScript, sensor olcumleri, kosu
durumlari, recete verileri ve API yanitlari icin tip guvenligi saglar. Vite,
hizli gelistirme sunucusu ve sade build sureci icin kullanilir.

Beklenen ekranlar:

- Canli proses izleme
- Gecmis kosu listesi
- Kosu detayi ve grafikler
- Recete ve cihaz ayarlari
- Veri disa aktarma ekranlari

### Apache ECharts

Zaman serisi grafiklerinde kullanilir.

Tipik grafikler:

- Raf sicakligi
- Urun sicakligi
- Kondenser sicakligi
- Vakum / basinc
- Faz gecisleri ve proses olaylari

ECharts secimi, uzun zaman serilerinde performansli cizim ve cok eksenli
grafik ihtiyaci nedeniyle uygundur.

### TanStack Query

Frontend ile collector/API katmani arasindaki veri cekme, cache, refetch ve
loading/error durumlari icin kullanilir.

Kullanim alanlari:

- Canli telemetri snapshot'lari
- Kosu listesi
- Kosu detaylari
- Grafik veri sorgulari
- Ayar ve recete kayitlari

### Zod

Runtime veri dogrulama icin kullanilir. Ozellikle makineden, dosyadan veya API
katmanindan gelen veriler UI'a girmeden once Zod semalari ile dogrulanir.

Kullanim alanlari:

- API yanitlari
- Recete formlari
- Ayar dosyalari
- Import edilen veri

## Desktop

### Tauri 2

Tauri 2 ilk MVP'nin ana kosulu degildir. Web arayuzu once lokal browser
uygulamasi olarak gelistirilir. Ileride tek tikla acilan masaustu paket
gerektiginde ayni React arayuzu Tauri ile paketlenebilir.

Tauri'nin bu proje icin gorevleri:

- Uygulamayi Windows/Linux masaustu uygulamasi olarak paketlemek
- Yerel servis/collector ile guvenli haberlesmek
- Yerel dosya secimi ve export islemlerini yonetmek
- Gerekirse collector prosesini baslatmak ve izlemek

## Collector

### Rust + Tokio

Collector katmani Rust ile yazilir. Tokio, seri port ve Modbus gibi I/O agirlikli
islerde async calisma modeli saglar.

Collector sorumluluklari:

- Makineden periyodik veri okumak
- Baglanti kopmasi ve yeniden baglanma senaryolarini yonetmek
- Ham veriyi domain modeline cevirmek
- Veriyi SQLite'a yazmak
- Frontend'e canli durum ve gecmis veri API'lari sunmak

### Axum

Yerel HTTP API icin kullanilir. Frontend, Tauri icinden bu API ile konusur.

Olasi endpoint gruplari:

- `/api/health`
- `/api/live`
- `/api/runs`
- `/api/runs/:id/samples`
- `/api/recipes`
- `/api/settings`

### tokio-modbus / tokio-serial

Makine haberlesmesi icin kullanilir.

- `tokio-serial`: Seri port uzerinden haberlesme.
- `tokio-modbus`: Modbus RTU/TCP protokolu ile register okuma/yazma.

Haberlesme katmani cihaz markasi ve register haritasi degisebilecegi icin
collector icinde ayri bir adapter olarak tutulmalidir.

### Serde

Rust tarafinda JSON, ayar dosyalari ve veri modelleri icin kullanilir.

## Storage

### SQLite + SQLx

Ilk surumde ana veri tabani SQLite olur. SQLx ile compile-time SQL kontrolu,
async sorgular ve migration yonetimi kullanilir.

Temel tablolar:

- `runs`: Her freeze dry kosusu
- `samples`: Zaman serisi sensor olcumleri
- `events`: Alarm, faz gecisi, operator notu gibi olaylar
- `recipes`: Recete tanimlari
- `settings`: Uygulama ve cihaz ayarlari

### WAL

SQLite Write-Ahead Logging modu acilir. Bu, collector veri yazarken UI tarafinin
okuma yapabilmesini kolaylastirir.

### STRICT tablolar

SQLite STRICT tablolar kullanilir. Sensor verisi gibi uzun omurlu kayitlarda
tip hatalarini erken yakalamak icin tercih edilir.

## Ileride

### Parquet + DuckDB

Analiz, raporlama veya buyuk veri seti isleme ihtiyaci artarsa, tamamlanan
kosular Parquet formatina aktarilabilir. DuckDB bu dosyalar uzerinde hizli
analitik sorgular icin kullanilabilir.

Bu katman ilk surum icin ana veri tabani degildir; analiz ve export katmanidir.

### Python Sidecar

Ileri analiz, raporlama, modelleme veya optimizasyon ihtiyaci dogarsa Python
sidecar eklenebilir.

Olasi kullanimlar:

- Kurutma egrisi analizi
- Anomali tespiti
- Rapor uretimi
- Deneysel modelleme

Python sidecar ilk surumun kritik parcasi olmamalidir.

### PostgreSQL

PostgreSQL yalnizca merkezi veya cok kullanicili sisteme gecilirse eklenmelidir.
Tek makine ve yerel operator senaryosunda SQLite daha sade ve yeterlidir.

PostgreSQL'e gecis nedenleri:

- Birden fazla operator veya istasyon
- Merkezi veri toplama
- Uzaktan izleme
- Rol bazli yetkilendirme
- Kurumsal yedekleme ve raporlama ihtiyaci

## Ilk Surum Icin Onerilen Kapsam

Ilk surumda odak su parcalarda kalmalidir:

- Collector ile makineden veri okuma
- SQLite'a guvenilir zaman serisi kaydi
- Canli proses ekrani
- Gecmis kosu detayi
- Temel grafikler
- CSV veya Parquet export icin hazir veri modeli

Bu kapsam, merkezi sistem veya ileri analiz ihtiyaci dogmadan once cekirdek
veri toplama ve izleme akisini dogrulamaya yeterlidir.
