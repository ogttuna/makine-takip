# Frontend Yeniden Tasarim Plani

Bu dokuman mevcut arayuzun mekanik bir freeze dryer operator paneli gibi
hissetmemesi uzerine yapilan tasarim analizini ve uygulanacak UI refactor
siralarini tanimlar. Import/export davranisi bu planin sonunda ele alinacak;
ilk odak ana inceleme ekrani, grafik alani ve operator icin anlamli bilgi
hiyerarsisidir.

## Uygulama Durumu

2026-06-24 ilk geciste Faz 1, Faz 2 ve Faz 3'un temel kararları uygulanmaya
baslandi:

- Summary metrik kartlari kaldirildi.
- Secili kosu icin proses basligi eklendi.
- Ana grafik alanı genisletildi.
- Sag panel sekmeli inspector'a cevrildi ve kendi ic scroll'u kaldirildi.
- Dark mode graphite/steel tabanli palete tasindi.
- Import/export mevcut davranisini koruyor ve `Kaynak` sekmesine alindi.

2026-06-24 ikinci geciste kalan "genel web app" hissini azaltan ek
sadelestirmeler uygulandi:

- Grafik duzeni ve analiz kontrolleri kartlardan cikarilip kompakt toolbar'a
  tasindi.
- Grafik kullanim ipuclari kaldirildi; ekran artik arayuzu metinle
  anlatmaya calismiyor.
- Kanal basligi `Kanal secimi` olarak sadeleştirildi ve gorunurluk sayaci
  kompakt hale getirildi.
- Kalite event kartlari kisaltildi; olay basligi, konum, zaman ve tek teknik
  aciklama kaldi.
- Warning paneli sari blok gibi davranmak yerine role dayali kenar vurgu ve
  sade yuzey kullaniyor.

2026-06-24 ucuncu geciste sagdaki kalici inspector tamamen kaldirildi:

- Ana workspace tek kolon oldu; grafik ekrani artik sag panel tarafindan
  daraltilmiyor.
- `Uyarilar`, `Kosular` ve `Kaynak` bolumleri ust bardaki sandvic tipli
  `Islemler` menusune tasindi.
- Kosu secimi menuden yapildiktan sonra menu kapaniyor ve operator direkt
  grafiğe donuyor.
- Uyari listesi menu icinde kisa tutuluyor; detayli tarama sonraki grafik
  odaklama davranisina birakildi.
- Import/export mevcut davranisini koruyor, fakat ana inceleme yuzeyini artik
  surekli bolmuyor.

2026-06-24 dorduncu geciste header hiyerarsisi netlestirildi:

- Ust marka/baglanti/tema/islem bolgesi tek bir header karti haline getirildi.
- Secili kosu, sure, zaman araligi, veri kalitesi, gorunum ve kaynak bilgileri
  ana grafik kartinin icine tasindi.
- Eski proses bandinin ust/alt kesik cizgi hissi kaldirildi; bilgiler chart
  karti icinde tek bir kompakt context band olarak davranıyor.

2026-06-24 besinci geciste renk dili daha sakin steel palete cekildi:

- Secim ve aktif kanal yuzeylerinde yesil/teal transparan dolgular kaldirildi.
- Accent rengi muted steel-blue olarak degistirildi.
- Grafik slider/zoom rengi teal yerine steel oldu.
- RAF2, VACUM ve SERP4 gibi yesil/teal okunan kanal cizgileri daha notr
  steel/blue tonlara tasindi.
- Yesil yalnizca kucuk baglanti/OK semantigi icin korunuyor; genis yuzey veya
  dekoratif glow olarak kullanilmiyor.

2026-06-24 altinci geciste kontrol organizasyonu standardize edildi:

- Header aksiyonlari ortak yukseklik, radius ve padding sistemine baglandi.
- Collector karti buyuk bagimsiz kart hissinden cikarilip kompakt status
  kontrolu haline getirildi.
- Grafik gorunum secimi ana grafik basliginin sagina tasindi.
- Sadece tek toggle tasiyan genis toolbar satiri kaldirildi.

