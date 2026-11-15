const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const groqApiKey = process.env.GROQ_API_KEY;
let groqClient = null;
if (groqApiKey) {
  try {
    groqClient = new Groq({ apiKey: groqApiKey });
  } catch (err) {
    console.warn('[AI] Groq init warning:', err.message);
  }
}

const supabaseUrl = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(supabaseUrl, supabaseKey);

// In-memory product cache (refreshed periodically from Supabase)
let cachedProductsText = `
১. [মডেল কোড: DF-101] ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট, মূল্য: ৳২,৪৫০ টাকা (ফেব্রিক: প্রিমিয়াম দুবাই চেরি কাপড় + গর্জিয়াস কারচুপি কোটি, ঝুল ৫০-৫৬, বডি ৩৮-৪৬ ফ্রি সাইজ, ম্যাচিং হিজাব ফ্রি ৩-পিস সেট)
২. [মডেল কোড: DF-102] প্রিমিয়াম দুবাই চেরি রানি আবায়া (জেট ব্ল্যাক), মূল্য: ৳২,২০০ টাকা (১০০% অরিজিনাল দুবাই চেরি, ঝুল ৫০-৫৬, বডি ৩৬-৪৬, ম্যাচিং হিজাব ফ্রি)
৩. [মডেল কোড: DF-103] কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান বোরকা (কফি ও সি-গ্রিন), মূল্য: ৳১,৯৫০ টাকা (প্রিমিয়াম সফট কোরিয়ান চেরি ও জর্জেট, ঝুল ৫২-৫৬, কাফতান ফ্রি সাইজ, ম্যাচিং হিজাব ফ্রি)
৪. [মডেল কোড: DF-104] সিম্পল এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার বোরকা (নেভি ব্লু), মূল্য: ৳১,৬৫০ টাকা (১০০% সফট দুবাই চেরি, ঝুল ৫০-৫৬, বডি ৩৬-৪৪, হিজাব সহ)
৫. [মডেল কোড: DF-105] এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (রয়েল ব্লু ও মেরুন), মূল্য: ৳২,৩০০ টাকা (হেভি কোরিয়ান ডায়মন্ড জর্জেট, ঝুল ৫২-৫৬, ম্যাচিং লং হিজাব ফ্রি)
৬. [মডেল কোড: DF-106] ডাবল লেয়ার কোটি স্টাইল দুবাই আবায়া (চকলেট ও কালো), মূল্য: ৳২,১০০ টাকা (পিওর দুবাই চেরি ডাবল লেয়ার, ঝুল ৫০-৫৬, বডি ৩৮-৪৪, ম্যাচিং হিজাব ফ্রি)
`;

let cachedProductList = [];

// Dynamic Store & Delivery Settings (synced from Supabase store_settings)
let storeSettings = {
  inside_dhaka_fee: 80,
  outside_dhaka_fee: 150,
  bkash_number: '01613-129192',
  nagad_number: '01677-557292',
  auto_reply_enabled: true
};

