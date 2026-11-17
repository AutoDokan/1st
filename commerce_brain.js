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
      .order('id', { ascending: true });

    if (!prodErr && prods && prods.length > 0) {
      cachedProductList = prods;
      cachedProductsText = prods.map((p, idx) => {
        const code = p.model_code || `DF-${100 + idx + 1}`;
        const regPrice = Number(p.regular_price) || Number(p.price);
        const discPrice = Number(p.discount_price);
        let priceStr = `মূল্য: ৳${p.price} টাকা (ফিক্সড)`;
        if (discPrice > 0 && discPrice < regPrice) {
          priceStr = `রেগুলার প্রাইস: ৳${regPrice}, বর্তমান অফার প্রাইস: ৳${discPrice} (ছাড় চলছে!)`;
        }

        let stockStr = '[স্টকে আছে]';
        if (p.in_stock === false || (p.stock_quantity !== null && p.stock_quantity <= 0)) {
          stockStr = '[স্টক আউট / বর্তমানে নেই — অর্ডার নেওয়া যাবে না, বিকল্প মডেল সাজেস্ট করুন]';
        } else if (p.stock_quantity !== null && p.stock_quantity > 0 && p.stock_quantity <= 5) {
          stockStr = `[স্টকে আছে — মাত্র ${p.stock_quantity} পিস বাকি]`;
        }

        const details = [
          `ফেব্রিক: ${p.fabric || 'প্রিমিয়াম চেরি'}`,
          `সাইজ: ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}`,
          `হিজাব: ${p.hijab_included ? 'ম্যাচিং হিজাব উপহার হিসেবে সম্পূর্ণ ফ্রি' : 'আলাদা'}`,
          p.colors ? `কালার: ${p.colors}` : '',
          p.short_description ? `বিবরণ: ${p.short_description}` : '',
          p.image_url ? 'মেইন ছবি: আছে' : '',
          p.detail_image_url ? 'কাজের ক্লোজ-আপ: আছে' : '',
          p.hijab_image_url ? 'হিজাব ছবি: আছে' : '',
          p.flare_image_url ? 'ঘেরের ছবি: আছে' : '',
          p.real_image_url ? 'রিয়েল ছবি: আছে' : ''
        ].filter(Boolean).join(', ');

        return `${idx + 1}. [মডেল কোড: ${code}] ${p.name} | ${priceStr} | ${stockStr} (${details})`;
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

    // 3. Fetch Style Playbook Hints
    try {
      const { data: hints } = await supabase
        .from('human_style_playbook')
        .select('*')
        .eq('is_active', true)
        .limit(3);

      if (hints && hints.length > 0) {
        cachedPlaybookHints = hints.map(h => 
          `• [পরিস্থিতি: ${h.scenario_tag}] কাস্টমার যেমন: "${h.customer_trigger_example}" -> নির্দেশনা: ${h.human_reply_guideline} (ন্যাচারাল স্টাইল যেমন: "${h.sample_natural_reply}")`
        ).join('\n');
      } else {
        cachedPlaybookHints = '';
      }
    } catch (e) {}

  } catch (err) {
    console.warn('[Products Sync Error]:', err.message);
  }
  return cachedProductList;
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

function detectModelFromText(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return null;

  // 1. Direct Model Code Matching (e.g. "DF-101", "DF 102", "df103")
  const directMatch = t.match(/\bdf[ -]?(\d{3})\b/i);
  if (directMatch) {
    return `DF-${directMatch[1]}`;
  }

  // 2. Ordinal Banglish / Bengali numbers
  if (/^(?:১|1)$|(?:^|[^\d০-৯])(?:১|1)\s*(?:নং|নম্বর|নাম্বার|ম\b|st\b|প্রথম)/i.test(t)) return 'DF-101';
  if (/^(?:২|2)$|(?:^|[^\d০-৯])(?:২|2)\s*(?:নং|নম্বর|নাম্বার|য়\b|nd\b|দ্বিতীয়|দিতিয়)/i.test(t)) return 'DF-102';
  if (/^(?:৩|3)$|(?:^|[^\d০-৯])(?:৩|3)\s*(?:নং|নম্বর|নাম্বার|য়া\b|rd\b|তৃতীয়|তিতিও)/i.test(t)) return 'DF-103';
  if (/^(?:৪|4)$|(?:^|[^\d০-৯])(?:৪|4)\s*(?:নং|নম্বর|নাম্বার|র্থ\b|th\b|চতুর্থ)/i.test(t)) return 'DF-104';
  if (/^(?:৫|5)$|(?:^|[^\d০-৯])(?:৫|5)\s*(?:নং|নম্বর|নাম্বার|ম\b|th\b|পঞ্চম)/i.test(t)) return 'DF-105';

  // 3. Name / Style Keywords
  if (/৩-পিস|কারচুপি\s*কোটি|কটি\s*আবায়া|কোটি\s*সেট/i.test(t)) return 'DF-101';
  if (/রানি\s*আবায়া|রানী\s*আবায়া|কাটওয়ার্ক|rani/i.test(t)) return 'DF-102';
  if (/কাফতান|front\s*open|ফ্রন্ট\s*ওপেন/i.test(t)) return 'DF-103';
  if (/এ-লাইন|ক্যাজুয়াল|daily\s*wear|a-line|aline/i.test(t)) return 'DF-104';
  if (/বাটারফ্লাই|পার্টি\s*বোরকা|butterfly/i.test(t)) return 'DF-105';

  return null;
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

function buildSystemPrompt(isFirstMessage, sessionState = {}, recentOrderText = '') {
  const shopName = storeSettings.shop_name || 'Dawah Fashion';
  const insideFee = storeSettings.inside_dhaka_fee || 80;
  const outsideFee = storeSettings.outside_dhaka_fee || 150;
  const bkashNum = storeSettings.bkash_number || '01613-129192';
  const nagadNum = storeSettings.nagad_number || '01677-557292';
  const returnPolicy = storeSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।';

  const greetingDirective = (isFirstMessage || !sessionState.hasGreeted)
    ? `১. প্রথম মেসেজের অভিবাদন:
   - কাস্টমারকে প্রথমবারের মতো সম্ভাষণ জানাও: "আসসালামু আলাইকুম, ${shopName} থেকে বলছি। বোরকা বা আবায়ার কালেকশন দেখবেন?"
   - শুধুমাত্র কাস্টমার যদি নিজে থেকে কুশল জানতে চায় (যেমন: "কেমন আছেন?"): বলবে "আলহামদুলিল্লাহ, আমরা ভালো আছি। আপনি কেমন আছেন?"
   - কাস্টমার যদি শুধু সালাম বা সাধারণ সম্ভাষণ জানায় (যেমন: "Hi", "Hello", "হাই"): ভুলেও আগ বাড়িয়ে "ভালো আছি" বলবে না এবং কখনোই "আজ কীভাবে সাহায্য করতে পারি?" বা "কীভাবে সাহায্য করতে পারি?" বলবে না! বলবে: "আসসালামু আলাইকুম, ${shopName} থেকে বলছি। বোরকা বা আবায়ার কালেকশন দেখবেন?"`
    : `১. স্ট্রিক্ট জিরো সালাম রুল (সালাম পুনরাবৃত্তি সম্পূর্ণ নিষিদ্ধ):
   - এই কাস্টমারের সাথে ইতিমধ্যে কথা হয়েছে (AlreadyGreeted = true)।
   - ভুলেও দ্বিতীয়বার "আসসালামু আলাইকুম", "ওয়া আলাইকুম আসসালাম" বা সালামের পুনরাবৃত্তি করবে না!
   - কাস্টমার আবার সালাম দিলেও সালাম ফেরত দেবে না; সরাসরি "জি বলুন", "অবশ্যই" বা মূল প্রশ্নের উত্তর দিয়ে শুরু করবে।`;

  return `
তুমি "${shopName}"-এর একজন বাস্তব মানুষ ও ইনচার্জ, যে নিজের ফোন হাতে নিয়ে সরাসরি হোয়াটসঅ্যাপে কাস্টমারের সাথে কথা বলছে। তুমি কোনো এআই, ভার্চুয়াল বট বা অটোমেটেড রোবট নও।

[SESSION STATE]: AlreadyGreeted=${sessionState.hasGreeted ? 'true' : 'false'}, Stage=${sessionState.stage || 'BROWSING'}, PreviouslySentPhotos=${sessionState.imagesSentForModels?.join(',') || 'None'}, DeliveryFeeMentioned=${sessionState.deliveryFeeMentioned ? 'true' : 'false'}, CustomerNotes=${sessionState.customer_notes || 'None'}

${greetingDirective}

কঠোর নিষিদ্ধ শব্দ ও ফরম্যাটিং (ধরা খাওয়ার সব পথ বন্ধ):
১. কখনোই কাস্টমারকে "ভাইয়া", "আপু", "ভাইয়া/আপু", বা "স্যার/ম্যাম" বলবে না! সর্বদা মার্জিত "আপনি", "আপনার", "জি", "অবশ্যই" ব্যবহার করবে।
২. উত্তরের ভেতরে কোনো ড্যাশ, হাইফেন বা বুলেট পয়েন্ট (-, --, —, •, *) ব্যবহার করবে না! কোনো পয়েন্ট লেখার প্রয়োজন হলে ১., ২., ৩. দিয়ে লিখবে।
৩. কখনোই 🌸 বা 😊 রোবটিক ইমোজি ব্যবহার করবে না! বাক্যের শেষে অযথা ইমোজি দেওয়ার দরকার নেই, সর্বদা স্বাভাবিক মানুষের মতো মেসেজ দেবে।
৪. প্রতিটি উত্তরের শেষে রোবটের মতো গদবাঁধা প্রশ্ন ("আর কিছু জানতে চান?", "আপনি কি অর্ডার করতে চান?") ঝুলিয়ে রাখবে না। কাস্টমার যতটুকু জানতে চেয়েছে, ততটুকুই স্পষ্ট ও স্বাভাবিকভাবে বলবে।
৫. কখনোই রোবটিক কর্পোরেট লাইন ("ধন্যবাদ আপনার মতামতের জন্য", "আজ কীভাবে সাহায্য করতে পারি?") বলবে না!

বাংলাদেশি স্ল্যাং, রূপক ও টাইপো ডিকোডার (১০০% বাধ্যতামূলক নির্দেশ):
১. রূপক, ব্যঙ্গ ও খোঁটা বোঝা:
   - "নাম ধুয়ে পানি খাবো নাকি?", "নাম দিয়ে কি করব?", "মুখে বললে হবে?", "বাতাস কিনব নাকি?" — এর আসল অর্থ কাস্টমার পোশাকটির ছবি বা পিক দেখতে চেয়েছে! ভুলেও জামাকাপড় ধোয়া, ডিটারজেন্ট, পাওয়ার ওয়াশ বা লন্ড্রি টিউটোরিয়াল দেবে না! সঙ্গে সঙ্গে বলবে: "জি অবশ্যই, দুঃখিত! আমি এখনই ড্রেসটির আসল ছবি পাঠাচ্ছি।" এবং ছবির ট্যাগ দেবে।
২. বাংলিশ ও ভুল বানানের শব্দ (Banglish Typos):
   - "poc", "pik", "puk", "pic", "sobi", "chbi" ইত্যাদির অর্থ PICTURE বা ছবি (কখনোই Proof of Concept বা Detergent Wash নয়)!
   - কাস্টমার "poc dite hobe" বা "poc den" বললে তাকে সঙ্গে সঙ্গে ছবির ট্যাগসহ ছবি পাঠাবে।
৩. কাস্টমার যদি বলে "ছবি কই?", "পিক কই?", "ছবি তো দিলেন না", "ছবি পাই নাই":
   - ভুলেও মিথ্যা দাবি করবে না যে "আমি তো পাঠিয়েছি!"
   - বলবে: "আরে সরি, হয়তো নেটের কারণে যায়নি। আমি এখনই আবার ছবি পাঠাচ্ছি, দেখুন।" এবং সাথে ছবির ট্যাগ পাঠাবে।

স্মার্ট গিবরিশ, দুর্ঘটনাজনিত মেসেজ ও বিদায় রুলস:
১. কাস্টমার যদি অর্থহীন গিবরিশ (যেমন: asdfgh, qwerty, 123456, ....) পাঠায় বা "ভুল করে মেসেজ দিয়েছি" বলে, কোনো সেলস পিচ বা প্রোডাক্টের ছবির ট্যাগ পাঠাবে না; ছোট করে বলবে "আচ্ছা সমস্যা নেই।"
২. কাস্টমার যদি বিদায় নেয় বা চ্যাট শেষ করে (যেমন: "আল্লাহ হাফেজ", "বাই", "পরে কথা হবে", "রাখি", "পরে জানাবো"), ভুলেও শেষে কোনো নতুন প্রশ্ন বা সেলস হুক জুড়বে না! শুধু সংক্ষিপ্ত ও সম্মানজনক বিদায় দেবে: "জি ইনশাআল্লাহ, ভালো থাকবেন।"

লাইভ অর্ডার ট্র্যাকিং ও কুরিয়ার স্ট্যাটাস রুলস:
কাস্টমার যদি তার পূর্বের অর্ডারের অবস্থা, ডেলিভারির খবর বা পার্সেল ট্র্যাকিং কোড জানতে চায়:
- নিচে দেওয়া [LIVE CUSTOMER RECENT ORDER] সেকশন থেকে আসল স্ট্যাটাস, কুরিয়ার ও ট্র্যাকিং কোড সরাসরি সত্য হিসেবে জানাবে।
- কোনো অর্ডার তথ্য দেওয়া না থাকলে মনগড়া তথ্য না দিয়ে বলবে: "আপনার এই নম্বরে কোনো রানিং অর্ডার পাওয়া যায়নি। আপনি কি অন্য নম্বর দিয়ে অর্ডার করেছিলেন? অর্ডার আইডিটি জানালে এখনই চেক করে দিচ্ছি।"

কাস্টমার অভিযোগ ও হিউম্যান এজেন্ট সাপোর্ট রুলস:
১. কাস্টমার যদি কঠোর অভিযোগ করে (যেমন: প্রতারণা, নষ্ট পণ্য, ভোক্তা অধিকার, রিফান্ড সমস্যা): কোনো তর্ক করবে না, শান্তভাবে সর্বোচ্চ আন্তরিকতা নিয়ে দুঃখ প্রকাশ করবে এবং অর্ডার আইডি/ফোন নম্বর চেয়ে বলবে ইনচার্জ নিজে সরাসরি কথা বলে সমাধান করে দেবেন।
২. কাস্টমার যদি স্টাফ বা মানুষের সাথে কথা বলতে চায়: তর্ক না করে বলবে "আমি স্টোরের ইনচার্জ হিসেবে নিজেই মেসেজগুলো দেখছি। বলুন কী সমস্যা হয়েছে? আর সরাসরি ফোনে কথা বলতে চাইলে নম্বরটি দিন, আমাদের দায়িত্বশীল ব্যক্তি দ্রুত কল দিচ্ছেন।"

অ্যান্টি-রিপিটেশন ও রিয়েল মেমোরি রুলস:
১. যে তথ্য (যেমন কাপড়ের মান, ডেলিভারি চার্জ বা চেক করার সুবিধা) আগের ১-২ মেসেজে একবার বলা হয়েছে, কাস্টমার নিজে থেকে আবার না চাইলে তা দ্বিতীয়বার ঘুরিয়ে বলবে না।
২. কাস্টমার যদি গরম, সাইজ নিয়ে দ্বিধা, পারিবারিক পরামর্শ বা ডেলিভারি নিয়ে কথা বলে—তাহলে একজন অভিজ্ঞ মানুষের মতো সহানুভূতি ও বাস্তব অভিজ্ঞতা শেয়ার করে সহজ সমাধান দেবে (যেমন: "৫ ফুট ২ বা ৩ উচ্চতায় অনেকেই ৫২ সাইজটাই নেয়, একদম পারফেক্ট ঝুল হয়")।
৩. কাস্টমার যদি জিজ্ঞেস করে ("আপনি কি রোবট?"):
   ন্যাচারালভাবে বলবে: "আরে না, আমি ${shopName} থেকেই বলছি, অর্ডারগুলো দেখছি। আপনাকে কোন মডেল বা সাইজ নিয়ে সাহায্য করব বলুন?"

সাইজ সংক্রান্ত সঠিক শিষ্টাচার (বুকের বা বডির মাপ চাওয়া সম্পূর্ণ নিষিদ্ধ):
- বোরকা ও আবায়া সম্পূর্ণ ঢিলেঢালা পর্দাশীল পোশাক। কখনোই কাস্টমারের বডি বা বুকের মাপ চাইবে না।
- সাইজ পরামর্শ দেওয়ার সময় অবশ্যই ঝুলের ইঞ্চি এবং সাইজ দুটিই উল্লেখ করবে (যেমন: "৫২ ইঞ্চি ঝুল / ৫২ সাইজ"):
  • ৫০ ইঞ্চি ঝুল / ৫০ সাইজ (উচ্চতা ৫ ফুট থেকে ৫ ফুট ১ ইঞ্চি)
  • ৫২ ইঞ্চি ঝুল / ৫২ সাইজ (উচ্চতা ৫ ফুট ২ থেকে ৫ ফুট ৩ ইঞ্চি)
  • ৫৪ ইঞ্চি ঝুল / ৫৪ সাইজ (উচ্চতা ৫ ফুট ৪ থেকে ৫ ফুট ৫ ইঞ্চি)
  • ৫৬ ইঞ্চি ঝুল / ৫৬ সাইজ (উচ্চতা ৫ ফুট ৬ ইঞ্চি বা তার বেশি)
  • ৫৮ ইঞ্চি ঝুল / ৫৮ সাইজ (৫ ফুট ৮ ইঞ্চি বা হিল পরলে স্পেশাল কাস্টমাইজ)
  • ৪ ফুট ৪ ইঞ্চির মতো বিশেষ ক্ষেত্রে কাস্টমাইজ সাইজ (৪৪ বা ৪৬) পরামর্শ দেবে।

স্টেপড সেলস ফানেল ও ফটো ট্যাগ গাইডলাইন:
১. স্টেজ ১ (ক্যাটালগ ব্রাউজিং): কাস্টমার সাধারণভাবে কালেকশন দেখতে চাইলে কোনো প্রাইস ডাম্প ছাড়া রানিং মডেলের ১টি মূল শোকেস ছবি পাঠাবে [SEND_IMAGE:DF-101] এবং সাবলীলভাবে জিজ্ঞাসা করবে সব কয়টি ডিজাইন দেখতে চায় নাকি নির্দিষ্ট পছন্দ আছে।
২. স্টেজ ১খ (সবগুলো দেখতে চাইলে): কাস্টমার "সবগুলো দেখান" বা "সব ডিজাইন দেখতে চাই" বললে পাঠাবে [SEND_CATALOG_OVERVIEW]।
৩. স্টেজ ২ (মডেল পছন্দ করলে): কাস্টমার নির্দিষ্ট মডেল চাইলে (যেমন: DF-102 বা ২ নম্বর) কোনো প্রাইস ডাম্প না করে ওই মডেলের সব ভিউ পাঠাবে [SEND_ALL_IMAGES:DF-102]।
   - শুধু হিজাব চাইলে: [SEND_HIJAB_IMAGE:DF-XXX]
   - শুধু কাজের ক্লোজআপ চাইলে: [SEND_DETAIL_IMAGE:DF-XXX]
   - শুধু ঘের চাইলে: [SEND_FLARE_IMAGE:DF-XXX]
   - শুধু রিয়েল ছবি চাইলে: [SEND_REAL_IMAGE:DF-XXX]
৪. স্টেজ ৩ (দাম ও বিস্তারিত জানতে চাইলে): কাস্টমার দাম বা ফেব্রিক জানতে চাইলে পোশাকের মূল্য, ফেব্রিক, সাইজ এবং সাথে ম্যাচিং প্রিমিয়াম হিজাব উপহার হিসেবে সম্পূর্ণ ফ্রি—তা সুন্দরভাবে জানাবে।

কঠোর ফ্যাক্ট লক ও রুলস (১০০% জিরো হ্যালুসিনেশন):
• নিচে দেওয়া LIVE PRODUCT CATALOG, ACTIVE PROMOTIONS এবং STORE SETTINGS-এর বাইরে নিজের মন থেকে ১টি মডেল কোড, ১ টাকা দাম কম-বেশি, সাইজ, কালার বা ফ্রি ডেলিভারির কথা বানিয়ে বলবে না!
• কোনো প্রোডাক্ট [স্টক আউট] লেখা থাকলে স্পষ্ট বলবে যে ওটা এখন স্টকে নেই, এবং স্টকে থাকা কাছাকাছি অন্য মডেল সাজেস্ট করবে।
• কাস্টমার এমন কিছু জানতে চাইলে যা লিস্টে লেখা নেই (যেমন কবে রিস্টক হবে বা কাস্টম অল্টারেশন), আন্দাজে উত্তর না দিয়ে ছোট করে বলবে: "এটা আমি একটু স্টোর থেকে কনফার্ম হয়ে জানাচ্ছি।"

ডায়নামিক স্টোর পলিসি ও বার্গেইনিং রুলস:
• ডেলিভারি টাইমলাইন: ঢাকার ভেতরে ২৪ থেকে ৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ২ থেকে ৩ দিনের মধ্যে ডেলিভারি সম্পন্ন হয়।
• ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${insideFee} টাকা, ঢাকার বাইরে ৳${outsideFee} টাকা। ACTIVE PROMOTIONS-এ ফ্রি ডেলিভারি বা ডিসকাউন্ট লেখা না থাকলে নিজে থেকে কখনোই ডেলিভারি ফ্রি দেবে না।
• ফ্রি ডেলিভারি দাবি করলে স্পষ্ট বলবে যে ডেলিভারি চার্জ কুরিয়ার সার্ভিসের বুকিং ফি, তাই এটি মওকুফ করার সুযোগ নেই।
• প্রোডাক্টের মূল টাকা ক্যাশ অন ডেলিভারি (ডেলিভারি ম্যানের সামনে খুলে চেক করে নেওয়ার সুযোগ আছে)। অর্ডার কনফার্ম করতে শুধুমাত্র ডেলিভারি চার্জটুকু বিকাশ (${bkashNum}) বা নগদে (${nagadNum}) অগ্রিম পাঠাতে হয়।
• একাধিক প্রোডাক্ট অর্ডার করলে একই পার্সেলে বুকিং হবে, ফলে বাড়তি ডেলিভারি চার্জ দিতে হবে না—এক চার্জেই সব দেওয়া যাবে।
• বিশ্বাস ও নিরাপত্তা: পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে চেক করে বোরকার মূল্য পরিশোধ করতে পারবেন। পছন্দ না হলে সাথে সাথে রিটার্ন করা যাবে।

ডিজিটাল ক্যাশ মেমো (নাম, ফোন ও সম্পূর্ণ ঠিকানা পেলে):
কাস্টমার সম্পূর্ণ ঠিকানা দিলে আলহামদুলিল্লাহ জানিয়ে ক্যাশ মেমো উপস্থাপন করবে:
পোশাকের মূল্য, ডেলিভারি চার্জ (৳${insideFee}/৳${outsideFee}), এবং কুরিয়ারে প্রদেয় Due COD। ডেলিভারি চার্জ বিকাশ/নগদে (${bkashNum}) পাঠিয়ে লাস্ট ৪ ডিজিট জানাতে বলবে।

লাইভ রানিং প্রোডাক্ট তালিকা (ডাটাবেস থেকে প্রাপ্ত ফিক্সড সত্য):
${cachedProductsText || 'বর্তমানে ৫টি প্রিমিয়াম মডেল স্টকে সক্রিয় আছে।'}

${cachedPromotionsText ? `সক্রিয় অফার ও প্রমোশন:\n${cachedPromotionsText}` : ''}
${cachedPlaybookHints ? `স্টাইল প্লেবুক গাইডলাইন:\n${cachedPlaybookHints}` : ''}
${recentOrderText ? `[LIVE CUSTOMER RECENT ORDER]:\n${recentOrderText}` : ''}
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

  // 15% Complex route -> gemini-3.5-flash FIRST
  // 85% Routine route -> gemini-3.5-flash-lite FIRST (sub-second latency, 1,000 free RPD)
  const candidateModels = complexity === 'COMPLEX'
    ? ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
    : ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

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
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: {
            temperature: 0.42,
            maxOutputTokens: 900
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

  // 1. Smart Gibberish & Accidental Text Guard (Instant response, zero photo dump, zero sales hook)
  if (isGibberishOrAccidental(userText)) {
    let gibberishReply = 'আচ্ছা সমস্যা নেই। আমাদের প্রোডাক্ট বা কালেকশন নিয়ে কিছু জানতে চাইলে বলতে পারেন।';
    if (/ভুল\s*করে|vul\s*kore|vul\s*hoise|ভুল\s*হয়েছে/i.test(userText)) {
      gibberishReply = 'আচ্ছা সমস্যা নেই।';
    } else if (/^[.\s,!?…\-_]+$/.test(userText) || userText.trim().length <= 1) {
      gibberishReply = 'জি, কোনো কিছু জানতে চান?';
    }
    session.messages.push({ role: 'user', content: userText, timestamp: Date.now() });
    session.messages.push({ role: 'assistant', content: gibberishReply, timestamp: Date.now() });
    saveCustomerSession(sellerId, 'WHATSAPP', senderId, session);
    return gibberishReply;
  }

  // 2. Goodbye Intent Guard (Strictly zero follow-up questions or sales hooks)
  if (isGoodbyeIntent(userText)) {
    const goodbyeReply = 'জি ইনশাআল্লাহ, ভালো থাকবেন। শুভকামনা রইল!';
    session.messages.push({ role: 'user', content: userText, timestamp: Date.now() });
    session.messages.push({ role: 'assistant', content: goodbyeReply, timestamp: Date.now() });
    saveCustomerSession(sellerId, 'WHATSAPP', senderId, session);
    return goodbyeReply;
  }

  // 3. Auto Human-Alert Escalation Check (Angry Complaint & Human Agent Request)
  const isComplaint = isAngryComplaint(userText);
  const isAgentReq = isAgentRequest(userText);
  if ((isComplaint || isAgentReq) && supabase && senderId && !senderId.startsWith('unit_user_')) {
    const attentionReason = isComplaint ? 'CUSTOMER_COMPLAINT' : 'HUMAN_AGENT_REQUESTED';
    supabase.from('chat_sessions').update({
      needs_human_attention: true,
      attention_reason: attentionReason
    }).eq('seller_id', sellerId).eq('customer_identifier', senderId).then().catch(e => console.warn(e.message));
  }

  // 4. Live Order Status Lookup by Phone
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
        recentOrderText = `অর্ডার #${ord.id} | মডেল: ${ord.model_code || 'N/A'} | বর্তমান স্ট্যাটাস: ${ord.status} | কুরিয়ার: ${ord.courier_name || 'Steadfast Courier'} | ট্র্যাকিং কোড: ${ord.courier_tracking_id || 'প্রসেসিং হচ্ছে'} | বকেয়া COD: ৳${ord.due_cod || ord.total_bdt || 2200} টাকা`;
      }
    } catch (ordErr) {
      console.warn('[Order Query Warning]:', ordErr.message);
    }
  }

  // If customer is directly asking about their order status
  if (isOrderStatusInquiry(userText)) {
    let statusReply = '';
    if (latestOrder) {
      statusReply = `আপনার অর্ডার #${latestOrder.id} (${latestOrder.model_code || 'পোশাক'}) বর্তমানে [${latestOrder.status}] অবস্থায় রয়েছে। কুরিয়ার: ${latestOrder.courier_name || 'Steadfast Courier'}, ট্র্যাকিং কোড: ${latestOrder.courier_tracking_id || 'প্রসেসিং হচ্ছে'}। বকেয়া COD: ৳${latestOrder.due_cod || latestOrder.total_bdt || 2200} টাকা।`;
    } else {
      statusReply = 'আপনার এই নম্বরে বর্তমানে কোনো রানিং অর্ডার পাওয়া যায়নি। আপনি কি অন্য কোনো নম্বর দিয়ে অর্ডার করেছিলেন? অথবা আপনার অর্ডার আইডিটি জানালে এখনই ট্র্যাকিং স্ট্যাটাস চেক করে দিচ্ছি।';
    }
    session.messages.push({ role: 'user', content: userText, timestamp: Date.now() });
    session.messages.push({ role: 'assistant', content: statusReply, timestamp: Date.now() });
    saveCustomerSession(sellerId, 'WHATSAPP', senderId, session);
    return statusReply;
  }

  // If customer is abusive, swearing, or frustrated (e.g. "Baler buddhi daw tumi")
  if (isAbusiveOrFrustrated(userText)) {
    session.needsHumanAttention = true;
    session.attentionReason = 'CUSTOMER_FRUSTRATED';
    try {
      if (supabase) {
        await supabase
          .from('chat_sessions')
          .update({
            needs_human_attention: true,
            attention_reason: 'CUSTOMER_FRUSTRATED',
            updated_at: new Date().toISOString()
          })
          .eq('seller_id', storeSettings.seller_id || 'autodokan_seller_1')
          .eq('customer_identifier', senderId);
      }
    } catch (e) {}

    const apologyModel = session.imagesSentForModels[session.imagesSentForModels.length - 1] || 'DF-101';
    const apologyReply = `আচ্ছা সরি, আমারই ভুল হয়েছে—এখনই ছবিটা দিচ্ছি দেখুন। [SEND_IMAGE:${apologyModel}]`;
    session.messages.push({ role: 'user', content: userText, timestamp: Date.now() });
    session.messages.push({ role: 'assistant', content: apologyReply.replace(/\[\s*SEND_[A-Za-z0-9_:\s-]+\s*\]/gi, '').trim(), timestamp: Date.now() });
    saveCustomerSession(sellerId, 'WHATSAPP', senderId, session);
    return apologyReply;
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

  // Build Context-Aware Real-Human Prompt with Live Order Data
  const systemPrompt = buildSystemPrompt(isFirstMessage, session, recentOrderText);

  // Conversational message history for LLM (trimmed to last 12 turns)
  const chatHistory = session.messages.slice(-12).map(m => ({
    role: m.role,
    content: m.content
  }));

  // 85% Routine / 15% Complex Hybrid Router
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

  // Clean dashes, bullets and illegal emojis
  aiReply = aiReply
    .replace(/[•●▪]/g, '')
    .replace(/[-–—]{2,}/g, ' ')
    .replace(/[🌸😊🌺🌹]/g, '')
    .replace(/\b(ভাইয়া|আপু|ভাইয়া|আপুনি|স্যার|ম্যাম)\b/gi, '')
    .replace(/ধন্যবাদ\s*আপনার\s*মতামতের\s*জন্য[।.]?/gi, '')
    .replace(/আপনার\s*বার্তার\s*জন্য\s*ধন্যবাদ[।.]?/gi, '')
    .replace(/আজ\s*কীভাবে\s*(?:সাহায্য|সহায়তা)\s*করতে\s*পারি\??/gi, 'বোরকা বা আবায়ার কালেকশন দেখবেন?')
    .replace(/কীভাবে\s*(?:সাহায্য|সহায়তা)\s*করতে\s*পারি\??/gi, 'কোন ডিজাইন বা সাইজ দেখতে চান বলুন?')
    .trim();

  // ==========================================
  // Post-Processing & Sales Funnel Verification
  // ==========================================

  const wantsImage = isAskingForImage(userText);
  const detectedModelInUser = detectModelFromText(userText);
  const detectedModelInReply = detectModelFromText(aiReply);
  const activeModel = detectedModelInUser || detectedModelInReply || session.imagesSentForModels[session.imagesSentForModels.length - 1];

  const isAskingWhereIsPhoto = /(?:ছবি\s*কই|পিক\s*কই|sobi\s*koi|chobi\s*koi|pic\s*koi|poc\s*koi|ছবি\s*তো\s*দিলেন\s*না|ছবি\s*আসেনি|ছবি\s*পাইনি|ছবি\s*নাই|পিক\s*নাই)/i.test(userText);
  const isSarcasticPhotoRequest = /(?:ধুয়ে\s*পানি|ধুয়ে\s*পানি|dhuye\s*pani|pani\s*khabo|poc|pik|sobi|নাম\s*দিয়ে\s*কি|নাম\s*ধুয়ে|মুখে\s*বললে\s*হবে|বাতাস\s*কিনবো)/i.test(userText);

  // If customer asked "where is the photo?", apologize and dispatch immediately
  if (isAskingWhereIsPhoto) {
    const targetModel = activeModel || 'DF-101';
    aiReply = `আরে সরি, হয়তো নেটের কারণে যায়নি। আমি এখনই আবার ছবি পাঠাচ্ছি, দেখুন। [SEND_IMAGE:${targetModel}]`;
  }

  // Prevent detergent / laundry wash hallucinations on sarcastic requests
  if ((isSarcasticPhotoRequest || wantsImage) && /(?:ডিটারজেন্ট|পাওয়ার\s*ওয়াশ|কাপড়\s*ধোয়ার|লন্ড্রি|power\s*wash|detergent|wash)/i.test(aiReply)) {
    const targetModel = activeModel || 'DF-101';
    aiReply = `জি অবশ্যই, দুঃখিত! আমি এখনই ড্রেসটির ছবি পাঠাচ্ছি। [SEND_IMAGE:${targetModel}]`;
  }

  const promisesPhotoInReply = /(?:ছবি\s*পাঠাচ্ছি|ছবি\s*দিচ্ছি|পিক\s*দিচ্ছি|শোকেস\s*ছবি|আবার\s*পাঠাচ্ছি|ছবিটি\s*দেখুন|ছবি\s*পাঠালাম|পিক\s*পাঠাচ্ছি|ছবি\s*পাঠিয়েছি|ছবি\s*দিয়েছি)/i.test(aiReply);
  const userWantedPhoto = wantsImage || isAskingWhereIsPhoto || isSarcasticPhotoRequest || /(?:ছবি\s*কই|পিক|sobi|chobi|pic|poc|ধুয়ে\s*পানি|দেখান)/i.test(userText);

  if (isAskingForAllCatalog(userText, session.messages)) {
    // Stage 1b: Customer explicitly asked to see all models
    aiReply = aiReply.replace(/\[\s*SEND_[A-Z_]+[^\]]*\]/gi, '').trim();
    aiReply += ' [SEND_CATALOG_OVERVIEW]';
  } else if (isAskingForCatalogOverview(userText)) {
    // Stage 1: General catalog inquiry -> 1 showcase image, NO price dump
    aiReply = aiReply.replace(/\[\s*SEND_[A-Z_]+[^\]]*\]/gi, '').trim();
    aiReply += ' [SEND_IMAGE:DF-101]';
  } else if (detectedModelInUser && wantsImage && !isAskingForPriceOrDetails(userText)) {
    // Stage 2: Specific model selected for pictures
    aiReply = aiReply.replace(/\[\s*SEND_[A-Z_]+[^\]]*\]/gi, '').trim();
    if (isAskingForHijab(userText)) {
      aiReply += ` [SEND_HIJAB_IMAGE:${detectedModelInUser}]`;
    } else if (isAskingForDetail(userText)) {
      aiReply += ` [SEND_DETAIL_IMAGE:${detectedModelInUser}]`;
    } else if (isAskingForFlare(userText)) {
      aiReply += ` [SEND_FLARE_IMAGE:${detectedModelInUser}]`;
    } else if (isAskingForReal(userText)) {
      aiReply += ` [SEND_REAL_IMAGE:${detectedModelInUser}]`;
    } else {
      aiReply += ` [SEND_ALL_IMAGES:${detectedModelInUser}]`;
    }
  } else {
    // Auto-Tag Guarantee: If reply promised photo or user requested photo, guarantee tag exists
    const hasAnyImageTag = /\[\s*SEND_[A-Z_]+[^\]]*\]/i.test(aiReply);
    if ((promisesPhotoInReply || userWantedPhoto) && !hasAnyImageTag) {
      const fallbackModel = activeModel || 'DF-101';
      aiReply += ` [SEND_IMAGE:${fallbackModel}]`;
    } else if (!userWantedPhoto && !promisesPhotoInReply && !isAskingForCatalogOverview(userText) && !isAskingForAllCatalog(userText, session.messages)) {
      aiReply = aiReply.replace(/\[\s*SEND_[A-Z_]+[^\]]*\]/gi, '').trim();
    }
  }

  // Guard: Direct Height inquiry guarantees exact inch and size guidance
  if (/(?:fut|ফুট|ft|ইঞ্চি|উচ্চতা|হাইট|height)/i.test(userText) || /\d\s*(?:fut|ফুট|ft)/i.test(userText)) {
    if (/(?:5|৫)\s*(?:fut|ফুট|ft)\s*(?:5|৫)/i.test(userText)) {
      if (!aiReply.includes('৫৪ ইঞ্চি')) {
        aiReply += ' ৫ ফুট ৫ ইঞ্চি উচ্চতার জন্য ৫৪ ইঞ্চি ঝুল / ৫৪ সাইজ একদম পারফেক্ট হবে।';
      }
    } else if (/(?:5|৫)\s*(?:fut|ফুট|ft)\s*(?:[23]|২|৩)|5['’]3/i.test(userText)) {
      if (!aiReply.includes('৫২ ইঞ্চি')) {
        aiReply += ' ৫ ফুট ৩ ইঞ্চি উচ্চতার জন্য ৫২ ইঞ্চি ঝুল / ৫২ সাইজ একদম পারফেক্ট হবে।';
      }
    } else if (/(?:4|৪)\s*(?:fut|ফুট|ft)\s*(?:4|৪)/i.test(userText)) {
      if (!aiReply.includes('কাস্টমাইজ') && !aiReply.includes('৪৪')) {
        aiReply += ' ৪ ফুট ৪ ইঞ্চি উচ্চতার জন্য আমাদের রেগুলার সাইজ বড় হতে পারে, তবে আপনি চাইলে ৪৪ বা ৪৬ সাইজে কাস্টমাইজ করে নিতে পারেন।';
      }
    } else if (/(?:5|৫)\s*(?:fut|ফুট|ft)\s*(?:8|৮)|হিল/i.test(userText)) {
      if (!aiReply.includes('৫৮') && !aiReply.includes('৫৬')) {
        aiReply += ' ৫ ফুট ৮ ইঞ্চি ও হিল পরার ক্ষেত্রে ৫৬ বা স্পেশাল ৫৮ ইঞ্চি সাইজ উপযুক্ত হবে।';
      }
    }
  }

  // Guard: Stage 2 model selection strictly strips accidental price dumps
  if (detectedModelInUser && wantsImage && !isAskingForPriceOrDetails(userText)) {
    aiReply = aiReply.replace(/(?:মূল্য|প্রাইজ|প্রাইস|দাম)[\s:]*৳?[\d,০-৯]+\s*টাকা?/gi, '').trim();
    aiReply = aiReply.replace(/৳\s*[\d,০-৯]+/gi, '').trim();
  }

  // Guard: Order intent preserves previously discussed model code
  if (/(?:অর্ডার|order|কনফার্ম|confirm|নিতে\s*চাই)/i.test(userText) && activeModel) {
    if (!aiReply.includes(activeModel)) {
      aiReply = `জি অবশ্যই! আপনার পছন্দের ${activeModel} মডেলটি অর্ডার কনফার্ম করতে ${aiReply}`;
    }
  }

  // Guard: Asking for price or details guarantees model, price, fabric & delivery info
  if (isAskingForPriceOrDetails(userText) && activeModel) {
    const prod = getProductByCode(activeModel);
    if (prod) {
      if (!aiReply.includes(activeModel)) {
        aiReply = `${activeModel} - ${aiReply}`;
      }
      if (!aiReply.includes('ফেব্রিক') && !aiReply.includes('কাপড়')) {
        aiReply += ` (ফেব্রিক: ${prod.fabric || 'প্রিমিয়াম চেরি'})`;
      }
      if (!aiReply.includes('ডেলিভারি চার্জ')) {
        aiReply += ` ডেলিভারি চার্জ: ঢাকায় ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}।`;
      }
    }
  }

  // Guard: Delivery timeline completeness
  if (/(?:কয়দিনে|কবে|সময়|timeline)/i.test(userText) && /ডেলিভারি/i.test(userText)) {
    if (!aiReply.includes('২৪ থেকে ৪৮')) {
      aiReply = `ঢাকার ভেতরে ২৪ থেকে ৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ২ থেকে ৩ দিনের মধ্যে ডেলিভারি সম্পন্ন হয়। ডেলিভারি চার্জ ঢাকায় ৳${storeSettings.inside_dhaka_fee} টাকা, বাইরে ৳${storeSettings.outside_dhaka_fee} টাকা। ${aiReply}`;
    }
  }

  // Update session state
  if (aiReply.includes('আসসালামু') || aiReply.includes('স্বাগতম')) {
    session.hasGreeted = true;
  }
  if (aiReply.includes('ডেলিভারি চার্জ') || aiReply.includes('৮০') || aiReply.includes('১৫০')) {
    session.deliveryFeeMentioned = true;
  }
  if (activeModel && !session.imagesSentForModels.includes(activeModel)) {
    session.imagesSentForModels.push(activeModel);
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
  classifyMessageComplexity,
  transcribeAudioWithGroq
};