2026-06-24 yedinci geciste teknik etiket ve kanal kontrol ergonomisi
iyilestirildi:

- `degC` gorunumleri `°C` olarak degistirildi.
- `Vacum` gorunum etiketi `Vakum` olarak duzeltildi.
- Birim uyarisi daha kompakt ve etiketli bir bilgi satirina cevrildi.
- Kanal hizli secimleri `Kanal secimi` basliginin aksiyonlari haline
  getirildi; ayri satir hissi azaltilarak kontrol grubu sikilastirildi.
- Turetilmis kanal etiketi `°C · turetilmis` formatina alindi.

2026-06-24 sekizinci geciste erisilebilirlik ve kod niyeti temizlendi:

- Header aksiyonlarinin DOM sirasi gorsel sira ile eslestirildi; klavye focus
  sirasi artik Tema -> Dil -> Collector -> Islemler seklinde ilerliyor.
- CSS `order` kullanimi kaldirildi.
- Sadece grafik gorunum modunu degistiren component `ChartModeControl` olarak
  yeniden adlandirildi.

2026-06-24 dokuzuncu geciste TR/EN dil destegi eklendi:

- UI metinleri `src/i18n.ts` altinda merkezi copy sozlugune tasindi.
- Ust bara kompakt TR/EN dil kontrolu eklendi; tercih localStorage'da saklaniyor.
- Varsayilan dil Turkce kalacak sekilde ayarlandi, kullanici isterse EN'e
  gecebilir.
- Tarih, sure, kaynak durumu ve kalite uyari metinleri locale'a baglandi.
- Kanal etiketleri grafik, filtreler ve uyari kartlarinda ortak
  `channelLabel` helper'i ile cevriliyor.

2026-06-24 onuncu geciste dark mode cockpit panel hissine yaklastirildi:

- Dark tokenlar siyaha yakin mat grafit yuzeylere cekildi.
- Kart ve kontrol radiuslari koyu modda kucultuldu; panel kenarlari daha keskin
  ve metal/plastik kontrol yuzeyi gibi davranacak sekilde ayarlandi.
- Aktif grafik kontrolleri ve kanal chip'leri amber lamba etkisiyle ayriliyor.
- Collector durumu ve tema anahtari kucuk isikli gosterge hissi verecek sekilde
  yeniden renklendirildi.
- ECharts dark paleti amber pointer, koyu tooltip ve daha sert grid/axis
  kontrastiyle guncellendi.

2026-06-24 on birinci geciste light mode ayni cockpit ailesine yaklastirildi:

- Light tokenlar beyaz dashboard yerine acik mat metal/plastik yuzeylere cekildi.
- Light mode arka planina cok hafif panel dokusu ve daha sert gri zemin verildi.
- Header, chart panel, islem menusu ve kontrol butonlari bevel/inset hissiyle
  yeniden dengelendi.
- Aktif grafik modu ve kanal chip'leri dark mode ile ayni amber gosterge dilini
  kullaniyor.
- ECharts light paleti amber pointer/zoom ve daha endustriyel gri axis/grid
  tonlariyla guncellendi.

2026-06-24 on ikinci geciste grafik kanal renkleri ayristirildi:

- Kanal konfigurasyonuna light/dark icin ayri cizgi rengi destegi eklendi.
- Basinc kanallari kirmizi/turuncu olarak ayrildi.
- Sogutma kanallari mavi/teal/bronze kombinasyonuna tasindi.
- Raf kanallari mavi/yesil/amber/mor ve turetilmis ortalama cizgisiyle daha
  belirgin hale getirildi.

2026-06-24 on ucuncu geciste canli akis ve grafik secim davranisi netlestirildi:

- ECharts legend uzerinden kapatilan kanallar refetch sonrasi otomatik geri
  acilmayacak sekilde component state'ine baglandi.
- Secili kosu `running` durumundaysa sample ve kalite event sorgulari
  periyodik yenileniyor; import edilmis tamamlanmis kosularda gereksiz polling
  yapilmiyor.
- Canli veri kaynagi UI'ye baglanmiyor; collector tarafindaki kaynak bagimsiz
  ingest endpointleri SQLite modelini besliyor.