async function refreshSettingsFromDB() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('store_settings').select('*').eq('id', 1).single();
    if (data && !error) {
      storeSettings = {
        inside_dhaka_fee: Number(data.inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(data.outside_dhaka_fee) || 150,
        bkash_number: data.bkash_number || '01613-129192',
        nagad_number: data.nagad_number || '01677-557292',
        auto_reply_enabled: data.auto_reply_enabled ?? true
      };
      console.log(`[Store Settings Loaded] Inside Dhaka: ৳${storeSettings.inside_dhaka_fee} | Outside Dhaka: ৳${storeSettings.outside_dhaka_fee}`);
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
        `${idx + 1}. [মডেল কোড: ${p.model_code || 'DF-' + (100 + idx + 1)}] ${p.name}, মূল্য: ৳${p.price} টাকা (ফেব্রিক: ${p.fabric || 'দুবাই চেরি'}, সাইজ: ${p.sizes || '৫০-৫৬'}, হিজাব: ${p.hijab_included ? 'সাথে ফ্রি' : 'আলাদা'}${p.image_url ? ', মেইন ছবি: আছে' : ''}${p.hijab_image_url ? ', হিজাব ছবি: আছে' : ''}${p.detail_image_url ? ', কাজের ছবি: আছে' : ''})`
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

// Set of contact phone numbers that have already received Salam today
const greetedContacts = new Set();

// Conversation memory per user (sliding window)
const conversationMemory = new Map();

// Intent, Color, and Model Matchers
function detectModelFromText(text) {
  const t = (text || '').toLowerCase();
  // Direct model code or keywords
  if (/df-?101|\b101\b|কারচুপি|karchupi|কোটি|koti/i.test(t)) return 'DF-101';
  if (/df-?102|\b102\b|রানি|rani/i.test(t)) return 'DF-102';
  if (/df-?103|\b103\b|কাফতান|kaftan|কোরিয়ান|korian|korean|ceri/i.test(t)) return 'DF-103';
  if (/df-?104|\b104\b|এ-লাইন|a-line|aline|ক্যাজুয়াল/i.test(t)) return 'DF-104';
  if (/df-?105|\b105\b|বাটারফ্লাই|butterfly/i.test(t)) return 'DF-105';
  if (/df-?106|\b106\b|ডাবল লেয়ার|double layer/i.test(t)) return 'DF-106';

  // Ordinal numbering from catalog lists (e.g. "4 number er pic daw", "৩ নাম্বারটা দেখান", "১ নং এর ছবি")
  if (/(?:^|\s|[^\w])(?:১|1)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)/i.test(t)) return 'DF-101';
  if (/(?:^|\s|[^\w])(?:২|2)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)/i.test(t)) return 'DF-102';
  if (/(?:^|\s|[^\w])(?:৩|3)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)/i.test(t)) return 'DF-103';
  if (/(?:^|\s|[^\w])(?:৪|4)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)/i.test(t)) return 'DF-104';
  if (/(?:^|\s|[^\w])(?:৫|5)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)/i.test(t)) return 'DF-105';
  if (/(?:^|\s|[^\w])(?:৬|6)\s*(?:নং|নম্বর|নাম্বার|number|no|er|এর|ta|টা)/i.test(t)) return 'DF-106';

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
  return /দাম কম|কম রাখা|kom rakha|dam kom|kom koren|kom kora|kom hobe|discount|ডিসকাউন্ট|ছাড়|kom e sell|kome sell|sobai to kom/i.test(t);
}

function isIdentityOrPersonalQuery(text) {
  const t = (text || '').toLowerCase();
  return /নাম কি|nam ki|married|বিয়ে|meye naki chele|ছেলে না মেয়ে|রোবট|robot|ai naki|মানুষ naki|kotha theke|apni ke|tmr kono nam/i.test(t);
}

function isAskingForImage(text) {
  const t = (text || '').toLowerCase();
  return /ছবি|পিক|পিকচার|pic|photo|image|chobi|dekhao|dekhaw|dekhi|দেখান|দেখাও|দেখব|দেখি|দেখতে|কালেকশন/i.test(t);
}

function isAskingForHijab(text) {
  const t = (text || '').toLowerCase();
  return /হিজাব|hijab|ওড়না|orna/i.test(t);
}

function isAskingForDetail(text) {
  const t = (text || '').toLowerCase();
  return /কাজের|ডিটেইল|detail|ক্লোজ|close|হাতা|কাজ|স্লিভ|sleeve/i.test(t);
}

