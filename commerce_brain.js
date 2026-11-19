// Load local .env if present
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.substring(0, eqIdx).trim();
          const v = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }
} catch (e) {}

const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 1. Dual-Engine Multi-Provider Setup
// ==========================================

// Detect all Groq API Keys from environment
const groqKeys = [];
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string') {
    if (k.toUpperCase().includes('GROQ') || v.includes('gsk_')) {
      v.split(/[\s,;]+/).forEach(token => {
        const clean = token.trim();
        if (clean && clean.startsWith('gsk_') && !groqKeys.includes(clean)) {
          groqKeys.push(clean);
        }
      });
    }
  }
}

const groqClients = [];
groqKeys.forEach((k, idx) => {
  try {
    const client = new Groq({ apiKey: k });
    groqClients.push(client);
    console.log(`[AI Init] Registered Groq Key #${idx + 1} (${k.substring(0, 6)}...${k.substring(k.length - 4)})`);
  } catch (err) {
    console.warn(`[AI Init] Failed to init Groq Key #${idx + 1}:`, err.message);
  }
});

// ==========================================
// 2. Dynamic Multi-Tenant Store Settings, Catalog & Memory Cache
// ==========================================

const defaultStoreSettings = {
  shop_name: 'Dawah Fashion',
  business_category: 'modest_fashion',
  bot_persona_name: 'Zara',
  currency: 'BDT',
  inside_dhaka_fee: 80,
  outside_dhaka_fee: 150,
  free_delivery_min_amount: null,
  bkash_number: '01613-129192',
  nagad_number: '01677-557292',
  auto_reply_enabled: true,
  return_policy: 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।',
  promo_offer: '',
  extra_config: {}
};

let storeSettings = { ...defaultStoreSettings };

// Multi-Tenant Isolated Memory Vault
const sellerSettingsCache = new Map(); // sellerId -> settings object
const sellerProductsCache = new Map(); // sellerId -> [ products array ]
const sellerProductsTextCache = new Map(); // sellerId -> prompt catalog text
const sellerPromotionsTextCache = new Map(); // sellerId -> promo text

let cachedProductsText = '';
let cachedProductList = [];
let cachedPromotionsText = '';
let cachedPlaybookHints = '';
let cachedPlaybookRows = [];

// Supabase Client Setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(supabaseUrl, supabaseKey);

// Detect Google Gemini API Key dynamically from environment or storeSettings
function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim()) return process.env.GOOGLE_API_KEY.trim();
  if (process.env.GOOGLE_GEMINI_KEY && process.env.GOOGLE_GEMINI_KEY.trim()) return process.env.GOOGLE_GEMINI_KEY.trim();
  if (process.env.GEMINI_KEY && process.env.GEMINI_KEY.trim()) return process.env.GEMINI_KEY.trim();
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && (k.toUpperCase().includes('GEMINI') || k.toUpperCase().includes('GOOGLE_API') || v.startsWith('AIzaSy'))) {
      if (v.trim().length > 10) return v.trim();
    }
  }
  if (storeSettings && storeSettings.extra_config && storeSettings.extra_config.gemini_api_key) {
    return storeSettings.extra_config.gemini_api_key.trim();
  }
  return null;
}

const initialGeminiKey = getGeminiApiKey();
if (initialGeminiKey) {
  console.log(`[AI Init] Registered Google Gemini Key (${initialGeminiKey.substring(0, 6)}...${initialGeminiKey.substring(initialGeminiKey.length - 4)})`);
} else {
  console.warn('[AI Init] ⚠️ NO GEMINI KEY DETECTED in Environment or DB! Set GEMINI_API_KEY in Render env.');
}

// Two-Tier Persistent Memory Cache (RAM Cache + Supabase chat_sessions)
const sessionCache = new Map(); // "${sellerId}:${customerId}" -> sessionState

async function refreshSettingsFromDB(sellerId = 'autodokan_seller_1') {
  if (!supabase) return sellerSettingsCache.get(sellerId) || storeSettings;
  try {
    const { data, error } = await supabase
      .from('store_settings')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (!error && data) {
      const merged = {
        ...defaultStoreSettings,
        ...data,
        inside_dhaka_fee: Number(data.inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(data.outside_dhaka_fee) || 150
      };
      sellerSettingsCache.set(sellerId, merged);
      if (sellerId === 'autodokan_seller_1') {
        storeSettings = merged;
      }
      console.log(`[Store Settings Loaded] Seller: ${sellerId} | Shop: ${merged.shop_name} | Inside: ৳${merged.inside_dhaka_fee} | Outside: ৳${merged.outside_dhaka_fee} | Promo: ${merged.promo_offer || 'None'}`);
      return merged;
    }
  } catch (err) {
    console.warn(`[Store Settings Refresh Error for ${sellerId}]:`, err.message);
  }
  return sellerSettingsCache.get(sellerId) || storeSettings;
}

function getProductImageUrls(product) {
  if (!product) return [];
  const urls = [];
  // 1. Direct standard columns (clean backward compatibility)
  const standardFields = ['image_url', 'detail_image_url', 'hijab_image_url', 'flare_image_url', 'real_image_url'];
  standardFields.forEach(f => {
    if (product[f] && typeof product[f] === 'string' && product[f].trim()) {
      urls.push(product[f].trim());
    }
  });

  // 2. Dynamic gallery_images / images array / custom_attributes
  const gallerySources = [
    product.gallery_images,
    product.images,
    product.custom_attributes?.gallery_images,
    product.custom_attributes?.images,
    product.variants_json?.images
  ];
  gallerySources.forEach(src => {
    if (Array.isArray(src)) {
      src.forEach(u => {
        if (typeof u === 'string' && u.trim()) urls.push(u.trim());
      });
    }
  });

  // 3. Deduplicate URLs
  const uniqueUrls = Array.from(new Set(urls));
  // 4. Universal Safety Cap at 8 images max
  return uniqueUrls.slice(0, 8);
}

function getProductColors(p) {
  if (!p) return '';
  if (p.colors && p.colors.trim()) return p.colors.trim();
  const parenMatch = (p.name || '').match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) return parenMatch[1].trim();
  return '';
}

async function refreshProductsFromDB(sellerId = 'autodokan_seller_1') {
  await refreshSettingsFromDB(sellerId);
  if (!supabase) return sellerProductsCache.get(sellerId) || cachedProductList;
  try {
    // 1. Fetch ALL products for seller (both in_stock = true AND in_stock = false)
    const { data: prods, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', sellerId)
      .order('model_code', { ascending: true })
      .order('id', { ascending: true });

    if (!prodErr && prods && prods.length > 0) {
      sellerProductsCache.set(sellerId, prods);
      const sText = prods.map((p, idx) => {
        const code = p.model_code || `P-${100 + idx + 1}`;
        const price = p.price || 2200;
        const colorStr = getProductColors(p);
        const cAttr = p.custom_attributes || {};

        const qualityList = [];
        if (cAttr.color_guarantee) qualityList.push('কালার গ্যারান্টি');
        if (cAttr.wrinkle_free) qualityList.push('কুঁচকে যায় না');
        if (cAttr.summer_friendly) qualityList.push('গরমে আরামদায়ক');
        if (cAttr.wash_care) qualityList.push('সহজে ওয়াশেবল');
        if (cAttr.warranty) qualityList.push(`ওয়ারেন্টি: ${cAttr.warranty}`);
        const qualityBadges = qualityList.join(', ');

        const bundleStr = cAttr.bundle_label || (cAttr.bundle_active ? `${cAttr.bundle_qty || 2}টি নিলে বিশেষ বান্ডেল ছাড়` : '');

        const sizeStockMap = cAttr.size_stock;
        let sizeStockDesc = p.sizes ? `সাইজ: ${p.sizes}` : '';
        if (sizeStockMap && typeof sizeStockMap === 'object' && Object.keys(sizeStockMap).length > 0) {
          const sEntries = Object.entries(sizeStockMap).map(([sz, qty]) => {
            const q = parseInt(qty) || 0;
            return q > 0 ? `${sz}(${q}টি)` : `${sz}(স্টক শেষ)`;
          }).join(', ');
          sizeStockDesc = `সাইজ-স্টক: [${sEntries}]`;
        }

        const details = [
          p.category && p.category !== 'general' ? `ক্যাটাগরি: ${p.category}` : '',
          p.fabric ? `উপাদান: ${p.fabric}` : (cAttr.material ? `উপাদান: ${cAttr.material}` : ''),
          cAttr.transparency ? `ঘনত্ব: ${cAttr.transparency}` : '',
          cAttr.package_type ? `প্যাকেজ: ${cAttr.package_type}` : '',
          cAttr.inclusions ? `থাকছে: ${cAttr.inclusions}` : '',
          (p.hijab_included || cAttr.hijab_included || cAttr.hijab_details) ? `হিজাব: ${cAttr.hijab_details || 'হিজাব অন্তর্ভুক্ত'}` : '',
          colorStr ? `কালার: ${colorStr}` : '',
          sizeStockDesc,
          cAttr.body_fit ? `ফিটিং: ${cAttr.body_fit}` : '',
          cAttr.flare_inches ? `ঘের: ${cAttr.flare_inches}` : '',
          cAttr.comfort ? `কমফোর্ট: ${cAttr.comfort}` : '',
          cAttr.tech_specs ? `স্পেক্স: ${cAttr.tech_specs}` : '',
          cAttr.skin_type ? `ত্বক: ${cAttr.skin_type}` : '',
          qualityBadges ? `কোয়ালিটি: ${qualityBadges}` : '',
          bundleStr ? `[বান্ডেল অফার: ${bundleStr}]` : '',
          cAttr.lighting_disclaimer ? `লাইটিং নোট: ${cAttr.lighting_disclaimer}` : '',
          p.short_description ? `সেলস নোট: ${p.short_description}` : ''
        ].filter(Boolean).join(', ');
        const stock = p.in_stock === false ? 'স্টক আউট' : 'স্টকে আছে';
        const imgUrls = getProductImageUrls(p);
        const imgCount = imgUrls.length;
        const imgText = imgCount > 1 
          ? `${imgCount}টি অ্যালবাম ছবি ডাটাবেজে যুক্ত আছে` 
          : (imgCount === 1 
              ? '১টি ছবি ডাটাবেজে যুক্ত আছে' 
              : 'ছবি ডাটাবেজে এখনো আপলোড করা হয়নি (ছবি শূন্য)');

        let advanceBookingNotice = '';
        if (cAttr.advance_active) {
          const advAmt = cAttr.advance_amount || 200;
          const shipRule = cAttr.advance_shipping_rule === 'shipping_included' ? 'ডেলিভারি চার্জ সহ' : 'ডেলিভারি চার্জ ছাড়া আলাদা';
          advanceBookingNotice = ` [অগ্রিম বুকিং বাধ্যতামূলক: ৳${advAmt} অগ্রিম প্রযোজ্য (${shipRule})]`;
        }
        return `${idx + 1}. [${code}] ${p.name} | ৳${price} | ${stock} (${details})${advanceBookingNotice} | [${imgText}]`;
      }).join('\n');

      sellerProductsTextCache.set(sellerId, sText);

      if (sellerId === 'autodokan_seller_1') {
        cachedProductList = prods;
        cachedProductsText = sText;
      }

      console.log(`[Products Sync] Loaded ${prods.length} products for ${sellerId}`);
    }

    // 2. Fetch Active Promotions
    try {
      const { data: promos } = await supabase
        .from('promotions')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('is_active', true);

      const curStore = sellerSettingsCache.get(sellerId) || storeSettings;
      if (promos && promos.length > 0) {
        const promoText = promos.map(pr => 
          `• [অফার: ${pr.title}] কোড: ${pr.promo_code || 'N/A'}, ছাড়: ৳${pr.discount_value}, নির্দেশনা: ${pr.ai_instruction}`
        ).join('\n');
        sellerPromotionsTextCache.set(sellerId, promoText);
        if (sellerId === 'autodokan_seller_1') cachedPromotionsText = promoText;
      } else if (curStore.promo_offer) {
        const promoText = `• [চলমান স্টোর অফার]: ${curStore.promo_offer}`;
        sellerPromotionsTextCache.set(sellerId, promoText);
        if (sellerId === 'autodokan_seller_1') cachedPromotionsText = promoText;
      } else {
        const promoText = 'বর্তমানে কোনো অতিরিক্ত ডিসকাউন্ট বা প্রোমো কোড অফার সক্রিয় নেই।';
        sellerPromotionsTextCache.set(sellerId, promoText);
        if (sellerId === 'autodokan_seller_1') cachedPromotionsText = promoText;
      }
    } catch (e) {}

    // 3. Fetch Style Playbook Hints (All active rows for dynamic matching)
    try {
      const { data: hints } = await supabase
        .from('human_style_playbook')
        .select('id, scenario_tag, customer_trigger_example, human_reply_guideline, sample_natural_reply')
        .eq('is_active', true);

      if (hints && hints.length > 0) {
        cachedPlaybookRows = hints;
        cachedPlaybookHints = hints.slice(0, 1).map(h => 
          `• [${h.scenario_tag}]: "${h.customer_trigger_example}" -> ${h.human_reply_guideline}`
        ).join('\n');
        console.log(`[Playbook Sync] Loaded ${hints.length} human style playbook guidelines`);
      } else {
        cachedPlaybookRows = [];
        cachedPlaybookHints = '';
      }
    } catch (e) {}

  } catch (err) {
    console.warn('[Products Sync Error]:', err.message);
  }
  return cachedProductList;
}

function getDynamicPlaybookGuidance(userText) {
  if (!cachedPlaybookRows || cachedPlaybookRows.length === 0) return cachedPlaybookHints;
  const t = (userText || '').toLowerCase().trim();
  if (!t) return cachedPlaybookHints;

  const scored = [];
  for (const row of cachedPlaybookRows) {
    let score = 0;
    const trigger = (row.customer_trigger_example || '').toLowerCase();
    const tag = (row.scenario_tag || '').toLowerCase();

    if (/(?:দাম|price|koman|kom|কম|টাকা|ছাড়|ডিসকাউন্ট|বাজেট)/i.test(t) && (tag.includes('bargain') || tag.includes('discount') || trigger.includes('দাম'))) score += 5;
    if (/(?:প্রতারণা|বাটপার|চিটার|ফেক|ছবিতে|বাস্তবে|ডেলিভারি\s*ম্যান|খুলে|চেক)/i.test(t) && (tag.includes('scam') || tag.includes('check') || trigger.includes('প্রতারিত') || trigger.includes('খুল'))) score += 5;
    if (/(?:আম্মা|আম্মু|হাজবেন্ড|পরিবার|কথা\s*বলে|জানাবো)/i.test(t) && (tag.includes('family') || tag.includes('husband') || trigger.includes('হাজবেন্ড'))) score += 5;
    if (/(?:সাইজ|উচ্চতা|হাইট|ফিট|ফুট|ইঞ্চি)/i.test(t) && (tag.includes('size') || tag.includes('height') || trigger.includes('সাইজ'))) score += 5;
    if (/(?:কাপড়|ফেব্রিক|পাতলা|ট্রান্সপারেন্ট|কোয়ালিটি)/i.test(t) && (tag.includes('fabric') || tag.includes('quality') || trigger.includes('কাপড়'))) score += 5;
    if (/(?:কবে|দেরি|লেট|দেরিতে|কখন)/i.test(t) && (tag.includes('delay') || tag.includes('timeline') || trigger.includes('কবে'))) score += 5;
    if (/(?:রোবট|বট|মানুষ|স্টাফ)/i.test(t) && (tag.includes('robot') || tag.includes('human') || trigger.includes('রোবট'))) score += 5;

    const words = t.split(/\s+/).filter(w => w.length > 2);
    for (const w of words) {
      if (trigger.includes(w)) score += 2;
      if (tag.includes(w)) score += 2;
    }

    if (score > 0) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, 2).map(s => s.row);
  if (topMatches.length === 0) {
    const fallback = cachedPlaybookRows.slice(0, 1);
    return fallback.map(h => `• [${h.scenario_tag}]: "${h.customer_trigger_example}" -> ${h.human_reply_guideline}`).join('\n');
  }

  return topMatches.map(h => `• [${h.scenario_tag}]: "${h.customer_trigger_example}" -> ${h.human_reply_guideline}`).join('\n');
}

// Multi-Tenant Dynamic Background Sync (All Active Registered Sellers in DB)
async function syncAllActiveSellers() {
  if (!supabase) return;
  try {
    const { data: sellers, error } = await supabase.from('seller_invites').select('seller_id');
    if (!error && Array.isArray(sellers) && sellers.length > 0) {
      for (const row of sellers) {
        if (row.seller_id) {
          await refreshProductsFromDB(row.seller_id);
        }
      }
    } else {
      await refreshProductsFromDB('autodokan_seller_1');
    }
  } catch (err) {
    console.warn('[Multi-Seller Sync Error]:', err.message);
  }
}

// Initial Sync across all active tenants
syncAllActiveSellers();
setInterval(syncAllActiveSellers, 45 * 1000);

// ==========================================
// 3. Persistent Two-Tier Memory Helpers
// ==========================================

async function getCustomerSession(sellerId = 'autodokan_seller_1', channelType = 'WHATSAPP', customerId) {
  const sessionKey = `${sellerId}:${customerId}`;
  if (sessionCache.has(sessionKey)) {
    return sessionCache.get(sessionKey);
  }

  const defaultSession = {
    messages: [],
    stage: 'BROWSING',
    customer_notes: '',
    customer_name: null,
    hasGreeted: false,
    imagesSentForModels: [],
    deliveryFeeMentioned: false
  };

  if (!supabase) {
    sessionCache.set(sessionKey, defaultSession);
    return defaultSession;
  }

  try {
    const { data } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('channel_type', channelType)
      .eq('customer_identifier', customerId)
      .maybeSingle();

    if (data) {
      const msgs = Array.isArray(data.messages) ? data.messages.slice(-14) : [];
      const hasGreeted = msgs.some(m => m.role === 'assistant' && (m.content.includes('আসসালামু') || m.content.includes('স্বাগতম')));
      const sentModels = [];
      msgs.forEach(m => {
        const matches = m.content.match(/[A-Z0-9_-]+/gi);
        if (matches) {
          matches.forEach(c => {
            if (c.includes('-') && c.length >= 4) sentModels.push(c.toUpperCase());
          });
        }
      });

      // Check time gap from last message (2+ hours gap allows fresh warm greeting!)
      const lastMsg = msgs[msgs.length - 1];
      const lastMsgTime = lastMsg?.timestamp || (data.updated_at ? new Date(data.updated_at).getTime() : null);
      const timeGapHours = lastMsgTime ? (Date.now() - lastMsgTime) / (1000 * 60 * 60) : 0;
      const isLongGap = timeGapHours >= 2.0;
      const effectiveHasGreeted = isLongGap ? false : hasGreeted;
      const lastViewed = data.metadata?.lastViewedModel || null;

      const loadedSession = {
        messages: msgs,
        stage: data.stage || 'BROWSING',
        customer_notes: data.customer_notes || '',
        customer_name: data.customer_name || null,
        hasGreeted: effectiveHasGreeted,
        lastViewedModel: lastViewed,
        timeGapHours: isLongGap ? Math.round(timeGapHours) : 0,
        imagesSentForModels: Array.from(new Set(sentModels)),
        deliveryFeeMentioned: msgs.some(m => m.role === 'assistant' && (m.content.includes('ডেলিভারি চার্জ') || m.content.includes('৮০') || m.content.includes('১৫০')))
      };
      sessionCache.set(sessionKey, loadedSession);
      return loadedSession;
    }
  } catch (err) {
    console.warn('[Session Fetch Error]:', err.message);
  }

  sessionCache.set(sessionKey, defaultSession);
  return defaultSession;
}

async function saveCustomerSession(sellerId = 'autodokan_seller_1', channelType = 'WHATSAPP', customerId, session) {
  const sessionKey = `${sellerId}:${customerId}`;
  sessionCache.set(sessionKey, session);
  if (!supabase) return;

  const trimmedMessages = session.messages.slice(-16);
  const cleanPhone = customerId.split('@')[0].replace(/\D/g, '');

  try {
    await supabase.from('chat_sessions').upsert({
      seller_id: sellerId,
      channel_type: channelType,
      customer_identifier: customerId,
      customer_phone: cleanPhone || null,
      customer_name: session.customer_name || null,
      stage: session.stage || 'BROWSING',
      messages: trimmedMessages,
      customer_notes: session.customer_notes || '',
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'seller_id,channel_type,customer_identifier' });
  } catch (err) {
    console.warn('[Session Save Error]:', err.message);
  }
}

// ==========================================
// 4. Intent & Model Matcher Helpers
// ==========================================

// Clean human formatting sanitizer (Section 1)
function trimIncompleteEnding(text) {
  if (!text) return '';
  let str = text.trim();
  // If ends cleanly with terminal punctuation or bracket/tag
  if (/[।!?\]]$/.test(str)) return str;

  // Find last valid sentence ending
  const lastDanda = str.lastIndexOf('।');
  const lastQuestion = str.lastIndexOf('?');
  const lastExcl = str.lastIndexOf('!');
  const lastTag = str.lastIndexOf(']');
  const lastPunctIdx = Math.max(lastDanda, lastQuestion, lastExcl, lastTag);

  // If there is a complete sentence preceding it and the trailing fragment is incomplete
  if (lastPunctIdx > 15) {
    const trailingFragment = str.substring(lastPunctIdx + 1).trim();
    // If the trailing fragment doesn't end with sentence-ending punctuation and is short (< 40 chars), cut it off
    if (trailingFragment.length > 0 && trailingFragment.length < 40) {
      return str.substring(0, lastPunctIdx + 1).trim();
    }
  }
  return str;
}


