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
// 2. Dynamic Store Settings, Catalog & Memory Cache
// ==========================================

let storeSettings = {
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
const sessionCache = new Map(); // customerIdentifier -> sessionState

async function refreshSettingsFromDB(sellerId = 'autodokan_seller_1') {
  if (!supabase) return storeSettings;
  try {
    const { data, error } = await supabase
      .from('store_settings')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (!error && data) {
      storeSettings = {
        ...storeSettings,
        ...data,
        inside_dhaka_fee: Number(data.inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(data.outside_dhaka_fee) || 150
      };
      console.log(`[Store Settings Loaded] Shop: ${storeSettings.shop_name} | Inside: ৳${storeSettings.inside_dhaka_fee} | Outside: ৳${storeSettings.outside_dhaka_fee} | Promo: ${storeSettings.promo_offer || 'None'}`);
    }
  } catch (err) {
    console.warn('[Store Settings Refresh Error]:', err.message);
  }
  return storeSettings;
}

async function refreshProductsFromDB(sellerId = 'autodokan_seller_1') {
  await refreshSettingsFromDB(sellerId);
  if (!supabase) return cachedProductList;
  try {
    // 1. Fetch ALL products for seller (both in_stock = true AND in_stock = false)
    const { data: prods, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', sellerId)
      .order('model_code', { ascending: true })
      .order('id', { ascending: true });

    if (!prodErr && prods && prods.length > 0) {
      cachedProductList = prods;
      cachedProductsText = prods.map((p, idx) => {
        const code = p.model_code || `DF-${100 + idx + 1}`;
        const price = p.price || 2200;
        const details = [
          p.fabric ? `ফেব্রিক: ${p.fabric}` : '',
          p.sizes ? `সাইজ: ${p.sizes}` : '',
          p.hijab_included ? 'হিজাব ফ্রি' : ''
        ].filter(Boolean).join(', ');
        const stock = p.in_stock === false ? 'স্টক আউট' : 'স্টকে আছে';
        return `${idx + 1}. [${code}] ${p.name} | ৳${price} | ${stock} (${details})`;
      }).join('\n');

      console.log(`[Products Sync] Loaded ${prods.length} products for ${sellerId}`);
    }

    // 2. Fetch Active Promotions
    try {
      const { data: promos } = await supabase
        .from('promotions')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('is_active', true);

      if (promos && promos.length > 0) {
        cachedPromotionsText = promos.map(pr => 
          `• [অফার: ${pr.title}] কোড: ${pr.promo_code || 'N/A'}, ছাড়: ৳${pr.discount_value}, নির্দেশনা: ${pr.ai_instruction}`
        ).join('\n');
      } else if (storeSettings.promo_offer) {
        cachedPromotionsText = `• [চলমান স্টোর অফার]: ${storeSettings.promo_offer}`;
      } else {
        cachedPromotionsText = 'বর্তমানে কোনো অতিরিক্ত ডিসকাউন্ট বা প্রোমো কোড অফার সক্রিয় নেই।';
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

// Initial Sync
refreshProductsFromDB('autodokan_seller_1');
setInterval(() => refreshProductsFromDB('autodokan_seller_1'), 60 * 1000);

// ==========================================
// 3. Persistent Two-Tier Memory Helpers
// ==========================================

async function getCustomerSession(sellerId = 'autodokan_seller_1', channelType = 'WHATSAPP', customerId) {
  if (sessionCache.has(customerId)) {
    return sessionCache.get(customerId);
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
    sessionCache.set(customerId, defaultSession);
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
        const matches = m.content.match(/DF-\d{3}/gi);
        if (matches) matches.forEach(c => sentModels.push(c.toUpperCase()));
      });

      const loadedSession = {
        messages: msgs,
        stage: data.stage || 'BROWSING',
        customer_notes: data.customer_notes || '',
        customer_name: data.customer_name || null,
        hasGreeted: hasGreeted,
        imagesSentForModels: Array.from(new Set(sentModels)),
        deliveryFeeMentioned: msgs.some(m => m.role === 'assistant' && (m.content.includes('ডেলিভারি চার্জ') || m.content.includes('৮০') || m.content.includes('১৫০')))
      };
      sessionCache.set(customerId, loadedSession);
      return loadedSession;
    }
  } catch (err) {
    console.warn('[Session Fetch Error]:', err.message);
  }

  sessionCache.set(customerId, defaultSession);
  return defaultSession;
}

async function saveCustomerSession(sellerId = 'autodokan_seller_1', channelType = 'WHATSAPP', customerId, session) {
  sessionCache.set(customerId, session);
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
  s = s.replace(/(?:আজ\s*)?কীভাবে\s*(?:সাহায্য|সহায়তা)\s*করতে\s*পারি[?।]*/gi, '');
  s = s.replace(/ধন্যবাদ\s*আপনার\s*মতামতের\s*জন্য[।.]*/gi, '');

  // 7. Strip accidental "আরে ভাই", "আরে না ভাই", "ভাইয়া", "আপু", etc.
  s = s.replace(/(?:আরে\s*না\s*ভাই|আরে\s*ভাই)/gi, 'জি');
  s = s.replace(/(?:ভাইয়া|আপু|ভাইয়া|আপুনি|ভাই|স্যার|ম্যাম)/gi, '');

  // 8. Clean repetitive punctuation & clean up commas
  s = s.replace(/,\s*,+/g, ',');
  s = s.replace(/,\s*([।!?\n])/g, '$1');
  s = s.replace(/^[,\s]+/g, '');
  s = s.replace(/[ \t]{2,}/g, ' ');

  // 9. Extra empty lines: max 1 blank line between blocks
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function detectModelFromText(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return null;

  // 1. Direct Model Code Matching (e.g. "DF-101", "DF 102", "df103")
  const directMatch = t.match(/\bdf[ -]?(\d{3})\b/i);
  if (directMatch) {
    return `DF-${directMatch[1]}`;
  }

  // 2. Ordinal Banglish / Bengali numbers & Word numbers
  if (/^(?:১|1)$|(?:^|[^\d০-৯])(?:১|1)\s*(?:নং|নম্বর|নাম্বার|টা|টি|ম\b|st\b|প্রথম)|এক\s*নম্বর/i.test(t)) return 'DF-101';
  if (/^(?:২|2)$|(?:^|[^\d০-৯])(?:২|2)\s*(?:নং|নম্বর|নাম্বার|টা|টি|য়\b|nd\b|দ্বিতীয়|দিতিয়)|দুই\s*নম্বর/i.test(t)) return 'DF-102';
  if (/^(?:৩|3)$|(?:^|[^\d০-৯])(?:৩|3)\s*(?:নং|নম্বর|নাম্বার|টা|টি|য়া\b|rd\b|তৃতীয়|তিতিও)|তিন\s*নম্বর/i.test(t)) return 'DF-103';
  if (/^(?:৪|4)$|(?:^|[^\d০-৯])(?:৪|4)\s*(?:নং|নম্বর|নাম্বার|টা|টি|র্থ\b|th\b|চতুর্থ)|চার\s*নম্বর/i.test(t)) return 'DF-104';
  if (/^(?:৫|5)$|(?:^|[^\d০-৯])(?:৫|5)\s*(?:নং|নম্বর|নাম্বার|টা|টি|ম\b|th\b|পঞ্চম)|পাঁচ\s*নম্বর/i.test(t)) return 'DF-105';

  // 3. Name / Style Keywords
  if (/৩-পিস|কারচুপি\s*কোটি|কটি\s*আবায়া|কোটি\s*সেট/i.test(t)) return 'DF-101';
  if (/রানি\s*আবায়া|রানী\s*আবায়া|কাটওয়ার্ক|rani/i.test(t)) return 'DF-102';
  if (/কাফতান|front\s*open|ফ্রন্ট\s*ওপেন/i.test(t)) return 'DF-103';
  if (/এ-লাইন|ক্যাজুয়াল|daily\s*wear|a-line|aline|কম\s*দামের|কম\s*দামেরটা|সবচেয়ে\s*কম/i.test(t)) return 'DF-104';
  if (/বাটারফ্লাই|পার্টি\s*বোরকা|butterfly/i.test(t)) return 'DF-105';

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

function getProductByCode(code) {
  if (!code) return null;
  const clean = code.toUpperCase().trim();
  return cachedProductList.find(p => p.model_code && p.model_code.toUpperCase().trim() === clean) || null;
}

function getAllCachedProducts() {
  return cachedProductList;
}

// ==========================================
// 5. Complete Real-Human System Prompt Builder
// ==========================================

function buildSystemPrompt(isFirstMessage, sessionState = {}, recentOrderText = '', userText = '') {
  const shopName = storeSettings.shop_name || 'Dawah Fashion';
  const insideFee = storeSettings.inside_dhaka_fee || 80;
  const outsideFee = storeSettings.outside_dhaka_fee || 120;
  const bkashNum = storeSettings.bkash_number || '01613-129192';
  const nagadNum = storeSettings.nagad_number || '01677-557292';

  const dynamicPlaybook = typeof getDynamicPlaybookGuidance === 'function' ? getDynamicPlaybookGuidance(userText) : '';

  return `
[SESSION STATE]: AlreadyGreeted=${sessionState.hasGreeted ? 'true' : 'false'}, Stage=${sessionState.stage || 'BROWSING'}, CatalogOverviewSent=${sessionState.catalogSent ? 'true' : 'false'}, PreviouslySentPhotos=${sessionState.imagesSentForModels?.join(',') || 'None'}${recentOrderText ? `\n[RECENT ORDER]: ${recentOrderText}` : ''}

তুমি "${shopName}"-এর বাস্তব শপ ইনচার্জ, সরাসরি হোয়াটসঅ্যাপে কাস্টমারের সাথে কথা বলছ। কোনো এআই বা রোবট নও। ১-৩ লাইনে সংক্ষিপ্ত, সাবলীল ও মার্জিত বাংলাদেশি বাংলায় উত্তর দাও।

কঠোর নিয়ম ও শিষ্টাচার:
১. "ভাই", "ভাইয়া", "আপু", "স্যার/ম্যাম" সম্পূর্ণ নিষিদ্ধ; সর্বদা "আপনি/আপনার/জি" বলবে।
২. ড্যাশ, হাইফেন বা বুলেট (-, --, —, •, *) নিষিদ্ধ। তালিকা দিতে ১., ২., ৩. ব্যবহার করো।
৩. কোনো রোবটিক ইমোজি (🌸, 😊), "কীভাবে সাহায্য করতে পারি?", বা কর্পোরেট বুলি ("ধন্যবাদ আপনার মতামতের জন্য") নিষিদ্ধ। সাধারণ শুভেচ্ছায় উষ্ণ স্বাগতম জানাও।
৪. AlreadyGreeted=true হলে সালাম বা স্বাগতমের পুনরাবৃত্তি করবে না।
৫. কাস্টমার না চাইলে আগে থেকে দাম বা বড় বিবরণ ঢালবে না।

বিক্রয় ও ফটো ফ্লো:
১. কালেকশন/বোরকা দেখতে চাইলে ওভারভিউ পাঠাও: [SEND_CATALOG_OVERVIEW] এবং জানতে চাও কোন ডিজাইন পছন্দ।
২. নির্দিষ্ট মডেল চাইলে তার ছবি পাঠাও: [SEND_IMAGE:CODE] বা [SEND_ALL_IMAGES:CODE]।
৩. দাম জানতে চাইলে পণ্যের ফিক্সড মূল্য, ফেব্রিক ও ডেলিভারি চার্জ (ঢাকায় ৳${insideFee}, বাইরে ৳${outsideFee}) জানিয়ে সাইজের জন্য উচ্চতা জানতে চাও।
৪. সাইজ চার্ট (বোরকা ফ্রি-সাইজ, শুধু উচ্চতা অনুযায়ী ঝুল): ৫'০"-৫'১" হলে ৫০ সাইজ; ৫'২"-৫'৩" হলে ৫২ সাইজ; ৫'৪"-৫'৫" হলে ৫৪ সাইজ; ৫'৬"-৫'৮" হলে ৫৬ সাইজ। হিলের কথা না বললে সাধারণ সাইজটিই সাজেস্ট করবে (যেমন ৫'৩" এর জন্য ৫২ সাইজ)।
৫. অর্ডারে নাম, ঠিকানা ও ফোন নম্বর নিয়ে ক্যাশ অন ডেলিভারিতে বুকিং নাও। চার্জ অগ্রিম দিতে বললে বিকাশ (${bkashNum}) বা নগদ (${nagadNum}) দাও।

স্ল্যাং ও অভিযোগ:
১. "নাম ধুয়ে পানি খাবো", "poc", "sobi", "pic den" মানে ছবি দেখতে চেয়েছেন।
২. অভিযোগ বা স্ল্যাং এলে শান্তভাবে সমাধান করো। সরাসরি ব্যক্তিগত গালিতে বলো: "দয়া করে শালীনভাবে কথা বলুন।"

[LIVE PRODUCTS]:
${cachedProductsText || 'বর্তমানে ৫টি মডেল স্টকে সক্রিয় আছে।'}
${cachedPromotionsText ? `\n[PROMOTIONS]: ${cachedPromotionsText}` : ''}
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
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
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
          max_tokens: 600
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
  // 15% Complex route -> gemini-flash-latest FIRST
  // 85% Routine route -> gemini-flash-lite-latest / gemini-3.5-flash-lite FIRST
  const candidateModels = complexity === 'COMPLEX'
    ? ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
    : ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
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
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: {
            temperature: 0.38,
            maxOutputTokens: 1200
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
function generateSmartFallback(userText, isFirstMessage, session = null, recentOrder = null) {
  const t = (userText || '').toLowerCase().trim();
  const shopName = storeSettings.shop_name || 'Dawah Fashion';
  const insideFee = storeSettings.inside_dhaka_fee || 80;
  const outsideFee = storeSettings.outside_dhaka_fee || 150;
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

  // 2. Height & Size inquiries
  if (/উচ্চতা|হাইট|height|fut|ফুট|ইঞ্চি|inch/i.test(t) || /\d\s*(?:fut|ফুট|ft)/i.test(t)) {
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

async function extractAndSaveOrderLead(senderPhone, fullText, conversationHistory, session) {
  if (!supabase || !senderPhone || senderPhone.startsWith('unit_user_')) return;

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
      for (const m of ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile']) {
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
      const targetPhone = parsed.customer_phone || senderPhone.split('@')[0];
      const isOutsideDhaka = parsed.address && !/(ঢাকা|dhaka|মিরপুর|উত্তরা|গুলশান|বনানী|ধানমন্ডি|মোহাম্মদপুর|বসুন্ধরা|যাত্রাবাড়ী|মতিঝিল|বাড্ডা|খিলগাঁও|মহাখালী|তেজগাঁও|ফার্মগেট|আজিমপুর|পুরান ঢাকা)/i.test(parsed.address);
      const deliveryFee = parsed.delivery_fee || (isOutsideDhaka ? storeSettings.outside_dhaka_fee : storeSettings.inside_dhaka_fee);

      const detectedCode = parsed.model_code || detectModelFromText(fullText) || (conversationHistory ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : null);
      const matchedProd = getProductByCode(detectedCode);
      const prodPrice = matchedProd ? matchedProd.price : (Number(parsed.total_bdt) || 2200);
      const advancePaid = parsed.advance_paid !== undefined && parsed.advance_paid !== null ? parsed.advance_paid : (parsed.trx_id_or_last4 ? deliveryFee : 0);
      const dueCod = prodPrice;

      if (parsed.customer_notes && session) {
        session.customer_notes = parsed.customer_notes;
      }
      if (parsed.customer_name && session) {
        session.customer_name = parsed.customer_name;
      }
      if (session) {
        session.stage = parsed.address ? 'COLLECTING_ADDRESS' : 'DISCUSSING_PRODUCT';
      }

      // Check existing order in orders table
      const { data: existing } = await supabase
        .from('orders')
        .select('id, status, model_code, customer_name, address, product_details')
        .eq('customer_phone', targetPhone)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        await supabase.from('orders').update({
          seller_id: 'autodokan_seller_1',
          source_channel: 'WHATSAPP',
          model_code: detectedCode || existing.model_code,
          customer_name: parsed.customer_name || existing.customer_name,
          address: parsed.address || existing.address,
          product_details: parsed.product_name ? `${parsed.product_name} (Size: ${parsed.length_size || 'Standard'})` : existing.product_details,
          length_size: parsed.length_size || null,
          total_bdt: prodPrice,
          delivery_fee: deliveryFee,
          advance_paid: advancePaid,
          due_cod: dueCod,
          payment_method: parsed.payment_method || 'COD',
          trx_id_or_last4: parsed.trx_id_or_last4 || null
        }).eq('id', existing.id);
      } else {
        await supabase.from('orders').insert({
          seller_id: 'autodokan_seller_1',
          source_channel: 'WHATSAPP',
          customer_phone: targetPhone,
          model_code: detectedCode || null,
          customer_name: parsed.customer_name || null,
          address: parsed.address || null,
          product_details: parsed.product_name ? `${parsed.product_name} (Size: ${parsed.length_size || 'Standard'})` : fullText.substring(0, 180),
          length_size: parsed.length_size || null,
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

async function handleIncomingMessage(senderId, userText) {
  const sellerId = 'autodokan_seller_1';
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

  // 3. Payment Verification Regex (Save/update order lead + 30m pause + clean verification message)
  if (/(?:পাঠিয়ে\s*দিয়েছি|পাঠালাম|সেন্ড\s*করলাম|দিলাম|paid|sent)/i.test(userText) && /(?:বিকাশ|নগদ|টাকা|চার্জ|ডিজিট|লাস্ট|trx|trxid)/i.test(userText)) {
    extractAndSaveOrderLead(senderId, userText, session.messages, session);
    if (supabase && senderId && !senderId.startsWith('unit_user_')) {
      const pauseUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      supabase.from('chat_sessions').update({
        needs_human_attention: true,
        attention_reason: 'PAYMENT_VERIFICATION_SUBMITTED',
        paused_until: pauseUntil
      }).eq('seller_id', sellerId).eq('customer_identifier', senderId).catch(() => {});
    }
    const payReply = 'আপনার পেমেন্টের তথ্যটি গ্রহণ করা হয়েছে। আমাদের অ্যাকাউন্ট ম্যানেজার খুব দ্রুত ভেরিফাই করে আপনার সাথে যোগাযোগ করবেন।\n\nঅর্ডারটি কনফার্ম করতে আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারির ঠিকানাটি দিন।';
    session.messages.push({ role: 'user', content: userText, timestamp: Date.now() });
    session.messages.push({ role: 'assistant', content: payReply, timestamp: Date.now() });
    saveCustomerSession(sellerId, 'WHATSAPP', senderId, session);
    return payReply;
  }

  const isFirstMessage = session.messages.length === 0;

  // Add customer message to session history
  session.messages.push({
    role: 'user',
    content: userText,
    timestamp: Date.now()
  });

  // Extract order/lead in background
  extractAndSaveOrderLead(senderId, userText, session.messages, session);

  // Build Context-Aware Real-Human Prompt with Dynamic Playbook & Live Order Data
  const systemPrompt = buildSystemPrompt(isFirstMessage, session, recentOrderText, userText);

  // Conversational message history for LLM (trimmed to last 14 turns)
  const chatHistory = session.messages.slice(-14).map(m => ({
    role: m.role,
    content: m.content
  }));

  // Hybrid Router
  const complexity = classifyMessageComplexity(userText, session.messages.length);
  console.log(`[AI Pipeline] Route: ${complexity} | Sender: ${senderId}`);

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
    aiReply = generateSmartFallback(userText, isFirstMessage, session, latestOrder);
  }

  // Strip banned corporate phrases
  aiReply = aiReply
    .replace(/[•●▪*]/g, '')
    .replace(/[-–—]{2,}/g, ' ')
    .replace(/[🌸😊🌺🌹]/g, '')
    .replace(/\b(ভাইয়া|আপু|ভাইয়া|আপুনি|স্যার|ম্যাম)\b/gi, '')
    .replace(/ধন্যবাদ\s*আপনার\s*মতামতের\s*জন্য[।.]?/gi, '')
    .replace(/আপনার\s*বার্তার\s*জন্য\s*ধন্যবাদ[।.]?/gi, '')
    .trim();

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
        aiReply += ` [SEND_IMAGE:${activeModel}]`;
      } else if (isAskingForCatalogOverview(userText) || /কালেকশন|বোরকা|ডিজাইন|সব|ছবি|পিক|chobi|pic|poc/i.test(userText)) {
        aiReply += ' [SEND_CATALOG_OVERVIEW]';
      }
    } else if (isAskingForImage(userText) && !activeModel && (isAskingForCatalogOverview(userText) || /কালেকশন|বোরকা|ডিজাইন|সব|ছবি|পিক|chobi|pic|poc/i.test(userText))) {
      aiReply += ' [SEND_CATALOG_OVERVIEW]';
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

  // Apply Section 1 Clean Human Formatting Sanitizer
  aiReply = cleanHumanFormatting(aiReply);

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
  getStoreSettings: () => storeSettings,
  getProductByCode,
  getAllCachedProducts,
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
  getDynamicPlaybookGuidance
};
