const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');
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
১. [মডেল কোড: DF-101] ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট - মূল্য: ৳২,৪৫০ টাকা (ফেব্রিক: প্রিমিয়াম দুবাই চেরি কাপড় + গর্জিয়াস কারচুপি কোটি, ঝুল ৫০-৫৬, বডি ৩৮-৪৬ ফ্রি সাইজ, ম্যাচিং হিজাব ফ্রি ৩-পিস সেট)
২. [মডেল কোড: DF-102] প্রিমিয়াম দুবাই চেরি রানি আবায়া (জেট ব্ল্যাক) - মূল্য: ৳২,২০০ টাকা (১০০% অরিজিনাল দুবাই চেরি, ঝুল ৫০-৫৬, বডি ৩৬-৪৬, ম্যাচিং হিজাব ফ্রি)
৩. [মডেল কোড: DF-103] কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান বোরকা (কফি ও সি-গ্রিন) - মূল্য: ৳১,৯৫০ টাকা (প্রিমিয়াম সফট কোরিয়ান চেরি ও জর্জেট, ঝুল ৫২-৫৬, কাফতান ফ্রি সাইজ, ম্যাচিং হিজাব ফ্রি)
৪. [মডেল কোড: DF-104] সিম্পল এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার বোরকা (নেভি ব্লু) - মূল্য: ৳১,৬৫০ টাকা (১০০% সফট দুবাই চেরি, ঝুল ৫০-৫৬, বডি ৩৬-৪৪, হিজাব সহ)
৫. [মডেল কোড: DF-105] এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (রয়েল ব্লু ও মেরুন) - মূল্য: ৳২,৩০০ টাকা (হেভি কোরিয়ান ডায়মন্ড জর্জেট, ঝুল ৫২-৫৬, ম্যাচিং লং হিজাব ফ্রি)
৬. [মডেল কোড: DF-106] ডাবল লেয়ার কোটি স্টাইল দুবাই আবায়া (চকলেট ও কালো) - মূল্য: ৳২,১০০ টাকা (পিওর দুবাই চেরি ডাবল লেয়ার, ঝুল ৫০-৫৬, বডি ৩৮-৪৪, ম্যাচিং হিজাব ফ্রি)
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
        `${idx + 1}. [মডেল কোড: ${p.model_code || 'DF-' + (100 + idx + 1)}] ${p.name} - মূল্য: ৳${p.price} টাকা (ফেব্রিক: ${p.fabric || 'দুবাই চেরি'}, সাইজ: ${p.sizes || '৫০-৫৬'}, হিজাব: ${p.hijab_included ? 'সাথে ফ্রি' : 'আলাদা'}${p.image_url ? ', মেইন ছবি: আছে' : ''}${p.hijab_image_url ? ', হিজাব ছবি: আছে' : ''}${p.detail_image_url ? ', কাজের ডিটেইল ছবি: আছে' : ''})`
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
You are the official smart sales assistant for "Dawah Fashion" (দাওয়াহ ফ্যাশন) - an exclusive modest clothing & premium Abaya brand in Bangladesh ("Dress with Purpose").

CRITICAL COMMUNICATION RULES (MUST FOLLOW STRICTLY):
1. NO GENDER ASSUMPTIONS - NEVER SAY "আপু", "ভাইয়া", OR "আপু/ভাইয়া":
   - কখনোই কাস্টমারকে "আপু" বা "ভাইয়া" বলবে না।
   - সব সময় প্রমিত, মার্জিত ও সম্মানসূচক "আপনি", "আপনার", "জি", "অবশ্যই" ব্যবহার করবে।
   - কাস্টমার যে-ই হোক, অত্যন্ত আন্তরিক ও ইসলামিক শালীনতা বজায় রেখে কথা বলবে।

${salamRule}