// ==========================================
// BANGLADESHI PHONE & ADDRESS VALIDATION ENGINE
// ==========================================
function normalizeBdPhone(str) {
  if (!str) return null;
  // Convert Bengali numerals to English numerals
  const bnToEn = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
  let cleaned = str.toString().replace(/[০-৯]/g, d => bnToEn[d]);
  // Remove spaces, dashes, parentheses and non-digits except +
  cleaned = cleaned.replace(/[^0-9+]/g, '');
  // Match standard BD mobile: optional +88, 0088, or 88 prefix, then 01[3-9] followed by 8 digits
  const match = cleaned.match(/(?:(?:\+|00)?88)?(01[3-9]\d{8})(?!\d)/);
  if (match) {
    return match[1]; // Standardized 11-digit format: 01XXXXXXXXX
  }
  return null;
}

function validateBdAddress(addr) {
  if (!addr || typeof addr !== 'string') return { valid: false, reason: 'EMPTY' };
  const clean = addr.trim();
  if (clean.length < 8) return { valid: false, reason: 'TOO_SHORT' };

  // Anti-Gibberish: Check word count
  const words = clean.split(/\s+/).filter(w => w.length > 1);
  if (words.length < 2) return { valid: false, reason: 'NEED_AT_LEAST_TWO_WORDS' };

  // Anti-Gibberish: Reject consonant mash or keyboard mashing
  if (/^[bcdfghjklmnpqrstvwxyz]{6,}$/i.test(clean.replace(/[\s\d,.-]+/g, ''))) {
    return { valid: false, reason: 'CONSONANT_GIBBERISH' };
  }
  if (/(.)\1{4,}/.test(clean)) {
    return { valid: false, reason: 'REPEATED_CHARS' };
  }

  // BD Locations, Districts, Thanas & Standard Structure Keywords
  const bdKeywordsRegex = /(?:ঢাকা|dhaka|চট্টগ্রাম|chittagong|ctg|সিলেট|sylhet|রাজশাহী|rajshahi|খুলনা|khulna|বরিশাল|barisal|রংপুর|rangpur|ময়মনসিংহ|mymensingh|গাজীপুর|gazipur|নারায়ণগঞ্জ|narayanganj|কুমিল্লা|comilla|বগুড়া|bogra|ফেনী|feni|নোয়াখালী|noakhali|যশোর|jessore|পাবনা|pabna|কুষ্টিয়া|kushtia|সিরাজগঞ্জ|sirajganj|টাঙ্গাইল|tangail|কিশোরগঞ্জ|kishoreganj|কক্সবাজার|cox|ব্রাহ্মণবাড়িয়া|b-baria|মানিকগঞ্জ|মুন্সীগঞ্জ|নরসিংদী|ফরিদপুর|মাদারীপুর|গোপালগঞ্জ|শরীয়তপুর|জামালপুর|শেরপুর|নেত্রকোণা|হবিগঞ্জ|মৌলভীবাজার|সুনামগঞ্জ|চাঁদপুর|লক্ষ্মীপুর|রাঙ্গামাটি|বান্দরবান|খাগড়াছড়ি|নাটোর|নওগাঁ|চাঁপাইনবাবগঞ্জ|জয়পুরহাট|দিনাজপুর|ঠাকুরগাঁও|পঞ্চগড়|নীলফামারী|লালমনিরহাট|কুড়িগ্রাম|গাইবান্ধা|চুয়াডাঙ্গা|মেহেরপুর|ঝিনাইদহ|মাগুরা|নড়াইল|বাগেরহাট|সাতক্ষীরা|ঝালকাঠি|পিরোজপুর|পটুয়াখালী|বরগুনা|ভোলা|মিরপুর|mirpur|উত্তরা|uttara|গুলশান|gulshan|বনানী|banani|ধানমন্ডি|dhanmondi|মোহাম্মদপুর|mohammadpur|বসুন্ধরা|bashundhara|বাড্ডা|badda|খিলগাঁও|khilgaon|যাত্রাবাড়ী|jatrabari|মতিঝিল|motijheel|তেজগাঁও|tejgaon|ফার্মগেট|farmgate|আজিমপুর|azimpur|কেরানীগঞ্জ|keraniganj|সাভার|savar|টঙ্গী|tongi|বাসা|house|হোল্ডিং|holding|বাড়ি|bari|রোড|road|rd|গ্রাম|gram|village|ডাকঘর|পোস্ট|post|থানা|thana|উপজেলা|upazila|জেলা|zila|district|সেক্টর|sector|ব্লক|block|লেন|lane|গলি|মোড়|বাজার|bazar|মার্কেট|market|ফ্ল্যাট|flat|তলা|floor)/i;

  if (!bdKeywordsRegex.test(clean)) {
    return { valid: false, reason: 'NO_BD_LANDMARK_OR_KEYWORD' };
  }

  return { valid: true, clean };
}

function cleanHumanFormatting(text) {
  if (!text) return '';
  let s = String(text);

  // 1. Remove em-dash and en-dash (convert to comma or space)
  s = s.replace(/[—–]/g, ', ');

  // 2. Remove bullets
  s = s.replace(/[•●▪*]/g, '');

  // 3. Remove space-hyphen-space: " - " -> ", "
  s = s.replace(/\s+[-–—]+\s+/g, ', ');

  // 4. Remove leading hyphens on lines: "\n- " or "\n-- "
  s = s.replace(/(^|\n)\s*[-–—]+\s*/g, '$1');

  // 5. Remove multiple consecutive hyphens: "--" or "---"
  s = s.replace(/--+/g, ', ');

  // 6. Remove standalone hyphens not inside model codes or digits (Preserves DF-101 to DF-105, phone numbers, and বাংলা digit ranges like ৫০-৫৬)
  s = s.replace(/(?<![A-Za-z0-9০-৯])[-–—]+(?![A-Za-z0-9০-৯])/g, ' ');

  // 7a. Strip robotic corporate phrases
  s = s.replace(/(?:আজ\s*)?কীভাবে\s*(?:সাহায্য|সহায়তা|সহযোগিতা)\s*করতে\s*পারি[?।]*/gi, '');
  s = s.replace(/ধন্যবাদ\s*আপনার\s*মতামতের\s*জন্য[।.]*/gi, '');
  s = s.replace(/আপনার\s*বার্তার\s*জন্য\s*ধন্যবাদ[।.]?/gi, '');

  // 7. Strip accidental informal address tags: "আরে ভাই", "আরে না ভাই", "ভাইয়া", "আপু", etc.
  // Note: NEVER strip "আপনি" or "আপনার"!
  s = s.replace(/(?:আরে\s*না\s*ভাই|আরে\s*ভাই)/gi, 'জি');
  s = s.replace(/(?:ভাইয়া|আপু|ভাইয়া|ভাই|স্যার|ম্যাম)/gi, '');

  // 8. Clean repetitive punctuation & clean up commas
  s = s.replace(/,\s*,+/g, ',');
  s = s.replace(/,\s*([।!?\n])/g, '$1');
  s = s.replace(/^[,\s]+/g, '');
  s = s.replace(/[ \t]{2,}/g, ' ');

  // 9. Extra empty lines: max 1 blank line between blocks
  s = s.replace(/\n{3,}/g, '\n\n');

  // 10. Trim abrupt cutoffs: remove dangling fragmented words at sentence end
  s = trimIncompleteEnding(s);

  return s.trim();
}

