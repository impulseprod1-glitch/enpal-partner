# enpal-partner

## Lead Defteri (`enpal-lead-defteri.html`)

Günlük leadler, aramalar, notlar ve takipler için masaüstü ve mobil uyumlu araç.
Veriler cihazda tutulur. İsteğe bağlı olarak cihazlar arasında **uçtan uca şifreli**
senkron yapılabilir.

### Yayın (Netlify)

`netlify.toml` yalnızca uygulamayı (`index.html` olarak), `fonts/` klasörünü ve
`netlify/functions/sync.mts` senkron fonksiyonunu yayınlar. Repodaki diğer sayfalar
yayınlanmaz.

- Site: `lead-defteri` (Netlify, ücretsiz plan)
- Derleme komutu ve yayın klasörü `netlify.toml` içinde tanımlı. Fonksiyonun bağımlılığı `@netlify/blobs` (`package.json`).

### Senkron nasıl çalışır

- Her kayıt cihazda AES-256-GCM ile şifrelenir. Anahtar, 20 karakterlik senkron kodundan
  PBKDF2 ile türetilir ve cihazlardan hiç çıkmaz.
- Sunucu (`/api/sync/push|pull|wipe`) yalnızca HMAC ile türetilmiş kimlikleri ve şifreli
  metni görür. Bunları Netlify Blobs'ta, her senkron alanı için tek bir belgede saklar.
- Yazmalar ETag ile koşullu yapılır (`onlyIfMatch` / `onlyIfNew`). Böylece aynı anda
  gönderilen değişiklikler birbirinin üzerine yazmaz. Kayıt bazında son yazan kazanır.
- **Buluttan tamamen sil** o alanın belgesini siler. Diğer cihazlar bunu bir sonraki
  senkronda fark eder ve senkronu kapatır; kendi verileri cihazda kalır.

### Cihazları eşleştirme

1. İlk cihazda: **Ayarlar → Bulut senkronu → Bu cihazda senkronu başlat**. Kodu güvenli bir yere yaz.
2. Diğer cihazda: aynı web adresini aç → **Ayarlar → Bulut senkronu** → kodu gir → **Koda bağlan**.

Kodu e-posta veya mesajla gönderme.
