# E-Ticaret Platformu Karşılaştırma — Türkiye & Dünya

26 e-ticaret altyapısının yan yana karşılaştırması: **Hemenmağaza, ikas, Ticimax, ideaSoft, T-Soft, Shopiverse, PlatinMarket, Faprika, ETrend, Sentrop, EticaretGold + Shopify, BigCommerce, Wix eCommerce, Squarespace, Webflow, Ecwid, Square Online, Big Cartel, Shoplazza, WooCommerce, Magento, PrestaShop, OpenCart, Salesforce Commerce Cloud, commercetools**.

## 🔗 Canlı

Sayfa GitHub Pages üzerinde yayında: `https://baranbaranpolat-dotcom.github.io/eticaretplatformum/`

## 🛠 Nasıl çalışıyor

Tek dosya HTML (`index.html`) — kurulum/build adımı yok, tarayıcıda direkt açılır.

### Otomatik güncellemeler

İki GitHub Actions workflow'u sürekli güncel tutuyor:

| Workflow | Sıklık | İşlevi |
|---|---|---|
| `daily-update.yml` | Her gün 00:00 TR (21:00 UTC) | "Son güncelleme" tarihini yenileyip commit eder |
| `weekly-ai-refresh.yml` | Her Pazartesi 01:00 TR (22:00 UTC) | Anthropic API (Haiku) ile 11 platformun resmi sitelerinden güncel fiyat/özellik bilgisini çekip günceller |
| `pages-deploy.yml` | `index.html` push'unda | GitHub Pages'e otomatik deploy eder |

### Manuel tetikleme

Repo → **Actions** sekmesi → ilgili workflow → **Run workflow**

## 🔑 Gereken secret

GitHub repo ayarlarında **Settings → Secrets and variables → Actions**:

- `ANTHROPIC_API_KEY` — `console.anthropic.com`'dan alınan API key.

## 📁 Proje yapısı

```
.
├── index.html                       # Karşılaştırma sayfası (tek dosya)
├── package.json                     # Node bağımlılıkları (AI refresh için)
├── scripts/
│   ├── daily-update.js              # Günlük tarih banner'ı yenileme
│   └── ai-refresh.js                # Haftalık AI veri yenileme
└── .github/workflows/
    ├── daily-update.yml
    ├── weekly-ai-refresh.yml
    └── pages-deploy.yml
```

## 🧮 Yerel test

```bash
# Bağımlılıkları kur
npm install

# Sadece tarih güncelleme
npm run daily

# AI ile tam veri yenileme (ANTHROPIC_API_KEY env var gerekir)
ANTHROPIC_API_KEY=sk-ant-... npm run refresh

# HTML'i tarayıcıda aç (Windows)
start index.html
```

## 📜 Lisans

MIT. Veriler kamuya açık kaynaklardan derlenmiştir; fiyatlar zamanla değişebilir — karar vermeden önce ilgili platformun resmi sitesini kontrol edin.