function detectModelFromText(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return null;

  // 1. Direct Model Code Matching across any cached products (e.g. "DF-101", "DF 102", "df103", or custom codes)
  if (Array.isArray(cachedProductList) && cachedProductList.length > 0) {
    for (const p of cachedProductList) {
      if (!p.model_code) continue;
      const cleanCode = p.model_code.toLowerCase().trim();
      const codeDigits = cleanCode.replace(/\D/g, '');
      const codeRegex = new RegExp(`\\b${cleanCode}\\b|\\bdf[ -]?${codeDigits}\\b`, 'i');
      if (codeRegex.test(t)) {
        return p.model_code;
      }
    }
  } else {
    const directMatch = t.match(/\bdf[ -]?(\d{3})\b/i);
    if (directMatch) return `DF-${directMatch[1]}`;
  }

  // 2. Ordinal Index Matching (১ম, ২য়, ৩য়, ৪র্থ, ৫ম বা ১ নম্বর, ২ নম্বর, ইত্যাদিতে ক্যাটালগের প্রোডাক্ট ম্যাচিং)
  const ordinalMap = [
    { regex: /^(?:১|1)$|(?:^|[^\d০-৯])(?:১|1)\s*(?:নং|নম্বর|নাম্বার|টা|টি|ম\b|st\b|প্রথম)|এক\s*নম্বর/i, idx: 0 },
    { regex: /^(?:২|2)$|(?:^|[^\d০-৯])(?:২|2)\s*(?:নং|নম্বর|নাম্বার|টা|টি|য়\b|nd\b|দ্বিতীয়|দিতিয়)|দুই\s*নম্বর/i, idx: 1 },
    { regex: /^(?:৩|3)$|(?:^|[^\d০-৯])(?:৩|3)\s*(?:নং|নম্বর|নাম্বার|টা|টি|য়া\b|rd\b|তৃতীয়|তিতিও)|তিন\s*নম্বর/i, idx: 2 },
    { regex: /^(?:৪|4)$|(?:^|[^\d০-৯])(?:৪|4)\s*(?:নং|নম্বর|নাম্বার|টা|টি|র্থ\b|th\b|চতুর্থ)|চার\s*নম্বর/i, idx: 3 },
    { regex: /^(?:৫|5)$|(?:^|[^\d০-৯])(?:৫|5)\s*(?:নং|নম্বর|নাম্বার|টা|টি|ম\b|th\b|পঞ্চম)|পাঁচ\s*নম্বর/i, idx: 4 }
  ];
  for (const om of ordinalMap) {
    if (om.regex.test(t)) {
      if (cachedProductList && cachedProductList[om.idx]) {
        return cachedProductList[om.idx].model_code;
      }
      return `DF-${101 + om.idx}`;
    }
  }

  // 3. Dynamic Color & Search Keywords Matching from DB Products
  if (Array.isArray(cachedProductList) && cachedProductList.length > 0) {
    for (const p of cachedProductList) {
      const colorKeywords = [];
      if (p.colors) {
        if (Array.isArray(p.colors)) colorKeywords.push(...p.colors);
        else if (typeof p.colors === 'string') colorKeywords.push(...p.colors.split(/[,/|]/));
      }
      if (p.search_keywords) {
        if (Array.isArray(p.search_keywords)) colorKeywords.push(...p.search_keywords);
        else if (typeof p.search_keywords === 'string') colorKeywords.push(...p.search_keywords.split(/[,/|]/));
      }
      for (const kw of colorKeywords) {
        const cleanKw = kw.toLowerCase().trim();
        if (cleanKw.length >= 2 && t.includes(cleanKw)) {
          return p.model_code;
        }
      }
    }
  }

  // 4. Style keywords for modest fashion collection
  if (/৩-পিস|কারচুপি\s*কোটি|কটি\s*আবায়া|কোটি\s*সেট/i.test(t)) return 'DF-101';
  if (/রানি\s*আবায়া|রানী\s*আবায়া|কাটওয়ার্ক|rani/i.test(t)) return 'DF-102';
  if (/কাফতান|front\s*open|ফ্রন্ট\s*ওপেন|সি-গ্রিন|সিগ্রিন|কফি|সবুজ/i.test(t)) return 'DF-103';
  if (/এ-লাইন|ক্যাজুয়াল|daily\s*wear|a-line|aline|কম\s*দামের|কম\s*দামেরটা|সবচেয়ে\s*কম|নেভি\s*ব্লু/i.test(t)) return 'DF-104';
  if (/বাটারফ্লাই|পার্টি\s*বোরকা|butterfly|রয়েল\s*ব্লু|মেরুন/i.test(t)) return 'DF-105';

  return null;
}

function isInsultOrTrolling(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:tor\s*bap|tor\s*baap|ami\s*tor\s*bap|shala|shala\s*idiot|idiot|\bbap\b|madarchod|khankir|kutta|haramzada|bokachoda|suor|chudir|choda|শালার|শালা|ইডিয়ট|ইডিয়েট|তোর\s*বাপ|তোর\s*বাবা|তোর\s*বাপরে|খানকির|মাদারচোদ|কুত্তা|হারামজাদা)/i.test(t);
}

function isAskingForImage(text) {
  const t = (text || '').toLowerCase();
  return /(?:ছবি|পিক|পিকচার|ফটো|ইমেজ|pic|photo|image|chobi|chobi dekhan|pic dekhan|view|video|ভিডিও|দেখান|দেখাও|দেখি|দেখবো|দেখব|দেখাইতে|দেখা\s*যাবে|দেখতে\s*চাই|show|send|pathan|পাঠান|দিন|dekhaw|poc|pik|puk|chbi|sobi|ছবি\s*কই|পিক\s*কই|sobi\s*koi|chobi\s*koi|pic\s*koi|poc\s*koi|pic\s*den|poc\s*den|ছবি\s*দিন|পিক\s*দিন|ছবি\s*দেন|পিক\s*নাই|ছবি\s*নাই|ছবি\s*তো\s*দিলেন\s*না|ছবি\s*আসেনি|ছবি\s*পাইনি|ধুয়ে\s*পানি|ধুয়ে\s*পানি|dhuye\s*pani|pani\s*khabo|নাম\s*দিয়ে\s*কি|নাম\s*ধুয়ে|মুখে\s*বললে\s*হবে|বাতাস\s*কিনবো)/i.test(t);
}

function isAbusiveOrFrustrated(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:বালের|বাল|ফালতু|ধুর|পাগল\s*নাকি|মিথ্যা\s*বলেন|মিথ্যা\s*দাবি|চিটার|বাটপার|প্রতারক|ভুয়া|বাজে\s*বট|আজব\s*বট|\bbal\b|\bbaler\b|\bbuddhi\b|\bfaltu\b|\bpagol\b|\bchiter\b|\bbatpar\b)/i.test(t);
}

function isAskingForHijab(text) {
  return /(?:হিজাব|hijab|হিজাবের|হিজাবটা|নিকাব|niqab)/i.test((text || '').toLowerCase());
}

function isAskingForDetail(text) {
  return /(?:ডিটেল|ডিটেইল|কাজ|কাজের|হাতার|গলার|ক্লোজ|কারচুপি|কাটওয়ার্ক|detail|close|closer|work)/i.test((text || '').toLowerCase());
}

function isAskingForFlare(text) {
  return /(?:ঘের|ঘেরের|flare|gher|সাইড|side)/i.test((text || '').toLowerCase());
}

function isAskingForReal(text) {
  return /(?:রিয়েল|রিয়েল|ক্যামেরা|বাস্তব|আনফিল্টার্ড|real|camera|direct|actual)/i.test((text || '').toLowerCase());
}

function isAskingForAllCatalog(text, history = []) {
  const t = (text || '').toLowerCase().trim();
  if (/সব\s*(?:মডেল|ডিজাইন|কালেকশন|ছবি|পিক|পিকচার|বোরকা|আবায়া)?\s*(?:দেখাও|দেখান|দেখব|দেখতে\s*চাই|পাঠান|দিন)|সবগুলো|সবগুলা|sob\s*(?:mode|model|collection|chobi|pic|design|dekhte|dekhaw|dekhan|dekhi)|sobgulo|সব\s*কয়টি/i.test(t)) {
    return true;
  }
  if (/^(?:হ্যাঁ|হাঁ|জি|ji|ha|yes|ok|আচ্ছা|হুম)(?:\s*(?:দেখান|পাঠান|দেখব|চাই|দিন|dekhan))?$|^(?:দেখান|পাঠান|দেখব|দিন|dekhan|pathan|show|send)$/i.test(t)) {
    if (history && history.length > 0) {
      const lastBot = history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      if (lastBot.includes('সব কয়টি') || lastBot.includes('সবগুলোর') || lastBot.includes('সব ডিজাইন') || lastBot.includes('সব দেখতে')) {
        return true;
      }
    }
  }
  return false;
}

function isAskingForCatalogOverview(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:কালেকশন\s*দেখান|ডিজাইন\s*দেখান|বোরকা\s*দেখান|আবায়া\s*দেখান|কালেকশন\s*কি\s*আছে|কি\s*কি\s*আছে|কি\s*কি\s*ডিজাইন|নতুন\s*কালেকশন|collection\s*dekhan|design\s*dekhan)/i.test(t);
}

function isAskingForPriceOrDetails(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:দাম\s*কত|প্রাইজ\s*কত|প্রাইস\s*কত|price\s*koto|dam\s*koto|pp|rate|ফেব্রিক\s*কি|কাপড়\s*কি|ডিটেইলস|details|বিবরণ)/i.test(t);
}

function isPureQuestion(text) {
  const t = (text || '').toLowerCase().trim();
  const wantsImageExplicitly = isAskingForImage(t);
  // If user asks a question AND asks for an image, it is NOT a pure text question!
  if (wantsImageExplicitly) return false;
  const hasQuestionKeywords = /(?:দাম|প্রাইজ|প্রাইস|price|dam|ফেব্রিক|কাপড়|কাপড়|fabric|ডেলিভারি|চার্জ|উচ্চতা|হাইট|height|fut|ফুট|ফিট|ইঞ্চি|inch|সাইজ|size|খুলে|চেক|রিটার্ন|এক্সচেঞ্জ|হাতা|ঘের|কুরিয়ার|কুরিয়ার|অগ্রিম|বিকাশ|নগদ|কেমন|kemon|কোথায়|কবে|কয়দিনে|সময়|timeline)/i.test(t) || /\d\s*(?:fut|ফুট|ফিট|ft|ইঞ্চি|inch)/i.test(t);
  return hasQuestionKeywords;
}

// ==========================================
// Intent & Guardrail Classifiers (BanglaEComIntent)
// ==========================================

function isGibberishOrAccidental(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length <= 1 && !/[০-৯0-9]/.test(t)) return true;
  if (/^[.\s,!?…\-_]+$/.test(t)) return true;
  if (/(?:asdf|qwerty|zxcv|123456)/i.test(t)) return true;
  if (/^(?:[a-z])\1{3,}$/i.test(t.replace(/\s+/g, ''))) return true;
  if (/(?:ভুল\s*করে|vul\s*kore|vul\s*hoise|ভুল\s*হয়েছে|এমনি\s*টেস্ট|just\s*testing|এমনি\s*মেসেজ)/i.test(t)) return true;
  return false;
}

function isGoodbyeIntent(text) {
  const t = (text || '').toLowerCase().trim();
  return /^(?:আল্লাহ\s*হাফেজ|আল্লাহ্\s*হাফেজ|খোদা\s*হাফেজ|allah\s*hafez|khoda\s*hafez|bye|বাই|টাটা|tata|রাখি\s*তাহলে|রাখি|পরে\s*কথা\s*হবে|পরে\s*জানাবো|পরে\s*অর্ডার\s*করব|আজকে\s*আর\s*লাগবে\s*না|আপাতত\s*এটুকুই|valo\s*thakben)[\s.!]*$/i.test(t);
}

function isAngryComplaint(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:ভোক্তা\s*অধিকার|প্রতারণা|প্রতারক|চিটিং|চিটার|মামলা|পুলিশ|কেস\s*করব|সেলাই\s*খুল|রং\s*উঠে|ছেঁড়া|রিফান্ড\s*পাইনি|টাকা\s*নিয়ে\s*ঘুরা|বাজে\s*সার্ভিস|হারাম|ফালতু|খারাপ|fraud|cheating)/i.test(t);
}

function isAgentRequest(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:বট\s*বন্ধ|স্টাফ\s*দিন|রোবট.*কথা\s*বলব\s*না|মানুষ\s*চাই|ম্যানেজার.*কথা|কল\s*দেন|হটলাইন|direct\s*call|admin\s*er\s*number|real\s*manush|staff\s*kothay|call\s*me|staff\s*er\s*sathe)/i.test(t);
}

function isOrderStatusInquiry(text) {
  const t = (text || '').toLowerCase().trim();
  return /(?:অর্ডার.*(?:খবর|কোথায়|স্ট্যাটাস|কবে|পাবো|আটকে)|পার্সেল.*(?:কোথায়|কবে|আটকে)|ট্র্যাকিং|tracking|order\s*status|courier.*(?:code|id|tracking)|কুরিয়ারে\s*দিয়েছেন|আমার\s*মালটা)/i.test(t);
}

function getProductByCode(code, sellerId = null) {
  if (!code) return null;
  const clean = code.toUpperCase().trim();
  if (sellerId && sellerProductsCache.has(sellerId)) {
    const p = sellerProductsCache.get(sellerId).find(p => p.model_code && p.model_code.toUpperCase().trim() === clean);
    if (p) return p;
  }
  return null;
}

function getAllCachedProducts(sellerId = null) {
  if (sellerId && sellerProductsCache.has(sellerId)) {
    return sellerProductsCache.get(sellerId);
  }
  return [];
}

// ==========================================
// 5. Complete Real-Human System Prompt Builder
// ==========================================

