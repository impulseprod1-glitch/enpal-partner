# Lead Defteri · bulut senkronu kurulumu

Senkron uçtan uca şifrelidir. Kayıtlar cihazda AES-256-GCM ile şifrelenir ve
anahtar yalnızca senkron kodundan türetilir. Sunucu sadece HMAC ile türetilmiş
kimlikleri ve okunamayan şifreli metni saklar. Müşteri adı, telefon, adres ve
not gibi hiçbir bilgi sunucuda açık metin olarak bulunmaz.

## Bir kerelik kurulum

1. Supabase'te yeni bir proje aç. Bölge olarak **Frankfurt (eu-central-1)** seç.
2. Projede **SQL Editor** bölümünü aç. `lead-defteri.sql` dosyasının tamamını yapıştırıp **Run** de.
3. **Project Settings → API** bölümünden iki değeri al: proje adresi (`https://….supabase.co`) ve
   **publishable key** (`sb_publishable_…`). Bu anahtar herkese açık olabilir; tek
   başına hiçbir veriye erişim vermez.
4. Uygulamada **Ayarlar → Bulut senkronu → Sunucu ayarları** bölümüne bu iki değeri gir.
   Değerler `enpal-lead-defteri.html` içindeki `SYNC_CFG`'ye yazılırsa bu adım tüm cihazlarda kendiliğinden atlanır.

## Cihazları eşleştirme

- **İlk cihaz (bilgisayar):** Ayarlar → Bulut senkronu → **Bu cihazda senkronu başlat**.
  20 karakterlik kodu güvenli bir yere yaz.
- **Diğer cihaz (telefon):** Ayarlar → Bulut senkronu → kodu gir → **Koda bağlan**.

Kodu e-posta veya mesajla gönderme; telefona elle yaz. Kod kaybolursa buluttaki
kopya açılamaz, ancak cihazlardaki veriler durur.

## Silme

**Buluttan tamamen sil** düğmesi o koda ait tüm şifreli kayıtları sunucudan siler.
Supabase projesini silmek de bütün veriyi kaldırır.