## Problem Ozeti

Mevcut UI calisiyor, ancak gorsel dili ve bilgi hiyerarsisi bir makine
gostergesinden cok genel bir web dashboard hissi veriyor.

Ana problemler:

- Sag paneldeki kendi ic scroll'u gereksiz ve operasyonel olarak rahatsiz.
  Ana sayfa scroll'u ile panel scroll'u yaristigi icin kalite uyarilari ve run
  listesi dar bir alana sikisiyor.
- Orta ana kart grafik uygulamasi icin dar kaliyor. Grafik bu urunun ana
  calisma yuzeyi; kart icine alinmis bir widget gibi degil, ekranin baskin
  bolgesi gibi davranmali.
- Ustteki dort metrik karti operator icin karar uretmiyor. `Calismalar`,
  `Ornekler`, `Sinyaller`, `Uyarilar` sayilari teknik olarak dogru ama makine
  muhendisinin "ne yapmaliyim?" sorusuna cevap vermiyor.
- UI cok kartli. Her bolge kutuya alininca ekran kontrol panelinden cok SaaS
  dashboard kart mozaiğine benziyor.
- Dark mode paleti zayif. Yesil/teal agirlikli koyu tema mekanik/industrial
  hissi vermiyor, warning bolgeleri de fazla sicak sari bloklar halinde
  gorunuyor.

## Tasarim Tezi

Arayuz, "lokal freeze dryer proses inceleme konsolu" gibi hissetmeli:

- Geniş grafik alani birincil calisma yuzeyi olur.
- Yan bilgi sade bir inspector gibi davranir, ayri bir uygulama bolgesi gibi
  kendi icinde scroll yapmaz.
- Renkler industrial ve islevsel olur: grafit/steel yuzeyler, muted steel-blue
  secim/odak rengi, amber yalnizca uyarilar, kirmizi yalnizca hata/alarm.
- Sayilar dekoratif KPI degil, proses yorumlamaya yardim eden sinyaller olur.

## Hedef Kullanici Bakisi

Bu ekrana bakan kisi muhtemelen makine muhendisi, operator veya proses
sorumlusu. Ilk bakista sunlari anlamali:

- Hangi kosu inceleniyor?
- Zaman araligi ve toplam sure nedir?
- Grafikte hangi proses grubu acik?
- Veri guvenilir mi, nerelerde bosluk veya supheli deger var?
- Raf, basinc, vakum ve sogutma sinyalleri hizlica ayristirilabiliyor mu?

`144 ornek`, `11 sinyal`, `1 calisma` gibi sayilar bu sorulara ancak dolayli
cevap veriyor. Bu yuzden ana metrik strip'i kaldirilacak veya proses odakli
ozetlere donusturulecek.

## Yeni Bilgi Hiyerarsisi

### 1. Kompakt Ust Bar

Ust bar marka ve baglanti bilgisi icin kalir, fakat daha az yer kaplar.

Icerik:

- `FreezeDryMachine`
- Collector durumu
- Secili kosu adi veya "Kosu secilmedi"
- Tema ve yenile aksiyonu

Ust bar hero gibi davranmayacak; operator ekraninda ana alan grafik olmalidir.

### 2. Proses Basligi

Mevcut dort istatistik karti yerine grafik alaninin ustunde kompakt bir proses
basligi olacak.

Onerilen alanlar:

- Kosu: dosya/kosu adi
- Sure: toplam sure
- Aralik: baslangic - bitis
- Veri kalitesi: `7 zaman boslugu`, `4 supheli RAF3`
- Kaynak: CSV import / ileride live / replay

Bu bilgi kart mozaiği olarak degil, tek satirlik veya iki satirlik sakin bir
status band olarak tasarlanacak.

### 3. Ana Grafik Yuzeyi

Grafik ekranin ana yuzeyi olacak.

Degisiklikler:

- `chart-panel` genisletilecek; mevcut 340px sag panel yuzunden dar kalan ana
  alan ferahlatilacak.
- Genel `max-width: 1440px` karari yeniden degerlendirilecek. Buyuk ekranda
  grafik daha fazla yatay alan kullanmali.