function buildSystemPrompt(isFirstMessage, sessionState = {}, recentOrderText = '', userText = '', sellerId = 'autodokan_seller_1') {
  const sSettings = sellerSettingsCache.get(sellerId) || storeSettings;
  const sExtra = (sSettings && typeof sSettings.extra_config === 'object' && sSettings.extra_config !== null) ? sSettings.extra_config : {};
  const shopName = sSettings.shop_name || 'আমাদের শপ';
  const personaName = sSettings.bot_persona_name || '';
  const insideFee = sSettings.inside_dhaka_fee || 80;
  const outsideFee = sSettings.outside_dhaka_fee || 120;
  const bkashNum = sSettings.bkash_number || '';
  const nagadNum = sSettings.nagad_number || '';
  const advanceRequired = sExtra.require_advance_outside !== undefined
    ? (sExtra.require_advance_outside === true || sExtra.require_advance_outside === 'true')
    : (sSettings.advance_delivery_charge_required !== false);
  const deliveryTimeline = sExtra.delivery_timeline || '২-৩ কার্যদিবস';
  const washCare = sExtra.wash_care || '';
  const promoOffer = sSettings.promo_offer || '';
  const paymentMethods = [];
  if (bkashNum) paymentMethods.push(`বিকাশ (${bkashNum})`);
  if (nagadNum) paymentMethods.push(`নগদ (${nagadNum})`);
  const paymentMethodText = paymentMethods.length > 0 ? paymentMethods.join(' বা ') : 'বিকাশ বা নগদ';

  const sProducts = sellerProductsCache.get(sellerId) || [];
  const sProductsText = sellerProductsTextCache.get(sellerId) || 'বর্তমানে এই শপে কোনো সক্রিয় পণ্য নেই।';
  const sPromotionsText = sellerPromotionsTextCache.get(sellerId) || '';

  const category = (sSettings.business_category || '').toLowerCase();
  
  let sizeGuideline = '';
  let qualityPitch = '';
  let productDomain = 'পণ্য';

  if (category.includes('footwear') || category.includes('shoe') || category.includes('juta')) {
    productDomain = 'জুতা ও ফুটওয়্যার';
    sizeGuideline = `জুতা ও ফুটওয়্যারের সাইজ সংক্রান্ত কঠোর নিয়ম:
     - জুতোর কখনো কোনো উচ্চতা বা হাইট থাকে না! কাস্টমারকে ভুলেও উচ্চতা জিজ্ঞেস করবে না।
     - শুরুতে সরাসরি জুতার সাইজ নম্বর জানতে চাও (যেমন: "আপনার জুতার সাইজ কত নম্বর লাগবে? আমাদের ৩৯, ৪০, ৪১, ৪২ ও ৪৩ সাইজ ইন-স্টকে আছে।")।
     - কাস্টমার যদি সাইজ বুঝতে না পারে বা দ্বিধায় থাকে, তবে স্থানীয় বাটা/এপেক্স রেফারেন্স দিয়ে বলো: "আপনি সাধারণত বাটা (Bata) বা এপেক্স (Apex) এর কত নম্বর জুতো পরেন? আমাদের জুতার সাইজ একদম বাটা/এপেক্স স্ট্যান্ডার্ড সমান হবে।"`;
    qualityPitch = `বাজারে কমদামে সাধারণ কপি জুতা পাওয়া যেতে পারে, কিন্তু আমাদের জুতোর প্রিমিয়াম ফিনিশিং, আরামদায়ক কুশন ইনসোল এবং টেকসই গ্রিপ সোল হাতে নিলেই প্রিমিয়াম কোয়ালিটি বুঝতে পারবেন ইনশাআল্লাহ। আর কুরিয়ারের সামনে পার্সেল খুলে চেক করে নেওয়ার সুবিধাও তো থাকছে।`;
  } else if (category.includes('fashion') || category.includes('clothing') || category.includes('abaya') || category.includes('burqa') || category.includes('dress') || category.includes('panjabi') || category.includes('sharee')) {
    productDomain = 'পোশাক ও ফ্যাশন';
    sizeGuideline = `সাইজ নির্ধারণ ও পরামর্শের বাংলাদেশি লোকাল নিয়ম:
     - ভুল প্রশ্ন সম্পূর্ণ নিষিদ্ধ: "আপনার উচ্চতা কত অথবা কোন সাইজটি লাগবে?" — সাইজ ও উচ্চতা ভুলেও এক সাথে জানতে চাইবে না! শুরুতে কাস্টমারকে উচ্চতা জিজ্ঞেস করা সম্পূর্ণ নিষেধ।
     - ধাপ ১ (সরাসরি সাইজ জানা): কাস্টমার কোনো পোশাক বা আবায়া পছন্দ করলে প্রথমে সরাসরি স্ট্যান্ডার্ড সাইজ জানতে চাও (যেমন: "আপনার কোন সাইজটি লাগবে? আমাদের ৫০, ৫২, ৫৪ এবং ৫৬ সাইজ ইন-স্টকে আছে।")।
     - ধাপ ২ (কেবলমাত্র কাস্টমার সাইজ বলতে না পারলে বা বুঝতে না পারলে): কাস্টমার যদি বলে "সাইজ জানি না / বুঝি না / কোনটা লাগবে বলে দিন", কেবল তখনই ঝুল নির্ধারণের জন্য ব্রেন খাটিয়ে উচ্চতা জানতে চাও: "আপনার উচ্চতা কত ফিট কত ইঞ্চি জানালে আমি সঠিক ঝুল সাইজটি বলে দিচ্ছি।"
       * রেফারেন্স চার্ট: ৫'০"-৫'১" হলে ৫০ সাইজ, ৫'২"-৫'৩" হলে ৫২ সাইজ, ৫'৪"-৫'৫" হলে ৫৪ সাইজ, ৫'৬"-৫'৮" হলে ৫৬ সাইজ পারফেক্ট ঝুল হয়।
     - পাঞ্জাবি বা অন্যান্য সাধারণ পোশাকের ক্ষেত্রে: কাস্টমার সাইজ না বুঝলে তাদের রেগুলার টি-শার্ট সাইজ (M, L, XL, XXL) অথবা বডি চেস্ট সাইজ জানতে চাও।`;
    qualityPitch = `বাজারে কমদামে অনেক কপি পাওয়া যেতে পারে, কিন্তু আমাদের কাপড়ের প্রিমিয়াম ফেব্রিক ফিনিশিং, নিখুঁত সেলাই এবং কালার গ্যারান্টি হাতে নিলেই প্রিমিয়াম ফিল পাবেন ইনশাআল্লাহ। আর কুরিয়ারের সামনে পার্সেল খুলে চেক করে নেওয়ার সুবিধাও তো থাকছে।`;
  } else if (category.includes('gadget') || category.includes('electronic') || category.includes('mobile') || category.includes('tech')) {
    productDomain = 'গ্যাজেট ও ইলেকট্রনিক্স';
    sizeGuideline = `কাস্টমার মডেল স্পেসিফিকেশন, ব্যাটারি ব্যাকআপ, ওয়্যারেন্টি বা কানেক্টিভিটি জানতে চাইলে ডাটাবেজের ফিচার তালিকা দেখে সরাসরি নিশ্চিত করো।`;
    qualityPitch = `বাজারে অনেক নন-ব্র্যান্ডেড বা ক্লোন প্রোডাক্ট থাকে, কিন্তু আমাদের গ্যাজেটগুলো ১০০% অথেনটিক এবং ইনস্পেক্ট করা। কুরিয়ারের সামনে বক্স খুলে চেক করে নেওয়ার সম্পূর্ণ সুযোগ রয়েছে।`;
  } else if (category.includes('cosmetic') || category.includes('beauty') || category.includes('skincare')) {
    productDomain = 'বিউটি ও স্কিনকেয়ার';
    sizeGuideline = `কাস্টমার স্কিনের ধরন (তৈলাক্ত, শুষ্ক বা সংবেদনশীল) বা ব্যবহারবিধি জানতে চাইলে পণ্যের বিবরণ অনুযায়ী জেনুইন পরামর্শ দাও।`;
    qualityPitch = `আমাদের প্রতিটি স্কিনকেয়ার ও বিউটি প্রোডাক্ট ১০০% অরিজিনাল ও ইনট্যাক্ট। ত্বক সুরক্ষায় আমরা কখনোই নকল বা কমদামী কপি প্রোডাক্ট বিক্রি করি না।`;
  } else if (category.includes('food') || category.includes('organic') || category.includes('honey') || category.includes('grocery')) {
    productDomain = 'অর্গানিক ফুড ও গ্রোসারি';
    sizeGuideline = `কাস্টমার পরিমাণ, ওজন (যেমন ৫০০ গ্রাম, ১ কেজি) বা প্যাকেজিং জানতে চাইলে ডাটাবেজে স্টকে থাকা ভ্যারিয়েন্ট অনুযায়ী জানাও।`;
    qualityPitch = `আমাদের প্রতিটি খাদ্যপণ্য ১০০% খাঁটি, কেমিক্যালমুক্ত ও প্রাকৃতিক উপায়ে সংগৃহীত। স্বাস্থ্য সচেতন পরিবারের জন্য সর্বোচ্চ মানের নিশ্চয়তা দিচ্ছি।`;
  } else if (category.includes('perfume') || category.includes('attar') || category.includes('fragrance')) {
    productDomain = 'পারফিউম ও সুগন্ধি';
    sizeGuideline = `কাস্টমার সুবাসের স্থায়িত্ব (Long-lasting), নোটস বা বোতলের মিলি (যেমন ৫০ মিলি, ১০০ মিলি) জানতে চাইলে বিবরণ দেখে জানাও।`;
    qualityPitch = `আমাদের আতর ও পারফিউম সম্পূর্ণ প্রিমিয়াম গ্রেডের অ্যালকোহল-মুক্ত নির্যাস থেকে তৈরি, যা কাপড়ে দীর্ঘ সময় ধরে মিষ্টি সুবাস ছড়াবে ইনশাআল্লাহ।`;
  } else {
    productDomain = 'পণ্য';
    sizeGuideline = `কাস্টমার সাইজ, ভ্যারিয়েন্ট বা বিবরণ জানতে চাইলে ডাটাবেজের [LIVE PRODUCTS] তালিকায় স্টকে থাকা বিবরণ দেখে সরাসরি স্পষ্ট পরামর্শ দাও।`;
    qualityPitch = `বাজারে কমদামে সাধারণ পণ্য পাওয়া যেতে পারে, কিন্তু আমাদের পণ্যের প্রিমিয়াম ফিনিশিং, নিখুঁত কোয়ালিটি ও দীর্ঘস্থায়িত্ব হাতে নিলেই বুঝতে পারবেন ইনশাআল্লাহ। আর কুরিয়ারের সামনে পার্সেল খুলে চেক করে নেওয়ার সুবিধাও তো থাকছে।`;
  }

  const freeMinText = sSettings.free_delivery_min_amount ? ` (বিশেষ অফার: ৳${sSettings.free_delivery_min_amount} বা তার বেশি অর্ডারে ফ্রি ডেলিভারি!)` : '';
  const returnPolicyText = sSettings.return_policy || 'কুরিয়ার ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।';

  const distinctCategories = Array.isArray(sProducts)
    ? [...new Set(sProducts.map(p => p.category || (p.custom_attributes && p.custom_attributes.category)).filter(Boolean))]
    : [];

  const dynamicPlaybook = typeof getDynamicPlaybookGuidance === 'function' ? getDynamicPlaybookGuidance(userText) : '';

  const activeModelCode = sessionState.lastViewedModel || 'None';
  const timeGapInfo = sessionState.timeGapHours ? `${sessionState.timeGapHours} hours ago` : 'None';

  return `
[SESSION STATE]: AlreadyGreeted=${sessionState.hasGreeted ? 'true' : 'false'}, Stage=${sessionState.stage || 'BROWSING'}, ActiveModel=${activeModelCode}, CatalogOverviewSent=${sessionState.catalogSent ? 'true' : 'false'}, TimeGapSinceLastMsg=${timeGapInfo}${recentOrderText ? `\n[RECENT ORDER]: ${recentOrderText}` : ''}

তুমি "${shopName}"-এর অভিজ্ঞ শপ ইনচার্জ ও আসল সেলসম্যান${personaName ? ` (তোমার নাম ${personaName})` : ''}, সরাসরি হোয়াটসঅ্যাপে কাস্টমারের সাথে কথা বলছ। কোনো এআই বা হেল্পডেস্ক সাপোর্ট এজেন্ট নও। তোমার লক্ষ্য কাস্টমারের সাথে আপন মানুষের মতো আন্তরিক সম্পর্ক তৈরি করা এবং সঠিক পণ্যটি বেছে দিতে সাহায্য করে বিক্রয় নিশ্চিত করা। ১-৩ লাইনে সংক্ষিপ্ত, আকর্ষণীয় ও মার্জিত বাংলাদেশি বাংলায় পূর্ণাঙ্গ বাক্যে উত্তর দাও। কোনো কথা বা বাক্য মাঝপথে কাটা রাখবে না।

কঠোর শিষ্টাচার ও ভাষা:
১. "ভাই", "ভাইয়া", "আপু", "স্যার/ম্যাম" সম্পূর্ণ নিষিদ্ধ; সর্বদা সম্মানসূচক "আপনি/আপনার" বলবে। বাক্যের শুরুতে রোবটের মতো অহেতুক "জি," বসাবে না, বিশেষ করে ব্যক্তিগত বা সাধারণ প্রশ্নে সরাসরি স্বাভাবিক ভাষায় কথা বলবে।
২. ড্যাশ, হাইফেন বা বুলেট (-, --, —, •, *) সম্পূর্ণ নিষিদ্ধ। একাধিক তথ্য দিতে ১., ২., ৩. ব্যবহার করো।
৩. কোনো রোবটিক ইমোজি (🌸, 😊), হেল্পডেস্কের বুলি ("কীভাবে সাহায্য/সহযোগিতা করতে পারি?") বা সাধু ভাষা ("উপলব্ধ আছে", "প্রয়োজনীয়তা") সম্পূর্ণ নিষিদ্ধ। সর্বদা লোকাল স্বাভাবিক বাংলা ব্যবহার করবে: "স্টকে আছে", "ইন-স্টকে অ্যাভেইলেবল আছে", "অফার প্রাইস"।
৪. সালাম ও কুশল বিনিময়ের খাঁটি সেলসম্যান নিয়ম:
   - কাস্টমার সালাম দিলে ("আসসালামু আলাইকুম"): সরাসরি উত্তর দাও: "ওয়ালাইকুম আসসালাম! ${shopName}-এ স্বাগতম।" কাস্টমার নিজে "কেমন আছেন" না জিজ্ঞেস করলে নিজ থেকে কখনোই "ভালো আছি" বলবে না। কাস্টমার "কেমন আছেন" জিজ্ঞেস করলে উত্তর দাও: "আলহামদুলিল্লাহ ভালো আছি, আপনি কেমন আছেন?"
   - কাস্টমার "Hi", "Hello", "হাই" বা "সালাম" দিলে: অত্যন্ত মার্জিত ও আন্তরিক ভাষায় সালাম ও স্বাগতম জানাও: "আসসালামু আলাইকুম! ${shopName}-এ স্বাগতম। আপনাকে কীভাবে সহযোগিতা করতে পারি?"
     (ভুলেও নিজ থেকে হুট করে 'ট্রেন্ডিং কালেকশন দেখবেন কি না' বলবে না! কাস্টমার নিজে কী খুঁজছেন বা কী জানতে চান, আগে সেটি শুনতে হবে এবং নিজের বুদ্ধি খাটিয়ে প্রাসঙ্গিক উত্তর দাও।)
   - কাস্টমার শুরুতেই কোনো প্রশ্ন বা কালেকশন চাইলে (যেমন "বোরকা আছে?", "কালেকশন দেখান" বা "দাম কত"): সালাম ও শপের নাম দিয়ে সরাসরি উত্তর দাও। "আমি কি ছবি পাঠাব?" বলে কখনো অনুমতি খুঁজবে না।
   - দীর্ঘ সময় (২+ ঘণ্টা) পর কাস্টমার ফিরে এলে: নতুন করে আন্তরিক কুশল বিনিময় করো এবং আগে যে মডেলটি দেখছিল তা বুকিং করতে চায় নাকি নতুন কোনো কালেকশন দেখতে চায় জানতে চাও।
৫. কাস্টমার না চাইলে আগে থেকে বড় বিবরণ বা মূল্য ঢালবে না।
৬. ব্যক্তিগত বা অফ-টপিক প্রশ্নের মার্জিত উত্তর:
   - কাস্টমার ব্যক্তিগত প্রশ্ন করলে (যেমন "Are you married", "বিয়ে করেছেন?", "আপনার নাম কী", "আপনাকে ভালো লেগেছে" ইত্যাদি): ভুলেও "জি," বলবে না। শালীন ও মার্জিতভাবে সংক্ষেপে বলো: "আমি ${shopName}-এর সেলস অ্যাসিস্ট্যান্ট, আপনার কেনাকাটা ও পণ্য সংক্রান্ত যে কোনো তথ্যে সাহায্য করতে প্রস্তুত আছি।" এবং আলোচনা পণ্যের পছন্দের দিকে ফিরিয়ে আনো।

বিক্রয় ও ক্যাটালগ ফ্লো:
১. কালেকশন ব্রাউজিং:
   ${distinctCategories.length > 1 
     ? `আমাদের শপে ${distinctCategories.join(', ')} ক্যাটাগরির পণ্য রয়েছে। কাস্টমার কালেকশন দেখতে চাইলে কোন ক্যাটাগরি দেখতে চান জানতে চাও।`
     : `কাস্টমার কালেকশন দেখতে চাইলে ওভারভিউ পাঠাও: [SEND_CATALOG_OVERVIEW] এবং উৎসাহ নিয়ে বলো: "আমাদের সেরা কালেকশনের ছবিগুলো পাঠিয়েছি। ডিজাইনগুলো দেখে কোনটি আপনার বেশি পছন্দ হচ্ছে জানান, সেটির বিস্তারিত ও অফার প্রাইস জানিয়ে দিচ্ছি!"`}
২. নির্দিষ্ট মডেল ও অ্যালবাম:
   - কাস্টমার নির্দিষ্ট কোনো একটি মডেল পছন্দ করলে বা সেটির ছবি দেখতে চাইলে (যেমন কোড বা নাম উল্লেখ করে, বা ছবিতে সোয়াইপ/কোট রিপ্লাই দিলে):
     * ছবি সংক্রান্ত সতর্কতা ও সততা: যদি কোনো পণ্যের পাশে [ছবি ডাটাবেজে এখনো আপলোড করা হয়নি (ছবি শূন্য)] লেখা থাকে, তবে ভুলেও বলবে না "ছবি পাঠিয়েছি" বা কোনো ছবি ট্যাগ পাঠাবে না! সরাসরি বলবে: "এই মডেলটির ছবি এখনও সিস্টেমে আপলোড করা হয়নি, খুব শীঘ্রই যুক্ত হবে ইনশাআল্লাহ।"
     * শুধুমাত্র যে পণ্যের ছবি ডাটাবেজে যুক্ত আছে, সেটির জন্যই অ্যালবাম ট্যাগ পাঠাও: [SEND_ALL_IMAGES:MODEL_CODE]। বলবে: "এই মডেলটির সুন্দর কিছু ছবি পাঠিয়ে দিচ্ছি [SEND_ALL_IMAGES:MODEL_CODE], দেখে জানান কেমন লাগছে।"
   - এক টার্নে কখনোই একের অধিক মডেলের অ্যালবাম ট্যাগ পাঠাবে না।
   - কাস্টমার নির্দিষ্ট মডেল উল্লেখ না করে যদি বলে "Eta koto" বা "এটার দাম কত": ActiveModel জানা থাকলে সরাসরি সেটির দাম ও অফার বলো; আর জানা না থাকলে বলো: "কোন মডেলটির দাম জানতে চাচ্ছেন একটু নাম বা কোড বলুন, আমি এখনই দাম জানিয়ে দিচ্ছি।"
৩. সাইজ নির্ধারণ ও পরামর্শ (কঠোর সেলস প্রটোকল):
   - ভুল প্রশ্ন সম্পূর্ণ নিষিদ্ধ: "আপনার উচ্চতা কত অথবা কোন সাইজটি লাগবে?" — সাইজ ও উচ্চতা ভুলেও একসাথে জানতে চাইবে না! শুরুতে বা আগ বাড়িয়ে উচ্চতা জিজ্ঞেস করা সম্পূর্ণ নিষেধ।
   ${sizeGuideline}
৪. অর্ডার বুকিং ও চূড়ান্তকরণ (কঠোর অর্ডার গার্ড):
   - কঠোর নিয়ম: কাস্টমার নির্দিষ্ট কোনো মডেল ও সাইজ চূড়ান্ত করে বুকিং বা কেনার স্পষ্ট ইচ্ছা প্রকাশ না করা পর্যন্ত কখনোই আগ বাড়িয়ে নাম, ঠিকানা বা মোবাইল নম্বর চাইবে না! আর প্রোডাক্ট ও সাইজ নিশ্চিত হওয়ার পূর্বে ভুলেও অগ্রিম ডেলিভারি চার্জ বা পেমেন্টের কথা বলবে না। সাধারণ কথা, গল্প, সাইজ পরামর্শ বা কালেকশন দেখার সময় শুধুই স্বাভাবিক পরামর্শ দেবে; উত্তরের শেষে অযাচিতভাবে 'আপনার ঠিকানা দিন' বা পেমেন্ট চেয়ে কাস্টমারকে বিরক্ত করবে না।
   - সাইজ গার্ড: সাইজ বা ভ্যারিয়েন্ট নিশ্চিত না হওয়া পর্যন্ত অর্ডার কখনই কনফার্ম করবে না! কাস্টমার ঠিকানা দিয়ে ফেললেও সাইজ জানা না থাকলে আগে সাইজ নিশ্চিত করবে, তারপর সামারি দিয়ে কনফার্ম করবে। সাইজ ছাড়া ভুলেও বলবে না "অর্ডার কনফার্ম হয়েছে"।
   - ধাপ ১: মডেল এবং সাইজ উভয়ই নিশ্চিত হওয়ার পর (অথবা কাস্টমার সরাসরি "অর্ডার করব / নিতে চাই" বললে) বুকিংয়ের জন্য কাস্টমারের নাম, সম্পূর্ণ ডেলিভারি ঠিকানা ও মোবাইল নম্বর চাও।
   - মোবাইল নম্বর ভ্যালিডেশন (+88 ও কপি-পেস্ট সাপোর্ট):
     * কাস্টমার ফোন নম্বর কপি-পেস্ট করে দিলে বা +88 সহ দিলে (যেমন: +8801712345678 বা 8801712345678 বা ০১৭...) স্বাভাবিকভাবে গ্রহণ করবে এবং সামারিতে ১১ ডিজিটের স্ট্যান্ডার্ড নম্বরে দেখাবে।
     * ভুল, অসম্পূর্ণ বা ভুয়া নম্বর (যেমন: ৮ ডিজিট, ১০ ডিজিট, বা 01 ছাড়া অন্য কোনো সংখ্যা যেমন 8275727282) দিলে কখনই অর্ডার কনফার্ম করবে না। বলবে: "আপনার মোবাইল নম্বরটি সঠিক নয় বা কিছু সংখ্যা কম আছে বলে মনে হচ্ছে। দয়া করে আপনার চালু থাকা সঠিক ১১ ডিজিটের মোবাইল নম্বরটি দিন (যেমন: 017XXXXXXXX)।"
   - ডেলিভারি ঠিকানা ভ্যালিডেশন:
     * কাস্টমারের ঠিকানা অবশ্যই স্পষ্ট ও সম্পূর্ণ হতে হবে (বাসা/রোড নম্বর, এলাকা/থানা এবং জেলা)।
     * অসম্পূর্ণ বা কিবোর্ড ম্যাশ করা অক্ষর (যেমন: kjhvsh, abc, asdfgh) দিলে বলবে: "পার্সেল সঠিক ঠিকানায় দ্রুত ডেলিভারি করার জন্য দয়া করে আপনার বিস্তারিত ঠিকানা দিন (বাসা/হোল্ডিং নম্বর, রোড, এলাকা/থানা ও জেলা)।"
   - ধাপ ২: কাস্টমার ঠিকানা পাঠালে সাথে সাথে একটি সুন্দর সামারি দিয়ে কাস্টমারকে কনফার্ম করতে বলো:
     "অর্ডার সামারি:
     ১. প্রোডাক্ট: [মডেলের নাম]
     ২. সাইজ: [সাইজ]
     ৩. ঠিকানা: [কাস্টমারের ঠিকানা]
     ৪. মোবাইল: [মোবাইল নম্বর]
     ৫. পণ্য পেয়ে মূল্য পরিশোধ (ক্যাশ অন ডেলিভারি): ৳[মূল্য]
     ৬. ডেলিভারি চার্জ: ঢাকায় ৳${insideFee} / বাইরে ৳${outsideFee}${freeMinText}
     সব তথ্য ঠিক থাকলে একটু 'ঠিক আছে' বা 'কনফার্ম' লিখে দিন, আমরা পার্সেল বুকিং শুরু করব।"
   - ধাপ ৩: কাস্টমার কনফার্ম করার পর ডেলিভারি পলিসি ও পেমেন্ট:
     ${advanceRequired ? `পার্সেল বুকিং নিশ্চিত করতে ডেলিভারি চার্জটি (ঢাকায় ৳${insideFee} / বাইরে ৳${outsideFee}) আমাদের ${paymentMethodText} নম্বরে সেন্ড মানি করতে বলো। কাস্টমার TrxID দিলে বলো: "ধন্যবাদ! আপনার পেমেন্ট তথ্যটি নোট করা হয়েছে। আমাদের অ্যাকাউন্টস ম্যানেজার ভেরিফাই করে কল দিয়ে অর্ডারটি চূড়ান্ত করবেন এবং কুরিয়ারের ট্র্যাকিং কোড পাঠিয়ে দেওয়া হবে।"` : '১০০% ক্যাশ অন ডেলিভারি, কোনো অগ্রিম চার্জ নেই (পণ্য হাতে পেয়ে পুরো মূল্য পরিশোধ করবেন)।'}
     - ডেলিভারির আনুমানিক সময়সীমা: ${deliveryTimeline}
     - রিটার্ন ও এক্সচেঞ্জ পলিসি: ${returnPolicyText}
     ${washCare ? `- কাপড়ের যত্ন / ওয়াশ কেয়ার: ${washCare}` : ''}

কালার ও স্পেক্স নিয়ম (Zero Hallucination Specs):
১. কালার, কাপড়ের ঘনত্ব/ট্রান্সপারেন্সি (ইনার লাগবে কিনা), প্যাকেজ (কয় পিস/হিজাব আছে কিনা), সাইজ, ফিটিং, ঘের ও কোয়ালিটি সংক্রান্ত কাস্টমারের প্রশ্নে হুবহু [LIVE PRODUCTS] তালিকার স্পেসিফিকেশন অনুযায়ী উত্তর দেবে। কোনো কাল্পনিক তথ্য দেওয়া সম্পূর্ণ নিষিদ্ধ।
২. কাস্টমার কালার জানতে চাইলে ডাটাবেসের তালিকায় থাকা কালারই বলবে। অন্য কালার চাইলে সরাসরি বলবে স্টকে কেবল উল্লেখিত কালারগুলোই রয়েছে।
৩. কাপড় পাতলা বা ইনার লাগবে কিনা জানতে চাইলে তালিকার 'ঘনত্ব' অনুযায়ী স্পষ্ট জানাবে (যেমন: "এটি ১০০% নন-ট্রান্সপারেন্ট, আলাদা ইনারের প্রয়োজন নেই")।
৪. কোয়ালিটি ও ছবির রঙের মিল জানতে চাইলে তালিকায় থাকা নিশ্চয়তা উল্লেখ করবে এবং বলবে স্টুডিও লাইটিংয়ের কারণে ছবিতে ৫-১০% সামান্য উনিশ-বিশ হতে পারে, বাস্তবে কাপড় অত্যন্ত প্রিমিয়াম।

স্টক, দাম ও বান্ডেল ডিল (ভ্যালু-বেসড সেলিং ও বান্ডেল অফার):
১. কোনো প্রোডাক্টে [বান্ডেল অফার: ...] থাকলে কাস্টমার দাম কম রাখতে চাইলে বা একাধিক পিস নিতে চাইলে অবশ্যই সেই বান্ডেল অনুযায়ী আকর্ষণীয় অফার দেবে (যেমন: "আমাদের ১টির রেগুলার প্রাইস ৳[দাম], তবে আপনি একসাথে ২টি নিলে বান্ডেল অফারে ১০% ছাড়ে মোট ৳[টাকা] পাবেন")।
২. ডাটাবেসে যে প্রোডাক্ট "স্টক আউট" রয়েছে, সেটির কথা বললে স্পষ্টভাবে বলো যে এই মডেলটি এখন স্টকে নেই এবং স্টকে থাকা একই কোয়ালিটির অন্য রানিং মডেল দেখতে বলো।
৩. কাস্টমার দাম বেশি বললে বা বাজারে কম দামের কথা তুললে মিষ্টি ভাষায় কোয়ালিটি তুলে ধরো: "${qualityPitch}"
${promoOffer ? `৪. রানিং স্পেশাল অফার: "${promoOffer}" (কাস্টমার বিশেষ কোনো ডিসকাউন্ট বা অফার জানতে চাইলে এটি তুলে ধরবে)।` : '৪. বান্ডেল ছাড়া অন্য কোনো মনগড়া বা আন্দাজে ছাড় দেবে না।'}

স্ল্যাং ও অভিযোগ:
১. "নাম ধুয়ে পানি খাবো", "poc", "sobi", "pic den" মানে ছবি দেখতে চেয়েছেন।
২. সরাসরি ব্যক্তিগত গালাগালি এলে শান্তভাবে বলো: "দয়া করে শালীনভাবে কথা বলুন।"

[LIVE PRODUCTS]:
${sProductsText || 'বর্তমানে পণ্য সক্রিয় আছে।'}
${sPromotionsText ? `\n[PROMOTIONS]: ${sPromotionsText}` : ''}
${dynamicPlaybook ? `\n[PLAYBOOK]:\n${dynamicPlaybook}` : ''}
`.trim();
}

