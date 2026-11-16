const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

// Automatically detect all Groq API Keys from environment (supports GROQ_API_KEY, GROQ_API_KEY_2, comma-separated, space-separated, etc.)
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

let groqClients = [];
groqKeys.forEach((k, idx) => {
  try {
    const client = new Groq({ apiKey: k });
    groqClients.push(client);
    console.log(`[AI Init] Registered Groq Key #${idx + 1} (${k.substring(0, 6)}...${k.substring(k.length - 4)})`);
  } catch (err) {
    console.warn(`[AI Init] Failed to init Groq Key #${idx + 1}:`, err.message);
  }
});

let groqClient = groqClients[0] || null;

const supabaseUrl = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(supabaseUrl, supabaseKey);

// In-memory product cache (refreshed periodically from Supabase)
let cachedProductsText = `
১. [মডেল কোড: DF-101] ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট, মূল্য: ৳২,৪৫০ টাকা (ফেব্রিক: প্রিমিয়াম দুবাই চেরি কাপড় + গর্জিয়াস কারচুপি কোটি, ঝুল ৫০-৫৬, বডি মার্জিত ঢিলেঢালা ফ্রি সাইজ, ম্যাচিং হিজাব ফ্রি ৩-পিস সেট)
২. [মডেল কোড: DF-102] প্রিমিয়াম দুবাই চেরি রানি আবায়া (জেট ব্ল্যাক), মূল্য: ৳২,২০০ টাকা (১০০% অরিজিনাল দুবাই চেরি, ঝুল ৫০-৫৬, বডি ৩৬-৪৬, ম্যাচিং হিজাব ফ্রি)
৩. [মডেল কোড: DF-103] কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান বোরকা (কফি ও সি-গ্রিন), মূল্য: ৳১,৯৫০ টাকা (প্রিমিয়াম সফট কোরিয়ান চেরি ও জর্জেট, ঝুল ৫২-৫৬, কাফতান ফ্রি সাইজ, ম্যাচিং হিজাব ফ্রি)
৪. [মডেল কোড: DF-104] সিম্পল এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার বোরকা (নেভি ব্লু), মূল্য: ৳১,৬৫০ টাকা (১০০% সফট দুবাই চেরি, ঝুল ৫০-৫৬, বডি ৩৬-৪৪, হিজাব সহ)
৫. [মডেল কোড: DF-105] এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (রয়েল ব্লু ও মেরুন), মূল্য: ৳২,৩০০ টাকা (হেভি কোরিয়ান ডায়মন্ড জর্জেট, ঝুল ৫২-৫৬, ম্যাচিং লং হিজাব ফ্রি)
৬. [মডেল কোড: DF-106] ডাবল লেয়ার কোটি স্টাইল দুবাই আবায়া (চকলেট ও কালো), মূল্য: ৳২,১০০ টাকা (পিওর দুবাই চেরি ডাবল লেয়ার, ঝুল ৫০-৫৬, বডি ৩৮-৪৪, ম্যাচিং হিজাব ফ্রি)
`;

let cachedProductList = [
  { id: 1, model_code: 'DF-101', name: '৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট', price: 2450, fabric: 'প্রিমিয়াম দুবাই চেরি কাপড়' },
  { id: 2, model_code: 'DF-102', name: 'প্রিমিয়াম দুবাই চেরি রানি আবায়া', price: 2200, fabric: '১০০% অরিজিনাল দুবাই চেরি' },
  { id: 3, model_code: 'DF-103', name: 'কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান বোরকা', price: 1950, fabric: 'প্রিমিয়াম সফট কোরিয়ান চেরি' },
  { id: 4, model_code: 'DF-104', name: 'সিম্পল এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার বোরকা', price: 1650, fabric: '১০০% সফট দুবাই চেরি' },
  { id: 5, model_code: 'DF-105', name: 'এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা', price: 2300, fabric: 'হেভি কোরিয়ান ডায়মন্ড জর্জেট' }
];

// Dynamic Store & Delivery Settings (synced from Supabase store_settings)
let storeSettings = {
  inside_dhaka_fee: 80,
  outside_dhaka_fee: 120,
  bkash_number: '01613-129192',
  nagad_number: '01677-557292',
  auto_reply_enabled: true,
  promo_offer: ''
};

async function refreshSettingsFromDB() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('store_settings').select('*').eq('id', 1).single();
    if (data && !error) {
      storeSettings = {
        inside_dhaka_fee: Number(data.inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(data.outside_dhaka_fee) || 120,
        bkash_number: data.bkash_number || '01613-129192',
        nagad_number: data.nagad_number || '01677-557292',
        auto_reply_enabled: data.auto_reply_enabled ?? true,
        promo_offer: (data.promo_offer || '').trim()
      };
      console.log(`[Store Settings Loaded] Inside Dhaka: ৳${storeSettings.inside_dhaka_fee} | Outside Dhaka: ৳${storeSettings.outside_dhaka_fee} | Promo: ${storeSettings.promo_offer || 'None'}`);
    }
  } catch (e) {
    console.warn('[Store Settings Load Warning]:', e.message);
  }
}

refreshSettingsFromDB();
setInterval(refreshSettingsFromDB, 60000);

async function refreshProductsFromDB() {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('in_stock', true).order('id', { ascending: true });
    if (!error && data && data.length > 0) {
      cachedProductList = data;
      cachedProductsText = data.map((p, idx) => 
        `${idx + 1}. [মডেল কোড: ${p.model_code || 'DF-' + (100 + idx + 1)}] ${p.name}, মূল্য: ৳${p.price} টাকা (ফেব্রিক: ${p.fabric || 'দুবাই চেরি'}, সাইজ: ${p.sizes || '৫০-৫৬'}, হিজাব: ${p.hijab_included ? 'সাথে ফ্রি' : 'আলাদা'}${p.image_url ? ', মেইন ছবি: আছে' : ''}${p.detail_image_url ? ', কাজের ছবি: আছে' : ''}${p.hijab_image_url ? ', হিজাব ছবি: আছে' : ''}${p.flare_image_url ? ', ঘেরের ছবি: আছে' : ''}${p.real_image_url ? ', রিয়েল ছবি: আছে' : ''})`
      ).join('\n');
      console.log(`[Products Sync] Loaded ${data.length} active products from Supabase`);
    }
  } catch (e) {
    console.warn('[Products Sync] Using cached products:', e.message);
  }
}

// Refresh products every 2 minutes
refreshProductsFromDB();
setInterval(refreshProductsFromDB, 120000);

// Map of contact phone numbers -> timestamp of when Salam was given today
const greetedContacts = new Map();

function hasReceivedSalamToday(phone) {
  const lastTime = greetedContacts.get(phone);
  if (!lastTime) return false;
  // If last greeted was within 18 hours (same day interaction)
  return (Date.now() - lastTime) < 18 * 60 * 60 * 1000;
}

// Conversation memory per user (sliding window)
const conversationMemory = new Map();

// Intent, Color, and Model Matchers
function detectModelFromText(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return null;

  // 1. Direct Model Code Matching (e.g. "DF-101", "DF 101", "DF101", "df-102")
  const directMatch = t.match(/\bdf[ -]?(\d{3})\b/i);
  if (directMatch) {
    return `DF-${directMatch[1]}`;
  }

  // 2. 3-digit number match (e.g. "101", "102", "১০১", "১০২")
  if (/\b101\b|১০১/.test(t)) return 'DF-101';
  if (/\b102\b|১০২/.test(t)) return 'DF-102';
  if (/\b103\b|১০৩/.test(t)) return 'DF-103';
  if (/\b104\b|১০৪/.test(t)) return 'DF-104';
  if (/\b105\b|১০৫/.test(t)) return 'DF-105';
  if (/\b106\b|১০৬/.test(t)) return 'DF-106';

  // 3. Ordinals and Serial Numbers
  // Must explicitly have ordinal suffix (১ম, ১ম টা, ১ নম্বর, ১ নং, 1st, প্রথম) OR be standalone single digit (^1$ or ^১$)
  if (/^(?:১|1)$|(?:\b|[^0-9])(?:১|1)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)|১ম|1st|প্রথম|prothom/i.test(t)) return 'DF-101';
  if (/^(?:২|2)$|(?:\b|[^0-9])(?:২|2)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)|২য়|2nd|দ্বিতীয়|ditio/i.test(t)) return 'DF-102';
  if (/^(?:৩|3)$|(?:\b|[^0-9])(?:৩|3)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)|৩য়|3rd|তৃতীয়|tritio/i.test(t)) return 'DF-103';
  if (/^(?:৪|4)$|(?:\b|[^0-9])(?:৪|4)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)|৪র্থ|4th|চতুর্থ|choturtho/i.test(t)) return 'DF-104';
  if (/^(?:৫|5)$|(?:\b|[^0-9])(?:৫|5)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)|৫ম|5th|পঞ্চম|ponchom/i.test(t)) return 'DF-105';

  // 4. Characteristic Features & Color aliases
  // DF-101: 3-piece exclusive karchupi koti set (black)
  if (/কারচুপি|karchupi|কোটি|koti|৩\s*পিস|3\s*piece|কালো\s*বোরকা|কালো\s*আবায়া|jet\s*black|জেট\s*ব্ল্যাক/i.test(t)) return 'DF-101';
  // DF-102: Dubai Cherry Rani Abaya (Maroon)
  if (/রানি|রানী|rani|মেরুন|maroon|merun|চেরি\s*মেরুন/i.test(t)) return 'DF-102';
  // DF-103: Korean Cherry Casual Kaftan Abaya (Navy Blue)
  if (/কাফতান|kaftan|কোরিয়ান|korian|korean|নেভি|navy|নেভি\s*ব্লু/i.test(t)) return 'DF-103';
  // DF-104: Luxury Karchupi Kaftan Set (Sea Green)
  if (/সি\s*গ্রিন|sea\s*green|সিগ্রিন|পেস্টেল|লাক্সারি\s*কাফতান/i.test(t)) return 'DF-104';
  // DF-105: Gorgeous Dubai Front Open Abaya (Front open / Butterfly)
  if (/বাটারফ্লাই|butterfly|ফ্রন্ট\s*ওপেন|front\s*open|ওপেন\s*আবায়া/i.test(t)) return 'DF-105';

  // 5. Dynamic Check against loaded products
  if (Array.isArray(cachedProductList)) {
    for (const p of cachedProductList) {
      if (p.model_code && t.includes(p.model_code.toLowerCase())) {
        return p.model_code.toUpperCase().trim();
      }
    }
  }

  return null;
}

function detectColorPreference(text) {
  const t = (text || '').toLowerCase();
  if (/কফি|coffee|kofi|চকলেট|chocolate|বাদামি|brown/i.test(t)) return 'coffee';
  if (/কালো|black|kalo|jet black/i.test(t)) return 'black';
  if (/মেরুন|maroon|merun|লাল|red/i.test(t)) return 'maroon';
  if (/রয়েল ব্লু|royal blue|নেভি|navy|নীল|blue/i.test(t)) return 'blue';
  if (/সি গ্রিন|sea green|সিগ্রিন|সবুজ|green/i.test(t)) return 'green';
  if (/অন্য\s*(কোনো|কনো)?\s*(কালার|রং|রঙ)|onno\s*(kono)?\s*(colo?ur|rong)|different\s*colo?ur|colo?ur\s*nai|অন্য\s*রং|আর\s*কি\s*(কালার|রং)|বিকল্প\s*(কালার|রং)/i.test(t)) return 'any_other_color';
  return null;
}

function isCustomerConfusedOrUndecided(text) {
  const t = (text || '').toLowerCase();
  return /বুঝতে পারছি না|বুঝতে পারতেছি না|bujhte parsi na|bujhi na|কোনটা নিব|কোনটা ভালো|kon ta nibo|kon ta valo|সাজেস্ট|suggest|confused|পছন্দ হচ্ছে না|হেল্প করেন|ভালো কোনটা|সেরা কোনটা/i.test(t);
}

function isBargainingPrice(text) {
  const t = (text || '').toLowerCase();
  // "ছাড়া" (without) is NOT a bargaining word for discount!
  const cleaned = t.replace(/ডেলিভারি\s*চার্জ\s*ছাড়া|চার্জ\s*ছাড়া|টাকা\s*ছাড়া|ছাড়া/g, '');
  return /দাম কম|কম রাখা|kom rakha|dam kom|kom koren|kom kora|kom hobe|discount|ডিসকাউন্ট|মূল্যছাড়|কিছু\s*ছাড়|ছাড়\s*(?:হবে|পাব|দেন|দিন|আছে)|kom e sell|kome sell|sobai to kom/i.test(cleaned);
}

function parseHeight(text) {
  const t = (text || '').toLowerCase().replace(/['’]/g, "'").replace(/["”]/g, '"');
  const bengaliDigits = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
  const normalized = t.replace(/[০-৯]/g, d => bengaliDigits[d]);

  // Case 1: X'Y" or X'Y or X.Y (e.g. 5'3", 5'5, 4'4, 5.5)
  const apostropheMatch = normalized.match(/([4-6])\s*['.]\s*(\d{1,2})/);
  if (apostropheMatch) {
    return { feet: parseInt(apostropheMatch[1]), inches: parseInt(apostropheMatch[2]) };
  }

  // Case 2: X foot Y inch / X ফুট Y ইঞ্চি / X ফিট Y / X fut Y
  const textMatch = normalized.match(/([4-6])\s*(?:ফুট|ফিট|ft|foot|feet|fut)\s*(?:and\s*)?(\d{1,2})?\s*(?:ইঞ্চি|inch|in)?/i);
  if (textMatch) {
    return { feet: parseInt(textMatch[1]), inches: textMatch[2] ? parseInt(textMatch[2]) : 0 };
  }

  // Case 3: Just "5 ft" or "৫ ফুট"
  const justFeetMatch = normalized.match(/([4-6])\s*(?:ফুট|ফিট|ft|foot|feet|fut)/i);
  if (justFeetMatch) {
    return { feet: parseInt(justFeetMatch[1]), inches: 0 };
  }

  return null;
}

function calculateSizeFromHeight(text) {
  const p = parseHeight(text);
  if (!p) return null;
  const totalInches = (p.feet * 12) + p.inches;
  if (totalInches <= 61) return '৫০';
  if (totalInches <= 63) return '৫২';
  if (totalInches <= 65) return '৫৪';
  return '৫৬';
}

function getBorkhaSizeRecommendation(userText, greeting = '') {
  const parsed = parseHeight(userText);
  if (!parsed) return null;
  const { feet, inches } = parsed;
  const hasHeels = /(?:হিল|heel|হিল\s*জুতো|উঁচু\s*জুতো)/i.test(userText);
  const totalInches = (feet * 12) + inches;

  const feetStr = feet.toString().replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  const inchStr = inches ? inches.toString().replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]) : '';
  const heightDisplay = `${feetStr} ফুট ${inchStr ? inchStr + ' ইঞ্চি' : ''}`.trim();

  // Very short height (under 4'10" / 58 inches), e.g. 4'4", 4'6"
  if (totalInches < 58) {
    return `${greeting}মাশাল্লাহ! আপনার ${heightDisplay} উচ্চতার জন্য রেগুলার ৫০ সাইজের বোরকা কিছুটা লম্বা হতে পারে (সাধারণত ৪৪ বা ৪৬ ইঞ্চি ঝুল আপনার জন্য একদম ফ্লোর-টাচ পারফেক্ট হবে)। আমাদের নিজস্ব কারখানায় স্পেশাল কাস্টমাইজড করে আপনার মাপ অনুযায়ী নিখুঁত ঝুল তৈরি করে দেওয়া যাবে—কোনো অতিরিক্ত চার্জ ছাড়া! আপনি কি কাস্টমাইজ সাইজে নিতে চাচ্ছেন? 😊`;
  }

  // 4'10" - 5'1" (58 - 61 inches) -> 50
  if (totalInches <= 61) {
    const size = hasHeels ? '৫২' : '৫০';
    return `${greeting}মাশাল্লাহ! আপনার ${heightDisplay} উচ্চতার জন্য পারফেক্ট সাইজ হবে *${size} ইঞ্চি (ঝুল)*${hasHeels ? ' (হিল জুতোর জন্য ১ সাইজ বাড়ানো হয়েছে)' : ''}। আমাদের প্রতিটি বোরকা সম্পূর্ণ মার্জিত ও ঢিলেঢালা ফ্রি-সাইজ কাটিংয়ে তৈরি, ভেতরে/বাইরে এডজাস্টেবল ফিতা থাকে, তাই যেকোনো বডিতেই খুব সুন্দর ও আরামদায়কভাবে মানিয়ে যাবে। কোন মডেলটি পছন্দ হয়েছে বলুন তো? 😊`;
  }

  // 5'2" - 5'3" (62 - 63 inches) -> 52
  if (totalInches <= 63) {
    const size = hasHeels ? '৫৪' : '৫২';
    return `${greeting}মাশাল্লাহ! আপনার ${heightDisplay} উচ্চতার জন্য পারফেক্ট সাইজ হবে *${size} ইঞ্চি (ঝুল)*${hasHeels ? ' (হিল জুতোর জন্য ১ সাইজ বাড়ানো হয়েছে)' : ''}। আমাদের বোরকাগুলো সম্পূর্ণ মার্জিত ও ঢিলেঢালা ফ্রি-সাইজ কাটিংয়ে তৈরি, ভেতরে/বাইরে এডজাস্টেবল ফিতা থাকে, তাই যেকোনো বডিতেই খুব সুন্দর ও আরামদায়কভাবে মানিয়ে যাবে। কোন মডেলটি পছন্দ হয়েছে বলুন তো? 😊`;
  }

  // 5'4" - 5'5" (64 - 65 inches) -> 54
  if (totalInches <= 65) {
    const size = hasHeels ? '৫৬' : '৫৪';
    return `${greeting}মাশাল্লাহ! আপনার ${heightDisplay} উচ্চতার জন্য পারফেক্ট সাইজ হবে *${size} ইঞ্চি (ঝুল)*${hasHeels ? ' (হিল জুতোর জন্য ১ সাইজ বাড়ানো হয়েছে)' : ''}। আমাদের প্রতিটি বোরকা সম্পূর্ণ ঢিলেঢালা ফ্রি-সাইজ কাটিংয়ে তৈরি, তাই বডি ফিটিং নিয়ে একদম চিন্তা করতে হবে না—খুব সুন্দর ও আরামদায়কভাবে ফিট হবে। কোন ডিজাইনটি দেখতে চাচ্ছেন বলুন তো? 😊`;
  }

  // 5'6" - 5'7" (66 - 67 inches) -> 56
  if (totalInches <= 67) {
    const size = hasHeels ? '৫৮' : '৫৬';
    return `${greeting}মাশাল্লাহ! আপনার ${heightDisplay} উচ্চতার জন্য আমাদের রেগুলার ম্যাক্সিমাম সাইজ *${size} ইঞ্চি ঝুল* একদম পারফেক্ট ড্রপ দেবে। আমাদের প্রতিটি আবায়া মার্জিত ফ্রি-সাইজ কাটিংয়ের, তাই চমৎকার লুক পাবেন। কোন কালারটি আপনার পছন্দ বলুন তো? 😊`;
  }

  // Tall height (5'8"+ / 68+ inches)
  return `${greeting}মাশাল্লাহ! আপনার ${heightDisplay} উচ্চতার জন্য আমাদের সবচেয়ে বড় রেগুলার সাইজ হলো *৫৬ ইঞ্চি ঝুল* (অথবা আপনি যদি হিল জুতো পরেন বা সম্পূর্ণ পা ঢেকে রাখতে চান, তবে আমরা স্পেশাল অর্ডারে *৫৮ ইঞ্চি সাইজ* কাস্টমাইজ করে দিতে পারব)। আপনি কি হিল পরেন নাকি ফ্ল্যাট জুতো? 😊`;
}