3. CONCISE & DIRECT ANSWERS (টু দ্য পয়েন্ট ও প্রাসঙ্গিক উত্তর):
   - কাস্টমার যতটুকু জানতে চেয়েছে ততটুকুর সরাসরি ও সুন্দর উত্তর দিবে (১ থেকে ৩ লাইনের মধ্যে)।
   - কাস্টমার যদি বলে "কোন কোন মডেল আছে", "মডেল দেখাও", "কালেকশন কি কি":
     সরাসরি আমাদের এভেইলেবল মডেলগুলোর কোড ও নাম সংক্ষেপে উল্লেখ করে বলবে:
     "আমাদের কাছে বর্তমানে জনপ্রিয় এই মডেলগুলো রয়েছে:
     • DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট (৳২,৪৫০)
     • DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (৳২,২০০)
     • DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
     • DF-104: সিম্পল এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার (৳১,৬৫০)
     • DF-105: এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
     সবগুলোর সাথেই ম্যাচিং হিজাব ফ্রি! আপনি কোন মডেলটির ছবি ও বিস্তারিত দেখতে চাচ্ছেন?"
   - কাস্টমার কোনো অপ্রাসঙ্গিক কথা বললে অযথা অন্য কিছু (যেমন মা, ওয়াইফ ইত্যাদি) টেনে আনবে না। যদি কাস্টমার নিজে বলে যে সে মা বা ওয়াইফের জন্য নিচ্ছে, তখন শুধু তাদের পছন্দের কথা জানতে চাইবে।

4. LOCAL BANGLADESH VIBE & LIGHT WITTY WARMTH (লোকাল ভাষার মিষ্টি টান ও আন্তরিক মজা):
   - কথার টোনে একদম রোবট হবে না। আন্তরিক ও মিষ্টি করে কথা বলবে।
   - যেমন:
     * সাইজ নিয়ে ভাবলে: "আরেহ কোনো চিন্তাই করবেন না! একদম মানানসই সাইজ বেছে দেওয়ার দায়িত্ব আমাদের। শুধু আপনার উচ্চতাটা জানিয়ে দিন 😊"
     * কাপড় নিয়ে জানতে চাইলে: "একদম নিশ্চিন্ত থাকতে পারেন! ১০০% পিওর দুবাই চেরি ফেব্রিক, ছবির চেয়েও বাস্তবে অনেক বেশি গর্জিয়াস লাগবে।"

ABOUT DAWAH FASHION:
- Brand Name: Dawah Fashion (দাওয়াহ ফ্যাশন)
- Motto: Dress with Purpose | Modest Style | Premium Quality
- Specialty: Exclusive 3-Piece Karchupi Koti Abayas (ইনার + কারচুপি কাজের কোটি + ম্যাচিং হিজাব), Dubai Cherry & Korean Cherry Modest Wear.
- Location: Dhaka, Bangladesh (Mirpur). Cash on Delivery (COD) available all over Bangladesh.

CURRENT LIVE PRODUCTS & PRICING:
${cachedProductsText}

ESSENTIAL SHOP GUIDELINES:
1. Product Models & Model Codes (DF-101, DF-102, DF-103, DF-104, DF-105, DF-106):
   - কাস্টমার নির্দিষ্ট কোড বললে সেই মডেলের নাম, মূল্য, ফেব্রিক ও হিজাব অফার স্পষ্ট করে জানাবে।

2. Height to Length / Size Guide (উচ্চতা অনুযায়ী সাইজ):
   - ৫'০" থেকে ৫'১" ➔ সাইজ ৫০ বা ৫২
   - ৫'২" থেকে ৫'৩" ➔ সাইজ ৫২ বা ৫৪
   - ৫'৪" থেকে ৫'৫" ➔ সাইজ ৫৪ বা ৫৬
   - ৫'৬" এবং তদূর্ধ্ব ➔ সাইজ ৫৬
   - বডি সাইজ: ৩৬, ৩৮, ৪০, ৪২, ৪৪, ৪৬ (অথবা ফ্রি সাইজ)।

3. Pricing & Advance Delivery Policy (অগ্রিম ডেলিভারি চার্জ পলিসি):
   - ঢাকার ভেতরে ডেলিভারি চার্জ: ৳${storeSettings.inside_dhaka_fee} টাকা।
   - ঢাকার বাইরে ডেলিভারি চার্জ: ৳${storeSettings.outside_dhaka_fee} টাকা।
   - অর্ডার কনফার্ম করতে ডেলিভারি চার্জটি (${storeSettings.inside_dhaka_fee}/${storeSettings.outside_dhaka_fee} টাকা) আমাদের বিকাশ বা নগদে (${storeSettings.bkash_number}) অগ্রিম প্রদান করতে হয়।
   - বাকি ড্রেসের পুরো মূল্য ক্যাশ অন ডেলিভারিতে (COD) পার্সেল হাতে পেয়ে প্রদান করবেন।