// ==========================================
// 6. Smart 85% / 15% Hybrid AI Router & Cooldown Engine
// ==========================================

const modelCooldownMap = new Map(); // modelName -> timestamp ms

function isModelCoolingDown(modelName) {
  const until = modelCooldownMap.get(modelName);
  if (!until) return false;
  if (Date.now() < until) return true;
  modelCooldownMap.delete(modelName);
  return false;
}

function triggerModelCooldown(modelName, seconds = 60) {
  const until = Date.now() + (seconds * 1000);
  modelCooldownMap.set(modelName, until);
  console.warn(`[Model Cooldown] '${modelName}' hit 429 / Rate Limit. Cooldown active for ${seconds}s.`);
}

function classifyMessageComplexity(text, historyLength = 0) {
  const t = (text || '').toLowerCase().trim();

  // 1. Bargaining indicators
  const isBargaining = /(?:কমান|কম\s*রাখা|কম\s*রাখবেন|ডিসকাউন্ট|বাজেট|একদাম|কম\s*দিবেন|ছাড়|কিছু\s*কম|koman|kom|discount|budget|ekdam)/i.test(t);

  // 2. Anger / complaint / sarcasm / slang indicators
  const isEmotionalOrSarcastic = /(?:মিথ্যা|ধুয়ে\s*পানি|ধুয়ে\s*পানি|বালের|বাল|ফালতু|ফেরত|ধরা|কই\s*ছবি|poc|baler|bal|faltu|dhuye\s*pani|pani\s*khabo|koi\s*chobi|চিটার|বাটপার|প্রতারক|ভুয়া)/i.test(t);

  // 3. Multi-item / wholesale indicators
  const isWholesaleOrBulk = /(?:পাইকারি|পাইকারী|কমিশন|ডজন|৫\s*পিস|১০\s*পিস|paikari|wholesale|dozon|5\s*piece|10\s*piece)/i.test(t);

  // 4. Story / long chit-chat
  const isStoryOrLong = t.length > 120 || /(?:আমার\s*আম্মা|আমার\s*বোন|আমার\s*বান্ধবী|উপহার\s*দিব|বিয়ে|অনুষ্ঠান)/i.test(t);

  // 5. Extended conversation without order (> 8 turns)
  const isExtendedDiscussion = Number(historyLength) > 8;

  if (isBargaining || isEmotionalOrSarcastic || isWholesaleOrBulk || isStoryOrLong || isExtendedDiscussion) {
    return 'COMPLEX';
  }

  return 'ROUTINE';
}