function isAskingForAllImages(text) {
  const t = (text || '').toLowerCase();
  return /সব|all|একাধিক|কয়েকটা|আরও|আর কি|ডিটেইল/i.test(t);
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
You are the official smart sales consultant for "Dawah Fashion" (দাওয়াহ ফ্যাশন) - an exclusive modest clothing & premium Abaya brand in Bangladesh ("Dress with Purpose").

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
     "আমি দাওয়াহ ফ্যাশনের অনলাইন সাপোর্ট টিম থেকে বলছি 🌸 আপনাকে সুন্দর একটি বোরকা বা আবায়া সিলেক্ট করতে কীভাবে সাহায্য করতে পারি বলুন?"

5. PRICE BARGAINING & JUSTIFICATION (দাম কমানোর অনুরোধে করণীয়):
   - কাস্টমার যদি দাম কমাতে বলে বা বলে "সবাই তো কমে সেল করছে / দাম কম রাখা যায় না / ডিসকাউন্ট হবে?":
     কখনোই রোবটের মতো "দুঃখিত, দাম কমানো সম্ভব নয়" বলবে না! প্রিমিয়াম কোয়ালিটি ব্যাখ্যা করে আন্তরিকভাবে বলবে:
     "আমাদের প্রতিটি বোরকা ও আবায়া অরিজিনাল প্রিমিয়াম দুবাই ও কোরিয়ান চেরি ফেব্রিক দিয়ে নিখুঁত কারচুপি ও সেলাই ফিনিশিংয়ে প্রস্তুত করা। সাথে আকর্ষণীয় ম্যাচিং হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন এবং সারা দেশে ক্যাশ অন ডেলিভারি সুবিধা রয়েছে। কোয়ালিটি বিবেচনায় প্রাইজটি একদম রিজনেবল ও ফিক্সড রাখা হয়েছে।"

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

7. IMMEDIATE SPECIFIC PHOTO TAG ATTACHMENT:
   - কাস্টমার যখনই কোনো মডেল বা ছবি দেখতে চাইবে, উত্তরের শেষে অবশ্যই ফটো ট্যাগ লিখবে:
     * মেইন ছবি: [SEND_IMAGE:DF-XXX]
     * সব ছবি / একাধিক ছবি: [SEND_ALL_IMAGES:DF-XXX]
     * হিজাবের ছবি: [SEND_HIJAB_IMAGE:DF-XXX]
     * কাজের ডিটেইল ছবি: [SEND_DETAIL_IMAGE:DF-XXX]

8. STRICT PRICING & ZERO-ADVANCE COD POLICY (ভুল হিসাব বা জামার টাকা অগ্রিম চাওয়া সম্পূর্ণ নিষিদ্ধ):
   - জামার জন্য ১ টাকাও অগ্রিম নেওয়া হয় না! জামার সম্পূর্ণ দাম পণ্য হাতে পেয়ে ক্যাশ অন ডেলিভারিতে দিতে হয়।
   - অগ্রিম শুধুমাত্র এবং শুধুমাত্র ডেলিভারি চার্জ:
     * ঢাকার ভেতরে ডেলিভারি চার্জ: ঠিক ৳${storeSettings.inside_dhaka_fee} টাকা (৮০ টাকা)।
     * ঢাকার বাইরে ডেলিভারি চার্জ: ঠিক ৳${storeSettings.outside_dhaka_fee} টাকা (১৫০ টাকা)।
     * বিকাশ ও নগদ পার্সোনাল নাম্বার: ${storeSettings.bkash_number}
   - সম্পূর্ণ নিষিদ্ধ (CRITICAL ERROR): কখনোই কাস্টমারের কাছে ১,০০০ টাকা বা ৫০% বা জামার কোনো দাম অগ্রিম চাইবে না! অগ্রিম শুধুমাত্র ৮০ টাকা অথবা ১৫০ টাকা!
   - ডেলিভারির সময় বকেয়া (Due COD): কাস্টমার পার্সেল হাতে পেয়ে ডেলিভারি ম্যানকে ঠিক জামার আসল দাম পরিশোধ করবেন।

9. CLEAN, CONCISE & STRUCTURED FORMAT:
   - উত্তর কখনোই এলোমেলো বা বড় অনুচ্ছেদ হবে না।
   - সর্বোচ্চ ৩ থেকে ৪ লাইনের পরিচ্ছন্ন ও গোছানো ফরম্যাট।
   - ১., ২. দিয়ে পরিষ্কার পয়েন্ট।

ABOUT DAWAH FASHION:
- Brand Name: Dawah Fashion (দাওয়াহ ফ্যাশন)
- Motto: Dress with Purpose | Modest Style | Premium Quality
- Location: Dhaka, Bangladesh (Mirpur). Cash on Delivery (COD) available all over Bangladesh.

CURRENT LIVE PRODUCTS & PRICING:
${cachedProductsText}
`;
}

// Smart Dynamic Fallback Generator when LLM is unavailable
function generateSmartFallback(userText, isFirstMessage) {
  const t = (userText || '').toLowerCase();
  const greeting = isFirstMessage ? 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। ' : 'জি, ';

  // 1. Personal / Identity / Robot questions
  if (isIdentityOrPersonalQuery(t)) {
    return 'আমি দাওয়াহ ফ্যাশনের অনলাইন সাপোর্ট টিম থেকে বলছি 🌸 আপনাকে সুন্দর একটি বোরকা বা আবায়া সিলেক্ট করতে কীভাবে সাহায্য করতে পারি বলুন?';
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

  // 5. Asking for all pictures or multiple photos
  if (isAskingForAllImages(t) && isAskingForImage(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}অবশ্যই! ${code} মডেলের মেইন লুক, ম্যাচিং হিজাব ও নিখুঁত কাজের সব ছবি পাঠিয়ে দেওয়া হলো [SEND_ALL_IMAGES:${code}]`;
  }

  // 6. Asking for hijab photo
  if (isAskingForHijab(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}আমাদের প্রতিটি আবায়ার সাথেই ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি! ${code} এর হিজাবের ছবি নিচে দেওয়া হলো [SEND_HIJAB_IMAGE:${code}]`;
  }

  // 7. Asking for detail photo
  if (isAskingForDetail(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}নিশ্চয়ই! ${code} এর নিখুঁত কারচুপি কাজ ও ফেব্রিকের ক্লোজ-আপ ছবি নিচে দেওয়া হলো [SEND_DETAIL_IMAGE:${code}]`;
  }

  // 8. Asking for general photo / picture of a model
  if (isAskingForImage(t)) {
    const code = detectModelFromText(t);
    if (code) {
      const prod = getProductByCode(code);
      const name = prod ? prod.name : code;
      return `${greeting}${name} এর সুন্দর রিয়েল ছবি পাঠিয়ে দেওয়া হলো [SEND_IMAGE:${code}]`;
    }
    return `${greeting}আমাদের সেরা ২টি মডেল—৩-পিস কারচুপি কোটি সেট ও দুবাই চেরি রানি আবায়ার ছবি পাঠিয়ে দিচ্ছি [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-102]`;
  }

  // 9. Asking for models or collection
  if (t.includes('model') || t.includes('মডেল') || t.includes('কি কি') || t.includes('design') || t.includes('ডিজাইন') || t.includes('কালেকশন') || t.includes('total') || t.includes('কয়টা') || t.includes('কয়টা')) {
    return `${greeting}আমাদের কালেকশনে বর্তমানে সেরা এই মডেলগুলো রয়েছে:
১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (৳২,৪৫০)
২. DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (৳২,২০০)
৩. DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
৪. DF-104: সিম্পল এ-লাইন ক্যাজুয়াল বোরকা (৳১,৬৫০)
৫. DF-105: বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
সবগুলোর সাথেই ম্যাচিং হিজাব একদম ফ্রি! আপনি কোন মডেলটির ছবি দেখতে চাচ্ছেন?`;
  }

  // 10. Asking for payment / bKash / Nagad
  if (t.includes('pay') || t.includes('বিকাশ') || t.includes('bkash') || t.includes('nagad') || t.includes('নগদ') || t.includes('advance') || t.includes('অগ্রিম') || t.includes('টাকা পাঠাব')) {
    return `${greeting}অর্ডার কনফার্ম করতে শুধুমাত্র ডেলিভারি চার্জ (ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, ঢাকার বাইরে ৳${storeSettings.outside_dhaka_fee}) আমাদের বিকাশ বা নগদ পার্সোনাল নাম্বারে (${storeSettings.bkash_number}) সেন্ড মানি করে লাস্ট ৪ ডিজিট অথবা একটি স্ক্রিনশট দিলেই হবে। জামার কোনো টাকা অগ্রিম নয়, পুরো টাকাই ডেলিভারির সময় ক্যাশ অন ডেলিভারিতে দিবেন।`;
  }

  // 11. Asking for price
  if (t.includes('dam') || t.includes('দাম') || t.includes('price') || t.includes('টাকা') || t.includes('rate') || t.includes('cost')) {
    const code = detectModelFromText(t);
    if (code) {
      const prod = getProductByCode(code);
      if (prod) {
        return `${greeting}${prod.name} (${prod.model_code}) এর মূল্য ৳${prod.price} টাকা (ম্যাচিং হিজাব ফ্রি)। জামার কোনো টাকা অগ্রিম নেওয়া হয় না। শুধুমাত্র ডেলিভারি চার্জ (ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}) অগ্রিম দিয়ে কনফার্ম করতে হয়, বাকি পুরো টাকা পণ্য হাতে পেয়ে দিবেন। [SEND_IMAGE:${code}]`;
      }
    }
    return `${greeting}আমাদের প্রিমিয়াম আবায়াগুলোর মূল্য ৳১,৬৫০ থেকে ৳২,৪৫০ টাকার মধ্যে (প্রতিটির সাথেই ম্যাচিং হিজাব ফ্রি)। আপনি কোন মডেলের দাম জানতে চাচ্ছেন জানালে ছবি সহ বিস্তারিত জানিয়ে দিচ্ছি।`;
  }

  // Default pleasant guidance
  if (isFirstMessage) {
    return 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। আমাদের এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট, দুবাই চেরি রানি আবায়া ও কাফতান কালেকশন রয়েছে (সবগুলোর সাথেই ম্যাচিং হিজাব একদম ফ্রি)। আপনি কোন মডেলের ছবি বা বিস্তারিত দেখতে চাচ্ছেন?';
  }
  return 'জি, আপনি কোন মডেলের ছবি বা সাইজ দেখতে চাচ্ছেন জানালে এখনই শেয়ার করছি।';
}

