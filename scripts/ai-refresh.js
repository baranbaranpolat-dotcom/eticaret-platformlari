#!/usr/bin/env node
/**
 * ai-refresh.js — Weekly AI-powered refresh of e-commerce platform data.
 *
 * For each platform with a URL, fetches the live page, sends it to Claude Haiku
 * to extract structured pricing/feature info, and updates the PLATFORMS data in
 * index.html. Designed to be conservative — only updates fields that the model
 * confidently extracted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const HTML_PATH = 'index.html';
const MODEL = 'claude-haiku-4-5-20251001';

const PLATFORM_URLS = {
  hemenmagaza: 'https://hemenmagaza.com',
  ikas: 'https://www.ikas.com/tr',
  ticimax: 'https://www.ticimax.com',
  ideasoft: 'https://www.ideasoft.com.tr',
  tsoft: 'https://www.tsoft.com.tr',
  shopify: 'https://www.shopify.com/pricing',
  bigcommerce: 'https://www.bigcommerce.com/essentials/pricing/',
  wix: 'https://www.wix.com/upgrade/website',
  squarespace: 'https://www.squarespace.com/pricing',
  shopiverse: 'https://shopiverse.com.tr',
  faprika: 'https://www.faprika.com'
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; eticaret-bot/1.0)' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
  } catch (err) {
    console.warn(`Fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

async function extractData(platformId, url, pageText) {
  const prompt = `Aşağıdaki "${platformId}" platformunun sayfasından şu bilgileri çıkar.
Sadece SAYFA İÇERİĞİNDE açıkça yer alan bilgiyi ver — uyduruk veri yazma.

İstenen JSON:
{
  "starter_price": "Başlangıç paket fiyatı, örn: '1.490₺/ay' veya 'Free' veya null",
  "growth_price": "Orta paket fiyatı veya null",
  "enterprise_price": "Üst paket fiyatı veya null",
  "trial": "Ücretsiz deneme süresi, örn: '14 gün' veya null",
  "customer_count": "Müşteri/mağaza sayısı, örn: '50.000+' veya null",
  "active_campaign": "Aktif kampanya/indirim bilgisi varsa kısa metin veya null",
  "notes": "Diğer dikkate değer güncel bilgi veya null"
}

Yalnızca JSON döndür, başka metin yok. Veri bulunmuyorsa alanları null bırak.

URL: ${url}

SAYFA İÇERİĞİ:
${pageText}`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
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
  // Refuse values that would break the JS structure
  if (!v || typeof v !== 'string') return null;
  if (v.length === 0 || v.length > 60) return null;
  // No quotes, commas, braces, or colons (these break our string literal context)
  if (/['",{}:]/.test(v)) return null;
  // Must not contain "starter:" / "growth:" / "enterprise:" / "trial:" / "customers:" etc.
  if (/(starter|growth|enterprise|trial|customers|pricing):/i.test(v)) return null;
  return v;
}

function replaceFieldOnce(html, platformId, parent, field, newValue) {
  // Match within a window of 1500 chars after the platform id, then find parent.field
  const clean = sanitizeValue(newValue);
  if (!clean) return html;
  // The regex captures: id: 'platformId' + up to 1500 chars + parent: { + up to 200 chars + field: '
  const re = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]{0,1500}?${parent}:\\s*\\{[^}]{0,300}?${field}:\\s*)'[^']*'`);
  return html.replace(re, `$1'${clean}'`);
}

function replaceTopLevelField(html, platformId, field, newValue) {
  // For top-level fields like trial, customers
  const clean = sanitizeValue(newValue);
  if (!clean) return html;
  const re = new RegExp(`(id:\\s*'${platformId}'[\\s\\S]{0,1500}?${field}:\\s*)'[^']*'`);
  return html.replace(re, `$1'${clean}'`);
}

function updatePlatformInHtml(html, platformId, data) {
  let before = html;
  if (data.starter_price) html = replaceFieldOnce(html, platformId, 'pricing', 'starter', data.starter_price);
  if (data.growth_price) html = replaceFieldOnce(html, platformId, 'pricing', 'growth', data.growth_price);
  if (data.enterprise_price) html = replaceFieldOnce(html, platformId, 'pricing', 'enterprise', data.enterprise_price);
  if (data.trial) html = replaceTopLevelField(html, platformId, 'trial', data.trial);
  if (data.customer_count) html = replaceTopLevelField(html, platformId, 'customers', data.customer_count);
  return html;
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
      summary.push(`${platformId}: updated (${Object.entries(data).filter(([_, v]) => v).map(([k]) => k).join(', ')})`);
    } else {
      summary.push(`${platformId}: no changes`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  if (updates > 0) {
    writeFileSync(HTML_PATH, html, 'utf8');
    console.log(`\n✓ Updated ${updates} platform(s)`);
  } else {
    console.log('\n✓ No updates needed');
  }

  console.log('\n--- Summary ---');
  summary.forEach(s => console.log(`  ${s}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
