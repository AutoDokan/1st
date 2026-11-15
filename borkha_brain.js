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

// Intent and Model Matchers
function detectModelFromText(text) {
  const t = (text || '').toLowerCase();
  if (/df-?101|\b101\b|কারচুপি|karchupi|কোটি|koti/i.test(t)) return 'DF-101';
  if (/df-?102|\b102\b|রানি|rani/i.test(t)) return 'DF-102';
  if (/df-?103|\b103\b|কাফতান|kaftan|কোরিয়ান|korian|korean|ceri/i.test(t)) return 'DF-103';
  if (/df-?104|\b104\b|এ-লাইন|a-line|aline|ক্যাজুয়াল/i.test(t)) return 'DF-104';
  if (/df-?105|\b105\b|বাটারফ্লাই|butterfly/i.test(t)) return 'DF-105';
  if (/df-?106|\b106\b|ডাবল লেয়ার|double layer/i.test(t)) return 'DF-106';
  return null;
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
You are the official smart sales assistant for "Dawah Fashion" (দাওয়াহ ফ্যাশন) - an exclusive modest clothing & premium Abaya brand in Bangladesh ("Dress with Purpose").

CRITICAL COMMUNICATION RULES (MUST FOLLOW STRICTLY):
1. NO GENDER ASSUMPTIONS - NEVER SAY "আপু", "ভাইয়া", OR "আপু/ভাইয়া":
   - কখনোই কাস্টমারকে "আপু" বা "ভাইয়া" বলবে না।
   - সব সময় প্রমিত, মার্জিত ও সম্মানসূচক "আপনি", "আপনার", "জি", "অবশ্যই" ব্যবহার করবে।

${salamRule}

3. ABSOLUTELY NO DASHES OR BULLETS (ড্যাশ বা হাইফেন বা বুলেট সম্পূর্ণ নিষিদ্ধ):
   - উত্তরের মধ্যে কখনোই ড্যাশ, এনাম-ড্যাশ, হাইফেন বা বুলেট (যেমন: '-', '--', '–', '—', '•') ব্যবহার করবে না!
   - কোনো তালিকা লেখার প্রয়োজন হলে খাঁটি বাংলা সংখ্যা ১., ২., ৩. ইত্যাদি দিয়ে লিখবে, কোনো হাইফেন বা ড্যাশ দেবে না।
   - যেমন:
     ১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট (মূল্য ৳২,৪৫০)
     ২. DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (মূল্য ৳২,২০০)

4. IMMEDIATE SPECIFIC PHOTO SENDING (ছবি চাইলে সাথে সাথে ট্যাগ দিতে হবে):
   - কাস্টমার যখনই কোনো মডেল দেখতে চাইবে (যেমন: "DF 101 dekhaw", "Korian ceri ta dekhaw", "কাফতান দেখাও", "রানি আবায়া দেখতে চাই"):
     * শুধু "এখনই দেখাচ্ছি" লিখে বসে থাকবে না! অবশ্যই অবশ্যই উত্তরের শেষে সেই মডেলের ফটো ট্যাগ [SEND_IMAGE:DF-XXX] লিখবে!
     * উদাহরণ: "DF-101 ৩-পিস কারচুপি কোটি আবায়া সেটের ছবি পাঠিয়ে দিচ্ছি [SEND_IMAGE:DF-101]"
     * যদি কাস্টমার বলে "সব ছবি দেন" বা "ডিটেইল পিক দেন" -> ট্যাগ লিখবে: [SEND_ALL_IMAGES:DF-101]
     * যদি কাস্টমার বলে "হিজাবের ছবি দেন" -> ট্যাগ লিখবে: [SEND_HIJAB_IMAGE:DF-101]
     * যদি কাস্টমার বলে "কাজের ছবি দেন" -> ট্যাগ লিখবে: [SEND_DETAIL_IMAGE:DF-101]

5. CONCISE & DIRECT ANSWERS (টু দ্য পয়েন্ট ও প্রাসঙ্গিক উত্তর):
   - কাস্টমার যদি বলে "টোটাল কয়টা মডেল আছে" বা "কোন কোন মডেল আছে":
     সরাসরি আমাদের মডেলগুলোর তালিকা দিয়ে বলবে:
     "আমাদের বর্তমানে এই ৫টি সেরা মডেল রয়েছে:
     ১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট (৳২,৪৫০)
     ২. DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (৳২,২০০)
     ৩. DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
     ৪. DF-104: সিম্পল এ-লাইন ক্যাজুয়াল বোরকা (৳১,৬৫০)
     ৫. DF-105: এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
     সবগুলোর সাথেই ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি! আপনি কোন মডেলটির ছবি ও বিস্তারিত দেখতে চাচ্ছেন?"
   - কাস্টমার অপ্রাসঙ্গিক কথা বললে কোনো অবস্থাতেই মা/ওয়াইফের কথা নিজে থেকে টেনে আনবে না।

6. LOCAL BANGLADESH VIBE (আন্তরিক ও মিষ্টি বাংলা):
   - একদম রোবট হবে না। স্বাভাবিক দেশি শপকিপারের মতো আন্তরিকভাবে কথা বলবে।

ABOUT DAWAH FASHION:
- Brand Name: Dawah Fashion (দাওয়াহ ফ্যাশন)
- Motto: Dress with Purpose | Modest Style | Premium Quality
- Specialty: Exclusive 3-Piece Karchupi Koti Abayas, Dubai Cherry & Korean Cherry Modest Wear.
- Location: Dhaka, Bangladesh (Mirpur). Cash on Delivery (COD) available all over Bangladesh.

CURRENT LIVE PRODUCTS & PRICING:
${cachedProductsText}

ESSENTIAL SHOP GUIDELINES:
1. Product Models & Model Codes:
   DF-101: ৩-পিস কারচুপি কোটি আবায়া সেট (৳২,৪৫০)
   DF-102: দুবাই চেরি রানি আবায়া (৳২,২০০)
   DF-103: কোরিয়ান চেরি কাফতান বোরকা (৳১,৯৫০)
   DF-104: এ-লাইন ক্যাজুয়াল ডেইলি ওয়্যার (৳১,৬৫০)
   DF-105: বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
   DF-106: ডাবল লেয়ার কোটি স্টাইল আবায়া (৳২,১০০)

2. Height to Length / Size Guide:
   ৫'০" থেকে ৫'১" ➔ সাইজ ৫০ বা ৫২
   ৫'২" থেকে ৫'৩" ➔ সাইজ ৫২ বা ৫৪
   ৫'৪" থেকে ৫'৫" ➔ সাইজ ৫৪ বা ৫৬
   ৫'৬" এবং তদূর্ধ্ব ➔ সাইজ ৫৬
   বডি সাইজ: ৩৬, ৩৮, ৪০, ৪২, ৪৪, ৪৬ (অথবা ফ্রি সাইজ)।

3. STRICT PRICING & ZERO-ADVANCE COD POLICY (ভুল হিসাব বা জামার টাকা অগ্রিম চাওয়া সম্পূর্ণ নিষিদ্ধ):
   - জামার জন্য ১ টাকাও অগ্রিম নেওয়া হয় না! জামার সম্পূর্ণ দাম পণ্য হাতে পেয়ে ক্যাশ অন ডেলিভারিতে দিতে হয়।
   - অগ্রিম শুধুমাত্র এবং শুধুমাত্র ডেলিভারি চার্জ:
     * ঢাকার ভেতরে ডেলিভারি চার্জ: ঠিক ৳${storeSettings.inside_dhaka_fee} টাকা (৮০ টাকা)।
     * ঢাকার বাইরে ডেলিভারি চার্জ: ঠিক ৳${storeSettings.outside_dhaka_fee} টাকা (১৫০ টাকা)।
     * বিকাশ ও নগদ পার্সোনাল নাম্বার: ${storeSettings.bkash_number}
   - সম্পূর্ণ নিষিদ্ধ (CRITICAL ERROR): কখনোই কাস্টমারের কাছে ১,০০০ টাকা বা ৫০% বা জামার কোনো দাম অগ্রিম চাইবে না! অগ্রিম শুধুমাত্র ৮০ টাকা অথবা ১৫০ টাকা!
   - ডেলিভারির সময় বকেয়া (Due COD): কাস্টমার পার্সেল হাতে পেয়ে ডেলিভারি ম্যানকে ঠিক জামার আসল দাম পরিশোধ করবেন।
   
   হিসাবের সুস্পষ্ট নিয়ম (STRICT CALCULATION MATRIX):
   ১. DF-101 (মূল্য ৳২,৪৫০):
      * ঢাকার ভেতরে: অগ্রিম ডেলিভারি চার্জ ৮০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,৪৫০ টাকা (সর্বমোট খরচ: ৳২,৫৩০ টাকা)।
      * ঢাকার বাইরে: অগ্রিম ডেলিভারি চার্জ ১৫০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,৪৫০ টাকা (সর্বমোট খরচ: ৳২,৬০০ টাকা)।
   ২. DF-102 (মূল্য ৳২,২০০):
      * ঢাকার ভেতরে: অগ্রিম ডেলিভারি চার্জ ৮০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,২০০ টাকা (সর্বমোট খরচ: ৳২,২৮০ টাকা)।
      * ঢাকার বাইরে: অগ্রিম ডেলিভারি চার্জ ১৫০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,২০০ টাকা (সর্বমোট খরচ: ৳২,৩৫০ টাকা)।
   ৩. DF-103 (মূল্য ৳১,৯৫০):
      * ঢাকার ভেতরে: অগ্রিম ডেলিভারি চার্জ ৮০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳১,৯৫০ টাকা (সর্বমোট খরচ: ৳২,০৩০ টাকা)।
      * ঢাকার বাইরে: অগ্রিম ডেলিভারি চার্জ ১৫০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳১,৯৫০ টাকা (সর্বমোট খরচ: ৳২,১০০ টাকা)।
   ৪. DF-104 (মূল্য ৳১,৬৫০):
      * ঢাকার ভেতরে: অগ্রিম ডেলিভারি চার্জ ৮০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳১,৬৫০ টাকা (সর্বমোট খরচ: ৳১,৭৩০ টাকা)।
      * ঢাকার বাইরে: অগ্রিম ডেলিভারি চার্জ ১৫০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳১,৬৫০ টাকা (সর্বমোট খরচ: ৳১,৮০০ টাকা)।
   ৫. DF-105 (মূল্য ৳২,৩০০):
      * ঢাকার ভেতরে: অগ্রিম ডেলিভারি চার্জ ৮০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,৩০০ টাকা (সর্বমোট খরচ: ৳২,৩৮০ টাকা)।
      * ঢাকার বাইরে: অগ্রিম ডেলিভারি চার্জ ১৫০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,৩০০ টাকা (সর্বমোট খরচ: ৳২,৪৫০ টাকা)।
   ৬. DF-106 (মূল্য ৳২,১০০):
      * ঢাকার ভেতরে: অগ্রিম ডেলিভারি চার্জ ৮০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,১০০ টাকা (সর্বমোট খরচ: ৳২,১৮০ টাকা)।
      * ঢাকার বাইরে: অগ্রিম ডেলিভারি চার্জ ১৫০ টাকা, ডেলিভারির সময় বকেয়া ঠিক ৳২,১০০ টাকা (সর্বমোট খরচ: ৳২,২৫০ টাকা)।

4. PAYMENT & BKASH INSTRUCTIONS (পেমেন্ট বা বিকাশ চাইলে করণীয়):
   - কাস্টমার যখন পে করতে চাইবে বা বিকাশ নাম্বার চাইবে:
     স্পষ্টভাবে বলবে:
     "অর্ডারটি কনফার্ম করতে শুধুমাত্র ডেলিভারি চার্জটি (${storeSettings.inside_dhaka_fee} টাকা ঢাকার ভেতরে / ${storeSettings.outside_dhaka_fee} টাকা ঢাকার বাইরে) আমাদের বিকাশ বা নগদ পার্সোনাল নাম্বারে (${storeSettings.bkash_number}) সেন্ড মানি করে লাস্ট ৪ ডিজিট অথবা একটি স্ক্রিনশট পাঠিয়ে দিবেন। জামার সম্পূর্ণ টাকা ডেলিভারি ম্যানের কাছে পণ্য পেয়ে পরিশোধ করবেন।"

Keep replies concise, friendly, NO dashes/bullets, and never use "আপু" or "ভাইয়া".
`;
}

// Smart Dynamic Fallback Generator when LLM is unavailable
function generateSmartFallback(userText, isFirstMessage) {
  const t = (userText || '').toLowerCase();
  const greeting = isFirstMessage ? 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। ' : 'জি, ';

  // Asking for models or collection
  if (t.includes('model') || t.includes('মডেল') || t.includes('কি কি') || t.includes('design') || t.includes('ডিজাইন') || t.includes('কালেকশন') || t.includes('total') || t.includes('কয়টা') || t.includes('কয়টা')) {
    return `${greeting}আমাদের কালেকশনে বর্তমানে সেরা এই মডেলগুলো রয়েছে:
১. DF-101: ৩-পিস এক্সক্লুসিভ কারচুপি কোটি সেট (৳২,৪৫০)
২. DF-102: প্রিমিয়াম দুবাই চেরি রানি আবায়া (৳২,২০০)
৩. DF-103: কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
৪. DF-104: সিম্পল এ-লাইন ক্যাজুয়াল বোরকা (৳১,৬৫০)
৫. DF-105: বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
সবগুলোর সাথেই ম্যাচিং হিজাব একদম ফ্রি! আপনি কোন মডেলটির ছবি দেখতে চাচ্ছেন?`;
  }

  // Asking for all pictures or multiple photos
  if (isAskingForAllImages(t) && isAskingForImage(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}অবশ্যই! ${code} মডেলের মেইন লুক, ম্যাচিং হিজাব ও নিখুঁত কাজের সব ছবি পাঠিয়ে দেওয়া হলো [SEND_ALL_IMAGES:${code}]`;
  }

  // Asking for hijab photo
  if (isAskingForHijab(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}আমাদের প্রতিটি আবায়ার সাথেই ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি! ${code} এর হিজাবের ছবি নিচে দেওয়া হলো [SEND_HIJAB_IMAGE:${code}]`;
  }

  // Asking for detail photo
  if (isAskingForDetail(t)) {
    const code = detectModelFromText(t) || 'DF-101';
    return `${greeting}নিশ্চয়ই! ${code} এর নিখুঁত কারচুপি কাজ ও ফেব্রিকের ক্লোজ-আপ ছবি নিচে দেওয়া হলো [SEND_DETAIL_IMAGE:${code}]`;
  }

  // Asking for general photo / picture of a model
  if (isAskingForImage(t)) {
    const code = detectModelFromText(t);
    if (code) {
      return `${greeting}${code} মডেলের রিয়েল ছবি পাঠিয়ে দেওয়া হলো [SEND_IMAGE:${code}]`;
    }
    return `${greeting}আমাদের সেরা ২টি মডেল—৩-পিস কারচুপি কোটি সেট ও দুবাই চেরি রানি আবায়ার ছবি পাঠিয়ে দিচ্ছি [SEND_ALL_IMAGES:DF-101] [SEND_IMAGE:DF-102]`;
  }

  // Asking for payment / bKash / Nagad
  if (t.includes('pay') || t.includes('বিকাশ') || t.includes('bkash') || t.includes('nagad') || t.includes('নগদ') || t.includes('advance') || t.includes('অগ্রিম') || t.includes('টাকা পাঠাব')) {
    return `${greeting}অর্ডার কনফার্ম করতে শুধুমাত্র ডেলিভারি চার্জ (ঢাকার ভেতরে ৳${storeSettings.inside_dhaka_fee}, ঢাকার বাইরে ৳${storeSettings.outside_dhaka_fee}) আমাদের বিকাশ বা নগদ পার্সোনাল নাম্বারে (${storeSettings.bkash_number}) সেন্ড মানি করে লাস্ট ৪ ডিজিট অথবা একটি স্ক্রিনশট দিলেই হবে। জামার কোনো টাকা অগ্রিম নয়, পুরো টাকাই ডেলিভারির সময় ক্যাশ অন ডেলিভারিতে দিবেন।`;
  }

  // Asking for price
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

  // 3. Deterministic Photo Guarantee Shield:
  // If customer is asking to see a model or asking for pics, ensure image tag is 100% attached!
  const hasImageTag = /\[SEND_(IMAGE|ALL_IMAGES|HIJAB_IMAGE|DETAIL_IMAGE):[A-Za-z0-9_-]+\]/i.test(aiReply);
  if (!hasImageTag) {
    const detectedModel = detectModelFromText(userText) || detectModelFromText(aiReply);
    const wantsImage = isAskingForImage(userText) || /দেখাচ্ছি|পাঠিয়ে দিচ্ছি|ছবি নিচে|পিকচার|দেখুন/i.test(aiReply);
    
    if (detectedModel && wantsImage) {
      if (isAskingForHijab(userText)) {
        aiReply += ` [SEND_HIJAB_IMAGE:${detectedModel}]`;
      } else if (isAskingForDetail(userText)) {
        aiReply += ` [SEND_DETAIL_IMAGE:${detectedModel}]`;
      } else if (isAskingForAllImages(userText)) {
        aiReply += ` [SEND_ALL_IMAGES:${detectedModel}]`;
      } else {
        aiReply += ` [SEND_IMAGE:${detectedModel}]`;
      }
    } else if (isAskingForImage(userText) && !detectedModel) {
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