async function callGroqEngine(messages, systemPrompt) {
  if (groqClients.length === 0) return null;

  // Dynamic model fallback with models verified active on Groq
  const candidateModels = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ];

  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  for (let cIdx = 0; cIdx < groqClients.length; cIdx++) {
    const client = groqClients[cIdx];
    for (const model of candidateModels) {
      if (isModelCoolingDown(`groq-${model}`)) {
        console.log(`[Groq Router] Model ${model} is in cooldown (429), checking next...`);
        continue;
      }

      try {
        const completion = await client.chat.completions.create({
          model: model,
          messages: chatMessages,
          temperature: 0.42,
          top_p: 0.85,
          max_tokens: 1024
        }, { timeout: 7000 });
        const reply = completion.choices[0]?.message?.content;
        if (reply && reply.trim()) {
          console.log(`[Groq Success] Model ${model} responded successfully`);
          return reply.trim();
        }
      } catch (err) {
        console.warn(`[Groq Key #${cIdx + 1} Model ${model}] Error:`, err.message);
        if (err.status === 429 || err.message.includes('429') || err.message.includes('rate_limit') || err.message.includes('timeout')) {
          triggerModelCooldown(`groq-${model}`, 60);
        }
      }
    }
  }
  return null;
}

async function callGeminiEngine(messages, systemPrompt, complexity = 'ROUTINE') {
  const activeGeminiKey = getGeminiApiKey();
  if (!activeGeminiKey) return null;

  // Active verified models with high quota:
  // Fast, uninterrupted full sentence completions
  const candidateModels = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-flash-latest'
  ];
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  for (const model of candidateModels) {
    if (isModelCoolingDown(model)) {
      console.log(`[Gemini Router] Model ${model} is in cooldown (429), checking next...`);
      continue;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeGeminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: {
            temperature: 0.38,
            maxOutputTokens: 2048
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          console.log(`[Gemini Router Success] Model ${model} (Route: ${complexity}) responded`);
          return text.trim();
        }
      } else {
        const errText = await res.text();
        console.warn(`[Gemini Model ${model}] HTTP ${res.status}:`, errText.substring(0, 120));
        if (res.status === 429 || res.status === 503 || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('rate_limit')) {
          triggerModelCooldown(model, 60);
        }
      }
    } catch (e) {
      console.warn(`[Gemini Model ${model}] Exception:`, e.message);
      if (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED')) {
        triggerModelCooldown(model, 60);
      }
    }
  }
  return null;
}

// Native Multimodal Bangla Speech-to-Text via Google Gemini (Section 4)
async function transcribeAudioWithGemini(audioBuffer) {
  const activeGeminiKey = getGeminiApiKey();
  if (!activeGeminiKey || !audioBuffer || audioBuffer.length === 0) return null;

  const candidateAudioModels = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const base64Audio = audioBuffer.toString('base64');

  for (const model of candidateAudioModels) {
    if (isModelCoolingDown(model)) continue;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeGeminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/ogg',
                    data: base64Audio
                  }
                },
                {
                  text: 'এই অডিও মেসেজটিতে বাংলায় কী বলা হয়েছে তা হুবহু বাংলায় লিখে দাও। কোনো ভূমিকা, ব্যাখ্যা বা বাড়তি কথা ছাড়া শুধু যা বলা হয়েছে হুবহু সেই কথাগুলোই বাংলায় লেখো।'
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 400
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          console.log(`[Gemini Audio STT Success] (${model}) Transcribed: "${text.trim()}"`);
          return text.trim();
        }
      } else {
        const errText = await res.text();
        console.warn(`[Gemini Audio STT ${model}] HTTP ${res.status}:`, errText.substring(0, 100));
        if (res.status === 429) {
          triggerModelCooldown(model, 60);
        }
      }
    } catch (err) {
      console.warn(`[Gemini Audio STT ${model}] Error:`, err.message);
    }
  }

  return null;
}

// Free Bangla Voice-to-Text via Groq Whisper API (whisper-large-v3-turbo)
async function transcribeAudioWithGroq(audioBuffer) {
  if (!audioBuffer || groqClients.length === 0) return null;

  for (let idx = 0; idx < groqClients.length; idx++) {
    const client = groqClients[idx];
    try {
      const file = await Groq.toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' });
      const transcription = await client.audio.transcriptions.create({
        file: file,
        model: 'whisper-large-v3-turbo',
        language: 'bn',
        temperature: 0.0,
        response_format: 'json'
      });
      const text = transcription?.text;
      if (text && text.trim()) {
        console.log(`[Groq Whisper Success] Transcribed: "${text.trim()}"`);
        return text.trim();
      }
    } catch (err) {
      console.warn(`[Groq Whisper Client #${idx + 1}] Error:`, err.message);
    }
  }
  return null;
}