function isIdentityOrPersonalQuery(text) {
  const t = (text || '').toLowerCase();
  return /নাম কি|nam ki|married|বিয়ে|meye naki chele|ছেলে না মেয়ে|রোবট|robot|ai naki|মানুষ naki|kotha theke|apni ke|tmr kono nam/i.test(t);
}

function isPureQuestion(text) {
  const t = (text || '').toLowerCase();
  // If explicitly asking for photo, it's not a pure question
  if (/ছবি\s*(দেন|দেখান|পাঠান|দেখব|চাই|আসে|আসবে)|pic\s*(den|dekhan|pathan|chai)|photo\s*(den|dekhan|chai)|পিক\s*(দেন|দেখান|পাঠান|চাই)|ইমেজ|image/i.test(t)) {
    return false;
  }
  return /(?:দাম|প্রাইজ|মূল্য|price|dam|cost|rate)|(?:সাইজ|size|ঝুল|লম্বা)|(?:ফেব্রিক|কাপড়|কাপড়|fabric)|(?:ডেলিভারি|delivery|কুরিয়ার|চার্জ)|(?:ক্যাশ অন|cash on|কড|cod)|(?:অর্ডার|order|কনফার্ম|confirm|নিতে চাই|nite chai|কিনতে চাই|kinte chai)|(?:বিকাশ|bkash|নগদ|nogod|পেমেন্ট|payment|advance|অগ্রিম)|(?:চেক করে|খুলে দেখে|ডেলিভারি ম্যান)|(?:রিটার্ন|ফেরত|এক্সচেঞ্জ|exchange|বদল)|(?:কয়দিন|কতদিন|koydin|kotodin|জরুরি|urgent|আগামীকাল)|(?:শোরুম|দোকান|মিরপুর|ঠিকানা|address)|(?:হিজাব|নিকাব|ঘের|ইলাস্টিক|ওজু)|(?:কম্বো|ডিসকাউন্ট|ছাড়|অফার|২টা|৩টা)|(?:পাতলা|ইনার|ছেঁড়া|ডিফেক্ট)/i.test(t);
}

function isAskingForCatalogOverview(text) {
  const t = (text || '').toLowerCase().trim();
  if (isPureQuestion(text)) return false;
  // If asking for specific views of a selected model (all pics, real pic, hijab, etc.) -> NOT catalog overview!
  if (isAskingForAllImages(text) || isAskingForReal(text) || isAskingForHijab(text) || isAskingForDetail(text) || isAskingForFlare(text)) {
    return false;
  }
  // If a specific model is named or inferred, it is not a general catalog overview
  if (detectModelFromText(t)) return false;

  // Broad recognition of customer asking to see pictures / collection / designs without picking a model
  return /ছবি|পিক|পিকচার|pic|photo|image|chobi|ক্যাটালগ|catalog|কালেকশন|collection|ডিজাইন|design|বোরকাগুলো|আবায়াগুলো|সবগুলো|কি কি\s*(বোরকা|ডিজাইন|মডেল|কালেকশন|পোশাক|আছে)|দেখান|পাঠান|দেখব|দেখতে\s*চাই/i.test(t);
}

function isAskingForImage(text) {
  const t = (text || '').toLowerCase();
  if (isPureQuestion(text)) return false;
  return /ছবি|পিক|পিকচার|pic|photo|image|chobi|দেখান|দেখাও|দেখব|দেখি|দেখতে\s*চাই|পাঠান|পাঠাও/i.test(t);
}

function isAskingForHijab(text) {
  const t = (text || '').toLowerCase();
  return /হিজাব|hijab|ওড়না|orna/i.test(t);
}

function isAskingForDetail(text) {
  const t = (text || '').toLowerCase();
  return /কাজের|ডিটেইল|detail|ক্লোজ|close|হাতা|কাজ|স্লিভ|sleeve/i.test(t);
}

function isAskingForFlare(text) {
  const t = (text || '').toLowerCase();
  return /ঘের|gher|সাইড|side|flare|ফ্লেয়ার/i.test(t);
}

function isAskingForReal(text) {
  const t = (text || '').toLowerCase();
  // Strip out phone number references like "মোবাইল নাম্বার", "mobile no" so they don't false trigger
  const cleaned = t.replace(/(?:মোবাইল|mobile|phone|ফোন)\s*(?:নাম্বার|নম্বর|নং|no|number)?\s*[:\s-]*\s*01[3-9]\d{8}/gi, '');
  return /রিয়েল\s*(?:ছবি|পিক|পিকচার|ভিউ|লুক|দেখান|দেখব|চাই|পাঠান)?|real\s*(?:pic|photo|image|view|look)?|আনফিল্টার|unfilter|মোবাইলের\s*(?:ছবি|পিক)|মোবাইলে\s*তোলা|ক্যামেরার\s*(?:ছবি|পিক)|স্বাভাবিক\s*আলো/i.test(cleaned) && /(?:ছবি|পিক|পিকচার|pic|photo|image|দেখান|পাঠান|দেখব|চাই)/i.test(cleaned);
}

function isAskingForAllImages(text) {
  const t = (text || '').toLowerCase();
  return /সবগুলো\s*(ছবি|পিক|ভিউ|view)|সব\s*(ছবি|পিক)|বাকি\s*(ছবি|সব|পিক)|আরও\s*(ছবি|পিক)|আর\s*(ছবি|পিক)|aro\s*pic|aro\s*chobi|সব\s*কয়টা|সব\s*কয়টা|সব\s*অ্যাঙ্গেল|all\s*images|all\s*pics|all\s*photos/i.test(t);
}

