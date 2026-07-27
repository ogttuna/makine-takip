# FD-750 Analiz Kurallari

## Kapsam

Kaynak calisma kitabi:
`260725_FD750_Tum_Loglar_Loop_Analizli.xlsx`

Bu dosya canli veya gecmis ham log kaynagi degildir. Icindeki cok sayfali loop
analizi, ham telemetry uzerinde tekrar calistirilacak kural profilini
guclendirmek icin kullanilmistir.

Calisma kitabinda 6 sayfa, 13.593 analiz satiri, 45 kaynak dosya ve 26 loop
incelendi. Sure ve state kolonlari tarihsel analiz ciktilaridir; sistem
bunlari dogrudan kopyalamaz, sensor kosullarindan yeniden uretir.

## Profil

- Kod: `fd750_loop`
- Surum: `1.0.0`
- Makine: `FD-750`
- Konfigurasyon kaynagi: `analysis_profiles.config_json`

Profil versiyonludur. Esik veya gecis mantigi degistiginde mevcut surum
yerinde degistirilmemeli; yeni bir profil surumu eklenmelidir.

## Kanal Anlami

- `RAF1..RAF4`: raf sicaklik hedefleri
- `S1..S4`: serpantin/sensor sicakliklari
- `VACUM`: vakum degeri
- `E.GUC`: anlik guc
- `E.TUKETIM`: makinenin bildirdigi tuketim
- `TARTIM`: tartim degeri
- `RECETE NO`, `RECETE ADIM`: varsa ham makine state gozlemi

Eski adlar import sirasinda normalize edilir:

- `S 1`/`SERP1` -> `S1`
- `S 2`/`SERP2` -> `S2`
- `S 3`/`SERP3` -> `S3`
- `S 4`/`SERP4` -> `S4`
- `VACUUM` -> `VACUM`

## State Zinciri

### Raf kapali

Bir RAF degeri `850 +/- 0.5` ise o raf kapali kabul edilir. Bu deger
`suspect_value` degildir ve aktif raf ortalamasina katilmaz.

### START ve DRY

- En az bir raf aktif ve `VACUM < 2` ise START.
- Kosul surerse bir sonraki state DRY.

### STOP ve WAIT

- Aktif raf sayisi sifirsa veya DRY sirasinda `VACUM > 4` ise STOP.
- Defrost kosulu henuz olusmadiysa WAIT.

### DEFROST ve DEFROST_STOP

- STOP/WAIT sonrasinda gecerli `S1..S4` degerlerinin en sicagi `>= 0 C` ise
  DEFROST.
- DEFROST sirasinda `E.GUC < 5` ise DEFROST_STOP.

### Yeni loop

DEFROST/DEFROST_STOP veya bekleme sonrasinda START kosulunun tekrar olusmasi
yeni loop baslatir.

### State reset

Ardisik kayitlar arasinda 180 dakikadan fazla bosluk varsa mevcut state zinciri
resetlenir, aktif loop `interrupted` olur ve
`fd750_state_chain_reset` olayi yazilir.

Bu kural, 240 saniyeden buyuk araligi isaretleyen `time_gap` veri-kalitesi
kuralindan bagimsizdir.

## S4-Vakum Paralel Tanilari

Karsilastirma hedefi 30 dakikadir; uygun onceki nokta icin `+/- 10 dakika`
tolerans kullanilir.

- Toparlanma: mutlak S4-S2 sapmasi en az `3 C` iyilesirken vakum en az `0.2`
  azalir. Olay: `fd750_s4_vacuum_recovery`.
- Birlikte yukselis: S4-S2 sapmasi en az `3 C` artarken vakum en az `0.2`
  artar. Olay: `fd750_s4_vacuum_rise`.

Bu olaylar proses state'i degil, tani sinyalidir.

## Turetilmis Degerler

- `ACTIVE_SHELF_COUNT`
- `HOTTEST_COIL_C`
- `S4_S2_DEVIATION_C`
- `INTERVAL_ENERGY_KWH`
- `CUMULATIVE_ENERGY_KWH`
- `WEIGHT_DELTA_KG`
- `WEIGHT_LOSS_KG`

Enerji trapez yontemiyle yalnizca ardisik iki kayitta da gecerli guc degeri
varsa hesaplanir; eksik guc kaydinin uzerinden atlanmaz ve 15 dakikadan uzun
veri bosluklari entegre edilmez. Tartim farklari `unvalidated_raw_delta`
olarak etiketlenir; kalibrasyon dogrulanmadan proses verimi olarak
kullanilmamalidir.

## Guven ve Sinirlar

Excelde yalnizca 26 loop'un 21'i icin kurutma suresi ve 3'u icin defrost
bitisi bulunabildi. Bu nedenle tarihsel ciktilar kesin etiket degil,
heuristic referanstir.

State segmentleri ve donguler:

- profil ve surumle birlikte saklanir,
- ham olcumleri degistirmez,
- yeniden analizde deterministik olarak silinip ayni profil icin yeniden
  uretilir,
- eksik kanal veya buyuk bosluklarda dusuk guven/incomplete/interrupted olarak
  isaretlenir.

## API ve Arayuz

```text
GET  /api/runs/:id/analysis
POST /api/runs/:id/analysis
```

GET kayitli dongu, state segmenti ve tani olaylarini dondurur. POST ham run'i
aktif profil ile yeniden analiz eder.

Arayuzde **Analiz** sekmesi profil surumunu, aktif state/loop'u, dongu
durumlarini ve tani sayilarini gosterir. Grafik state segmentlerini arka plan
bantlariyla gosterir.