// Fallback generator for extreme network failure or quick resolution
function generateSmartFallback(userText, isFirstMessage, session = null, recentOrder = null, sellerId = 'autodokan_seller_1') {
  const t = (userText || '').toLowerCase().trim();
  const sSettings = sellerSettingsCache.get(sellerId) || storeSettings;
  const shopName = sSettings.shop_name || 'আমাদের শপ';
  const category = (sSettings?.business_category || '').toLowerCase();
  const insideFee = sSettings.inside_dhaka_fee || 80;
  const outsideFee = sSettings.outside_dhaka_fee || 150;
  const greeting = (isFirstMessage && (!session || !session.hasGreeted)) ? `আসসালামু আলাইকুম! ${shopName}-এ স্বাগতম। ` : 'জি, ';

  // 0. Smart Gibberish & Accidental Text Guard
  if (isGibberishOrAccidental(t)) {
    if (/ভুল\s*করে|vul\s*kore|vul\s*hoise|ভুল\s*হয়েছে/i.test(t)) {
      return 'আচ্ছা সমস্যা নেই।';
    }
    if (/^[.\s,!?…\-_]+$/.test(t) || t.length <= 1) {
      return 'জি, কোনো কিছু জানতে চান?';
    }
    return 'আচ্ছা সমস্যা নেই। আমাদের প্রোডাক্ট বা কালেকশন নিয়ে কিছু জানতে চাইলে বলতে পারেন।';
  }

  // 0b. Goodbye intent (strictly zero sales hook / zero question)
  if (isGoodbyeIntent(t)) {
    return 'জি ইনশাআল্লাহ, ভালো থাকবেন। শুভকামনা রইল!';
  }

  // 0c. Customer Complaint & Escalation Guard
  if (isAngryComplaint(t)) {
    return 'এমন অনাকাঙ্ক্ষিত অভিজ্ঞতার জন্য আমরা অত্যন্ত আন্তরিকভাবে দুঃখিত। বিষয়টি আমরা সর্বোচ্চ গুরুত্ব দিয়ে দেখছি। আপনার অর্ডার আইডি বা ফোন নম্বরটি দিন, ইনচার্জ নিজে আপনার সাথে কথা বলে সমাধান করবেন।';
  }

  // 0d. Agent Request
  if (isAgentRequest(t)) {
    return 'আমি স্টোরের ইনচার্জ হিসেবে নিজেই মেসেজগুলো দেখছি। বলুন কী সমস্যা হয়েছে? আর সরাসরি ফোনে কথা বলতে চাইলে নম্বরটি দিন, আমাদের দায়িত্বশীল ব্যক্তি দ্রুত কল দিচ্ছেন।';
  }

  // 0e. Live Order Status Lookup
  if (isOrderStatusInquiry(t)) {
    if (recentOrder) {
      return `আপনার অর্ডার #${recentOrder.id} (${recentOrder.model_code || 'পোশাক'}) বর্তমানে [${recentOrder.status}] অবস্থায় রয়েছে। কুরিয়ার: ${recentOrder.courier_name || 'Steadfast Courier'}, ট্র্যাকিং কোড: ${recentOrder.courier_tracking_id || 'প্রসেসিং হচ্ছে'}। বকেয়া COD: ৳${recentOrder.due_cod || recentOrder.total_bdt || 2200} টাকা।`;
    }
    return 'আপনার এই নম্বরে বর্তমানে কোনো রানিং অর্ডার পাওয়া যায়নি। আপনি কি অন্য কোনো নম্বর দিয়ে অর্ডার করেছিলেন? অথবা আপনার অর্ডার আইডিটি জানালে এখনই ট্র্যাকিং স্ট্যাটাস চেক করে দিচ্ছি।';
  }

  // 1. Wellbeing inquiry
  if (/কেমন আছেন|kemon achen|kemon asen/i.test(t)) {
    return `${greeting}আলহামদুলিল্লাহ, আল্লাহর রহমতে আমরা ভালো আছি। আপনি কেমন আছেন? আপনাকে কীভাবে সহযোগিতা করতে পারি?`;
  }

  // 2. Height & Size inquiries (Local Bangladeshi Intelligence & Zero-Height Shoe Guard)
  const isShoeDomain = category.includes('footwear') || category.includes('shoe') || category.includes('juta');
  const mentionsHeight = /(?:উচ্চতা|হাইট|height|fut|ফুট|ফিট|ইঞ্চি|inch|\b\d\s*(?:fut|ফুট|ft)\b)/i.test(t);
  const mentionsSizeConfused = /(?:সাইজ\s*(?:জানি\s*না|বুঝি\s*না|বুঝতে\s*পারছি\s*না|কোনটা|কত|বলুন|লাগবে|হবে|দিব)|kon\s*size|size\s*jani\s*na|size\s*bujhi\s*na)/i.test(t);
  const asksAvailableSizes = /(?:কী\s*কী|কি\s*কি|কোন\s*কোন)\s*সাইজ|সাইজ\s*(?:কী\s*কী|কি\s*কি|আছে|এভেইলবল)|size\s*available/i.test(t);

  if (isShoeDomain) {
    if (mentionsHeight || mentionsSizeConfused || asksAvailableSizes || /(?:জুতার|জুতোর|পায়ের)\s*সাইজ/i.test(t)) {
      return `${greeting}আমাদের জুতার সাইজগুলো বাটা (Bata) ও এপেক্স (Apex) স্ট্যান্ডার্ড অনুযায়ী ৩৯, ৪০, ৪১, ৪২ এবং ৪৩ নম্বরে ইন-স্টকে আছে। আপনি সাধারণত কত নম্বর পরেন জানালে আমরা সে অনুযায়ী পাঠিয়ে দেব ইনশাআল্লাহ।`;
    }
  } else {
    if (mentionsHeight) {
      if (/4\s*(?:fut|ফুট|ft)\s*4|৪\s*ফুট\s*৪/i.test(t)) {
        return `${greeting}আপনার উচ্চতা অনুযায়ী (৪ ফুট ৪ ইঞ্চি) আমাদের রেগুলার ঝুল কিছুটা বড় হতে পারে। তবে আপনি চাইলে ৪৪ বা ৪৬ সাইজে বিশেষ কাস্টমাইজ করে দেওয়া যাবে।`;
      }
      if (/5\s*(?:fut|ফুট|ft)\s*8|৫\s*ফুট\s*৮|হিল/i.test(t)) {
        return `${greeting}৫ ফুট ৮ ইঞ্চি উচ্চতা এবং হিল পরার ক্ষেত্রে আপনার জন্য ৫৬ বা স্পেশাল ৫৮ ইঞ্চি সাইজটি একদম মানানসই হবে।`;
      }
      if (/5\s*(?:fut|ফুট|ft)\s*5|৫\s*ফুট\s*৫|5\s*fut\s*5/i.test(t)) {
        return `${greeting}৫ ফুট ৫ ইঞ্চি উচ্চতার জন্য ৫৪ ইঞ্চি সাইজটি পারফেক্ট ঝুল হবে।`;
      }
      if (/5\s*(?:fut|ফুট|ft)\s*[23]|৫\s*ফুট\s*[২৩]|5['’]3/i.test(t)) {
        return `${greeting}৫ ফুট ৩ ইঞ্চি উচ্চতার জন্য ৫২ ইঞ্চি সাইজটি একদম পারফেক্ট ঝুল হবে।`;
      }
      return `${greeting}সাধারণত ৫ ফুট থেকে ৫ ফুট ১ ইঞ্চি হলে ৫০ সাইজ, ৫ ফুট ২ থেকে ৫ ফুট ৩ হলে ৫২ সাইজ, ৫ ফুট ৪ থেকে ৫ ফুট ৫ হলে ৫৪ সাইজ এবং ৫ ফুট ৬ বা তার বেশি হলে ৫৬ সাইজ পারফেক্ট হয়।`;
    }
    if (mentionsSizeConfused) {
      return `${greeting}আপনার উচ্চতা কত ফিট কত ইঞ্চি জানালে আমি সঠিক ঝুল সাইজটি বলে দিচ্ছি। (সাধারণত ৫'০"-৫'১" হলে ৫০ সাইজ, ৫'২"-৫'৩" হলে ৫২ সাইজ, ৫'৪"-৫'৫" হলে ৫৪ সাইজ এবং ৫'৬"-৫'৮" হলে ৫৬ সাইজ পারফেক্ট ঝুল হয়)।`;
    }
    if (asksAvailableSizes) {
      return `${greeting}আমাদের এই পোশাকে ৫০, ৫২, ৫৪ এবং ৫৬ সাইজ ইন-স্টকে এভেইলবল আছে। আপনার কোন সাইজের ঝুলটি লাগবে?`;
    }
  }

  // 3. Payment submission verification (Checked FIRST to avoid being swallowed by delivery keywords)
  if (/(?:পাঠিয়ে\s*দিয়েছি|পাঠালাম|সেন্ড\s*করলাম|দিলাম|paid|sent)/i.test(t) && /(?:বিকাশ|নগদ|টাকা|চার্জ|ডিজিট|লাস্ট)/i.test(t)) {
    return `${greeting}আপনার পেমেন্টের তথ্যটি গ্রহণ করা হয়েছে। আমাদের অ্যাকাউন্ট ম্যানেজার খুব দ্রুত ভেরিফাই করে আপনার অর্ডারটি কনফার্ম করছেন।`;
  }

  // 4. Free delivery demand
  if (/(?:ফ্রি|free)/i.test(t) && /ডেলিভারি/i.test(t)) {
    return `${greeting}ডেলিভারি চার্জ আসলে আমাদের কুরিয়ার সার্ভিসের বুকিং ফি, তাই ডেলিভারি চার্জ ফ্রি করার সুযোগ নেই। তবে প্রোডাক্টের মূল টাকা আপনি ক্যাশ অন ডেলিভারিতে চেক করে দিতে পারবেন।`;
  }

  // 4b. Discount / promo
  if (/ডিসকাউন্ট|অফার|অফারে|ছাড়|offer|discount/i.test(t)) {
    return `${greeting}আমাদের প্রতিটি পোশাকের মূল্য একদম ফিক্সড ও পাইকারি রেটে রাখা হয়েছে। তবে যেকোনো বোরকা বা আবায়ার সাথে একটি আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব উপহার হিসেবে সম্পূর্ণ ফ্রি পাচ্ছেন!`;
  }

  // 4c. Delivery timeline and fee
  if (/(?:কয়দিনে|কবে|সময়|timeline)/i.test(t) || (/(?:চার্জ|কত|ঢাকার\s*বাইরে)/i.test(t) && /ডেলিভারি/i.test(t))) {
    return `${greeting}ঢাকার ভেতরে ২৪ থেকে ৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ২ থেকে ৩ দিনের মধ্যে ডেলিভারি সম্পন্ন হয়। ডেলিভারি চার্জ ঢাকায় ৳${insideFee} টাকা, ঢাকার বাইরে ৳${outsideFee} টাকা।`;
  }

  // 5. 2-piece combo / multiple items
  if (/২\s*পিস|2\s*piece|দুটো|দুইটা|একাধিক|ছাড়/i.test(t) && /নিলে|অর্ডার/i.test(t)) {
    return `${greeting}একাধিক ড্রেস অর্ডার করলে সবগুলো একই পার্সেলে বুকিং করা হবে, ফলে আলাদা কোনো বাড়তি ডেলিভারি চার্জ লাগবে না—এক চার্জেই সব পেয়ে যাবেন! সাথে ম্যাচিং হিজাব সম্পূর্ণ উপহার হিসেবে থাকছে।`;
  }

  // 6. Open parcel check
  if (/খুলে|চেক|দেখে|open\s*parcel/i.test(t)) {
    return `${greeting}জি অবশ্যই! পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে-শুনে চেক করে নিতে পারবেন। পছন্দ না হলে সাথে সাথে রিটার্ন করতে পারবেন।`;
  }

  // 7. Fabric transparency
  if (/পাতলা|ট্রান্সপারেন্ট|নন-ট্রান্সপারেন্ট|কাপড়|কাপড়|fabric/i.test(t) && /পাতলা|শালীন/i.test(t)) {
    return `${greeting}আমাদের কাপড়গুলো মোটেও পাতলা নয়। এগুলো ১০০% প্রিমিয়াম অরিজিনাল দুবাই চেরি কাপড় দিয়ে নিখুঁত ফিনিশিংয়ে তৈরি, যা সম্পূর্ণ শালীন ও নন-ট্রান্সপারেন্ট।`;
  }

  // 8. Asking for all catalog
  if (isAskingForAllCatalog(t, session?.messages)) {
    return `${greeting}আমাদের স্টকে থাকা রানিং কালেকশনের সবগুলোর মূল ছবি নিচে দেওয়া হলো [SEND_CATALOG_OVERVIEW]। আপনার যে মডেলটি পছন্দ হয়, সেটির নাম বা নম্বর জানালেই সেটির বাকি সব ছবি ও বিস্তারিত দিয়ে দেব।`;
  }

  // 9. Initial catalog browse
  if (isAskingForCatalogOverview(t)) {
    return `${greeting}আমাদের রানিং কালেকশনের মূল ডিজাইনটি উপরে দেওয়া হলো [SEND_IMAGE:DF-101]। আপনি কি স্টকের সব কয়টি ডিজাইন দেখতে চাচ্ছেন, নাকি আপনার নির্দিষ্ট কোনো পছন্দ আছে বলুন তো?`;
  }

  // 10. Detected Model inquiries
  const detectedModel = detectModelFromText(t) || (session?.imagesSentForModels && session.imagesSentForModels.length > 0 ? session.imagesSentForModels[session.imagesSentForModels.length - 1] : null);
  if (detectedModel) {
    const prod = getProductByCode(detectedModel);
    const prodName = prod ? prod.name : detectedModel;
    const price = prod ? prod.price : 2200;
    const fabric = prod?.fabric || 'প্রিমিয়াম দুবাই চেরি কাপড়';
    const sizes = prod?.sizes || '৫০, ৫২, ৫৪, ৫৬';

    if (!prod || prod.in_stock === false || (prod.stock_quantity !== null && prod.stock_quantity <= 0)) {
      return `${greeting}${detectedModel} মডেলটি বর্তমানে আমাদের স্টকে নেই [স্টক আউট]। তবে আপনি চাইলে স্টকে থাকা কাছাকাছি অন্য মডেল সাজেস্ট করতে পারি।`;
    }

    if (isAskingForPriceOrDetails(t)) {
      return `${greeting}${prodName} (${detectedModel}) এর ফিক্সড মূল্য মাত্র ৳${price} টাকা। এর ফেব্রিক ${fabric}, সাইজ ${sizes}। সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব উপহার হিসেবে সম্পূর্ণ ফ্রি পাচ্ছেন এবং ডেলিভারি চার্জ ঢাকায় ৳${insideFee}, বাইরে ৳${outsideFee}। পার্সেল খুলে চেক করে নেওয়ার সুবিধা আছে।`;
    }
    return `${greeting}${prodName} (${detectedModel}) এর চমৎকার ছবিগুলো পাঠিয়ে দিচ্ছি [SEND_ALL_IMAGES:${detectedModel}]। দেখে জানান কেমন লাগছে।`;
  }

  // 11. Follow-up order retention
  if (session && session.imagesSentForModels && session.imagesSentForModels.length > 0) {
    const lastModel = session.imagesSentForModels[session.imagesSentForModels.length - 1];
    if (/অর্ডার|নিতে চাই|কনফার্ম|বিকাশ|ঠিকানা/i.test(t)) {
      const prod = getProductByCode(lastModel);
      const price = prod ? prod.price : 2200;
      return `${greeting}আপনার পছন্দের ${lastModel} মডেলটি অর্ডার কনফার্ম করতে আপনার নাম, সম্পূর্ণ ডেলিভারির ঠিকানা এবং সাইজটি জানিয়ে দিন। ডেলিভারি চার্জ ঢাকায় ৳${insideFee}, বাইরে ৳${outsideFee}।`;
    }
  }

  // Default welcome
  return `${greeting}বলুন কীভাবে সাহায্য করতে পারি? আমাদের রানিং কালেকশন দেখতে চাইলে বলুন, অথবা নির্দিষ্ট কোনো সাইজ বা মডেল নিয়ে জানতে চাইলে এখনই বিস্তারিত জানাচ্ছি।`;
}

// ==========================================
// 7. Order Lead & Customer Context Extractor
// ==========================================

async function extractAndSaveOrderLead(senderPhone, fullText, conversationHistory, session, explicitSellerId = null) {
  if (!supabase || !senderPhone || senderPhone.startsWith('unit_user_')) return;
  const activeSellerId = explicitSellerId || 'autodokan_seller_1';
  const botPersona = sellerSettingsCache.get(activeSellerId)?.bot_persona_name || 'Zara';
  const confirmedNote = `Confirmed by WhatsApp AI (${botPersona})`;

  // Save 50% API Quota: ONLY call LLM extraction when strong lead indicators exist
  const hasPhone = /(?:01[3-9]\d{8}|০১[৩-৯][০-৯]{8})/i.test(fullText);
  const hasTrxOrPay = /(?:trx|trxid|transaction|ট্রানজেকশন|লাস্ট|ডিজিট|digit|বিকাশ|নগদ|paid|সেন্ড\s*মানি|পাঠিয়েছি|পাঠালাম)/i.test(fullText);
  const hasAddressOrConfirm = /(?:বাসা|রোড|থানা|জেলা|গ্রাম|অর্ডার\s*কনফার্ম|order\s*confirm|ঠিকানা|address|road|house|thana|zila|gram)/i.test(fullText);

  if (!hasPhone && !hasTrxOrPay && !hasAddressOrConfirm) {
    return; // Routine browsing/queries skip AI extraction completely
  }

  try {
    const recentMessages = conversationHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
    const extractPrompt = `
You are an expert Bangladeshi e-commerce data extraction specialist.
Extract order details and customer personal notes from this conversation into strict JSON:
${recentMessages}

JSON Format:
{
  "is_order_or_lead": true,
  "model_code": "DF-101" or string or null,
  "customer_name": string or null,
  "customer_phone": string or null,
  "address": string or null,
  "product_name": string or null,
  "length_size": string or null,
  "total_bdt": number or null,
  "delivery_fee": 80 or 150 or null,
  "advance_paid": number or null,
  "due_cod": number or null,
  "payment_method": "COD" or null,
  "trx_id_or_last4": string or null,
  "customer_notes": "Short customer context like height, preference, gift recipient" or null
}
`;

    let rawJson = null;
    const activeExtractGeminiKey = getGeminiApiKey();
    if (activeExtractGeminiKey) {
      try {
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${activeExtractGeminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: 'Output strictly valid JSON only.' }] },
            contents: [{ role: 'user', parts: [{ text: extractPrompt }] }],
            generationConfig: { response_mime_type: 'application/json' }
          })
        });
        if (geminiRes.ok) {
          const gData = await geminiRes.json();
          rawJson = (gData.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
        }
      } catch (e) {}
    }

    if (!rawJson && groqClients.length > 0) {
      for (const m of ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
        try {
          const completion = await groqClients[0].chat.completions.create({
            model: m,
            messages: [{ role: 'user', content: extractPrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.05,
            max_tokens: 400
          });
          rawJson = completion.choices[0]?.message?.content;
          if (rawJson) break;
        } catch (e) {}
      }
    }

    const parsed = JSON.parse(rawJson || '{}');
    if (parsed.is_order_or_lead && (parsed.customer_phone || parsed.address || (parsed.product_name && parsed.length_size))) {
      // Validate 11-digit Bangladeshi mobile number (handles +88, copy-paste, spaces, Bangla digits)
      const extractedPhone = parsed.customer_phone || senderPhone || '';
      const validBdPhone = normalizeBdPhone(extractedPhone);

      // Validate meaningful address
      const addrRes = validateBdAddress(parsed.address);
      const isMeaningfulAddress = addrRes.valid;
      const cleanAddress = addrRes.clean || (parsed.address || '').trim();

      // STRICT ORDER GUARD: BOTH a verified 11-digit BD mobile phone AND a meaningful address are MANDATORY before creating an order lead!
      if (!validBdPhone || !isMeaningfulAddress) {
        if (parsed.customer_notes && session) session.customer_notes = parsed.customer_notes;
        if (parsed.customer_name && session) session.customer_name = parsed.customer_name;
        return;
      }
      const targetPhone = validBdPhone;

      const sSettings = sellerSettingsCache.get(activeSellerId) || storeSettings;
      const insideFee = Number(sSettings.inside_dhaka_fee) || 80;
      const outsideFee = Number(sSettings.outside_dhaka_fee) || 150;
      const isOutsideDhaka = rawAddr && !/(ঢাকা|dhaka|মিরপুর|উত্তরা|গুলশান|বনানী|ধানমন্ডি|মোহাম্মদপুর|বসুন্ধরা|যাত্রাবাড়ী|মতিঝিল|বাড্ডা|খিলগাঁও|মহাখালী|তেজগাঁও|ফার্মগেট|আজিমপুর|পুরান ঢাকা)/i.test(rawAddr);
      const deliveryFee = parsed.delivery_fee || (isOutsideDhaka ? outsideFee : insideFee);

      const detectedCode = parsed.model_code || detectModelFromText(fullText, activeSellerId) || (conversationHistory ? detectModelFromText(conversationHistory.map(m => m.content).join(' '), activeSellerId) : null);
      const matchedProd = getProductByCode(detectedCode, activeSellerId);
      const prodPrice = matchedProd ? matchedProd.price : (Number(parsed.total_bdt) || (matchedProd ? matchedProd.price : 0));
      const advancePaid = parsed.advance_paid !== undefined && parsed.advance_paid !== null ? parsed.advance_paid : (parsed.trx_id_or_last4 ? deliveryFee : 0);
      const dueCod = prodPrice > 0 ? (prodPrice - (advancePaid > deliveryFee ? (advancePaid - deliveryFee) : 0)) : prodPrice;

      if (parsed.customer_notes && session) {
        session.customer_notes = parsed.customer_notes;
      }
      if (parsed.customer_name && session) {
        session.customer_name = parsed.customer_name;
      }
      if (session) {
        if (isMeaningfulAddress && validBdPhone && (detectedCode || session.lastViewedModel)) {
          session.stage = 'CONFIRMING_ORDER';
        } else if (detectedCode || session.lastViewedModel) {
          session.stage = 'DISCUSSING_PRODUCT';
        } else {
          session.stage = 'BROWSING';
        }
      }

      // Resolve Product Name with 3-tier fallback scoped strictly to active seller
      let resolvedProductName = null;
      if (parsed.product_name && parsed.product_name.length > 2 && !/(?:রোড|বাসা|থানা|জেলা|মিরপুর|উত্তরা|ধানমন্ডি|বিকাশ|নগদ)/i.test(parsed.product_name)) {
        resolvedProductName = parsed.product_name.trim();
      } else if (matchedProd && matchedProd.name) {
        resolvedProductName = matchedProd.name;
      } else if (session?.lastViewedModel) {
        const lastProd = getProductByCode(session.lastViewedModel, activeSellerId);
        if (lastProd && lastProd.name) resolvedProductName = lastProd.name;
      }

      if (!resolvedProductName) {
        const sProds = sellerProductsCache.get(activeSellerId) || [];
        if (Array.isArray(sProds) && sProds.length > 0) {
          resolvedProductName = sProds[0].name;
        } else {
          resolvedProductName = 'সিলেক্টেড আইটেম';
        }
      }

      // Resolve Size with 2-tier fallback
      let resolvedSize = parsed.length_size || null;
      if (!resolvedSize) {
        const sizeMatch = fullText.match(/\b(50|52|54|56|39|40|41|42|43|44)\b/i) || fullText.match(/\b(M|L|XL|XXL)\b/i);
        if (sizeMatch) resolvedSize = sizeMatch[1];
      }

      const safeProductDetails = `${resolvedProductName} (Size: ${resolvedSize || 'Standard'})`;

      // Check existing order in orders table strictly scoped to this seller
      const { data: existing } = await supabase
        .from('orders')
        .select('id, status, model_code, customer_name, address, product_details, length_size')
        .eq('seller_id', activeSellerId)
        .eq('customer_phone', targetPhone)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const shouldSanitizeDetails = !existing.product_details || /(?:রোড|বাসা|থানা|জেলা|মিরপুর|উত্তরা|ধানমন্ডি|বিকাশ|নগদ)/i.test(existing.product_details);
        await supabase.from('orders').update({
          seller_id: activeSellerId,
          source_channel: 'WHATSAPP',
          order_notes: confirmedNote,
          model_code: detectedCode || existing.model_code,
          customer_name: parsed.customer_name || existing.customer_name,
          address: cleanAddress || existing.address,
          product_details: shouldSanitizeDetails ? safeProductDetails : (parsed.product_name ? safeProductDetails : existing.product_details),
          length_size: resolvedSize || existing.length_size,
          total_bdt: prodPrice,
          delivery_fee: deliveryFee,
          advance_paid: advancePaid,
          due_cod: dueCod,
          payment_method: parsed.payment_method || 'COD',
          trx_id_or_last4: parsed.trx_id_or_last4 || null
        }).eq('id', existing.id);
      } else {
        await supabase.from('orders').insert({
          seller_id: activeSellerId,
          source_channel: 'WHATSAPP',
          order_notes: confirmedNote,
          customer_phone: targetPhone,
          model_code: detectedCode || null,
          customer_name: parsed.customer_name || null,
          address: cleanAddress || null,
          product_details: safeProductDetails,
          length_size: resolvedSize,
          total_bdt: prodPrice,
          delivery_fee: deliveryFee,
          advance_paid: advancePaid,
          due_cod: dueCod,
          payment_method: parsed.payment_method || 'COD',
          trx_id_or_last4: parsed.trx_id_or_last4 || null,
          status: 'Pending'
        });
      }
    }
  } catch (err) {
    console.warn('[Order Extraction Error]:', err.message);
  }
}