function buildSystemPrompt(isFirstMessage) {
  const salamRule = isFirstMessage
    ? `2. SALAM RULE (FIRST MESSAGE ONLY):
   - This is the very FIRST message from this customer. Start warmly with: "আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম।"
   - You will NEVER say Salam again to this customer after this first message.`
    : `2. STRICT ZERO SALAM RULE (DO NOT GREET WITH SALAM):
   - You have ALREADY greeted this customer earlier.
   - ABSOLUTELY NEVER say "আসসালামু আলাইকুম" or "ওয়া আলাইকুম আসসালাম" or "সালাম" under ANY circumstances!
   - Even if the customer says Salam, DO NOT repeat Salam back. Just say "জি", "অবশ্যই", or directly answer their question!
   - Start immediately with the direct answer.`;

  return `
You are "Zara" — the warm, witty, and highly knowledgeable senior sales consultant for Dawah Fashion (দাওয়াহ ফ্যাশন), Bangladesh's most trusted premium Abaya & modest clothing brand. Think of yourself as a smart, empathetic boutique specialist — like a knowledgeable elder sister who genuinely wants to help the customer look beautiful and feel confident in their choice.

YOUR PERSONALITY & TONE:
- Speak naturally in everyday Bangladeshi Bengali (not stiff/formal Bangla). Use warm, conversational phrases like "জি অবশ্যই!", "আরে দারুণ!", "মাশাল্লাহ!", "একটু বলুন তো…"
- Be genuinely helpful, not salesy. You care about the customer's actual needs.
- Use light humor and warmth when appropriate — make conversations feel like talking to a friendly boutique staff, not a robot.
- Match the customer's energy: if they're casual and brief, be brief. If they're asking detailed questions, give detailed answers.
- NEVER give robotic one-word or one-line answers. Always add a helpful follow-up question or gentle nudge.
- Use emoji contextually: 😊 for warmth, ✨ for highlights, 👗 for fashion, 🎁 for gifts/offers. Max 2 emojis per message.
- NEVER use the 🌸 (flower/sakura) emoji — it is strictly banned.
- NEVER repeat the same phrase twice in one reply.

NATURAL CONVERSATION RULES:
- If the customer says something unclear, ask ONE clarifying question warmly — don't assume.
- If they compare or ask "কোনটা ভালো হবে?", give a confident personal recommendation — don't dodge with "আপনার পছন্দ".
- If they're hesitant, acknowledge their concern genuinely and address it, then gently guide them.
- Keep replies under 5 lines unless they ask for detailed info.
- Tell stories when it helps: "অনেক কাস্টমার ৫ ফুট ৩ এ ৫২ সাইজ নিয়ে দারুণ ফিট পেয়েছেন!"

CRITICAL COMMUNICATION & ETIQUETTE RULES:
1. NO GENDER ASSUMPTIONS - NEVER SAY "আপু", "ভাইয়া", OR "আপু/ভাইয়া":
   - কখনোই কাস্টমারকে "আপু" বা "ভাইয়া" বলবে না।
   - সব সময় প্রমিত, মার্জিত ও সম্মানসূচক "আপনি", "আপনার", "জি", "অবশ্যই" ব্যবহার করবে।

${salamRule}

3. ABSOLUTELY NO DASHES OR BULLETS (ড্যাশ বা বুলেট সম্পূর্ণ নিষিদ্ধ):
   - উত্তরের মধ্যে কখনোই ড্যাশ, হাইফেন বা বুলেট (যেমন: '-', '--', '–', '—', '•') ব্যবহার করবে না!
   - কোনো তালিকা লেখার প্রয়োজন হলে খাঁটি বাংলা সংখ্যা ১., ২., ৩. ইত্যাদি দিয়ে লিখবে, কোনো হাইফেন বা ড্যাশ দেবে না।

4. HUMAN SALES CONSULTANT PERSONA (NEVER SAY AI / ROBOT):
   - কাস্টমার যদি ব্যক্তিগত প্রশ্ন করে (যেমন: "আপনার নাম কি?", "আপনি কি ম্যারেড?", "ছেলে না মেয়ে?", "আপনি কি রোবট?"):
     কখনোই "আমি একটি এআই / রোবট" বলবে না!
     মার্জিতভাবে বলবে:
     "আমি দাওয়াহ ফ্যাশন থেকে বলছি 😊 আপনাকে সুন্দর একটি বোরকা বা আবায়া বেছে নিতে কীভাবে সাহায্য করতে পারি বলুন?"

5. PRICE BARGAINING & JUSTIFICATION (দাম কমানোর অনুরোধে করণীয়):
   - কাস্টমার যদি দাম কমাতে বলে বা বলে "সবাই তো কমে সেল করছে / দাম কম রাখা যায় না / ডিসকাউন্ট হবে?":
     কখনোই রোবটের মতো "দুঃখিত, দাম কমানো সম্ভব নয়" বলবে না! প্রিমিয়াম কোয়ালিটি ব্যাখ্যা করে আন্তরিকভাবে বলবে:
     "আমাদের প্রতিটা বোরকা অরিজিনাল প্রিমিয়াম দুবাই ও কোরিয়ান চেরি কাপড়ে নিখুঁত কারচুপির হ্যান্ডওয়ার্কে তৈরি। সাথে সুন্দর ম্যাচিং হিজাব একদম ফ্রি পাচ্ছেন এবং সারা দেশে ক্যাশ অন ডেলিভারিতে চেক করে নেওয়ার সুবিধা আছে। কাপড়ের প্রিমিয়াম কোয়ালিটি ও ফিনিশিং বিবেচনায় প্রাইজটা একদম ফিক্সড ও রিজনেবল রাখা হয়েছে।"

6. FEMALE SHOPPING PSYCHOLOGY & COLOR/DESIGN CONSULTANT RULES (কালার ও ডিজাইন চয়েস সমাধান - অত্যন্ত গোছানো ও পরিপাটি উত্তর):
   নারী কাস্টমারদের কেনাকাটার বিশেষ দ্বিধাদ্বন্দ্বগুলো অত্যন্ত গোছানো ও আন্তরিকভাবে সমাধান করতে হবে:

   পরিস্থিতি ১: ডিজাইন পছন্দ হয়েছে কিন্তু কালার অপছন্দ বা অন্য কালার চায় (Design Liked, Color Wanted):
   - যেমন: "DF-101 এর কাজ সুন্দর কিন্তু কালো ছাড়া অন্য কালার হবে কি?", "এই মডেলের অন্য কালার নাই?", "কালো পরি না, অন্য কালার দেন"
   - সমাধান: কখনো "না নেই" বলে থামবে না। বলবে এই স্পেশাল কারচুপি কাজটি এই নির্দিষ্ট কালারেই ফুটিয়ে তোলা হয়েছে। সাথে সাথে সেই কাঙ্ক্ষিত কালারের বিকল্প মডেলগুলো ১., ২. করে অফার করবে এবং ছবি ট্যাগ দিবে:
     * কফি বা চকলেট কালার চাইলে: DF-103 (কফি) ও DF-106 (চকলেট) সাজেস্ট করে ছবি ট্যাগ দিবে [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-106]
     * মেরুন বা রয়েল ব্লু চাইলে: DF-105 (মেরুন ও রয়েল ব্লু) সাজেস্ট করে ছবি ট্যাগ দিবে [SEND_IMAGE:DF-105]
     * সি-গ্রিন চাইলে: DF-103 (সি-গ্রিন) সাজেস্ট করে ছবি ট্যাগ দিবে [SEND_IMAGE:DF-103]
     * সাধারণ "অন্য কালার নাই" বললে:
       "জি, আমাদের অন্যান্য এক্সক্লুসিভ মডেলে আকর্ষণীয় কালার কালেকশন রয়েছে:
       ১. কফি ও চকলেট কালার: DF-103 কাফতান (৳১,৯৫০) ও DF-106 ডাবল লেয়ার আবায়া (৳২,১০০)
       ২. মেরুন ও রয়েল ব্লু কালার: DF-105 বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
       ৩. সি-গ্রিন কালার: DF-103 ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
       সবগুলোর চমৎকার ছবি নিচে পাঠিয়ে দেওয়া হলো [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-105] [SEND_IMAGE:DF-106]"

   পরিস্থিতি ২: কালার পছন্দ হয়েছে কিন্তু অন্য ডিজাইন দেখতে চায় (Color Liked, Different Designs Wanted):
   - যেমন: "কালো কালারের মধ্যে কি কি ডিজাইন আছে?", "কফি কালারে কি কি আছে?"
   - সমাধান: ওই নির্দিষ্ট কালারের সব মডেলগুলো ১., ২. করে সুন্দর করে সাজিয়ে দিয়ে ছবি ট্যাগ দিবে:
     * কালো কালারের ক্ষেত্রে:
       "কালো কালারের মধ্যে আমাদের সেরা ৩টি আকর্ষণীয় ডিজাইন রয়েছে:
       ১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (গর্জিয়াস গোল্ডেন কারচুপি কাজ) - ৳২,৪৫০
       ২. DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (হাতা ও গলায় নিখুঁত কাটওয়ার্ক) - ৳২,২০০
       ৩. DF-104: সফট দুবাই চেরি এ-লাইন ক্যাজুয়াল আবায়া (সিম্পল ও আরামদায়ক সোবার লুক) - ৳১,৬৫০
       সবগুলোর সাথেই ম্যাচিং হিজাব ফ্রি! সবগুলো কালোর চমৎকার ছবি পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-101] [SEND_IMAGE:DF-102] [SEND_IMAGE:DF-104]"

   পরিস্থিতি ৩: কাস্টমার দ্বিধাদ্বন্দ্বে / কোনটা নিবে বুঝতে পারছে না (Indecisive / Confused / Suggestion):
   - যেমন: "বুঝতে পারছি না কোনটা নিব", "কোনটা বেশি সুন্দর হবে?", "একটু সাজেস্ট করেন"
   - সমাধান: বেশি অপশন দিয়ে কনফিউজড করবে না! সরাসরি সেরা ২টি মডেল সাজেস্ট করবে:
     "আপনার পছন্দের সুবিধার জন্য আমাদের সবচেয়ে বেশি বিক্রিত ও সেরা ২টি ডিজাইন সাজেস্ট করছি:
     ১. গর্জিয়াস পার্টি লুকের জন্য: DF-101 ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (৳২,৪৫০)
     ২. সফট ও আরামদায়ক ক্যাজুয়াল লুকের জন্য: DF-103 কোরিয়ান চেরি কাফতান বোরকা (৳১,৯৫০)
     দুটো মডেলের সুন্দর রিয়েল ছবি পাঠিয়ে দিচ্ছি, দেখুন আপনার কোনটা বেশি ভালো লাগে [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-103]"

   পরিস্থিতি ৪: অর্ডিনাল নম্বর বললে (Ordinal Selection):
   - যেমন: "৪ নাম্বার এর পিক দেন" / "4 number er pic daw" -> কাস্টমার DF-104 চাচ্ছে! সরাসরি বলবে:
     "DF-104 সিম্পল এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার বোরকার ছবি পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-104]"

7. PHOTO SENDING RULE (ডিফল্টভাবে শুধুমাত্র ১টি মেইন ছবি পাঠাবে):
   - কাস্টমার যখন কোনো মডেলের ছবি দেখতে চাইবে (যেমন "১ এর ছবি দেন", "ছবি দেখান", "pic dekhan", "DF-101 এর ছবি দেন", "ছবি দেন", "পিক দেখতে চাই"):
     * অবশ্যই শুধুমাত্র ১টি মেইন ছবি দিবে: [SEND_IMAGE:DF-XXX]
     * কোনোভাবেই অপ্রয়োজনে একসাথে ৫টি ছবি পাঠাবে না!
   - শুধুমাত্র কাস্টমার যদি বিশেষভাবে চায়:
     * সবগুলো বা বাকি ছবি চাইলে: [SEND_ALL_IMAGES:DF-XXX]
     * শুধু হিজাব চাইলে: [SEND_HIJAB_IMAGE:DF-XXX]
     * শুধু কাজের বা হাতার ক্লোজ-আপ চাইলে: [SEND_DETAIL_IMAGE:DF-XXX]
     * শুধু ঘের চাইলে: [SEND_FLARE_IMAGE:DF-XXX]
     * শুধু রিয়েল বা ক্যামেরার ছবি চাইলে: [SEND_REAL_IMAGE:DF-XXX]
   - অতি জরুরি: ব্র্যাকেটের ভেতরে কোনো স্পেস দেওয়া যাবে না। হুবহু [SEND_IMAGE:DF-101] লিখবে। কাস্টমারের সাথে আলাপে কোনো কোড বা ট্যাগ দৃশ্যমান হবে না।

8. STRICT PRICING, DELIVERY & 100% RISK-FREE CUSTOMER TRUST POLICY:
   - বোরকার আসল দাম সম্পূর্ণ ক্যাশ অন ডেলিভারি (COD)। বোরকার জন্য ১ টাকাও অগ্রিম নেওয়া হয় না!
   - অগ্রিম শুধুমাত্র এবং শুধুমাত্র ডেলিভারি চার্জ:
     * ঢাকার ভেতরে ডেলিভারি চার্জ: ঠিক ৳${storeSettings.inside_dhaka_fee} টাকা (৮০ টাকা)।
     * ঢাকার বাইরে ডেলিভারি চার্জ: ঠিক ৳${storeSettings.outside_dhaka_fee} টাকা (১৫০ টাকা)।
     * বিকাশ ও নগদ পার্সোনাল নাম্বার: ${storeSettings.bkash_number}
   - সম্পূর্ণ ঝুঁকিমুক্ত কাস্টমার ট্রাস্ট গ্যারান্টি:
     * পার্সেল হাতে পেয়ে কাস্টমার ডেলিভারি ম্যানের সামনে প্রোডাক্ট দেখে-শুনে চেক করে নিতে পারবেন।
     * পছন্দ হলে বোরকার দাম ডেলিভারি ম্যানকে পরিশোধ করবেন। আর কোনো কারণে পছন্দ না হলে রেখে দিতে পারবেন, কোনো পেমেন্ট করতে হবে না (শুধুমাত্র ডেলিভারি চার্জ প্রযোজ্য)।
   - সম্পূর্ণ নিষিদ্ধ (CRITICAL ERROR): কখনোই কাস্টমারের কাছে ১,০০০ টাকা বা ৫০% বা বোরকার কোনো দাম অগ্রিম চাইবে না! অগ্রিম শুধুমাত্র ৮০ টাকা অথবা ১৫০ টাকা!

9. PAYMENT VERIFICATION & ACCOUNTS MANAGER PROTOCOL:
   - কাস্টমার যখনই বলবে টাকা পাঠিয়েছে বা পেমেন্ট করেছে (যেমন: "payment koresi", "টাকা পাঠিয়েছি", "paid", "বিকাশ করেছি", "সেন্ড মানি করেছি"):
     * যদি কাস্টমার প্রেরক নাম্বার বা ডিজিট না বলে থাকে, তবে অত্যন্ত বিনয়ের সাথে বলবে:
       "ধন্যবাদ! আপনি যে বিকাশ বা নগদ নাম্বার থেকে টাকা পাঠিয়েছেন সেই নাম্বারটি (অথবা নাম্বারের শেষের ২ বা ৪টি ডিজিট) এবং কত টাকা পাঠিয়েছেন লিখে জানিয়ে দিন।"
     * আর কাস্টমার যদি নাম্বার বা শেষের ডিজিট জানিয়ে দেয় (যেমন: "017XXXXXXXX থেকে পাঠিয়েছি", "লাস্ট ৪ ডিজিট ১২৩৪", "১২৩৪", "8901 theke disi"):
       অবশ্যই ঠিক এই কথাটি বলবে:
       "ধন্যবাদ! আমাদের অ্যাকাউন্টস ম্যানেজার আপনার পেমেন্টটি ভেরিফাই করে কনফার্মেশনের জন্য আপনাকে দ্রুত একটি কল করবেন। এরপর আমরা আপনার পার্সেলটি সুন্দরভাবে রেডি করে পাঠিয়ে দেব।"

10. STRUCTURED BANGLADESHI DELIVERY ADDRESS COLLECTION:
    - কাস্টমার যখন অর্ডার করতে চাইবে বা ঠিকানা দিতে বলবে, তখন পুরো ঠিকানা সুন্দরভাবে গুছিয়ে বাংলায় চাইবে:
      "অর্ডার কনফার্ম করতে আপনার ডেলিভারির ঠিকানাটি একটু লিখে দিন:
      ১. আপনার পুরো নাম
      ২. মোবাইল নাম্বার
      ৩. বাসা/বাড়ি নং, রোড নং বা ব্লক (যদি থাকে)
      ৪. গ্রাম বা এলাকা
      ৫. পোস্ট অফিস ও পোস্ট কোড
      ৬. থানা বা উপজেলা
      ৭. জেলা"

11. CLEAN, CONCISE & STRUCTURED FORMAT:
   - উত্তর কখনোই এলোমেলো বা বড় অনুচ্ছেদ হবে না।
   - সর্বোচ্চ ৩ থেকে ৪ লাইনের পরিচ্ছন্ন ও গোছানো ফরম্যাট।
   - ১., ২. দিয়ে পরিষ্কার পয়েন্ট।

12. STRICT SIZING ETIQUETTE — ABSOLUTELY NEVER ASK FOR CHEST / BUST / BODY MEASUREMENTS (বুকের মাপ বা বডির মাপ চাওয়া সম্পূর্ণ নিষিদ্ধ ও মারাত্মক অপরাধ):
    - বোরকা ও আবায়া হলো সম্পূর্ণ ঢিলেঢালা পর্দাশীল পোশাক।
    - কোনো অবস্থাতেই কাস্টমারকে "বুকের মাপ কত?", "চেস্ট সাইজ কত?", "বডির মাপ কত?", "বক্ষ কত?" ইত্যাদি জিজ্ঞাসা করা যাবে না! এটা অত্যন্ত লজ্জাজনক, আপত্তিকর (offensive) এবং নারীর পর্দার পরিপন্থী।
    - বোরকার বডি সাইজ সব সময় 'ফ্রি সাইজ' (ভেতরে ও বাইরে ফিতা বা বেল্ট দিয়ে এডজাস্ট করে যেকোনো বডিতেই খুব সুন্দর ও আরামদায়কভাবে পরা যায়)। তাই বডি বা বুকের মাপ নেওয়ার কোনো প্রয়োজনই নেই!
    - সাইজ নির্ধারণের একমাত্র মাপ হলো উচ্চতা বা ঝুল (Length):
      * ৫০ সাইজ (উচ্চতা ৫ ফুট থেকে ৫ ফুট ১ ইঞ্চি)
      * ৫২ সাইজ (উচ্চতা ৫ ফুট ২ ইঞ্চি থেকে ৫ ফুট ৩ ইঞ্চি)
      * ৫৪ সাইজ (উচ্চতা ৫ ফুট ৪ ইঞ্চি থেকে ৫ ফুট ৫ ইঞ্চি)
      * ৫৬ সাইজ (উচ্চতা ৫ ফুট ৬ ইঞ্চি বা তার বেশি)
    - কাস্টমার সাইজ জানতে চাইলে বা সাইজ নিয়ে দ্বিধায় থাকলে শুধুমাত্র এভাবে বলবে:
      "আমাদের বোরকাগুলো সম্পূর্ণ ঢিলেঢালা ফ্রি সাইজ (বডি নিয়ে চিন্তা করতে হবে না, মার্জিত ঢিলেঢালা ফ্রি সাইজ কাটিং হওয়ায় কম বা বেশি যেকোনো বডিতেই অত্যন্ত সুন্দর ও আরামদায়কভাবে মানিয়ে যাবে। শুধু আপনার উচ্চতা কত (যেমন: ৫ ফুট ২ বা ৫ ফুট ৪ ইঞ্চি) জানালে সঠিক ঝুল সাইজ বলে দিতে পারব।"

13. DIGITAL CASH MEMO & ORDER SUMMARY (অর্ডার কনফার্মেশনের ডিজিটাল ক্যাশ মেমো):
    - কাস্টমার যখন তার নাম, ফোন নাম্বার এবং সম্পূর্ণ ডেলিভারি ঠিকানা প্রদান করবে (অথবা বলবে "কনফার্ম করেন / পাঠিয়ে দিন"):
      * এআই আন্তরিক শুভেচ্ছা জানিয়ে একটি সুন্দর গোছানো ডিজিটাল ক্যাশ মেমো উপস্থাপন করবে:
        "আলহামদুলিল্লাহ! আপনার অর্ডারটি গ্রহণ করা হয়েছে। 😊
        
        🧾 *দাওয়া ফ্যাশন — ডিজিটাল ক্যাশ মেমো*
        ━━━━━━━━━━━━━━━━━━━━
        📌 *ইনভয়েস আইডি:* #DF-[চার ডিজিট আইডি]
        
        👤 *কাস্টমার তথ্য:*
        • নাম: [গ্রাহকের নাম]
        • ফোন: [মোবাইল নাম্বার]
        • ঠিকানা: [ডেলিভারি ঠিকানা]
        
        🛍️ *পণ্যের বিবরণ:*
        • মডেল: [DF-XXX মডেল কোড ও নাম]
        • সাইজ: [ঝুল সাইজ] ইঞ্চি (ঢিলেঢালা ফ্রি বডি সাইজ)
        • উপহার: ম্যাচিং প্রিমিয়াম হিজাব (সম্পূর্ণ ফ্রি) 🎁
        
        💰 *পেমেন্ট সামারি:*
        • পোশাকের মূল্য: ৳[মূল্য] টাকা
        • ডেলিভারি চার্জ: ৳[৮০/১৫০] টাকা (অগ্রিম প্রযোজ্য)
        ━━━━━━━━━━━━━━━━━━━━
        💵 *কুরিয়ারে প্রদেয় (Due COD):* *৳[মূল্য] টাকা*
        ━━━━━━━━━━━━━━━━━━━━
        ✨ ডেলিভারি চার্জ বিকাশ বা নগদে (${storeSettings.bkash_number}) পাঠিয়ে শেষের ৪ ডিজিট জানিয়ে দিলে পার্সেলটি সুন্দরভাবে রেডি করে কুরিয়ারে বুকিং করে দেওয়া হবে।"

14. THE "PP" & RAPID PRICE INQUIRY RESPONSE (সংক্ষেপে দাম জানতে চাইলে):
    - কাস্টমার যখন শুধু "Pp", "pp", "Price", "dam koto", "দাম কত" ইত্যাদি সংক্ষেপে লিখবে:
      * কোনো শুষ্ক বা নিরস শুধু সংখ্যা বলবে না।
      * মডেল জানা থাকলে বলবে: "[মডেল নাম ও কোড] এর ফিক্সড মূল্য মাত্র ৳[মূল্য] টাকা। সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি এবং ডেলিভারি ম্যানের সামনে দেখে নেওয়ার সুযোগ রয়েছে।"
      * সাথে ১টি সিঙ্গেল ছবি দিবে: [SEND_IMAGE:DF-XXX]
      * নেক্সট কল টু অ্যাকশন: "আপনার উচ্চতা (যেমন: ৫'২ বা ৫'৪) জানালে সঠিক ঝুল সাইজটি বলে দেব, পার্সেল রেডি করতে পারব। 😊"

15. REAL PICTURE & AUTHENTICITY TRUST SHIELD (রিয়েল ছবি বনাম ক্যাটালগ শঙ্কা দূরীকরণ):
    - কাস্টমার যখন "real pic", "camera pic", "রিয়েল ছবি", "ক্যামেরা ছবি", "ছবিতে যেমন বাস্তবে তেমন তো?", "ভিডিও আছে?" জানতে চাইবে:
      * দ্ব্যর্থহীন নিশ্চয়তা দিবে:
        "আমাদের প্রতিটি ছবি ও ভিডিও নিজস্ব রিয়েল মডেলের ক্যামেরা ফটোশুট করা, কোনো ইন্টারনেট ক্যাটালগ ছবি নয়। ছবিতে ঠিক যেমন ফিনিশিং ও কালার দেখছেন, হুবহু তাই পাবেন। এছাড়াও পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে খুলে দেখে চেক করে নেওয়ার শতভাগ সুবিধা রয়েছে। 😊"
      * সাথে রিয়েল ভিউয়ের ছবি দিবে: [SEND_REAL_IMAGE:DF-XXX]

16. ADVANCED SIZING (58-SIZE & PLUS SIZE RESOLUTION):
    - কাস্টমার যদি "৫৮ সাইজ" বা "plus size" বা "বড় সাইজ" জানতে চায়:
      * বলবে: "আমাদের রেগুলার সাইজ ৫০, ৫২, ৫৪ ও ৫৬ ইঞ্চি ঝুল। বডি সাইজ সম্পূর্ণ ফ্রি সাইজ (৩৮ থেকে ৪৬ পর্যন্ত যে কেউই ফিতা বা বেল্ট দিয়ে সুন্দরভাবে এডজাস্ট করে পরতে পারেন)। আপনি যদি ৫৮ সাইজ চান, তবে স্পেশাল অর্ডারে প্রস্তুত করে দেওয়া যাবে। আপনার উচ্চতা কত একটু জানালে সঠিক সাইজ বলে দিচ্ছি।"

17. FABRIC, SUMMER HEAT & WASH/STONE DURABILITY (গরমের কমফোর্ট ও কাজের স্থায়িত্ব):
    - গরম লাগবে কিনা বা রোদে আরাম কিনা জানতে চাইলে বলবে:
      "আমাদের বোরকাগুলো ১০০% অরিজিনাল দুবাই ও কোরিয়ান চেরি কাপড়ের তৈরি। এটি অত্যন্ত সফট, ফলিং ও বাতাস চলাচল উপযোগী (breathable), তাই গরমের দিনে বা রোদের মধ্যেও পরে দারুণ আরামদায়ক ও নন-ট্রান্সপারেন্ট।"
    - ধোয়ার পর কাজ উঠবে কিনা বা স্টোন খসবে কিনা জানতে চাইলে বলবে:
      "কারচুপি ও কাটওয়ার্কের কাজগুলো হাতে মজবুত সুতায় লক করা। স্বাভাবিকভাবে হালকা হ্যান্ড ওয়াশ করলে কাজ বা স্টোন খসে পড়ার কোনো ভয় নেই এবং কাপড় সহজে কুঁচকে যায় না (wrinkle-resistant)।"

18. ADVANCE DELIVERY CHARGE & TRUST PSYCHOLOGY (অগ্রিম চার্জ সংক্রান্ত শঙ্কা দূরীকরণ):
    - কাস্টমার যদি অগ্রিম ডেলিভারি চার্জ নিয়ে ভয় পায় বা প্রতারণার শঙ্কা প্রকাশ করে:
      * বলবে: "আমরা আপনার শঙ্কা শতভাগ বুঝতে পারছি। সে কারণেই আমরা বোরকার জন্য ১ টাকাও অগ্রিম নিই না—বোরকার পুরো মূল্যই ক্যাশ অন ডেলিভারিতে পরিশোধ করবেন। শুধু কুরিয়ার পার্সেল বুকিং কনফার্মেশনের জন্য ডেলিভারি চার্জ (ঢাকায় ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম নেওয়া হয়। আর পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে-শুনে প্রোডাক্ট বুঝে নেওয়ার শতভাগ গ্যারান্টি রয়েছে। 😊"

19. PRACTICAL FEATURES (FEEDING FRIENDLY, POCKETS, DETACHABLE KOTI):
    - বেবি ফিডিং ফ্রেন্ডলি কিনা বা চেইন আছে কিনা জানতে চাইলে বলবে:
      "জি, আমাদের আবায়াগুলো মা-বোনদের সুবিধার জন্য ফ্রন্ট ওপেন ও হিডেন জিপার সুবিধা রয়েছে, যা বেবি ফিডিং ফ্রেন্ডলি।"
    - কোটি খোলা যায় কিনা জানতে চাইলে বলবে:
      "DF-101 মডেলে এক্সক্লুসিভ কারচুপি কোটি সম্পূর্ণ আলাদা খোলা যায় (৩-পিস সেট)। ফলে কোটি ছাড়াও এটি সিম্পল বোরকা হিসেবে পরা যায়।"

20. DELIVERY TIMELINE, URGENCY & ALL-BANGLADESH REACH (কয়দিনে পাওয়া যাবে ও জরুরি ডেলিভারি):
    - ডেলিভারি সময় নিয়ে জানতে চাইলে (যেমন: "কয়দিন লাগবে?", "কবে পাব?", "চিটাগং/সিলেটে কতদিন?", "জরুরি ২ দিনে লাগবে?", "কালকে দেওয়া যাবে?"):
      * ঢাকায় ডেলিভারি: মাত্র ২৪ থেকে ৪৮ ঘণ্টা।
      * ঢাকার বাইরে (সকল জেলা/থানা): ২ থেকে ৩ কার্যদিবস।
      * জরুরি প্রয়োজন: ঢাকায় ২৪ ঘণ্টার মধ্যে দ্রুত এক্সপ্রেস ডেলিভারির বিশেষ সুবিধা রয়েছে।

21. VILLAGE & THANA LEVEL HOME DELIVERY & COURIER SELECTION (গ্রাম ও থানা পর্যায়ে হোম ডেলিভারি):
    - কাস্টমার যদি জানতে চায় গ্রামে বা প্রত্যন্ত থানায় হোম ডেলিভারি হবে কিনা বা সুন্দরবন/এসএ পরিবহনে পাঠানো যাবে কিনা:
      * বলবে: "জি, আলহামদুলিল্লাহ! সারা বাংলাদেশের যে কোনো জেলা, থানা, উপজেলা এমনকি ইউনিয়ন ও গ্রাম পর্যায়েও কুরিয়ারের মাধ্যমে সরাসরি আপনার বাসায় হোম ডেলিভারি পৌঁছে দেওয়া হয়। এছাড়াও আপনি চাইলে আপনার পছন্দের সুন্দরবন কুরিয়ার বা এসএ পরিবহনের শাখা থেকেও পার্সেল রিসিভ করতে পারবেন।"

22. 100% SIZE EXCHANGE & DOORSTEP REPLACEMENT GUARANTEE (সাইজ না মিললে বা ফিট না হলে এক্সচেঞ্জ সুবিধা):
    - কাস্টমার যদি জানতে চায় বাসায় পরার পর সাইজ ছোট-বড় হলে বদলানো যাবে কিনা বা চার্জ কত:
      * বলবে: "জি অবশ্যই! বাসায় ট্রায়াল দেওয়ার পর সাইজ ছোট বা বড় হলে আপনি কোনো প্রকার ঝামেলা ছাড়াই ৪৮ ঘণ্টার মধ্যে সাইজ এক্সচেঞ্জ করে নিতে পারবেন। সাইজ এক্সচেঞ্জের জন্য আমাদের প্রোডাক্টের কোনো অতিরিক্ত চার্জ দিতে হয় না, শুধু কুরিয়ার এক্সচেঞ্জ চার্জ প্রযোজ্য হয়।"

23. HIJAB DIMENSIONS & MATCHING NIQAB SPECIFICATION (হিজাবের মাপ ও নিকাব সংক্রান্ত তথ্য):
    - কাস্টমার যদি হিজাবের মাপ বা নিকাব আছে কিনা জানতে চায়:
      * বলবে: "আমাদের প্রতিটা বোরকার সাথেই ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ উপহার বা ফ্রি দেওয়া হয়। হিজাবের সাইজ স্ট্যান্ডার্ড লং সাইজ (দৈর্ঘ্য প্রায় ৭৫-৮০ ইঞ্চি এবং প্রস্থ ৩০-৩২ ইঞ্চি), যা মাথা ও বক্ষ সম্পূর্ণ ঢেকে পর্দা করার জন্য যথেষ্ট বড়। সাথে মডেলভেদে ম্যাচিং সফট নিকাব সুবিধা রয়েছে।"
      * শুধু বোরকা নিলে দাম কমবে কিনা জানতে চাইলে বলবে: "ম্যাচিং হিজাবটি আমাদের পক্ষ থেকে কাস্টমারদের জন্য একটি বিশেষ উপহার, তাই এটি সাথে সম্পূর্ণ ফ্রি দেওয়া হচ্ছে।"

24. GHER (FLARE) & SLEEVE ELASTIC / WUDU FRIENDLINESS (ঘেরের মাপ ও হাতার কমফোর্ট):
    - বোরকার ঘের বা হাতার ইলাস্টিক/ওজু ফ্রেন্ডলি কিনা জানতে চাইলে:
      * বলবে: "আমাদের বোরকাগুলোর ঘের অত্যন্ত আকর্ষণীয় ও পর্যাপ্ত ঢিলেঢালা (মডেলভেদে ১১০ থেকে ১২০+ ইঞ্চি ঘের), যা হাঁটাচলায় দারুণ আরামদায়ক ও আভিজাত্য বজায় রাখে। আর হাতায় নরম ইলাস্টিক বা সুন্দর বোতাম ফিনিশিং রয়েছে, যা ওজুর সময় খুব সহজেই ওপরে তোলা যায় (১০০% ওজু ফ্রেন্ডলি)।"

25. PHYSICAL STORE / SHOWROOM / IN-PERSON TRIAL (দোকান বা শোরুম আছে কিনা):
    - শোরুম কোথায় বা এসে দেখে কেনা যাবে কিনা জানতে চাইলে:
      * বলবে: "আমাদের প্রধান প্রোডাকশন হাব ও কালেকশন পয়েন্ট ঢাকায় (মিরপুর)। শোরুমের অতিরিক্ত ভাড়া ও ডেকোরেশন খরচ না থাকায় আমরা সরাসরি নিজস্ব কারখানার প্রিমিয়াম দুবাই চেরি কাপড় পাইকারি মূল্যের মতো সুলভ মূল্যে দিতে পারছি। দোকানে গিয়ে জ্যাম ঠেলে সময় নষ্ট করার প্রয়োজন নেই—আমরা সারা দেশে হোম ডেলিভারি দিচ্ছি এবং পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে-শুনে ট্রায়াল দিয়ে নেওয়ার শতভাগ সুযোগ রয়েছে।"

26. MULTIPLE PIECE COMBO & STRICT NO FREE DELIVERY POLICY (২টা বা ৩টা নিলে করণীয়):
    - কাস্টমার যদি ২টি বা ৩টি বোরকা একসাথে নিতে চায় বা ডেলিভারি ফ্রি চায়:
      * কখনোই নিজে থেকে ডেলিভারি ফ্রি করার প্রতিশ্রুতি দেবে না! ডেলিভারি চার্জ কুরিয়ার সার্ভিসের অফিশিয়াল বুকিং ফি, এটি কখনোই মাফ বা ফ্রি করা যাবে না।
      * ড্যাশবোর্ডে কোনো অফার সেট করা থাকলে বলবে: "আমাদের বর্তমান অফার: [অফার বিবরণ]।"
      * আর কোনো অফার না থাকলে বলবে: "আমাদের কাপড়ের কোয়ালিটি ও নিখুঁত কারচুপির ফিনিশিং বিবেচনায় প্রাইজ ফিক্সড এবং ম্যাচিং প্রিমিয়াম হিজাব উপহার হিসেবে সম্পূর্ণ ফ্রি দেওয়া হচ্ছে। তবে আপনি একসাথে একাধিক বোরকা নিলে একই পার্সেলে বুকিং হবে, ফলে আলাদা দুইবার ডেলিভারি চার্জ দিতে হবে না—এক চার্জেই সব পেয়ে যাবেন!"

27. NON-TRANSPARENT & NO INNER REQUIRED (কাপড় পাতলা কিনা বা ইনার লাগবে কিনা):
    - বলবে: "আমাদের বোরকাগুলো হাই-জিএসএম অরিজিনাল দুবাই চেরি ও প্রিমিয়াম কোরিয়ান চেরি কাপড়ের তৈরি, যা শতভাগ নন-ট্রান্সপারেন্ট ও অপেক। তাই ভেতরে আলাদা কোনো ইনার বা পেটিকোট পরার কোনো প্রয়োজন নেই।"

28. RIDER REFUSING TO OPEN PARCEL AT DOORSTEP (ডেলিভারি ম্যান পার্সেল খুলতে দিচ্ছে না):
    - কাস্টমার যদি মেসেজ দেয় যে ডেলিভারি বয় পার্সেল খুলতে দিচ্ছে না বা আগে পুরো টাকা চাচ্ছে:
      * বলবে: "আপনি ডেলিভারি ম্যানকে সরাসরি আমাদের মার্চেন্ট সাপোর্টে কল দিতে বলুন (আমাদের বুকিংয়ে ওপেন পার্সেল চেকিং অনুমোদিত)। অথবা ডেলিভারি ম্যানের উপস্থিতিতেই প্যাকেট খুলে একটি ছোট্ট ভিডিও করে নিন। কোনো প্রকার অমিল বা সমস্যা থাকলে সাথে সাথে আমরা সম্পূর্ণ রিটার্ন বা সমাধান করে দেব!"

29. FAMILY / SPOUSE / PARENTAL CONSULTATION DELAY (হাজবেন্ড/আম্মু/পরিবারকে দেখিয়ে সিদ্ধান্ত নেওয়া):
    - কাস্টমার যদি বলে "হাজবেন্ডকে জিজ্ঞেস করে জানাই", "আম্মুর সাথে কথা বলে জানাচ্ছি", "একটু ভেবে বলি":
      * অত্যন্ত বিনয়ের সাথে বলবে: "জি অবশ্যই! আপনি পরিবারের সাথে কথা বলে সুন্দরভাবে পছন্দ করে নিন। আপনার সুবিধার জন্য ছবি ও বিস্তারিত রইল। আমাদের প্রতিটি এক্সক্লুসিভ ডিজাইনের স্টক দ্রুত শেষ হয়ে যায়, তাই সিদ্ধান্ত নেওয়ার পর একটু দ্রুত জানালে আপনার কাঙ্ক্ষিত সাইজটি রিজার্ভ রাখতে পারব। 😊"

30. PAYMENT DELAY OR CASH SHORTAGE (বিকাশে টাকা নেই / কালকে পাঠাব):
    - কাস্টমার যদি বলে বিকাশে ব্যালেন্স নেই বা কাল সকালে টাকা পাঠাবে:
      * বলবে: "জি কোনো সমস্যা নেই! আপনি আপনার সুবিধাজনক সময়ে ডেলিভারি চার্জ বিকাশ/নগদে পাঠিয়ে শেষের ৪ ডিজিট জানিয়ে দিলেই হবে। আপনার নাম, ফোন নম্বর ও সাইজ লিখে রেখে দিচ্ছি, ড্রেসটি আপনার জন্য আলাদা করে হোল্ড রাখা হলো। 😊"

31. RIDER ASKING TO MEET ON MAIN ROAD (ডেলিভারি বয় রোডের মাথায় ডাকছে / বাসায় ঢুকছে না):
    - কাস্টমার জানালে বলবে: "ডেলিভারি ম্যানের কাজ হলো সরাসরি আপনার দেওয়া ঠিকানায় হোম ডেলিভারি দেওয়া। গলিতে গাড়ি না ঢুকলে ডেলিভারি ম্যানকে হেঁটে বাসার গেটে আসতে বলুন অথবা আমাদের জানান, আমরা কুরিয়ারের ইনচার্জের সাথে কথা বলে আপনার বাসার সামনে ডেলিভারি নিশ্চিত করছি।"

32. ONLINE SHOPPING TRAUMA & SKEPTICISM (আগে অনলাইনে ধোঁকা খাওয়ার শঙ্কা):
    - কাস্টমার যদি পূর্বের প্রতারণার কথা উল্লেখ করে:
      * বলবে: "আপনার খারাপ অভিজ্ঞতার কথা আমরা শতভাগ বুঝি—অনলাইনে অনেকেই ক্যাটালগের ছবি দিয়ে লোকাল কাপড় পাঠিয়ে থাকে। সে কারণেই দাওয়াহ ফ্যাশনে কোনো ইন্টারনেট বা ক্যাটালগ ছবি ব্যবহার করা হয় না, প্রতিটি ছবি আমাদের নিজস্ব রিয়েল ফটোশুটের। আর সবচেয়ে বড় কথা—পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে, কোয়ালিটি পছন্দ হলে তবেই বোরকার টাকা দেবেন। কোনো পছন্দ না হলে সাথে সাথে রিটার্ন করতে পারবেন।"

33. POST-DELIVERY POSITIVE FEEDBACK & REVIEWS (পণ্য পাওয়ার পর ভালো লাগা বা প্রশংসা):
    - কাস্টমার যদি জানায় বোরকা হাতে পেয়েছে বা খুব সুন্দর হয়েছে:
      * বলবে: "আলহামদুলিল্লাহ! আপনার পছন্দ হয়েছে এবং সাইজ সুন্দরভাবে ফিট হয়েছে জেনে আমাদের পুরো টিম অত্যন্ত আনন্দিত। 😊 আপনার সুন্দর সন্তুষ্টি আমাদের জন্য অনেক বড় অনুপ্রেরণা। দাওয়াহ ফ্যাশনের সাথে থাকার জন্য জাযাকাল্লাহু খাইরান। ভবিষ্যতে আপনার বা পরিবারের যেকোনো পোশাকের প্রয়োজনে আমরা সবসময় পাশে আছি।"

ABOUT DAWAH FASHION:
- Brand Name: Dawah Fashion (দাওয়াহ ফ্যাশন)
- Motto: Dress with Purpose | Modest Style | Premium Quality
- Location: Dhaka, Bangladesh (Mirpur). Cash on Delivery (COD) available all over Bangladesh.

CURRENT LIVE PRODUCTS & PRICING:
${cachedProductsText}
`;
}

