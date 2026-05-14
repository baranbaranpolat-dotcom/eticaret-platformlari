#!/usr/bin/env node
/**
 * ai-refresh.js — Nightly AI-powered data refresh.
 *
 * For each of 22 platforms, fetches the live homepage, sends it to Claude Haiku
 * to extract pricing/trial/customer count, and conservatively updates index.html.
 * Also bumps the "last updated" banner to today's date.
 *
 * Designed to be safe: refuses to write multi-line or special-char values that
 * could break the JS structure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const HTML_PATH = 'index.html';
const MODEL = 'claude-haiku-4-5-20251001';

const PLATFORM_URLS = {
  // Türkiye'de aktif e-ticaret platformları (yalnız)
  hemenmagaza: 'https://hemenmagaza.com',
  ikas: 'https://www.ikas.com/tr',
  ticimax: 'https://www.ticimax.com',
  ideasoft: 'https://www.ideasoft.com.tr',
  tsoft: 'https://www.tsoft.com.tr',
  platinmarket: 'https://www.platinmarket.com',
  faprika: 'https://www.faprika.com'
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: AbortSignal.timeout(25000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 14000);
  } catch (err) {
    console.warn(`Fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

async function extractData(platformId, url, pageText) {
  const prompt = `Bir e-ticaret platformu olan "${platformId}" sayfasından şu bilgileri DOĞRUDAN sayfada açıkça yazılı olanlardan çıkar.

KURALLAR:
- Sadece sayfa içinde EXPLICIT olarak yazılı veri. Çıkarım/yorum yapma.
- Belirsiz/yazmıyor ise null döndür.
- Değer 60 karakteri geçemez. Tek satır olmalı, tırnak/virgül/süslü-parantez/iki-nokta içermemeli.

JSON (sadece bu, başka metin yok):
{
  "starter_price": "Başlangıç paket fiyatı tek satır metin (ör: '1.490₺/ay' veya 'Free' veya 'Basic $19/ay') veya null",
  "growth_price": "Orta/büyüme paket fiyatı veya null",
  "enterprise_price": "Üst paket fiyatı veya null",
  "trial": "Ücretsiz deneme süresi (ör: '14 gün' veya '30 days') veya null",
  "customer_count": "Müşteri/mağaza sayısı (ör: '50.000+' veya '1M+'). KURAL: değer açıkça yazılı, kalıcı bir rakam olmalı. Eğer sayı dinamik bir sayaç gibi görünüyorsa (örn. '{{var}}', '<%= ... %>' veya 200-400 aralığında küçük rastgele rakamlı bir mağaza sayacı), null döndür."
}

URL: ${url}

SAYFA İÇERİĞİ:
${pageText}`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`AI extraction failed for ${platformId}: ${err.message}`);
    return null;
  }
}

function sanitizeValue(v) {
  if (!v || typeof v !== 'string') return null;
  v = v.trim();
  if (v.length === 0 || v.length > 60) return null;
  if (/['",{}:]/.test(v)) return null;
  if (/[\r\n]/.test(v)) return null;
  if (/(starter|growth|enterprise|trial|customers|pricing|features|pros|cons|scores):/i.test(v)) return null;
  return v;
}

// Escape-aware single-quoted string: ' followed by chars that are not ' or \, or escaped \. then closing '
const QSTR = `'(?:[^'\\\\]|\\\\.)*'`;

function replaceFieldOnce(html, platformId, parent, field, newValue) {
  const clean = sanitizeValue(newValue);
  if (!clean) return html;
  const re = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]{0,2000}?${parent}:\\s*\\{[\\s\\S]{0,400}?${field}:\\s*)${QSTR}`);
  return html.replace(re, `$1'${clean}'`);
}

function replaceTopLevelField(html, platformId, field, newValue) {
  const clean = sanitizeValue(newValue);
  if (!clean) return html;
  const re = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]{0,2000}?\\b${field}:\\s*)${QSTR}`);
  return html.replace(re, `$1'${clean}'`);
}

// Smart sanity check for customer_count. Returns the cleaned value or null to skip.
// Goal: accept genuine, persistent customer-count claims; reject dynamic-counter
// placeholders that change every page load (e.g. hemenmagaza.com uses
// "{{stores_count+200}}+ Aktif mağaza" which renders as 200+, 239+, 251+...).
function validateCustomerCount(platformId, value) {
  if (!value) return null;
  // Reject any template syntax
  if (/\{\{|\}\}|<%|%>/.test(value)) return null;
  // Hemenmağaza-specific: their homepage uses a dynamic counter that hovers
  // in the low 200-500 range. Only accept a customer count if it is well above
  // that dynamic range, indicating a real, persistent claim.
  if (platformId === 'hemenmagaza') {
    const m = value.match(/(\d[\d.,]*)\s*\+?/);
    if (m) {
      const num = parseInt(m[1].replace(/[.,]/g, ''), 10);
      if (Number.isFinite(num) && num < 1000) return null;
    }
  }
  return value;
}

function updatePlatformInHtml(html, platformId, data) {
  if (data.starter_price) html = replaceFieldOnce(html, platformId, 'pricing', 'starter', data.starter_price);
  if (data.growth_price) html = replaceFieldOnce(html, platformId, 'pricing', 'growth', data.growth_price);
  if (data.enterprise_price) html = replaceFieldOnce(html, platformId, 'pricing', 'enterprise', data.enterprise_price);
  if (data.trial) html = replaceTopLevelField(html, platformId, 'trial', data.trial);
  const cleanCount = validateCustomerCount(platformId, data.customer_count);
  if (cleanCount) html = replaceTopLevelField(html, platformId, 'customers', cleanCount);
  return html;
}

function updateBanner(html) {
  // The lastUpdate span is rewritten by applyLang on page load (using browser locale),
  // so we just bump a build-time marker in HTML to force a deploy if no other changes
  // happened. We update the comment marker near the top.
  const today = new Date().toISOString().slice(0, 10);
  const marker = `<!-- last-refresh: ${today} -->`;
  if (html.includes('<!-- last-refresh:')) {
    return html.replace(/<!-- last-refresh: [^>]+>/, marker);
  }
  // Insert before </head>
  return html.replace('</head>', `${marker}\n</head>`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  let html = readFileSync(HTML_PATH, 'utf8');
  let updates = 0;
  const summary = [];

  for (const [platformId, url] of Object.entries(PLATFORM_URLS)) {
    process.stdout.write(`Fetching ${platformId} (${url})... `);
    const pageText = await fetchPage(url);
    if (!pageText) {
      console.log('skip (fetch failed)');
      summary.push(`${platformId}: fetch failed`);
      continue;
    }

    console.log(`got ${pageText.length} chars, extracting...`);
    const data = await extractData(platformId, url, pageText);
    if (!data) {
      summary.push(`${platformId}: extraction failed`);
      continue;
    }

    const before = html;
    html = updatePlatformInHtml(html, platformId, data);
    if (html !== before) {
      updates++;
      const changedKeys = Object.entries(data).filter(([_, v]) => v).map(([k]) => k).join(', ');
      summary.push(`${platformId}: updated (${changedKeys || 'no fields'})`);
    } else {
      summary.push(`${platformId}: no changes`);
    }

    await new Promise(r => setTimeout(r, 600));
  }

  html = updateBanner(html);
  writeFileSync(HTML_PATH, html, 'utf8');

  console.log(`\n✓ ${updates} platform(s) updated · banner bumped`);
  console.log('\n--- Summary ---');
  summary.forEach(s => console.log(`  ${s}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