- Grafik kart gibi degil, workstation canvas gibi davranacak.
- Kanal kontrolleri grafigin ustunde veya sol/ust toolbar olarak konumlanacak.
- Raflar, basinc, vakum, sogutma secimleri daha hizli taranan segmentler
  haline getirilecek.
- Chart hint metinleri azaltilacak; arayuz kullanimi metinle anlatmaya
  calismayacak.

### 4. Inspector / Yan Bilgi

Sag panel import, run listesi ve kalite eventlerini ayni anda tasidigi icin
sismesine ve kendi ic scroll'una neden oluyor.

Yeni davranis:

- Sag panel kendi icinde scroll etmeyecek.
- Run listesi ve veri kalitesi ayni panelde tabs/segment ile ayrilabilir:
  `Kosular`, `Uyarilar`, `Kaynak`.
- Uyari detaylari ilk ekranda uzun liste olarak degil, ozet + secili event
  detayi olarak verilecek.
- Import paneli birincil is degilse collapse edilecek veya "Yeni CSV" aksiyonu
  olarak daha kompakt tutulacak.

### 5. Veri Kalitesi Sunumu

Mevcut `Veri kontrolu` bolgesi cok buyuk ve sari blok olarak ayriliyor. Bu,
uyariyi okutturuyor ama ana grafikten alan caliyor.

Yeni davranis:

- Veri kalitesi grafik uzerinde veya hemen ustunde compact band olarak
  gorunecek.
- `time_gap` ve `suspect_value` olaylari filtre olarak kalacak.
- Event listesi gerekiyorsa inspector icinde secili filtreye gore kisaltilacak.
- Grafik uzerindeki marker ve cizgi kopmalari asıl kanit olacak; sag panel bu
  kanitin metinsel aciklamasi olacak.

## Metriklerin Yeniden Tanimlanmasi

Mevcut metrikler:

- Calismalar
- Ornekler
- Sinyaller
- Uyarilar

Bu metrikler yerine proses yorumu icin daha anlamli alanlar kullanilacak.

Onerilen alanlar:

- `Kosu suresi`: prosesin toplam suresi.
- `Baslangic / bitis`: zaman penceresi.
- `Ornekleme`: medyan veya beklenen ornekleme araligi. Su an backend bu degeri
  response'ta donmuyor; eklenmesi dusunulebilir.
- `Veri boslugu`: en uzun bosluk ve bosluk sayisi.
- `Supheli sensor`: kanal bazli supheli deger sayisi, ornegin `RAF3: 4`.
- `Aktif gorunum`: Raflar / Basinc / Vakum / Sogutma.

Not: Backend'de olmayan metrikler ilk UI gecisinde zorunlu degil. Once mevcut
`quality_events`, `started_at`, `finished_at`, `row_count` verilerinden daha
anlamli etiketler uretilebilir.

## Dark Mode Paleti

Mevcut dark mode yesil-teal agirlikli ve biraz "terminal/app theme" hissi
veriyor. Freeze dryer operator paneli icin daha industrial bir palet hedeflenir.

Onerilen token yonu:

```text
surface-0: #0b0d10   ana arka plan
surface-1: #12161b   bolge yuzeyi
surface-2: #1b2229   kontrol yuzeyi
border:    #2b3540
text-1:    #e6edf3
text-2:    #9aa8b4
accent:    #8a9aad   secim / aktif kanal
ok:        #4fbe7a   baglanti iyi
warning:   #d99a2b   veri uyarisi
alarm:     #d65b5b   hata / alarm
```

Kurallar:

- Amber sadece warning icin kullanilacak, tum kalite panelinin ana zemini
  olmayacak.
- Steel-blue secim, focus ve grafik kontrol vurgusu icin kullanilacak.
- Dark yuzeylerde gradient kullanimi azaltilacak.
- Grafik cizgi renkleri dark ve light modda ayri kontrast testinden gececek.

## Layout Planı

### Desktop

Onerilen iskelet:

```text
top status bar
process header / run context
main workspace
  primary chart canvas  |  inspector tabs
  channel toolbar       |  selected event / run list
```