async function callGroqWithFallback(messages, isFirstMessage = false, userText = '') {
  if (!groqClient) {
    return generateSmartFallback(userText, isFirstMessage);
  }

  const systemPrompt = buildSystemPrompt(isFirstMessage);
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const candidateModels = [
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b'
  ];

  for (const model of candidateModels) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: model,
        messages: chatMessages,
        temperature: 0.65,
        max_tokens: 500
      });
      const reply = completion.choices[0]?.message?.content;
      if (reply && reply.trim()) {
        return reply.trim();
      }
    } catch (err) {
      console.warn(`[Groq Model ${model}] Error:`, err.message);
    }
  }

  return generateSmartFallback(userText, isFirstMessage);
}

// Extract and save order when lead/order details are present
async function extractAndSaveOrderLead(senderPhone, fullText, conversationHistory) {
  if (!groqClient || !supabase) return;

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

    const completion = await groqClient.chat.completions.create({
      model: 'openai/gpt-oss-120b',
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
  const isFirstMessageForContact = !greetedContacts.has(cleanPhone);

  if (isFirstMessageForContact) {
    greetedContacts.add(cleanPhone);
  }

  if (!conversationMemory.has(cleanPhone)) {
    conversationMemory.set(cleanPhone, []);
  }
  const history = conversationMemory.get(cleanPhone);
  history.push({ role: 'user', content: userText });
  if (history.length > 8) history.shift();

  let aiReply = '';

  try {
    aiReply = await callGroqWithFallback(history, isFirstMessageForContact, userText);
  } catch (error) {
    console.error('[AI Error]:', error.message);
    aiReply = generateSmartFallback(userText, isFirstMessageForContact);
  }

  // 1. Double-shield: if NOT first message, strip any accidental Salam
  if (!isFirstMessageForContact) {
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

  // Shield against AI/Robot identity leakage:
  if (/কৃত্রিম\s*বুদ্ধিমত্তা|artificial intelligence|\bAI\b|রোবট|robot/i.test(aiReply)) {
    aiReply = 'আমি দাওয়াহ ফ্যাশনের অনলাইন সাপোর্ট টিম থেকে বলছি 🌸 আপনাকে সুন্দর একটি বোরকা বা আবায়া সিলেক্ট করতে কীভাবে সাহায্য করতে পারি বলুন?';
  }

  // Soften robotic price rejection:
  if (/দাম\s*নির্ধারিত\s*এবং\s*পরিবর্তন\s*করা\s*সম্ভব\s*নয়/i.test(aiReply)) {
    aiReply = 'আমাদের প্রতিটি বোরকা ও আবায়া প্রিমিয়াম দুবাই ও কোরিয়ান চেরি ফেব্রিক দিয়ে নিখুঁত কারচুপি ও ফিনিশিংয়ে তৈরি, সাথে আকর্ষণীয় ম্যাচিং হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন! তাই কোয়ালিটি বিবেচনায় প্রাইজটি একদম রিজনেবল ও ফিক্সড রাখা হয়েছে।';
  }

  // 3. Deterministic Photo Guarantee Shield:
  // If customer is asking to see a model, asking for pics, colors, or confused, ensure image tags are attached!
  const hasImageTag = /\[SEND_(IMAGE|ALL_IMAGES|HIJAB_IMAGE|DETAIL_IMAGE):[A-Za-z0-9_-]+\]/i.test(aiReply);
  if (!hasImageTag) {
    const detectedModel = detectModelFromText(userText) || detectModelFromText(aiReply);
    const color = detectColorPreference(userText);
    const isConfused = isCustomerConfusedOrUndecided(userText);
    const wantsImage = isAskingForImage(userText) || /দেখাচ্ছি|পাঠিয়ে দিচ্ছি|ছবি নিচে|পিকচার|দেখুন|ছবি/i.test(aiReply);
    
    if (detectedModel && (wantsImage || isAskingForImage(userText))) {
      if (isAskingForHijab(userText)) {
        aiReply += ` [SEND_HIJAB_IMAGE:${detectedModel}]`;
      } else if (isAskingForDetail(userText)) {
        aiReply += ` [SEND_DETAIL_IMAGE:${detectedModel}]`;
      } else if (isAskingForAllImages(userText)) {
        aiReply += ` [SEND_ALL_IMAGES:${detectedModel}]`;
      } else {
        aiReply += ` [SEND_IMAGE:${detectedModel}]`;
      }
    } else if (color === 'coffee') {
      aiReply += ' [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-106]';
    } else if (color === 'black') {
      aiReply += ' [SEND_IMAGE:DF-101] [SEND_IMAGE:DF-102]';
    } else if (color === 'maroon' || color === 'blue') {
      aiReply += ' [SEND_IMAGE:DF-105]';
    } else if (color === 'green') {
      aiReply += ' [SEND_IMAGE:DF-103]';
    } else if (color === 'any_other_color') {
      aiReply += ' [SEND_IMAGE:DF-103] [SEND_IMAGE:DF-105] [SEND_IMAGE:DF-106]';
    } else if (isConfused) {
      aiReply += ' [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-103]';
    } else if (wantsImage && !detectedModel) {
      aiReply += ' [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-102]';
    }
  }

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

module.exports = { 
  handleIncomingMessage, 
  refreshProductsFromDB, 
  refreshSettingsFromDB, 
  getStoreSettings: () => storeSettings,
  getProductByCode,
  getAllCachedProducts
};