// ==========================================
// 8. Main Message Orchestrator
// ==========================================

async function handleIncomingMessage(senderId, userText, explicitSellerId = null) {
  const sellerId = explicitSellerId || 'autodokan_seller_1';
  if (!sellerSettingsCache.has(sellerId) || !sellerProductsCache.has(sellerId)) {
    await refreshProductsFromDB(sellerId);
  }
  const session = await getCustomerSession(sellerId, 'WHATSAPP', senderId);

  // 1. Auto Human-Alert Escalation Check (Only flags dashboard, bot remains active!)
  const isComplaint = typeof isAngryComplaint === 'function' && isAngryComplaint(userText);
  const isAgentReq = typeof isAgentRequest === 'function' && isAgentRequest(userText);
  if ((isComplaint || isAgentReq) && supabase && senderId && !senderId.startsWith('unit_user_')) {
    const attentionReason = isAgentReq ? 'HUMAN_AGENT_REQUESTED' : 'CUSTOMER_COMPLAINT';
    supabase.from('chat_sessions').update({
      needs_human_attention: true,
      attention_reason: attentionReason
    }).eq('seller_id', sellerId).eq('customer_identifier', senderId).catch(() => {});
  }

  // 2. Live Order Status Lookup by Phone (Passed to AI context, never hardcoded bypass)
  let latestOrder = null;
  let recentOrderText = '';
  const rawDigits = (senderId || '').replace(/\D/g, '');
  if (supabase && rawDigits) {
    const clean11 = rawDigits.length >= 11 ? rawDigits.slice(-11) : rawDigits;
    try {
      const { data: ord } = await supabase
        .from('orders')
        .select('id, model_code, customer_name, status, courier_name, courier_tracking_id, due_cod, total_bdt, created_at')
        .eq('seller_id', sellerId)
        .or(`customer_phone.eq.${clean11},customer_phone.eq.880${clean11.slice(1)},customer_phone.eq.+880${clean11.slice(1)}`)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ord) {
        latestOrder = ord;
        recentOrderText = `অর্ডার #${ord.id} | মডেল: ${ord.model_code || 'পোশাক'} | স্ট্যাটাস: ${ord.status} | কুরিয়ার: ${ord.courier_name || 'Steadfast'} | ট্র্যাকিং: ${ord.courier_tracking_id || 'প্রসেসিং'} | COD বকেয়া: ৳${ord.due_cod || ord.total_bdt || 2200} টাকা`;
      }
    } catch (ordErr) {}
  }

  // 3. Payment Verification Regex (Save/update order lead + NO PAUSE + transparent verification message)
  if (/(?:পাঠিয়ে\s*দিয়েছি|পাঠালাম|সেন্ড\s*করলাম|দিলাম|paid|sent)/i.test(userText) && /(?:বিকাশ|নগদ|টাকা|চার্জ|ডিজিট|লাস্ট|trx|trxid)/i.test(userText)) {
    extractAndSaveOrderLead(senderId, userText, session.messages, session, sellerId);
    if (supabase && senderId && !senderId.startsWith('unit_user_')) {
      supabase.from('chat_sessions').update({
        needs_human_attention: true,
        attention_reason: 'PAYMENT_VERIFICATION_SUBMITTED'
      }).eq('seller_id', sellerId).eq('customer_identifier', senderId).catch(() => {});
    }
  }

  const isFirstMessage = session.messages.length === 0;

  // Add customer message to session history
  session.messages.push({
    role: 'user',
    content: userText,
    timestamp: Date.now()
  });

  // Extract order/lead in background
  extractAndSaveOrderLead(senderId, userText, session.messages, session, sellerId);

  // Build Context-Aware Real-Human Prompt with Dynamic Playbook & Live Order Data
  const systemPrompt = buildSystemPrompt(isFirstMessage, session, recentOrderText, userText, sellerId);

  // Conversational message history for LLM (trimmed to last 14 turns)
  const chatHistory = session.messages.slice(-14).map(m => ({
    role: m.role,
    content: m.content
  }));

  // Hybrid Router
  const complexity = classifyMessageComplexity(userText, session.messages.length);
  console.log(`[AI Pipeline] Route: ${complexity} | Sender: ${senderId} | Seller: ${sellerId}`);

  // Call Primary Gemini (#1) or Secondary Groq (#2)
  let aiReply = null;
  const activePipelineGeminiKey = getGeminiApiKey();
  if (activePipelineGeminiKey) {
    aiReply = await callGeminiEngine(chatHistory, systemPrompt, complexity);
  }
  if (!aiReply && groqClients.length > 0) {
    console.log('[AI Pipeline] Groq failover calling...');
    aiReply = await callGroqEngine(chatHistory, systemPrompt);
  }
  if (!aiReply) {
    console.log('[AI Pipeline] LLM engines offline or cooling down, generating smart fallback...');
    aiReply = generateSmartFallback(userText, isFirstMessage, session, latestOrder, sellerId);
  }

  // Strip banned corporate phrases
  aiReply = aiReply
    .replace(/[•●▪*]/g, '')
    .replace(/[-–—]{2,}/g, ' ')
    .replace(/[🌸😊🌺🌹]/g, '')
    .replace(/(?:ভাইয়া|আপু|ভাইয়া|ভাই|স্যার|ম্যাম)/gi, '')
    .replace(/ধন্যবাদ\s*আপনার\s*মতামতের\s*জন্য[।.]?/gi, '')
    .replace(/আপনার\s*বার্তার\s*জন্য\s*ধন্যবাদ[।.]?/gi, '')
    .trim();

  // Truncation & Quality Guard (Eliminates broken fragments like 'ডিএফ', 'স্বাগ', etc.)
  const isTruncatedFragment = !aiReply || aiReply.length < 15 || (/^(?:ডিএফ|স্বাগ|ঢাকার|আমাদের|জি|হ্যালো)$/i.test(aiReply.trim())) || (!/[.!?।…]$/.test(aiReply.trim()) && aiReply.length < 35);
  if (isTruncatedFragment) {
    console.warn(`[AI Guard] AI output was truncated or incomplete ('${aiReply}'). Applying robust smart fallback...`);
    aiReply = generateSmartFallback(userText, isFirstMessage, session, latestOrder, sellerId);
  }

  // Smart Dynamic Photo Safety:
  // ONLY if AI text explicitly says it is sending a photo right now
  // AND forgot to include a [SEND_...] tag, attach the currently discussed product's tag
  // (or [SEND_CATALOG_OVERVIEW] if no specific model is in context) — NEVER hardcode DF-101.
  const hasAnyImageTag = /\[\s*SEND_[A-Z_]+[^\]]*\]/i.test(aiReply);
  const promisesPhotoInReply = /(?:ছবি\s*(?:পাঠাচ্ছি|দিচ্ছি|পাঠালাম|দিলাম|পাঠিয়েছি|দিয়েছি|দেখুন)|পিক\s*(?:পাঠাচ্ছি|দিচ্ছি)|ছবিগুলো\s*দেখুন)/i.test(aiReply);

  const detectedModelInUser = detectModelFromText(userText);
  const detectedModelInReply = detectModelFromText(aiReply);
  const activeModel = detectedModelInUser || detectedModelInReply || session.imagesSentForModels[session.imagesSentForModels.length - 1];

  if (!hasAnyImageTag) {
    if (promisesPhotoInReply) {
      if (activeModel) {
        aiReply += ` [SEND_ALL_IMAGES:${activeModel}]`;
      } else if (isAskingForCatalogOverview(userText) || /কালেকশন|বোরকা|জুতা|ডিজাইন|সব|ছবি|পিক|chobi|pic|poc/i.test(userText)) {
        aiReply += ' [SEND_CATALOG_OVERVIEW]';
      }
    } else if (isAskingForImage(userText)) {
      if (activeModel) {
        aiReply += ` [SEND_ALL_IMAGES:${activeModel}]`;
      } else if (isAskingForCatalogOverview(userText) || /কালেকশন|বোরকা|জুতা|ডিজাইন|সব|ছবি|পিক|chobi|pic|poc/i.test(userText)) {
        aiReply += ' [SEND_CATALOG_OVERVIEW]';
      }
    }
  }

  // Update session state
  if (aiReply.includes('আসসালামু') || aiReply.includes('স্বাগতম')) {
    session.hasGreeted = true;
  }
  if (aiReply.includes('[SEND_CATALOG_OVERVIEW]')) {
    session.catalogSent = true;
  }
  if (activeModel && !session.imagesSentForModels.includes(activeModel)) {
    session.imagesSentForModels.push(activeModel);
  }

  // Bulletproof Salam Guardrail:
  // If customer did NOT say Salam, bot must NEVER start or reply with "ওয়ালাইকুম আসসালাম" / "ওয়ালাইকুমুস সালাম"!
  const customerGaveSalam = /(?:সালাম|salam|alaikum|আলাইকুম|slm)/i.test(userText);
  if (!customerGaveSalam) {
    aiReply = aiReply.replace(/^(?:ওয়ালাইকুম(?:ুস|\s*আস)?\s*সালাম[।,!\s]*)+/i, 'জি, ');
    aiReply = aiReply.replace(/ওয়ালাইকুম(?:ুস|\s*আস)?\s*সালাম[।,!]*/gi, '');
  } else if (!session.hasGreeted && !/(?:ওয়ালাইকুম|ওয়ালাইকুম)/i.test(aiReply)) {
    aiReply = 'ওয়ালাইকুম আসসালাম! ' + aiReply.replace(/^(?:জি[।,!\s]*)+/, '');
  }

  // Apply Section 1 Clean Human Formatting Sanitizer
  aiReply = cleanHumanFormatting(aiReply);

  // Defensive Anti-Truncation Polish
  const curShop = (sellerSettingsCache.get(sellerId) || storeSettings).shop_name || 'আমাদের শপ';
  if (aiReply.trim() === 'স্বাগ' || aiReply.trim() === 'স্বাগতম') {
    aiReply = `${curShop}-এ স্বাগতম! আমাদের নতুন কালেকশন দেখতে পারেন।`;
  } else if (aiReply.endsWith('আমাদের কা')) {
    aiReply += 'লেকশন দেখতে পারেন।';
  } else if (aiReply.trim() === 'ডিএফ') {
    aiReply = 'জি, ডিএফ কালেকশনের কোন মডেলটি দেখতে চাচ্ছেন বলুন।';
  }

  // Save clean AI response to session (never store send tags in history)
  session.messages.push({
    role: 'assistant',
    content: aiReply.replace(/\[\s*SEND_[A-Za-z0-9_:\s-]+\s*\]/gi, '').trim(),
    timestamp: Date.now()
  });

  // Asynchronously persist session to Supabase
  saveCustomerSession(sellerId, 'WHATSAPP', senderId, session);

  return aiReply;
}

// Deprecated stub for backward compatibility
function getFastPathReply() {
  return null;
}

module.exports = {
  handleIncomingMessage,
  refreshProductsFromDB,
  refreshSettingsFromDB,
  getStoreSettings: (sellerId = 'autodokan_seller_1') => sellerSettingsCache.get(sellerId) || storeSettings,
  getProductByCode,
  getAllCachedProducts: (sellerId = 'autodokan_seller_1') => sellerProductsCache.get(sellerId) || cachedProductList,
  getProductImageUrls,
  getProductColors,
  extractAndSaveOrderLead,
  getFastPathReply,
  isGibberishOrAccidental,
  isGoodbyeIntent,
  isAngryComplaint,
  isAgentRequest,
  isOrderStatusInquiry,
  isAbusiveOrFrustrated,
  isInsultOrTrolling,
  classifyMessageComplexity,
  transcribeAudioWithGroq,
  transcribeAudioWithGemini,
  cleanHumanFormatting,
  buildSystemPrompt,
  normalizeBdPhone,
  validateBdAddress,
  getDynamicPlaybookGuidance
};