Kararlar:

- Ana chart alani en az ekranin %70 yatay alanini kullanmali.
- Inspector 280-320px araliginda kalabilir, ama ic scroll yerine sayfa akisi
  veya tabbed icerik kullanilmali.
- Summary kartlari kaldirilacak.
- `workspace` kart gibi degil, page-level layout gibi kurulacak.

### Mobile / Dar Ekran

Bu uygulamanin ana hedefi masaustu operator bilgisayari. Yine de dar ekranda:

- Grafik ustte kalir.
- Inspector bolumleri grafik altina stack olur.
- Kanal kontrolleri yatay scroll yerine wrap veya compact menu olur.

## Uygulama Sirasi

### Faz 1: Layout ve Hiyerarsi

- Summary grid'i kaldir veya proses header'a donustur.
- `chart-panel` kart etkisini azalt, ana workspace'i genislet.
- Sag panelin `max-height` ve `overflow: auto` davranisini kaldir.
- Import/run/quality bolumlerini inspector mantigiyla yeniden sirala.
- Grafik yuksekligini daha net ve buyuk yap.

Kabul:

- Ilk bakista grafik ekranin ana elemani olur.
- Sayfada tek bir scroll davranisi olur.
- Sag panel kendi icinde bagimsiz scrollbar gostermemeli.

### Faz 2: Operator Odakli Bilgi

- Mevcut metrik kartlarini kaldir.
- Secili run icin sure, zaman araligi ve veri kalitesi ozetini compact band
  olarak goster.
- `time_gap` ve `suspect_value` sayilarini daha teknik etiketlerle sun.
- Kanal grubu secimlerini daha hizli taranan kontrol setine cevir.

Kabul:

- Ust kisimda "1 calisma / 144 ornek / 11 sinyal" kartlari gorunmez.
- Operator hangi kosuyu ve hangi kalite sorunlarini inceledigini hizlica
  anlar.

### Faz 3: Dark Mode Yenileme

- CSS renk tokenlarini ayir.
- Dark mode'u graphite/steel tabanli palete tasir.
- Warning, alarm, selection ve connection renklerini rol bazli ayir.
- ECharts palette'ini yeni dark tokenlarla uyumlu hale getir.

Kabul:

- Dark mode yesil/teal yuzeylerden kurtulur.
- Warning panelleri sari blok gibi degil, kontrollu vurgu gibi gorunur.
- Grafik ve metin kontrasti korunur.

### Faz 4: Grafik Deneyimi

- Grafik toolbar'ini sadeleştir.
- Raflar, basinc, vakum, sogutma icin daha belirgin gorunum modlari ekle.
- Uyari markerlari ve zaman boslugu gosterimini ana grafikle daha iyi
  iliskilendir.
- Gerekirse kalite eventine tiklayinca grafikte ilgili zamana odaklanma
  sonraki adim olarak planlanir.

Kabul:

- Grafik, operatorun asil calisma yuzeyi gibi hissedilir.
- Uyari listesi grafikle baglantili olur.

### Faz 5: Import / Export

Bu faz sona birakilacak.

- Import paneli daha az yer kaplayacak sekilde yeniden ele alinir.
- Export aksiyonu run/context actions altinda daha sakin konumlanir.
- Import preview veya onay akisina daha sonra karar verilir.

## Dikkat Edilecekler

- Mevcut backend/API davranisi degistirilmeden UI yenilenebilir.
- Refactor sonrasi her fazda `npm run build` calismali.
- Mevcut Tauri/collector build sagligi korunmali.
- Ilk gorsel geciste yeni feature eklemek yerine hiyerarsi ve layout
  duzeltilmeli.

## Basari Kriteri

Yeni UI icin basari kriteri:

- Ekran ilk bakista mekanik proses inceleme konsolu gibi hisseder.
- Grafik en baskin alan olur.
- Gereksiz dashboard metrikleri yoktur.
- Sagda ic scrollbar yoktur.
- Dark mode industrial, okunur ve rol bazli renklere sahiptir.
- Import/export ana deneyimi bolmez ve sonraki faza kadar mevcut calisir.