4. PRODUCT PHOTOS & MULTI-PICTURE RULES (ছবি পাঠানোর সঠিক ট্যাগ):
   ব্যাকএন্ড স্বয়ংক্রিয়ভাবে কাস্টমারের হোয়াটসঅ্যাপে ছবি ডেলিভার করবে ট্যাগের মাধ্যমে:
   - কাস্টমার যখন একটি নির্দিষ্ট মডেলের ছবি দেখতে চায় (যেমন: "DF-101 এর ছবি দেন", "রানি আবায়া দেখব", "পিক দাও"):
     উত্তরের শেষে ট্যাগ লিখবে: [SEND_IMAGE:DF-101]
   - কাস্টমার যখন হিজাবের ছবি দেখতে চায় (যেমন: "হিজাবের ছবি দেন", "হিজাব কেমন", "হিজাব সহ ছবি দেখান"):
     উত্তরের শেষে ট্যাগ লিখবে: [SEND_HIJAB_IMAGE:DF-101]
   - কাস্টমার যখন কাজের ক্লোজ-আপ / হাতার কাজ / ফেব্রিকের নিখুঁত ছবি দেখতে চায় (যেমন: "কাজের ছবি দেন", "হাতার কাজ দেখান", "কারচুপির ক্লোজআপ দিন"):
     উত্তরের শেষে ট্যাগ লিখবে: [SEND_DETAIL_IMAGE:DF-101]
   - কাস্টমার যখন একাধিক বা সব ছবি দেখতে চায় (যেমন: "সব ছবি দেন", "একাধিক পিক দেন", "আর কি কি ছবি আছে", "ডিটেইল পিক দেন", "পিকগুলো দাও", "সবগুলো পিকচার দেখান"):
     উত্তরের শেষে ট্যাগ লিখবে: [SEND_ALL_IMAGES:DF-101] (এটি দিলে স্বয়ংক্রিয়ভাবে মেইন ছবি + হিজাবের ছবি + কাজের ডিটেইল ছবি একসাথেই যাবে)।
   - কাস্টমার স্পেসিফিক কোনো কোড না বলে সাধারণভাবে বলে "ছবি দেখান" বা "পিক দিন":
     আমাদের টপ মডেলের ছবি ট্যাগ যোগ করবে: [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-102]।

Keep replies concise, polite, natural, and never use "আপু" or "ভাইয়া".
`;
}

// Smart Dynamic Fallback Generator when LLM is unavailable
function generateSmartFallback(userText, isFirstMessage) {
  const t = (userText || '').toLowerCase();
  const greeting = isFirstMessage ? 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। ' : 'জি, ';

  // Asking for models or collection
  if (t.includes('model') || t.includes('মডেল') || t.includes('কি কি') || t.includes('design') || t.includes('ডিজাইন') || t.includes('কালেকশন') || t.includes('দেখান')) {
    return `${greeting}আমাদের কালেকশনে বর্তমানে সেরা মডেলগুলো রয়েছে:
• DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (৳২,৪৫০)
• DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (৳২,২০০)
• DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
• DF-104: সিম্পল এ-লাইন বোরকা (৳১,৬৫০)
• DF-105: বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
সবগুলোর সাথেই ম্যাচিং হিজাব ফ্রি! আপনি কোন মডেলটির ছবি বা বিস্তারিত দেখতে চাচ্ছেন?`;
  }

  // Asking for all pictures or multiple photos
  if (t.includes('সব ছবি') || t.includes('একাধিক') || t.includes('সব পিক') || t.includes('ডিটেইল') || t.includes('detail') || t.includes('all pic')) {
    const codeMatch = t.match(/df-?(\d{3})/i);
    const code = codeMatch ? `DF-${codeMatch[1]}` : 'DF-101';
    return `${greeting}অবশ্যই! ${code} এর মেইন লুক, ম্যাচিং হিজাব ও নিখুঁত কাজের সব ছবি নিচে পাঠিয়ে দিচ্ছি 😊 [SEND_ALL_IMAGES:${code}]`;
  }

  // Asking for hijab photo
  if (t.includes('hijab') || t.includes('হিজাব')) {
    const codeMatch = t.match(/df-?(\d{3})/i);
    const code = codeMatch ? `DF-${codeMatch[1]}` : 'DF-101';
    return `${greeting}আমাদের প্রতিটি আবায়ার সাথেই ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি! নিচে হিজাবের ছবি পাঠিয়ে দেওয়া হলো: [SEND_HIJAB_IMAGE:${code}]`;
  }

  // Asking for general photo / picture
  if (t.includes('ছবি') || t.includes('pic') || t.includes('photo') || t.includes('পিক')) {
    const codeMatch = t.match(/df-?(\d{3})/i);
    const code = codeMatch ? `DF-${codeMatch[1]}` : 'DF-101';
    return `${greeting}অবশ্যই! আপনার জন্য ${code} এর রিয়েল ছবি পাঠিয়ে দিচ্ছি: [SEND_IMAGE:${code}]`;
  }

  // Asking for price
  if (t.includes('dam') || t.includes('দাম') || t.includes('price') || t.includes('টাকা') || t.includes('rate') || t.includes('cost')) {
    const codeMatch = t.match(/df-?(\d{3})/i);
    if (codeMatch) {
      const code = `DF-${codeMatch[1]}`;
      const prod = getProductByCode(code);
      if (prod) {
        return `${greeting}${prod.name} (${prod.model_code}) এর মূল্য ৳${prod.price} টাকা (ম্যাচিং হিজাব একদম ফ্রি)। ঢাকার ভিতরে ডেলিভারি ৳${storeSettings.inside_dhaka_fee}, বাইরে ৳${storeSettings.outside_dhaka_fee}।`;
      }
    }
    return `${greeting}আমাদের প্রিমিয়াম আবায়াগুলোর মূল্য ৳১,৬৫০ থেকে ৳২,৪৫০ টাকার মধ্যে (প্রতিটির সাথেই ম্যাচিং হিজাব ফ্রি)। আপনি কোন নির্দিষ্ট মডেলের দাম জানতে চাচ্ছেন জানালে বলে দিচ্ছি।`;
  }

  // Asking for size
  if (t.includes('size') || t.includes('সাইজ') || t.includes('ঝুল') || t.includes('হাইট') || t.includes('height')) {
    return `${greeting}আমাদের সব আবায়া ঝুল ৫০, ৫২, ৫৪, ৫৬ এবং বডি ৩৬-৪৬ সাইজে পেয়ে যাবেন। আপনার উচ্চতা (হাইট) কত ফিট-ইঞ্চি জানালে পারফেক্ট সাইজটি বলে দিচ্ছি।`;
  }

  // Asking for delivery or bkash
  if (t.includes('delivery') || t.includes('ডেলিভারি') || t.includes('bkash') || t.includes('বিকাশ') || t.includes('advance') || t.includes('অগ্রিম')) {
    return `${greeting}ঢাকার ভিতরে ডেলিভারি চার্জ ৳${storeSettings.inside_dhaka_fee} টাকা, ঢাকার বাইরে ৳${storeSettings.outside_dhaka_fee} টাকা। অর্ডার কনফার্ম করতে শুধু ডেলিভারি চার্জটি বিকাশ/নগদে (${storeSettings.bkash_number}) অগ্রিম পাঠাতে হয়, বাকি টাকা ক্যাশ অন ডেলিভারিতে দিবেন।`;
  }

  // Default pleasant guidance
  if (isFirstMessage) {
    return 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। আমাদের এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট, দুবাই চেরি রানি আবায়া ও কাফতান কালেকশন রয়েছে (সবগুলোর সাথেই ম্যাচিং হিজাব একদম ফ্রি)। আপনি কোন মডেলের ছবি বা বিস্তারিত দেখতে চাচ্ছেন?';
  }
  return 'জি, আপনি কোন মডেলের ছবি, সাইজ বা বিস্তারিত দেখতে চাচ্ছেন জানালে এখনই শেয়ার করছি।';
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

  // Candidates validated for this Groq instance
  const candidateModels = [
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b'
  ];

  for (const model of candidateModels) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: model,
        messages: chatMessages,
        temperature: 0.7,
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

  // If both models fail, use dynamic smart fallback
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
      const advancePaid = parsed.advance_paid !== undefined && parsed.advance_paid !== null ? parsed.advance_paid : (parsed.trx_id_or_last4 ? deliveryFee : 0);
      const prodPrice = parsed.total_bdt || 2200;
      const dueCod = parsed.due_cod || prodPrice;

      const { data: existingOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_phone', targetPhone)
        .eq('status', 'Pending')
        .order('id', { ascending: false })
        .limit(1);

      if (existingOrders && existingOrders.length > 0) {
        const existing = existingOrders[0];
        await supabase.from('orders').update({
          model_code: parsed.model_code || existing.model_code,
          customer_name: parsed.customer_name || existing.customer_name,
          address: parsed.address || existing.address,
          product_details: parsed.product_name ? `${parsed.product_name} (Size: ${parsed.length_size || 'Standard'})` : existing.product_details,
          length_size: parsed.length_size || existing.length_size,
          total_bdt: parsed.total_bdt || existing.total_bdt || prodPrice,
          delivery_fee: deliveryFee || existing.delivery_fee,
          advance_paid: advancePaid || existing.advance_paid,
          due_cod: dueCod || existing.due_cod,
          payment_method: parsed.trx_id_or_last4 ? 'COD (Advance Delivery Paid)' : (parsed.payment_method || existing.payment_method || 'COD (Pending Advance)'),
          trx_id_or_last4: parsed.trx_id_or_last4 || existing.trx_id_or_last4
        }).eq('id', existing.id);
        console.log(`[Order Sync] Updated existing Pending Order #${existing.id} for ${targetPhone}`);
      } else {
        await supabase.from('orders').insert({
          customer_phone: targetPhone,
          model_code: parsed.model_code || null,
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

  // Double-shield: if NOT first message, strip any accidental Salam
  if (!isFirstMessageForContact) {
    aiReply = aiReply.replace(/^(আসসালামু\s*আলাইকুম[^\n।!?]*[।!?\n]*|ওয়া\s*আলাইকুম\s*আসসালাম[^\n।!?]*[।!?\n]*|সালাম[^\n।!?]*[।!?\n]*)/gi, '').trim();
    if (!aiReply) {
      aiReply = 'জি, বলুন কীভাবে সাহায্য করতে পারি?';
    }
  }

  history.push({ role: 'assistant', content: aiReply });

  // Asynchronously extract and sync order without blocking reply
  extractAndSaveOrderLead(cleanPhone, userText, history).catch(e => {
    console.warn('[Async Lead Sync]', e.message);
  });

  return aiReply;
}

async function transcribeAudioVoiceNote(audioBuffer) {
  if (!groqClient || !audioBuffer || audioBuffer.length === 0) return null;

  try {
    const file = await toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' });
    
    // Primary: whisper-large-v3-turbo (ultrafast, <0.4s)
    const transcription = await Promise.race([
      groqClient.audio.transcriptions.create({
        file: file,
        model: 'whisper-large-v3-turbo',
        temperature: 0.0,
        response_format: 'json'
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Whisper timeout after 8s')), 8000))
    ]);

    if (transcription && transcription.text && transcription.text.trim()) {
      return transcription.text.trim();
    }
  } catch (err) {
    console.warn('[Groq Whisper Turbo Notice]:', err.message);
    try {
      const file2 = await toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' });
      const fallbackTrans = await groqClient.audio.transcriptions.create({
        file: file2,
        model: 'whisper-large-v3',
        temperature: 0.0,
        response_format: 'json'
      });
      if (fallbackTrans && fallbackTrans.text && fallbackTrans.text.trim()) {
        return fallbackTrans.text.trim();
      }
    } catch (e2) {
      console.error('[Groq Whisper Fallback Error]:', e2.message);
    }
  }
  return null;
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