// Fast-Path Rule Engine: Returns instant reply (0ms-15ms) for recognized intents, or null for LLM handling
function getFastPathReply(userText, isFirstMessage, conversationHistory = []) {
  const t = (userText || '').toLowerCase();
  const greeting = isFirstMessage ? 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। ' : 'জি, ';

  // 0. Customer submitted complete address & phone number directly -> Send Digital Cash Memo & Order Confirmation!
  const hasPhoneInText = /01[3-9]\d{8}/.test(t);
  const hasAddressWordInText = /(?:বাসা|বাড়ি|বাড়ি|রোড|গ্রাম|থানা|জেলা|উপজেলা|ঢাকা|চট্টগ্রাম|চিটাগং|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|মিরপুর|উত্তরা|ধানমন্ডি|মোহাম্মদপুর|বসুন্ধরা|পোস্ট|কোড|address|road|house|dhaka|ctg)/i.test(t);
  if (hasPhoneInText && hasAddressWordInText) {
    const code = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : null) || 'DF-101';
    const prod = getProductByCode(code);
    const prodName = prod ? prod.name : '৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট';
    const prodPrice = prod ? prod.price : 2450;
    const isOutside = !/(?:ঢাকা|dhaka|মিরপুর|উত্তরা|গুলশান|বনানী|ধানমন্ডি|মোহাম্মদপুর|বসুন্ধরা|যাত্রাবাড়ী|মতিঝিল|বাড্ডা|খিলগাঁও|মহাখালী|তেজগাঁও|ফার্মগেট|আজিমপুর|পুরান\s*ঢাকা)/i.test(t);
    const fee = isOutside ? storeSettings.outside_dhaka_fee : storeSettings.inside_dhaka_fee;

    return `${greeting}আলহামদুলিল্লাহ! আপনার ডেলিভারির ঠিকানা ও তথ্যগুলো আমরা সঠিকভাবে পেয়েছি। 😊

🧾 *ডিজিটাল ক্যাশ মেমো ও অর্ডার সামারি:*
────────────────────
👗 পোশাক: *${prodName} (${code})*
💰 পোশাকের মূল্য: *৳${prodPrice}* টাকা (ম্যাচিং হিজাব ফ্রি)
🚚 ডেলিভারি চার্জ: *৳${fee}* টাকা (${isOutside ? 'ঢাকার বাইরে' : 'ঢাকার ভেতরে'})
📦 ক্যাশ অন ডেলিভারি (Due COD): *৳${prodPrice}* টাকা
────────────────────
অর্ডারটি সাথে সাথে ফাইনাল বুকিং করতে শুধুমাত্র ডেলিভারি চার্জটি (৳${fee}) আমাদের বিকাশ বা নগদ পার্সোনাল নাম্বারে (${storeSettings.bkash_number}) সেন্ড মানি করে শেষের ৪টি ডিজিট জানিয়ে দিন। পেমেন্ট কনফার্ম হওয়ামাত্রই আমরা পার্সেল রেডি করে কুরিয়ারে বুকিং করে দেব ইনশাআল্লাহ! 😊`;
  }

  // 1. Personal / Identity / Robot questions
  if (isIdentityOrPersonalQuery(t)) {
    return 'আমি দাওয়াহ ফ্যাশন থেকে বলছি 😊 আপনাকে সুন্দর একটি বোরকা বা আবায়া বেছে নিতে কীভাবে সাহায্য করতে পারি বলুন?';
  }

  // 1a. Simple greetings (hi, hello, সালাম) — just welcome warmly, NOT আলহামদুলিল্লাহ আমরা ভালো আছি
  if (/^(?:hi|hello|hey|হ্যালো|হাই|হেলো|সালাম|আস-সালাম|আস্সালামু\s*আলাইকুম|ওয়া\s*আলাইকুম)[!?.\s]*$/i.test(t.trim())) {
    return `আস্সালামু আলাইকুম! Dawah Fashion-এ আপনাকে স্বাগতম 😊 কীভাবে সাহায্য করতে পারি বলুন? আমাদের রানিং বোরকা কালেকশন দেখতে চাইলে বলুন, অথবা কোনো নির্দিষ্ট মডেল বা সাইজ নিয়ে জানতে চাইলে এখনই জানাচ্ছি।`;
  }

  // 1b. Wellbeing queries (কেমন আছেন) — customer explicitly asked how we are doing
  if (/কেমন\s*আছেন|kemon\s*achen|kemon\s*asen|ki\s*obostha|কেমন\s*চলছে|valocen|ভালো\s*আছেন/i.test(t)) {
    return `${greeting}আলহামদুলিল্লাহ, আমরা বেশ ভালো আছি! 😊 আপনি কেমন আছেন? দাওয়াহ ফ্যাশনের এক্সক্লুসিভ কালেকশনে আপনাকে স্বাগতম। আপনি কি কোনো নির্দিষ্ট মডেলের বোরকা দেখতে চাচ্ছেন, নাকি আমাদের সেরা ডিজাইনগুলো একনজরে দেখতে চান?`;
  }
  // 1c. Free Delivery Demand / Objection (ডেলিভারি চার্জ ছাড়া / ফ্রি চাওয়া)
  if (/ডেলিভারি\s*(?:ফ্রি|free|ছাড়া|chara|মাফ|কম)|free\s*delivery|ডেলিভারি\s*চার্জ\s*রাখবেন\s*না/i.test(t)) {
    return `${greeting}আমরা আপনার অনুরোধ আন্তরিকভাবে বুঝতে পারছি! তবে ডেলিভারি চার্জটি সরাসরি কুরিয়ার কোম্পানির বুকিং ফি, যা তাদের পরিশোধ করতে হয় (আমরা বোরকার জন্য ১ টাকাও অগ্রিম নিই না, পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে চেক করে বোরকার মূল্য পরিশোধ করবেন)। আর প্রতিটি ড্রেসের সাথেই আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন! তাই শুধুমাত্র ডেলিভারি চার্জটি (ঢাকায় ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম দিয়ে কনফার্ম করতে হবে। 😊`;
  }

  // 1d. Multiple Piece Combo & Special Offer Inquiry
  if (/(?:২|3|4|5|২|৩|৪|৫|[2-5])\s*(?:টি|টা|পিস|piece|জোড়া|সেট)|দুটো|দুইটা|তিনটা|একসাথে\s*(?:নিলে|কিনলে)|কম্বো|combo|দুটোই|দুইটাই/i.test(t)) {
    if (storeSettings.promo_offer && storeSettings.promo_offer.trim()) {
      return `${greeting}মাশাল্লাহ! আপনি একাধিক বোরকা একসাথে অর্ডার করলে আমাদের চলমান বিশেষ অফার: *${storeSettings.promo_offer}*! আর সবগুলো একই পার্সেলে বুকিং হবে, ফলে আলাদা বাড়তি কোনো ডেলিভারি চার্জ দিতে হবে না—এক চার্জেই পুরো পার্সেল পেয়ে যাবেন। কোন কোন মডেল বা কালার পছন্দ হয়েছে বলুন তো? 😊`;
    }
    return `${greeting}আরে বাহ! আপনি একসাথে ২টি বা তার বেশি বোরকা নিলে দারুণ ব্যাপার! আমাদের প্রতিটি বোরকা প্রিমিয়াম দুবাই ও কোরিয়ান চেরি কাপড়ে নিখুঁত কারচুপিতে তৈরি এবং সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ উপহার হিসেবে ফ্রি দেওয়া হচ্ছে। কোয়ালিটি বিবেচনায় প্রাইজটি একদম রিজনেবল ও ফিক্সড। আর একাধিক বোরকা একসাথে নিলে একই পার্সেলে বুকিং হবে, ফলে আলাদা বাড়তি কোনো ডেলিভারি চার্জ লাগবে না—এক চার্জেই পেয়ে যাবেন! কোন কোন মডেল বা কালার পছন্দ হয়েছে বলুন তো? 😊`;
  }

  // 2. Price bargaining
  if (isBargainingPrice(t)) {
    return 'আমাদের প্রতিটি বোরকা ও আবায়া অরিজিনাল প্রিমিয়াম দুবাই ও কোরিয়ান চেরি ফেব্রিক দিয়ে নিখুঁত কারচুপি ও সেলাই ফিনিশিংয়ে প্রস্তুত করা। সাথে আকর্ষণীয় ম্যাচিং হিজাব সম্পূর্ণ ফ্রি এবং সারা দেশে ক্যাশ অন ডেলিভারি সুবিধা রয়েছে। কোয়ালিটি বিবেচনায় প্রাইজটি একদম রিজনেবল ও ফিক্সড রাখা হয়েছে।';
  }

  // 3. Customer confused / undecided / asking for recommendation
  if (isCustomerConfusedOrUndecided(t)) {
    return `${greeting}আপনার পছন্দের সুবিধার জন্য আমাদের সবচেয়ে বেশি বিক্রিত ও সেরা ২টি ডিজাইন সাজেস্ট করছি:
১. গর্জিয়াস পার্টি লুকের জন্য: DF-101 ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (৳২,৪৫০)
২. সফট ও আরামদায়ক ক্যাজুয়াল লুকের জন্য: DF-103 কোরিয়ান চেরি কাফতান বোরকা (৳১,৯৫০)
দুটো মডেলের সুন্দর রিয়েল ছবি পাঠিয়ে দিচ্ছি, দেখুন আপনার কোনটা বেশি ভালো লাগে [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-103]`;
  }

  // 4. Color preference handling
  const color = detectColorPreference(t);
  const detectedCodeForColor = detectModelFromText(t);

  if (detectedCodeForColor && color === 'any_other_color') {
    const prod = getProductByCode(detectedCodeForColor);
    const prodName = prod ? prod.name : detectedCodeForColor;
    return `${greeting}${prodName} মডেলটি স্পেশাল জেট ব্ল্যাক কালারেই কারচুপির কাজ নিখুঁতভাবে ফুটিয়ে তোলা হয়েছে, তাই এই ডিজাইনটি কালোতেই তৈরি করা হয়। তবে আপনি যদি অন্য কালার পছন্দ করেন, আমাদের এই কালারফুল মডেলগুলো দেখতে পারেন:
১. কফি ও চকলেট কালার: DF-103 কাফতান (৳১,৯৫০) ও DF-106 ডাবল লেয়ার আবায়া (৳২,১০০)
২. মেরুন ও রয়েল ব্লু কালার: DF-105 বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
৩. সি-গ্রিন কালার: DF-103 ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
সবগুলোর চমৎকার ছবি নিচে পাঠিয়ে দেওয়া হলো [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-105] [SEND_IMAGE:DF-106]`;
  }

  if (color) {
    if (color === 'coffee') {
      return `${greeting}কফি ও চকলেট কালার শেডের মধ্যে আমাদের এই প্রিমিয়াম মডেলগুলো রয়েছে:
১. DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান বোরকা (সফট কফি কালার) - ৳১,৯৫০
২. DF-106: ডাবল লেয়ার কোটি স্টাইল দুবাই আবায়া (চকলেট কালার) - ৳২,১০০
দুটো ডিজাইনেরই ছবি নিচে পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-106]`;
    }
    if (color === 'black') {
      return `${greeting}কালো কালারের মধ্যে আমাদের সেরা ৩টি আকর্ষণীয় ডিজাইন রয়েছে:
১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (গর্জিয়াস গোল্ডেন কারচুপি কাজ) - ৳২,৪৫০
২. DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (হাতা ও গলায় নিখুঁত কাটওয়ার্ক) - ৳২,২০০
৩. DF-104: সফট দুবাই চেরি এ-লাইন ক্যাজুয়াল আবায়া (সিম্পল ও আরামদায়ক) - ৳১,৬৫০
সবগুলোর চমৎকার ছবি পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-101] [SEND_IMAGE:DF-102] [SEND_IMAGE:DF-104]`;
    }
    if (color === 'maroon') {
      return `${greeting}মেরুন কালারের মধ্যে আমাদের রয়েছে:
১. DF-105: এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (হেভি ডায়মন্ড জর্জেট মেরুন কালার) - ৳২,৩০০
ছবিটি পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-105]`;
    }
    if (color === 'blue') {
      return `${greeting}নীল ও নেভি কালার শেডের মধ্যে আমাদের রয়েছে:
১. DF-105: বাটারফ্লাই পার্টি বোরকা (রয়েল ব্লু কালার) - ৳২,৩০০
২. DF-104: এ-লাইন ক্যাজুয়াল বোরকা (নেভি ব্লু কালার) - ৳১,৬৫০
ছবি পাঠিয়ে দেওয়া হলো [SEND_IMAGE:DF-105] [SEND_IMAGE:DF-104]`;
    }
    if (color === 'green') {
      return `${greeting}সি-গ্রিন কালারের মধ্যে রয়েছে:
১. DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান বোরকা (সি-গ্রিন কালার) - ৳১,৯৫০
ছবিটি পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-103]`;
    }
    if (color === 'any_other_color') {
      return `${greeting}আমাদের কালেকশনে ব্ল্যাক ছাড়াও বেশ কিছু চমৎকার কালার রয়েছে:
১. কফি ও চকলেট কালার: DF-103 কাফতান (৳১,৯৫০) ও DF-106 ডাবল লেয়ার আবায়া (৳২,১০০)
২. মেরুন ও রয়েল ব্লু কালার: DF-105 বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
৩. সি-গ্রিন কালার: DF-103 ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
সবগুলোর চমৎকার ছবি নিচে পাঠিয়ে দেওয়া হলো [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-105] [SEND_IMAGE:DF-106]`;
    }
  }

  // 4c. Pure Pricing & "Pp" rapid handling
  if (/(?:\bpp\b|\bprice\b|দাম কত|koto dam|dam koto|price please|প্রাইজ কত|মূল্য কত)/i.test(t)) {
    const code = detectModelFromText(t);
    if (code) {
      const prod = getProductByCode(code);
      if (prod) {
        return `${greeting}${prod.name} (${code}) এর ফিক্সড মূল্য *৳${prod.price}* টাকা। সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন এবং ডেলিভারি ম্যানের সামনে দেখে বুঝে নেওয়ার শতভাগ সুবিধা রয়েছে। আপনার উচ্চতা জানালে পারফেক্ট ঝুল সাইজটি বলে দেব। [SEND_IMAGE:${code}]`;
      }
    }
    return `${greeting}আমাদের কালেকশনের সেরা ৫টি এক্সক্লুসিভ বোরকা ও আবায়ার মূল্য মডেলভেদে ৳১,৬৫০ থেকে ৳২,৪৫০ টাকা পর্যন্ত (সবগুলোর সাথেই ম্যাচিং হিজাব একদম ফ্রি)। আপনি কোন মডেলটির ছবি বা বিস্তারিত দেখতে চাচ্ছেন জানালে পাঠিয়ে দিচ্ছি। 😊`;
  }

  if (/দাম কত|প্রাইজ কত|price koto|dam koto|মূল্য কত/i.test(t)) {
    const code = detectModelFromText(t);
    if (code) {
      const prod = getProductByCode(code);
      if (prod) {
        return `${greeting}${prod.name} (${code}) এর ফিক্সড মূল্য *৳${prod.price}* টাকা। সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি পাচ্ছেন! ${code} এর ছবি দেখতে চাইলে লিখে জানান।`;
      }
    }
  }

  // 4d. "Catalogue vs Real" Trust Shield
  if (/রিয়েল\s*ছবি|real\s*pic|ক্যামেরা\s*ছবি|camera\s*pic|আসল\s*ছবি|original\s*pic|ছবিতে\s*যেমন|ক্যাটালগ|ভিডিও\s*আছে|video\s*ache|ছবি\s*এর\s*মতো\s*হবে|filter\s*chara/i.test(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}আমাদের প্রতিটি ছবি ও ভিডিও নিজস্ব রিয়েল মডেলের ক্যামেরা ফটোশুট করা, কোনো ইন্টারনেট ক্যাটালগ ছবি নয়। ছবিতে ঠিক যেমন ফিনিশিং ও কালার দেখছেন, বাস্তবে হুবহু তাই পাবেন। এছাড়াও পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে খুলে দেখে চেক করে নেওয়ার শতভাগ সুবিধা রয়েছে। নিচে স্বাভাবিক আলোর রিয়েল ছবি পাঠিয়ে দিচ্ছি [SEND_REAL_IMAGE:${code}]`;
  }

  // 4e. 58-Size / Plus Size Handling
  if (/৫৮\s*সাইজ|58\s*size|৬০\s*সাইজ|60\s*size|প্লাস\s*সাইজ|plus\s*size|বড়\s*সাইজ|customized|কাস্টমাইজ/i.test(t)) {
    return `${greeting}আমাদের রেগুলার ঝুল সাইজ ৫০, ৫২, ৫৪ ও ৫৬ ইঞ্চি (বডি সাইজ সম্পূর্ণ ফ্রি সাইজ ৩৮ থেকে ৪৬ এডজাস্টেবল)। আপনি যদি ৫৮ সাইজ চান, তবে স্পেশাল অর্ডারে প্রস্তুত করে দেওয়া যাবে। আপনার উচ্চতা কত একটু জানালে সঠিক ঝুল জানিয়ে দিচ্ছি।`;
  }

  // 4f. Summer Heat, Breathability & Wash / Stone Durability
  if (/গরম\s*লাগবে|gorom\s*lagbe|রোদে|ধোয়ার\s*পর|dhowar\s*por|রং\s*উঠবে|rong\s*uthbe|stone\s*uth|পাথর\s*উঠ|কাজ\s*উঠে|কুঁচকে|iron\s*korte|হ্যান্ড\s*ওয়াশ/i.test(t)) {
    return `${greeting}আমাদের বোরকাগুলো প্রিমিয়াম দুবাই ও কোরিয়ান চেরি কাপড়ের তৈরি হওয়ায় অত্যন্ত সফট, ফলিং ও বাতাস চলাচল উপযোগী (breathable), তাই গরমের দিনে বা রোদের মধ্যেও পরে দারুণ আরামদায়ক ও নন-ট্রান্সপারেন্ট। আর কারচুপি ও কাটওয়ার্কের কাজগুলো হাতে মজবুত সুতায় লক করা, হালকা হ্যান্ড ওয়াশ করলে স্টোন বা কাজ খসে পড়ার কোনো ভয় নেই এবং কাপড় সহজে কুঁচকে যায় না। 😊`;
  }

  // 4g. Practical Features (Feeding Friendly, Pockets, Detachable Koti)
  if (/ফিডিং|feeding|চেইন\s*আছে|chain\s*ache|জিপার|zipper|পকেট|pocket|কোটি\s*আলাদা|koti\s*alada|ডিট্যাচ|detach/i.test(t)) {
    return `${greeting}জি, আমাদের আবায়াগুলো মা-বোনদের সুবিধার জন্য ফ্রন্ট ওপেন ও হিডেন জিপার সুবিধা রয়েছে, যা বেবি ফিডিং ফ্রেন্ডলি। আর DF-101 মডেলে এক্সক্লুসিভ কারচুপি কোটিটি সম্পূর্ণ আলাদা খোলা যায় (৩-পিস সেট), ফলে আপনি চাইলে কোটি ছাড়াও সিম্পল বোরকা হিসেবে পরতে পারবেন।`;
  }

  // 4h. Advance Delivery Charge & Fraud Fear
  if (/টাকা\s*মেরে|পার্সেল\s*না\s*পাঠান|টাকা\s*নিয়ে|প্রতারণা|আগে\s*টাকা\s*কেন|ফুল\s*ক্যাশ\s*অন|full\s*cash\s*on/i.test(t)) {
    return `${greeting}আমরা আপনার শঙ্কা শতভাগ বুঝতে পারছি। সে কারণেই আমরা বোরকা বা জামার জন্য ১ টাকাও অগ্রিম নিই না—বোরকার পুরো টাকাই ডেলিভারি ম্যানের হাতে ক্যাশ অন ডেলিভারিতে দেবেন। শুধু কুরিয়ার পার্সেল বুকিং কনফার্মেশনের জন্য ডেলিভারি চার্জ (ঢাকায় ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম নেওয়া হয়। আর পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে প্রোডাক্ট দেখে-চেক করে মূল্য পরিশোধ করার সম্পূর্ণ সুবিধা রয়েছে। 😊`;
  }

  // 4h-2. Free Delivery Demand / Waiver Objection (ডেলিভারি ফ্রি চাওয়া বা মাফ চাওয়া)
  if (/ডেলিভারি\s*(?:চার্জ\s*)?(?:ফ্রি|free|ছাড়া|chara|মাফ|কম|দেওয়া\s*যাবে|করা\s*যাবে)|free\s*delivery|ডেলিভারি\s*চার্জ\s*(?:রাখবেন\s*না|নেওয়া\s*যাবে\s*না|দিতে\s*পারব\s*না|বাদ)/i.test(t)) {
    return `${greeting}আমরা আপনার অনুরোধ আন্তরিকভাবে বুঝতে পারছি! তবে ডেলিভারি চার্জটি সরাসরি কুরিয়ার কোম্পানির বুকিং ফি, যা তাদের পরিশোধ করতে হয় (আমরা বোরকার জন্য ১ টাকাও অগ্রিম নিই না, পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে চেক করে বোরকার মূল্য পরিশোধ করবেন)। আর প্রতিটি ড্রেসের সাথেই আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ উপহার হিসেবে ফ্রি দেওয়া হচ্ছে। তাই শুধুমাত্র ডেলিভারি চার্জটি (ঢাকায় ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম দিয়ে কনফার্ম করতে হবে। 😊`;
  }

  // 4i. Delivery Timeline, Urgency & Delivery Charge Inquiry
  if (/(?:ঢাকার\s*বাইরে|ঢাকার\s*ভেতরে|ডেলিভারি).*(?:কয়দিনে|কয়দিনে|কতদিনে|কবে|সময়|চার্জ|কত|খরচ)|কয়দিনে\s*দেন|কয়দিনে\s*দেন|কতদিনে\s*দেন|ডেলিভারি\s*চার্জ\s*কত|ডেলিভারি\s*কত|চার্জ\s*কত|কয়দিন\s*লাগবে|কতদিন\s*লাগবে|delivery\s*time|ডেলিভারি\s*সময়/i.test(t)) {
    return `${greeting}ঢাকার ভেতরে সাধারণত মাত্র ২৪ থেকে ৪৮ ঘণ্টার মধ্যে (চার্জ ৳${storeSettings.inside_dhaka_fee}) এবং ঢাকার বাইরে যে কোনো জেলা ও থানা পর্যায়ে ২ থেকে ৩ কার্যদিবসের মধ্যে (চার্জ ৳${storeSettings.outside_dhaka_fee}) সরাসরি হোম ডেলিভারি পেয়ে যাবেন। আর আপনি পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সুন্দরভাবে খুলে দেখে চেক করে নেওয়ার শতভাগ সুবিধা পাবেন! আপনি কোন জেলা বা এলাকা থেকে বলছেন? 😊`;
  }

  // 4j. Village & Thana Level Home Delivery & Couriers
  if (/গ্রাম|grame|গ্রাম\s*পর্যায়ে|থানা\s*পর্যায়ে|থানায়|উপজেলায়|thana|upazila|হোম\s*ডেলিভারি|home\s*delivery|সুন্দরবন|sundarban|sundorbon|এসএ\s*পরিবহন|sa\s*paribahan|redx|স্টেডফাস্ট|steadfast/i.test(t)) {
    return `${greeting}জি, আলহামদুলিল্লাহ! সারা বাংলাদেশের যে কোনো জেলা, উপজেলা, থানা এমনকি ইউনিয়ন ও গ্রাম পর্যায়েও কুরিয়ারের মাধ্যমে সরাসরি আপনার ঠিকানায় হোম ডেলিভারি দেওয়া হয়। এছাড়াও আপনি চাইলে আপনার সুবিধামতো সুন্দরবন কুরিয়ার বা এসএ পরিবহনের শাখা থেকেও পার্সেল সংগ্রহ করতে পারবেন।`;
  }

  // 4k. Doorstep Size Exchange & Replacement Policy
  if (/এক্সচেঞ্জ|exchange|বদলানো|change\s*kora|সাইজ\s*না\s*মিললে|সাইজ\s*না\s*হলে|ফিট\s*না\s*হলে|বড়\s*হলে|ছোট\s*হলে|বদল|রিপ্লেস|replace|পাল্টানো/i.test(t)) {
    return `${greeting}জি অবশ্যই! বাসায় ট্রায়াল দেওয়ার পর সাইজ যদি ছোট বা বড় হয়, আপনি নিশ্চিন্তে ৪৮ ঘণ্টার মধ্যে সাইজ এক্সচেঞ্জ করে নিতে পারবেন। আমাদের বোরকার জন্য কোনো অতিরিক্ত মূল্য নেওয়া হয় না (শুধুমাত্র কুরিয়ার চার্জ প্রযোজ্য)। ১০০% রিল্যাক্সে অর্ডার করতে পারেন! 😊`;
  }

  // 4l. Hijab Dimensions & Matching Niqab Specification
  if (/হিজাবের\s*(সাইজ|মাপ|ইঞ্চি|লং)|hijab\s*size|লং\s*হিজাব|বড়\s*হিজাব|৮০\s*ইঞ্চি|৩০\s*ইঞ্চি|নিকাব|niqab|নেকাব|nekab|শুধু\s*বোরকা|shudhu\s*borkha|হিজাব\s*ছাড়া|hijab\s*chara/i.test(t)) {
    return `${greeting}আমাদের প্রতিটি বোরকার সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব একদম উপহার হিসেবে সম্পূর্ণ ফ্রি দেওয়া হয়! হিজাবের মাপ স্ট্যান্ডার্ড ফুল কাভারেজ লং সাইজ (দৈর্ঘ্য প্রায় ৭৫-৮০ ইঞ্চি এবং প্রস্থ ৩০-৩২ ইঞ্চি), যা সম্পূর্ণ শালীনভাবে ঢেকে পর্দা করার জন্য পারফেক্ট। আর মডেলভেদে ম্যাচিং সফট নিকাব সুবিধা রয়েছে। 😊`;
  }

  // 4m. Gher (Flare) & Sleeve Elastic / Wudu Friendliness
  if (/ঘের\s*কত|gher\s*koto|কত\s*ইঞ্চি\s*ঘের|ঘের\s*কেমন|১০০\s*ইঞ্চি|১১০\s*ইঞ্চি|১২০\s*ইঞ্চি|ইলাস্টিক|elastic|হাতা\s*কেমন|হাতায়\s*কি|ওজু\s*করা|ওজু\s*ফ্রেন্ডলি|wudu/i.test(t)) {
    return `${greeting}আমাদের বোরকাগুলোর ঘের অত্যন্ত রাজকীয় ও পর্যাপ্ত ঢিলেঢালা (মডেলভেদে ১১০ থেকে ১২০+ ইঞ্চি ঘের), যা হাঁটাচলায় দারুণ আরামদায়ক ও আভিজাত্য দেয়। আর হাতায় সফট প্রিমিয়াম ইলাস্টিক বা বোতাম ফিনিশিং রয়েছে, যা ওজুর সময় অনায়াসে কনুই পর্যন্ত তোলা যায় (১০০% ওজু ফ্রেন্ডলি)। 😊`;
  }

  // 4n. Physical Showroom / Store / In-Person Trial Inquiry
  if (/দোকান\s*কোথায়|dokan\s*kothay|শোরুম\s*কোথায়|showroom|outlet|আউটলেট|মিরপুর\s*কোথায়|দোকানে\s*এসে|দোকান\s*আছে|shop\s*ache|এসে\s*নেওয়া|physical\s*shop|দোকান\s*থেকে/i.test(t)) {
    return `${greeting}আমাদের প্রধান প্রোডাকশন হাব ও কালেকশন পয়েন্ট ঢাকায় (মিরপুর)। শোরুমের অতিরিক্ত ভাড়া ও খরচ না থাকায় আমরা সরাসরি কারখানার প্রিমিয়াম দুবাই চেরি কাপড় পাইকারি মূল্যের মতো সুলভ মূল্যে দিতে পারছি। দোকানে গিয়ে জ্যাম ঠেলে সময় নষ্ট করার প্রয়োজন নেই—আমরা সারা দেশে হোম ডেলিভারি দিচ্ছি এবং পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে-শুনে ট্রায়াল দিয়ে বুঝে নেওয়ার শতভাগ সুযোগ রয়েছে!`;
  }

  // 4o. Multiple Piece Combo & Special Offer / Free Delivery
  if (/২টি|২টা|3টি|৩টা|দুটো|দুইটা|তিনটা|2\s*ta|3\s*ta|একসাথে\s*নিলে|কম্বো|combo|ছাড়\s*পাব|free\s*delivery|ফ্রি\s*ডেলিভারি/i.test(t)) {
    if (storeSettings.promo_offer && storeSettings.promo_offer.trim()) {
      return `${greeting}মাশাল্লাহ! আপনি একাধিক বোরকা একসাথে অর্ডার করলে আমাদের চলমান বিশেষ অফার: *${storeSettings.promo_offer}*! আর সবগুলো একই পার্সেলে বুকিং হবে, ফলে আলাদা বাড়তি কোনো ডেলিভারি চার্জ দিতে হবে না—এক চার্জেই পুরো পার্সেল পেয়ে যাবেন। কোন কোন মডেল বা কালার পছন্দ হয়েছে বলুন তো? 😊`;
    }
    return `${greeting}আরে বাহ! আপনি একসাথে ২টি বা তার বেশি বোরকা নিলে দারুণ ব্যাপার! আমাদের প্রতিটি বোরকা প্রিমিয়াম দুবাই ও কোরিয়ান চেরি কাপড়ে নিখুঁত কারচুপিতে তৈরি এবং সাথে আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ উপহার হিসেবে ফ্রি দেওয়া হচ্ছে। কোয়ালিটি বিবেচনায় প্রাইজটি একদম রিজনেবল ও ফিক্সড। আর একাধিক বোরকা একসাথে নিলে একই পার্সেলে বুকিং হবে, ফলে আলাদা বাড়তি কোনো ডেলিভারি চার্জ লাগবে না—এক চার্জেই পেয়ে যাবেন! কোন কোন মডেল বা কালার পছন্দ হয়েছে বলুন তো? 😊`;
  }

  // 4p. See-Through / Transparency & Modesty Coverage
  if (/পাতলা\s*(?:কি|কিনা|নাকি|হবে)|শালীন|ট্রান্সপারেন্ট|transparent|see\s*through|ভেতরে\s*দেখা|ইনার\s*(?:লাগবে|পরতে)/i.test(t)) {
    return `${greeting}একদম নিশ্চিন্ত থাকুন! আমাদের কাপড়গুলো ১০০% অরিজিনাল প্রিমিয়াম দুবাই চেরি ও কোরিয়ান চেরি ফেব্রিক দিয়ে তৈরি। কাপড়টি একেবারেই পাতলা বা ট্রান্সপারেন্ট নয়—যথেষ্ট প্রিমিয়াম, ফল ও সফট এবং অত্যন্ত শালীনভাবে সম্পূর্ণ শরীর কভার করে। ভেতরে আলাদা কোনো ইনার পরারও প্রয়োজন হয় না। 😊`;
  }

  // 4q. Defect / Damage / Quality Issue Doorstep Return
  if (/ছেঁড়া\s*থাকলে|ছেঁড়া\s*বের\s*হলে|ডিফেক্ট|defect|সমস্যা\s*থাকলে|নষ্ট\s*হলে|খারাপ\s*হলে|ভুল\s*প্রোডাক্ট/i.test(t)) {
    return `${greeting}আমাদের প্রতিটি প্রোডাক্ট পাঠানোর আগে কোয়ালিটি চেকিং টিম ৩ বার নিখুঁতভাবে চেক করে পাঠায়। তবুও পার্সেল খুলে ডেলিভারি ম্যানের সামনে চেক করার সময় যদি কোনো ডিফেক্ট বা সমস্যা দেখতে পান, সাথে সাথে ডেলিভারি ম্যানকে সম্পূর্ণ রিটার্ন করে দিতে পারবেন—আপনাকে বোরকার কোনো টাকা দিতে হবে না!`;
  }

  // 4r. Rider Refusing to Open Parcel at Doorstep (Seller Group Screenshot Insight #1)
  if (/খুলতে\s*(?:দিচ্ছে\s*না|দেয়\s*না|দেবে\s*না)|khulte\s*dey\s*na|khulte\s*diche\s*na|ডেলিভারি\s*ম্যান.*খুলতে\s*(?:দেয়\s*না|দিচ্ছে\s*না)|আগে\s*টাকা\s*দিতে\s*হবে.*তারপর|রাইডার.*খুলতে/i.test(t)) {
    return `${greeting}আপনি ডেলিভারি ম্যানকে সরাসরি আমাদের মার্চেন্ট সাপোর্টে (${storeSettings.support_number || storeSettings.bkash_number}) কল দিতে বলুন—আমাদের বুকিংয়ে পার্সেল ওপেন করে দেখে নেওয়ার ক্লিয়ার পারমিশন দেওয়া আছে। অথবা ডেলিভারি ম্যানের সামনে রেখেই প্যাকেটটি খুলে একটি ছোট্ট ভিডিও করে নিন। কোনো প্রকার সমস্যা থাকলে সাথে সাথে আমরা সম্পূর্ণ রিটার্ন বা সমাধান করে দেব! 😊`;
  }

  // 4s. Family / Spouse / Parental Consultation Delay (Seller Group Screenshot Insight #2)
  if (/(?:হাজবেন্ড|husband|স্বামী|আম্মু|ammu|আম্মা|পরিবার|family|বোন|friend|ফ্রেন্ড|মায়ের|মাকে).*(?:জিজ্ঞেস|কথা\s*বলে|দেখিয়ে|বলব|জানাব|জানাই)|ভেবে\s*(?:জানাই|জানাব|বলব|দেখি)/i.test(t)) {
    return `${greeting}জি অবশ্যই! আপনি পরিবারের সাথে কথা বলে সুন্দরভাবে পছন্দ করে নিন। আপনার সুবিধার্থে ছবি ও বিস্তারিত তথ্য উপরে দেওয়া রইল। আমাদের প্রতিটি এক্সক্লুসিভ ডিজাইনের স্টক খুব দ্রুত শেষ হয়ে যায়, তাই সিদ্ধান্ত নেওয়ার পর একটু দ্রুত জানালে আপনার পছন্দের সাইজটি রিজার্ভ রাখতে পারব। 😊`;
  }

  // 4t. Payment Delay or Cash Shortage (Seller Group Screenshot Insight #3)
  if (/বিকাশে\s*টাকা\s*নাই|ব্যালেন্স\s*নাই|টাকা\s*শেষ|কালকে\s*(?:সকালে|দিব|পাঠাব)|সকালে\s*(?:দিব|পাঠাব)|shokale|দোকান\s*থেকে\s*ক্যাশ\s*ইন|ক্যাশ\s*দিলে\s*হবে\s*না/i.test(t)) {
    return `${greeting}জি কোনো সমস্যা নেই! আপনি আপনার সুবিধাজনক সময়ে ডেলিভারি চার্জ বিকাশ/নগদে পাঠিয়ে লাস্ট ৪ ডিজিট জানিয়ে দিলেই হবে। আপনার নাম, ফোন নম্বর ও সাইজ আমরা নোট করে রাখছি এবং ড্রেসটি আপনার জন্য আলাদা করে হোল্ড রাখা হলো। 😊`;
  }

  // 4u. Rider Asking to Meet on Main Road (Seller Group Screenshot Insight #4)
  if (/রোডের\s*মাথায়|রাস্তার\s*মাথায়|গলিতে\s*ঢুকছে\s*না|বাসায়\s*আসছে\s*না|বাসায়\s*আসতে\s*চায়\s*না|মোড়ে\s*ডাকছে/i.test(t)) {
    return `${greeting}কুরিয়ারের নিয়ম হলো সরাসরি আপনার বাসায় এসে হোম ডেলিভারি দেওয়া। গলিতে বড় গাড়ি না ঢুকলে ডেলিভারি ম্যানকে হেঁটে আপনার বাসার গেট পর্যন্ত আসতে বলুন। যদি সে কোনো গড়িমসি করে, তবে আমাদের জানান—আমরা কুরিয়ার ব্রাঞ্চে যোগাযোগ করে দ্রুত ব্যবস্থা নিচ্ছি।`;
  }

  // 4v. Online Shopping Trauma & Past Scam Fear (Seller Group Screenshot Insight #5)
  if (/ধোঁকা\s*খেয়েছি|প্রতারিত|ঠকেছি|খারাপ\s*অভিজ্ঞতা|আগে\s*কিনে\s*খারাপ|বিশ্বাস\s*হয়\s*না|ভয়\s*লাগে|অনলাইনে\s*বিশ্বাস/i.test(t)) {
    return `${greeting}আপনার খারাপ অভিজ্ঞতার কথা আমরা শতভাগ বুঝি—অনলাইনে অনেকেই ক্যাটালগের ছবি দেখিয়ে লোকাল কাপড় পাঠায়। সে কারণেই দাওয়াহ ফ্যাশনে কোনো ইন্টারনেট ক্যাটালগ ছবি ব্যবহার করা হয় না, প্রতিটা ছবি আমাদের নিজস্ব রিয়েল ফটোশুটের। আর সবচেয়ে বড় সুবিধা—পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে, কোয়ালিটি পছন্দ হলে তবেই বোরকার পুরো টাকা দেবেন। পছন্দ না হলে সাথে সাথে রিটার্ন করতে পারবেন! 😊`;
  }

  // 4w. Post-Delivery Positive Feedback & Customer Love (Seller Group Screenshot Insight #6)
  if (/বোরকা\s*পেয়েছি|বোরকাটা\s*পেয়েছি|ড্রেস\s*পেয়েছি|ড্রেসটা\s*পেয়েছি|পার্সেল\s*পেয়েছি|অনেক\s*সুন্দর|মাশাল্লাহ|মা\s*শা\s*আল্লাহ|দারুণ\s*হয়েছে|খুব\s*ভালো\s*লেগেছে|পারফেক্ট\s*হয়েছে|কাপড়\s*অনেক\s*ভালো/i.test(t)) {
    return `${greeting}আলহামদুলিল্লাহ! আপনার পছন্দ হয়েছে এবং সাইজ পারফেক্ট হয়েছে জেনে আমাদের পুরো টিম আনন্দিত। 😊 আপনার সুন্দর সন্তুষ্টি আমাদের জন্য অনেক বড় প্রেরণা। দাওয়াহ ফ্যাশনের সাথে থাকার জন্য জাযাকাল্লাহু খাইরান। ভবিষ্যতে আপনার যেকোনো প্রয়োজনে আমরা সবসময় পাশে আছি। 😊`;
  }

    // Universal Height to Length (ঝুল) Size Recommender (Handles any height: 4'4", 5'5", 5'8", etc.)
  const heightRecommendation = getBorkhaSizeRecommendation(t, greeting);
  if (heightRecommendation) {
    return heightRecommendation;
  }

  if (/সাইজ কি|size ki|কি কি সাইজ|কি সাইজ|ঝুল কত|কোন সাইজ|সাইজ কত|বডি সাইজ|মাপ/i.test(t)) {
    return `${greeting}আমাদের বোরকাগুলো সম্পূর্ণ ঢিলেঢালা ফ্রি সাইজ (মার্জিত ঢিলেঢালা ফ্রি সাইজ কাটিং হওয়ায় কম বা বেশি যেকোনো বডিতেই অত্যন্ত সুন্দর ও আরামদায়কভাবে মানিয়ে যাবে। শুধু উচ্চতা অনুযায়ী ঝুল সাইজ ৫০, ৫২, ৫৪ ও ৫৬ ইঞ্চি হয়ে থাকে। আপনার উচ্চতা কত (যেমন: ৫ ফুট ২ বা ৫ ফুট ৪ ইঞ্চি) জানালে সঠিক ঝুল সাইজটি বলে দিতে পারব।`;
  }

  if (/ফেব্রিক কি|কাপড় কি|কাপড় কি|fabric ki/i.test(t)) {
    const code = detectModelFromText(t);
    const prod = code ? getProductByCode(code) : null;
    const fabricName = prod ? prod.fabric : '১০০% অরিজিনাল প্রিমিয়াম দুবাই চেরি ও কোরিয়ান চেরি কাপড়';
    return `${greeting}আমাদের এই বোরকাটি অত্যন্ত সফট ও আরামদায়ক ${fabricName} দিয়ে নিখুঁত সেলাইয়ে তৈরি। কাপড় সম্পূর্ণ নন-ট্রান্সপারেন্ট এবং আরামদায়ক প্রিমিয়াম ফলের।`;
  }

  if (/মেমো|memo|ইনভয়েস|invoice|রিসিট|receipt|বিল/i.test(t)) {
    return `${greeting}আপনার অর্ডারের সম্পূর্ণ বিবরণ দিয়ে আমাদের ডিজিটাল ক্যাশ মেমো প্রস্তুত করে দেওয়া হয়। আপনার পছন্দের মডেল, সাইজ, নাম ও সম্পূর্ণ ডেলিভারি ঠিকানা জানালে এখনই মেমো রেডি করে পাঠিয়ে দেওয়া হবে। 😊`;
  }

  // 4k. Detachable Koti Query (DF-101 3-Piece Set)
  if (/কটি\s*(?:কি\s*)?আলাদা|কোটি\s*(?:কি\s*)?আলাদা|koti\s*(?:ki\s*)?alada|কটি\s*(?:কি\s*)?জোড়া|কোটি\s*(?:কি\s*)?জোড়া|jora\s*naki\s*alada|আলাদা\s*পরা\s*যাবে|আলাদা\s*করা\s*যায়/i.test(t)) {
    return `${greeting}আলহামদুলিল্লাহ, DF-101 মডেলের ৩-পিস সেটের গর্জিয়াস কারচুপি কোটিটি সম্পূর্ণ আলাদা (ডিট্যাচেবল)! অর্থাৎ আপনি পাচ্ছেন: ১. ভেতরের লং ইনার আবায়া, ২. সম্পূর্ণ আলাদা এক্সক্লুসিভ কারচুপি কোটি, এবং ৩. ম্যাচিং প্রিমিয়াম হিজাব। আপনি চাইলে যেকোনো সাধারণ অনুষ্ঠানে কোটি ছাড়াও পড়তে পারবেন, আবার পার্টিতে কোটির সাথে পরে দারুণ গর্জিয়াস লুক পেতে পারেন! 😊 [SEND_IMAGE:DF-101]`;
  }

  // 4l. Delivery Charge & Advance Payment Objection Handling
  if (/ডেলিভারি\s*চার্জ\s*(?:ছাড়া|ফ্রি|দিতে\s*পারব\s*না|বাদ)|অগ্রিম\s*(?:দিব\s*না|দেওয়া\s*যাবে\s*না|কেন\s*দিব)|টাকা\s*আগে\s*(?:দিব\s*না|দেওয়া\s*যাবে\s*না)|পার্সেল\s*(?:পেয়ে|পাওয়ার\s*পর)\s*সব\s*(?:টাকা\s*)?দিব|delivery\s*charge\s*chara|age\s*taka\s*dibo\s*na/i.test(t)) {
    return `${greeting}আপনার নিরাপত্তার বিষয়টি আমরা শতভাগ সম্মান করি! অতীতে কিছু অনাকাঙ্ক্ষিত ফেক অর্ডারের কারণে ডেলিভারি ম্যান কাস্টমারের ঠিকানায় যাওয়ার পর রিসিভ না করলে কুরিয়ার রিটার্ন চার্জের যে বড় ক্ষতি হয়, শুধুমাত্র সেই সিকিউরিটি হিসেবে ডেলিভারি চার্জটি (ঢাকার ভেতর ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম নেওয়া হয়। তবে আপনার শতভাগ নিশ্চয়তার জন্য বোরকার কোনো টাকাই আমরা অগ্রিম নিচ্ছি না—বোরকার পুরো মূল্য পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে সম্পূর্ণ খুলে দেখে চেক করে তারপর পরিশোধ করবেন! 😊`;
  }

  // 4m. Plus Size & Body Fit Handling
  if (/(?:বডি|body)\s*(?:[৩-৪3-4][০-৮0-8]|ফ্রি\s*সাইজ|সাইজ\s*কত|মাপ)|(?:আমি\s*একটু|একটু\s*)?(?:মোটা|স্বাস্থ্যবান|হেলদি|প্লাস\s*সাইজ|plus\s*size)/i.test(t)) {
    return `${greeting}জি অবশ্যই! আমাদের প্রতিটি বোরকা ও কোটি যেকোনো বডি সাইজের যে কারও গায়ে অত্যন্ত আরামদায়ক ও নিখুঁতভাবে ফিট হবে (সম্পূর্ণ ফ্রি-সাইজ ও মার্জিত ঢিলেঢালা কাটিং)। তাই বডি ফিটিং নিয়ে একদম চিন্তা করতে হবে না। শুধুমাত্র আপনার উচ্চতা কত (যেমন: ৫ ফুট ২ বা ৫ ফুট ৪) জানালে আমরা পারফেক্ট ঝুল সাইজটি (৫০, ৫২, ৫৪, ৫৬) বুক করে দেব। 😊`;
  }

  // 4n. Washing & Maintenance Instructions
  if (/ধোয়া|ধুতে|ওয়াশ|wash|লন্ড্রি|ইস্ত্রি|আয়রন|iron|রং\s*(?:উঠবে|যাবে|জ্বলবে)|কালার\s*(?:গ্যারান্টি|উঠবে|ফ্যাকাসে)/i.test(t)) {
    return `${greeting}জি অবশ্যই! এটি ১০০% অরিজিনাল প্রিমিয়াম চেরি কাপড় হওয়ায় কালার ১০০% পাকা এবং ধুলে কোনো রং উঠবে না বা কুঁচকে যাবে না। সাধারণ শ্যাম্পু বা মাইল্ড ডিটারজেন্ট পানিতে গুলে হালকা হাতে ওয়াশ করা যাবে। কোনো ব্রাশ ব্যবহার না করার পরামর্শ দিচ্ছি। কাপড় দ্রুত শুকায় এবং কুঁচকায় না বলে আয়রনও খুব একটা লাগে না। 😊`;
  }

  // 4o. Hijab Measurement & Full Coverage
  if (/হিজাব.*(?:সাইজ|মাপ|কত\s*বড়|বড়\s*তো|লং|চওড়া)|hijab.*(?:size|map|boro)|নিকাব|niqab|পর্দা\s*করা\s*যাবে|বক্ষ/i.test(t)) {
    return `${greeting}আমাদের প্রতিটা বোরকার সাথেই ম্যাচিং প্রিমিয়াম চেরি হিজাব একদম ফ্রি দেওয়া হয়। হিজাবের সাইজ ফুল লং সাইজ (দৈর্ঘ্য প্রায় ৭৫-৮০ ইঞ্চি এবং প্রস্থ ৩০-৩২ ইঞ্চি), যা মাথা ও বক্ষ সম্পূর্ণ ঢেকে পরিপূর্ণ পর্দা করার জন্য যথেষ্ট বড়। সাথে মডেলভেদে ম্যাচিং সফট নিকাব কভারেজ সুবিধাও রয়েছে। 😊`;
  }

  // 4p. Urgent / Next-day Delivery Inquiries
  if (/(?:কালকে|কালকেই|আগামীকাল|আজকেই|জরুরি|urgent|emergency|খুব\s*তাড়াতাড়ি).*(?:লাগবে|পাব|ডেলিভারি|দেওয়া\s*যাবে|সম্ভব)|(?:kalke|agamikal).*(?:dorkar|lagbe|pabo)/i.test(t)) {
    return `${greeting}ঢাকার ভেতরে আমরা সাধারণত ১ থেকে ২ দিনের মধ্যে এবং ঢাকার বাইরে ২ থেকে ৩ দিনের মধ্যে বিশ্বস্ত কুরিয়ারে দ্রুততম সময়ে ডেলিভারি সম্পন্ন করি। আপনার ঠিকানা ঢাকার ভেতরে হলে এবং খুব জরুরি প্রয়োজন থাকলে আমরা দ্রুততম এক্সপ্রেস সার্ভিসে পাঠানোর সর্বোচ্চ চেষ্টা করব! আপনার নাম, মোবাইল, সম্পূর্ণ ঠিকানা ও সাইজটি দ্রুত কনফার্ম করে দিন। 😊`;
  }

  // 4q. bKash Personal vs Merchant Clarification
  if (/পার্সোনাল\s*নাকি\s*মার্চেন্ট|personal\s*naki\s*merchant|সেন্ড\s*মানি\s*নাকি\s*পেমেন্ট|send\s*money\s*naki\s*payment|বিকাশ\s*কি\s*নাম্বার/i.test(t)) {
    return `${greeting}আমাদের বিকাশ ও নগদ নাম্বারটি (${storeSettings.bkash_number}) ব্যক্তিগত/পার্সোনাল নাম্বার। তাই শুধুমাত্র ডেলিভারি চার্জটি (ঢাকার ভেতর ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) "সেন্ড মানি" (Send Money) করে শেষের ৪ ডিজিট জানিয়ে দিলেই আমরা সাথে সাথে অর্ডারটি কনফার্ম করে নেব। 😊`;
  }

  // 4q2. Size Exchange Policy
  if (/সাইজ\s*(?:ছোট\s*বড়|না\s*মিললে|পরিবর্তন|চেঞ্জ|বদল|এক্সচেঞ্জ|exchange)|বোরকা\s*(?:পরিবর্তন|বদল)/i.test(t)) {
    return `${greeting}জি অবশ্যই! পার্সেল রিসিভ করার পর কোনো কারণে যদি সাইজ ছোট বা বড় মনে হয়, তবে পার্সেল পাওয়ার ২৪ ঘণ্টার মধ্যে আমাদের জানালে আমরা সম্পূর্ণ ফ্রেশ সাইজে এক্সচেঞ্জ করে দেওয়ার ব্যবস্থা করি। আপনার সন্তুষ্টিই আমাদের প্রথম অগ্রাধিকার! 😊`;
  }

  // 5. Asking for all pictures or multiple photos of a model
  if (isAskingForAllImages(t)) {
    const code = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : 'DF-101');
    const prod = getProductByCode(code);
    const name = prod ? prod.name : code;
    const price = prod ? prod.price : 2200;
    const fabric = prod ? prod.fabric : '১০০% অরিজিনাল প্রিমিয়াম দুবাই চেরি';
    return `${greeting}অবশ্যই! ${name} (${code}) এর ৫টি অ্যাঙ্গেলের সব ছবি (কাজের ক্লোজ-আপ, ম্যাচিং হিজাব, ঘের ও স্বাভাবিক আলোর রিয়েল ছবি) নিচে পাঠিয়ে দিচ্ছি [SEND_ALL_IMAGES:${code}]

💰 প্রাইজ: ৳${price} টাকা (ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি)
✨ ফেব্রিক: ${fabric}
📏 সাইজ (ঝুল): ৫০, ৫২, ৫৪, ৫৬ (বডি মার্জিত ঢিলেঢালা ফ্রি সাইজ)
🚚 ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee} (পার্সেল খুলে দেখে নেওয়ার ১০০% সুযোগ)।

🛍️ অর্ডার কনফার্ম করতে চাইলে আপনার নাম, মোবাইল, সম্পূর্ণ ঠিকানা ও উচ্চতা জানিয়ে দিন! 😊`;
  }

  // 6. Asking for real unedited daylight photo
  if (isAskingForReal(t)) {
    const code = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : 'DF-101');
    const prod = getProductByCode(code);
    const name = prod ? prod.name : code;
    return `${greeting}${name} (${code}) এর স্বাভাবিক দিনের আলোর সম্পূর্ণ আনফিল্টার্ড রিয়েল ছবি নিচে দেওয়া হলো [SEND_REAL_IMAGE:${code}]
ক্যামেরা বা ছবিতে যেমন কালার ও নিখুঁত ফিনিশিং দেখছেন, বাস্তবে পার্সেল হাতে পেয়ে হুবহু তাই পাবেন! এছাড়া ডেলিভারি ম্যানের সামনে খুলে দেখে চেক করে নেওয়ার ১০০% সুবিধা রয়েছে। 😊`;
  }

  // 7. Asking for hijab photo
  if (isAskingForHijab(t)) {
    const code = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : 'DF-101');
    const prod = getProductByCode(code);
    const name = prod ? prod.name : code;
    return `${greeting}আমাদের প্রতিটি আবায়ার সাথেই আকর্ষণীয় ম্যাচিং প্রিমিয়াম হিজাব সম্পূর্ণ ফ্রি! ${name} (${code}) এর হিজাবের ছবি নিচে দেওয়া হলো [SEND_HIJAB_IMAGE:${code}]`;
  }

  // 7b. Asking for detail / close-up embroidery photo
  if (isAskingForDetail(t)) {
    const code = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : 'DF-101');
    const prod = getProductByCode(code);
    const name = prod ? prod.name : code;
    return `${greeting}নিশ্চয়ই! ${name} (${code}) এর নিখুঁত কারচুপি কাজ, হাতা ও ফেব্রিকের ক্লোজ-আপ ছবি নিচে দেওয়া হলো [SEND_DETAIL_IMAGE:${code}]`;
  }

  // 7c. Asking for flare / side angle photo
  if (isAskingForFlare(t)) {
    const code = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : 'DF-101');
    const prod = getProductByCode(code);
    const name = prod ? prod.name : code;
    return `${greeting}${name} (${code}) এর চমৎকার ঘের ও সাইড অ্যাঙ্গেলের ছবি নিচে দেওয়া হলো [SEND_FLARE_IMAGE:${code}]`;
  }

  // 8. Specific model selected or requested (by code, number, ordinal, color, or keyword)
  const selectedCode = detectModelFromText(t);
  if (selectedCode) {
    const prod = getProductByCode(selectedCode);
    if (prod) {
      return `${greeting}অবশ্যই! আপনি ${prod.name} (${prod.model_code}) পছন্দ করেছেন। নিচে এর মূল ছবি পাঠিয়ে দেওয়া হলো। [SEND_IMAGE:${prod.model_code}]

💰 প্রাইজ: ৳${prod.price} টাকা (ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি)
✨ ফেব্রিক: ${prod.fabric || '১০০% অরিজিনাল প্রিমিয়াম দুবাই চেরি'}
📏 সাইজ (ঝুল): ৫০, ৫২, ৫৪, ৫৬ (বডি মার্জিত ঢিলেঢালা ফ্রি সাইজ)
🚚 ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee} (পার্সেল হাতে পেয়ে খুলে দেখে নেওয়ার ১০০% সুযোগ)।

👉 এই মডেলটির কাজের নিখুঁত ক্লোজ-আপ, ম্যাচিং হিজাব, ঘের বা স্বাভাবিক আলোর আনফিল্টার্ড রিয়েল ছবি দেখতে চাইলে "সব ছবি দিন" বা "রিয়েল ছবি দিন" লিখে জানান। আর অর্ডার করতে চাইলে আপনার উচ্চতা জানালে পারফেক্ট সাইজ বুক করে দেব। 😊`;
    }
  }

  // 9. General photo / collection inquiry when no specific model is selected -> SEND MAIN PIC OF ALL RUNNING MODELS!
  if (isAskingForCatalogOverview(t) || isAskingForImage(t)) {
    return `${greeting}আমাদের রানিং ৫টি প্রিমিয়াম হট-সেলিং আবায়া ও বোরকার মূল ছবি নিচে পাঠিয়ে দেওয়া হলো (প্রতিটির সাথেই ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি):

১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট (৳২,৪৫০)
২. DF-102: দুবাই চেরি রানি আবায়া (৳২,২০০)
৩. DF-103: কোরিয়ান চেরি ক্যাজুয়াল কাফতান আবায়া (৳১,৯৫০)
৪. DF-104: লাক্সারি কারচুপি কাফতান সেট (৳১,৯৫০)
৫. DF-105: গর্জিয়াস দুবাই ফ্রন্ট ওপেন আবায়া (৳২,২০০)

✨ আপনার যে মডেলটি পছন্দ হয়, সেটির নাম বা নম্বর লিখে জানালে (যেমন: "DF-101", "১ নম্বর" বা "মেরুন রানি আবায়া") সেটির সব অ্যাঙ্গেলের ছবি (কাজের ক্লোজ-আপ, হিজাব, ঘের ও স্বাভাবিক আলোর রিয়েল ছবি) এবং সাইজ বিস্তারিত পাঠিয়ে দেব। 😊 [SEND_CATALOG_OVERVIEW]`;
  }

  // 9b. Customer asking about checking in front of delivery man / Opening parcel / Return policy
  if (/খুলে\s*(?:দেখা|দেখব|দেখার|দেখতে|নেব|নেওয়া)|সামনে\s*খুলে|পার্সেল\s*খুলে|চেক\s*করে|দেখে\s*নিতে|দেখে\s*শুনে|খুলে\s*চেক|পছন্দ\s*না\s*হলে|ফেরত|return/i.test(t)) {
    return `${greeting}হ্যাঁ অবশ্যই! পার্সেল হাতে পেয়ে আপনি ডেলিভারি ম্যানের সামনে সুন্দরভাবে খুলে দেখে-শুনে চেক করে নিতে পারবেন। কাপড়ের কোয়ালিটি ও ফিনিশিং পছন্দ হলে তবেই মূল্য পরিশোধ করবেন, কোনো কারণে পছন্দ না হলে সাথে সাথে রিটার্ন করতে পারবেন—পোশাকের কোনো টাকা দিতে হবে না! 😊`;
  }

  // 9c. Payment confirmation & Accounts manager flow
  const isPaidQuery = /payment koresi|টাকা পাঠিয়েছি|taka pathaisi|paid|advance disi|অগ্রিম দিয়েছি|সেন্ড মানি করেছি|send money|টাকা দিছি|bkash korsi|বিকাশ করেছি|টাকা পাঠানো শেষ|taka disi|পাঠালাম|দিলাম/i.test(t);
  const hasDigitOrSenderPhone = /(?:01[3-9]\d{8}|\b\d{4}\b|\b\d{2}\b).*(?:থেকে|theke|digit|ডিজিট|নাম্বার|number)|(?:লাস্ট|শেষ|sesh|last).*(?:\d{2,4}|digit|ডিজিট)|^(?:01[3-9]\d{8}|\d{4}|\d{2})$/i.test(t);

  if (hasDigitOrSenderPhone && !t.includes('price') && !t.includes('দাম') && !t.includes('ছবি') && !t.includes('pic')) {
    return `${greeting}ধন্যবাদ! আমাদের অ্যাকাউন্টস ম্যানেজার আপনার পেমেন্টটি ভেরিফাই করে কনফার্মেশনের জন্য আপনাকে দ্রুত কল করবেন। ইনশাআল্লাহ আপনার পছন্দের পার্সেলটি যত্নসহকারে পাঠিয়ে দেওয়া হবে।`;
  }

  if (isPaidQuery) {
    if (hasDigitOrSenderPhone) {
      return `${greeting}ধন্যবাদ! আমাদের অ্যাকাউন্টস ম্যানেজার আপনার পেমেন্টটি ভেরিফাই করে কনফার্মেশনের জন্য আপনাকে দ্রুত কল করবেন। ইনশাআল্লাহ আপনার পছন্দের পার্সেলটি যত্নসহকারে পাঠিয়ে দেওয়া হবে।`;
    }
    return `${greeting}ধন্যবাদ! আপনি যে বিকাশ বা নগদ নাম্বার থেকে টাকা পাঠিয়েছেন সেই নাম্বারটি (অথবা নাম্বারের শেষের ২ বা ৪টি ডিজিট) এবং কত টাকা পাঠিয়েছেন লিখে জানিয়ে দিন।`;
  }

  // 9d. Customer asking to order / buy / confirm / provide address
  if (/(?:অর্ডার|order).*(?:কনফার্ম|করতে|করব|নিব|দেন|দিন|চাই|ক্লিক|হবে|প্রসেস)|(?:কনফার্ম|confirm).*(?:অর্ডার|করতে|করব|চাই|দেন|দিন)|নিতে\s*চাই|nite\s*chai|কিনতে\s*চাই|kinte\s*chai|অর্ডার\s*দেন|order\s*den|এড্রেস|address|ঠিকানা|বুকিং\s*কর/i.test(t)) {
    const detectedModel = detectModelFromText(t) || (conversationHistory && conversationHistory.length ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : null);
    const prod = detectedModel ? getProductByCode(detectedModel) : null;
    const modelHeader = prod ? `${prod.name} (${prod.model_code}) এর অর্ডার কনফার্ম করতে` : 'আপনার অর্ডার কনফার্ম করতে';

    return `${greeting}অবশ্যই! ${modelHeader} ডেলিভারির সম্পূর্ণ ঠিকানা ও তথ্যগুলো একটু লিখে দিন:
১. আপনার পুরো নাম
২. মোবাইল নাম্বার
৩. আপনার উচ্চতা (যেমন: ৫'২" বা ৫'৪" - পারফেক্ট ঝুল সাইজের জন্য)
৪. সম্পূর্ণ ঠিকানা (বাসা নং, রোড/গ্রাম, থানা, জেলা)

📦 ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, ঢাকার বাইরে ৳${storeSettings.outside_dhaka_fee}।
অর্ডারটি কনফার্ম করতে শুধুমাত্র ডেলিভারি চার্জ আমাদের বিকাশ/নগদে (${storeSettings.bkash_number}) সেন্ড মানি করে শেষের ৪ ডিজিট জানিয়ে দিলে আমরা অর্ডারটি দ্রুত রেডি করে পাঠিয়ে দিব। বোরকার পুরো মূল্য পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে পরিশোধ করবেন! 😊`;
  }

  // 10. Asking for payment / bKash / Nagad / advance
  if (t.includes('pay') || t.includes('বিকাশ') || t.includes('bkash') || t.includes('nagad') || t.includes('নগদ') || t.includes('advance') || t.includes('অগ্রিম') || t.includes('টাকা পাঠাব')) {
    return `${greeting}অর্ডার কনফার্ম করতে শুধুমাত্র ডেলিভারি চার্জ (ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, ঢাকার বাইরে ৳${storeSettings.outside_dhaka_fee}) আমাদের বিকাশ বা নগদ পার্সোনাল নাম্বারে (${storeSettings.bkash_number}) সেন্ড মানি করে লাস্ট ৪ ডিজিট দিলেই হবে। বোরকার কোনো টাকা অগ্রিম নয়—পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে-শুনে নিবেন, পছন্দ হলে বোরকার মূল্য পরিশোধ করবেন, পছন্দ না হলে পেমেন্ট করতে হবে না!`;
  }

  // 11. Asking for price
  if (t.includes('dam') || t.includes('দাম') || t.includes('price') || t.includes('টাকা') || t.includes('rate') || t.includes('cost')) {
    const code = detectModelFromText(t);
    if (code) {
      const prod = getProductByCode(code);
      if (prod) {
        return `${greeting}${prod.name} (${prod.model_code}) এর মূল্য ৳${prod.price} টাকা (ম্যাচিং হিজাব একদম ফ্রি)। বোরকার কোনো টাকা অগ্রিম নেই—শুধুমাত্র ডেলিভারি চার্জ (ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম দিয়ে কনফার্ম করতে হয়। পার্সেল হাতে পেয়ে দেখে-শুনে নিবেন, পছন্দ হলে বোরকার টাকা দিবেন, পছন্দ না হলে পেমেন্ট করতে হবে না! [SEND_ALL_IMAGES:${code}]`;
      }
    }
    return `${greeting}আমাদের প্রিমিয়াম আবায়াগুলোর মূল্য ৳১,৬৫০ থেকে ৳২,৪৫০ টাকার মধ্যে (প্রতিটির সাথেই ম্যাচিং হিজাব ফ্রি)। আপনি কোন মডেলের দাম জানতে চাচ্ছেন জানালে ছবি সহ বিস্তারিত জানিয়ে দিচ্ছি।`;
  }

  // If none of the specific rule intents matched, return null to delegate to LLM
  return null;
}

// Fallback guidance when LLM is unavailable or unserviceable
function generateSmartFallback(userText, isFirstMessage = false, conversationHistory = []) {
  const fast = getFastPathReply(userText, isFirstMessage, conversationHistory);
  if (fast) return fast;

  if (isFirstMessage) {
    return 'আসসালামু আলাইকুম! Dawah Fashion-এ আপনাকে স্বাগতম। 😊 কীভাবে সাহায্য করতে পারি বলুন? আমাদের রানিং কালেকশনের বোরকাগুলো দেখতে চাচ্ছেন নাকি কোনো নির্দিষ্ট ডিজাইন বা সাইজ খুঁজছেন?';
  }
  return 'জি, বলুন কীভাবে সহযোগিতা করতে পারি? আপনি আমাদের কোনো নির্দিষ্ট বোরকার ছবি, সাইজ বা প্রাইজ সম্পর্কে জানতে চাচ্ছেন কি? 😊';
}

async function callGroqWithFallback(messages, isFirstMessage = false, userText = '') {
  if (groqClients.length === 0) {
    return generateSmartFallback(userText, isFirstMessage);
  }

  const systemPrompt = buildSystemPrompt(isFirstMessage);
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const candidateModels = [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'mixtral-8x7b-32768'
  ];

  for (let clientIdx = 0; clientIdx < groqClients.length; clientIdx++) {
    const client = groqClients[clientIdx];
    for (const model of candidateModels) {
      try {
        const completion = await client.chat.completions.create({
          model: model,
          messages: chatMessages,
          temperature: 0.75,
          max_tokens: 600
        });
        const reply = completion.choices[0]?.message?.content;
        if (reply && reply.trim()) {
          return reply.trim();
        }
      } catch (err) {
        console.warn(`[Groq Key #${clientIdx + 1} Model ${model}] Error:`, err.message);
      }
    }
  }

  return generateSmartFallback(userText, isFirstMessage);
}

// Extract and save order when lead/order details are present
async function extractAndSaveOrderLead(senderPhone, fullText, conversationHistory) {
  if (groqClients.length === 0 || !supabase) return;

  const orderKeywords = /(01[3-9]\d{8}|অর্ডার|order|ঠিকানা|এড্রেস|address|ডেলিভারি|কুরিয়ার|সাইজ|size|নিব|নিতে চাই|বিকাশ|bkash|টাকা|bdt|রানি|কাফতান|লাইন)/i;
  if (!orderKeywords.test(fullText)) {
    return;
  }

  try {
    const recentMessages = conversationHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
    const extractPrompt = `
You are a data extraction assistant for a Bangladeshi e-commerce store.
Analyze the following conversation and extract order details into strict JSON:
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
  "payment_method": "COD (Advance Delivery Paid)" or "COD" or null,
  "trx_id_or_last4": string or null
}
`;

    const activeClient = groqClients[0];
    const completion = await activeClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: extractPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 350
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');

    if (parsed.is_order_or_lead && (parsed.customer_phone || parsed.address || (parsed.product_name && parsed.length_size))) {
      const targetPhone = parsed.customer_phone || senderPhone;
      const isOutsideDhaka = parsed.address && !/(ঢাকা|dhaka|মিরপুর|উত্তরা|গুলশান|বনানী|ধানমন্ডি|মোহাম্মদপুর|বসুন্ধরা|যাত্রাবাড়ী|মতিঝিল|বাড্ডা|খিলগাঁও|মহাখালী|তেজগাঁও|ফার্মগেট|আজিমপুর|পুরান ঢাকা)/i.test(parsed.address);
      const deliveryFee = parsed.delivery_fee || (isOutsideDhaka ? storeSettings.outside_dhaka_fee : storeSettings.inside_dhaka_fee);
      
      const detectedCode = parsed.model_code || detectModelFromText(fullText) || (conversationHistory ? detectModelFromText(conversationHistory.map(m => m.content).join(' ')) : null);
      const matchedProd = getProductByCode(detectedCode);
      const prodPrice = matchedProd ? matchedProd.price : (Number(parsed.total_bdt) || 2200);
      const advancePaid = parsed.advance_paid !== undefined && parsed.advance_paid !== null ? parsed.advance_paid : (parsed.trx_id_or_last4 ? deliveryFee : 0);
      const dueCod = prodPrice; // Due COD is strictly the full dress price!

      const { data: existingOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_phone', targetPhone)
        .in('status', ['Pending', 'Pending Verification'])
        .order('id', { ascending: false })
        .limit(1);

      if (existingOrders && existingOrders.length > 0) {
        const existing = existingOrders[0];
        await supabase.from('orders').update({
          model_code: detectedCode || existing.model_code,
          customer_name: parsed.customer_name || existing.customer_name,
          address: parsed.address || existing.address,
          product_details: parsed.product_name ? `${parsed.product_name} (Size: ${parsed.length_size || 'Standard'})` : existing.product_details,
          length_size: parsed.length_size || existing.length_size,
          total_bdt: prodPrice,
          delivery_fee: deliveryFee || existing.delivery_fee,
          advance_paid: advancePaid || existing.advance_paid,
          due_cod: dueCod,
          payment_method: parsed.trx_id_or_last4 ? 'COD (Advance Delivery Paid)' : (parsed.payment_method || existing.payment_method || 'COD (Pending Advance)'),
          trx_id_or_last4: parsed.trx_id_or_last4 || existing.trx_id_or_last4
        }).eq('id', existing.id);
        console.log(`[Order Sync] Updated existing Pending Order #${existing.id} for ${targetPhone}`);
      } else {
        await supabase.from('orders').insert({
          customer_phone: targetPhone,
          model_code: detectedCode || null,
          customer_name: parsed.customer_name || null,
          address: parsed.address || null,
          product_details: parsed.product_name ? `${parsed.product_name} (Size: ${parsed.length_size || 'Standard'})` : fullText.substring(0, 200),
          length_size: parsed.length_size || null,
          total_bdt: prodPrice,
          delivery_fee: deliveryFee,
          advance_paid: advancePaid,
          due_cod: dueCod,
          payment_method: parsed.trx_id_or_last4 ? 'COD (Advance Delivery Paid)' : 'COD (Pending Advance)',
          trx_id_or_last4: parsed.trx_id_or_last4 || null,
          status: 'Pending'
        });
        console.log(`[Order Sync] Created new Order Lead for ${targetPhone}`);
      }
    }
  } catch (err) {
    console.warn('[Order Extraction Warning]:', err.message);
  }
}

async function handleIncomingMessage(senderId, userText) {
  const cleanPhone = senderId.replace(/[^0-9]/g, '');
  const isFirstMessageForContact = !hasReceivedSalamToday(cleanPhone);

  if (isFirstMessageForContact) {
    greetedContacts.set(cleanPhone, Date.now());
  }

  if (!conversationMemory.has(cleanPhone)) {
    conversationMemory.set(cleanPhone, []);
  }
  const history = conversationMemory.get(cleanPhone);
  history.push({ role: 'user', content: userText });
  if (history.length > 8) history.shift();

  let aiReply = '';

  // 0ms Fast-Path: Instantly answer standard inquiries (Price, Sizing, Delivery, Hijab, Gher, Exchange, Rider, Orders etc.)
  const fastReply = getFastPathReply(userText, isFirstMessageForContact, history);

  if (fastReply) {
    aiReply = fastReply;
  } else {
    try {
      aiReply = await callGroqWithFallback(history, isFirstMessageForContact, userText);
    } catch (error) {
      console.error('[AI Error]:', error.message);
      aiReply = generateSmartFallback(userText, isFirstMessageForContact, history);
    }
  }

  // 1. Calendar Day Salam Shield:
  // If NOT first message today and user didn't explicitly greet with Salam, strip repetitive Salam
  const userSentSalam = /^(?:assalamu|as-salamu|সালাম|আসসালামু)/i.test((userText || '').trim());
  if (!isFirstMessageForContact && !userSentSalam) {
    aiReply = aiReply.replace(/^(আসসালামু\s*আলাইকুম[^\n।!?]*[।!?\n]*|ওয়া\s*আলাইকুম\s*আসসালাম[^\n।!?]*[।!?\n]*|সালাম[^\n।!?]*[।!?\n]*)/gi, '').trim();
    if (!aiReply) {
      aiReply = 'জি, বলুন কীভাবে সাহায্য করতে পারি?';
    }
  }

  // 2. Dash & Bullet Clean Shield (Eliminates ugly --, •, —, – without breaking model codes like DF-101)
  aiReply = aiReply
    .replace(/[•●▪]/g, '')
    .replace(/[-–—]{2,}/g, ' ')
    .replace(/^[ \t]*[-–—][ \t]*/gm, '')
    .replace(/[ \t]+[-–—][ \t]+/g, ': ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Normalize any tags to canonical [SEND_TAG:DF-XXX] format
  aiReply = aiReply.replace(/\[(SEND_[A-Z_]+):\s*DF[ :_‑—–-]*(\d{3})\]/gi, '[$1:DF-$2]');

  // Shield against asking for female body/chest/bust measurements (Strictly offensive in modest fashion):
  if (/(?:আপনার\s*)?বুকের\s*(?:মাপ|সাইজ|ঘের)\s*(?:কত|জানান|দেন|দিন|বলেন)|বক্ষ\s*(?:কত|মাপ)|চেস্ট\s*(?:কত|মাপ)/i.test(aiReply)) {
    aiReply = 'আমাদের বোরকাগুলো সম্পূর্ণ ঢিলেঢালা ফ্রি সাইজ কাটিংয়ে তৈরি, তাই বডি মাপ নিয়ে একদম চিন্তা করতে হবে না। আপনার উচ্চতা জানালে পারফেক্ট ঝুল সাইজটি বুক করে দেব। 😊';
  }

  // Shield against AI/Robot identity leakage:
  if (/কৃত্রিম\s*বুদ্ধিমত্তা|artificial intelligence|\bAI\b|রোবট|robot/i.test(aiReply)) {
    aiReply = 'আমি দাওয়াহ ফ্যাশন থেকে বলছি 😊 আপনাকে সুন্দর একটি বোরকা বা আবায়া বেছে নিতে কীভাবে সাহায্য করতে পারি বলুন?';
  }

  // Soften robotic price rejection:
  if (/দাম\s*নির্ধারিত\s*এবং\s*পরিবর্তন\s*করা\s*সম্ভব\s*নয়/i.test(aiReply)) {
    aiReply = 'আমাদের প্রতিটি বোরকা ও আবায়া প্রিমিয়াম দুবাই ও কোরিয়ান চেরি ফেব্রিক দিয়ে নিখুঁত কারচুপি ও ফিনিশিংয়ে তৈরি, সাথে আকর্ষণীয় ম্যাচিং হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন! তাই কোয়ালিটি বিবেচনায় প্রাইজটি একদম রিজনেবল ও ফিক্সড রাখা হয়েছে।';
  }

  // 3. Smart Image Dispatch & Zero-Image Purity Shield:
  if (isPureQuestion(userText)) {
    // Pure Q&A (pricing, size, fabric, delivery, etc.) -> Strictly strip ANY image tags!
    aiReply = aiReply.replace(/\[\s*SEND_[A-Z_]+[^\]]*\]/gi, '').trim();
  } else if (isAskingForCatalogOverview(userText)) {
    // Customer wants catalog / all designs -> Send 1 front image per model!
    aiReply = aiReply.replace(/\[\s*SEND_[A-Z_]+[^\]]*\]/gi, '').trim();
    aiReply += ' [SEND_CATALOG_OVERVIEW]';
  } else {
    // If specific model is requested with image intent
    const hasImageTag = /\[\s*SEND_[A-Z_]+[^\]]*\]/i.test(aiReply);
    if (!hasImageTag) {
      const detectedModel = detectModelFromText(userText) || detectModelFromText(aiReply);
      const wantsImage = isAskingForImage(userText);
      if (detectedModel && wantsImage) {
        if (isAskingForHijab(userText)) {
          aiReply += ` [SEND_HIJAB_IMAGE:${detectedModel}]`;
        } else if (isAskingForDetail(userText)) {
          aiReply += ` [SEND_DETAIL_IMAGE:${detectedModel}]`;
        } else if (isAskingForFlare(userText)) {
          aiReply += ` [SEND_FLARE_IMAGE:${detectedModel}]`;
        } else if (isAskingForReal(userText)) {
          aiReply += ` [SEND_REAL_IMAGE:${detectedModel}]`;
        } else if (isAskingForAllImages(userText)) {
          aiReply += ` [SEND_ALL_IMAGES:${detectedModel}]`;
        } else {
          aiReply += ` [SEND_IMAGE:${detectedModel}]`;
        }
      }
    }
  }

  // Downgrade SEND_ALL_IMAGES to SEND_IMAGE if customer did not explicitly ask for all images
  if (!isAskingForAllImages(userText)) {
    aiReply = aiReply.replace(/\[\s*SEND_ALL_IMAGES\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi, '[SEND_IMAGE:$1]');
  }

  // Vocabulary localizer shield (strips robotic phrases)
  aiReply = aiReply
    .replace(/উপলব্ধ\s*রয়েছে|উপলব্ধ\s*আছে|উপলব্ধ/gi, 'আমাদের কাছে আছে')
    .replace(/এভেইলেবল\s*রয়েছে|এভেইলেবল\s*আছে|এভেইলেবল/gi, 'স্টকে আছে')
    .replace(/অনলাইন\s*সাপোর্ট\s*টিম\s*থেকে\s*বলছি/gi, 'দাওয়াহ ফ্যাশন থেকে বলছি')
    .replace(/মূল্য\s*পরিশোধ\s*করবেন/gi, 'টাকা ডেলিভারি ম্যানকে দিয়ে পার্সেল বুঝে নেবেন')
    .replace(/পার্সেল\s*যত্নসহকারে\s*পাঠিয়ে\s*দেওয়া\s*হবে/gi, 'পার্সেলটি সুন্দরভাবে রেডি করে পাঠিয়ে দেওয়া হবে')
    .replace(/অনুগ্রহ\s*করে\s*আপনার\s*সম্পূর্ণ\s*ডেলিভারি\s*ঠিকানাটি/gi, 'আপনার ডেলিভারির ঠিকানাটি')
    .replace(/প্রস্তুত\s*করা/gi, 'তৈরি করা');

  // 4. Financial Calculation Protection Shield:
  // Strictly prevent any hallucinated advance calculations (e.g. 1000 TK / 1080 TK advance).
  // Advance is strictly delivery fee (80 / 150), and Due COD is the dress price.
  if (/(১০৮০|১০০০\s*টাকা\s*অগ্রিম|১১০০\s*টাকা\s*বাকি|1080|1000\s*advance)/i.test(aiReply)) {
    const detectedModel = detectModelFromText(userText) || detectModelFromText(aiReply) || 'DF-101';
    const prod = getProductByCode(detectedModel);
    const price = prod ? prod.price : 2450;
    aiReply = aiReply
      .replace(/(১০৮০|1080)/g, `${storeSettings.inside_dhaka_fee}`)
      .replace(/(১১০০|1100)/g, `${price}`);
  }

  history.push({ role: 'assistant', content: aiReply });

  // Asynchronously extract and sync order without blocking reply
  extractAndSaveOrderLead(cleanPhone, userText, history).catch(e => {
    console.warn('[Async Lead Sync]', e.message);
  });

  return aiReply;
}

function getProductByCode(code) {
  if (!code) return null;
  const clean = code.toUpperCase().trim();
  return cachedProductList.find(p => p.model_code && p.model_code.toUpperCase().trim() === clean) || null;
}

function getAllCachedProducts() {
  return cachedProductList;
}

module.exports = { getFastPathReply,  
  handleIncomingMessage, 
  refreshProductsFromDB, 
  refreshSettingsFromDB, 
  getStoreSettings: () => storeSettings,
  getProductByCode,
  getAllCachedProducts
};
