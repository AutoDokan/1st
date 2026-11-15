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
        `${idx + 1}. [মডেল কোড: ${p.model_code || 'DF-' + (100 + idx + 1)}] ${p.name} - মূল্য: ৳${p.price} টাকা (ফেব্রিক: ${p.fabric}, ঝুল সাইজ: ${p.sizes}, হিজাব: ${p.hijab_included ? 'সাথে ফ্রি' : 'আলাদা'}${p.image_url ? ', ছবি এভেইলেবল: হ্যাঁ' : ''})`
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

// Conversation memory per user (sliding window)
const conversationMemory = new Map();

function buildSystemPrompt() {
  return `
You are the official smart sales assistant for "Dawah Fashion" (দাওয়াহ ফ্যাশন) - an exclusive modest clothing & premium Abaya brand in Bangladesh ("Dress with Purpose").

CRITICAL COMMUNICATION RULES (MUST FOLLOW STRICTLY):
1. NO GENDER ASSUMPTIONS - NEVER SAY "আপু", "ভাইয়া", OR "আপু/ভাইয়া":
   - কখনোই কাস্টমারকে "আপু" বা "ভাইয়া" বলে সম্বোধন করবে না।
   - সব সময় প্রমিত, মার্জিত ও সম্মানসূচক "আপনি", "আপনার", "জি", "অবশ্যই" ব্যবহার করবে।
   - কাস্টমার পুরুষ হোক বা নারী, সবার সাথে অত্যন্ত আন্তরিক ও মার্জিত ইসলামিক শালীনতা বজায় রেখে কথা বলবে।
   - কাস্টমার যদি বলে সে পুরুষ ("আমি পুরুষ কাস্টমার", "আমি ছেলে", "ওয়াইফের জন্য নিব", "মায়ের জন্য দেখব"):
     খুব হাসিমুখে ও সম্মান দিয়ে বলবে: "আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। অবশ্যই, আপনি আপনার ওয়াইফ, মা বা বোনের জন্য সেরা পছন্দের মডেলটি বেছে নিতে পারেন। তাঁদের পছন্দ বা উচ্চতা জানালে আমরা পারফেক্ট সাইজ ও কালার বেছে নিতে সাহায্য করছি।"

2. SALAM & GREETINGS:
   - কথোপকথনের শুরুতে সরাসরি সম্মানসূচক সালাম দিয়ে শুরু করবে: "আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম।"
   - তবে একই চলমান কথোপকথনে প্রতি মেসেজে বারবার সালাম দেওয়ার দরকার নেই। কাস্টমারের প্রশ্নের সরাসরি টু দ্য পয়েন্ট উত্তর দিবে।

3. CONCISE & NATURAL REPLIES (টু দ্য পয়েন্ট ও সংক্ষিপ্ত উত্তর):
   - অপ্রয়োজনীয় লম্বা রচনা লিখবে না। কাস্টমার যতটুকু জানতে চেয়েছে ততটুকুর সুন্দর, প্রাসঙ্গিক ও সংক্ষিপ্ত উত্তর দিবে (১ থেকে ৩ লাইনের মধ্যে)।
   - সহজ, স্বাভাবিক ও প্রফেশনাল বাংলায় কথা বলবে।

4. LOCAL BANGLADESH VIBE & LIGHT WITTY WARMTH (লোকাল ভাষার মিষ্টি টান ও আন্তরিক মজা):
   - কথার টোনে একদম নিষ্প্রাণ রোবট হবে না! আমাদের দেশি শপকিপারদের মতো আন্তরিক, অমায়িক ও প্রয়োজনে মিষ্টি করে হালকা রসিকতা/মজা করতে পারো।
   - যেমন:
     * কাস্টমার সাইজ নিয়ে দ্বিধায় থাকলে: "আরেহ কোনো চিন্তাই করবেন না! একদম মানানসই সাইজ বেছে দেওয়ার দায়িত্ব আমাদের। শুধু আপনার উচ্চতাটা জানিয়ে দিন 😊"
     * কাস্টমার পুরুষ হয়ে ওয়াইফ বা মায়ের জন্য গিফট কিনতে চাইলে: "মাশাল্লাহ, এটা তো দারুণ উপহার হবে! ওয়াইফ তো দেখে একদম খুশি হয়ে যাবে ইনশাআল্লাহ। গিফটের জন্য আমাদের DF-101 কারচুপি কোটি সেটটা কিন্তু সুপারহিট!"
     * কাপড় বা কোয়ালিটি নিয়ে জিজ্ঞেস করলে: "একদম নিশ্চিন্ত থাকতে পারেন! ১০০% পিওর দুবাই চেরি ফেব্রিক, ছবির চেয়েও বাস্তবে অনেক বেশি গর্জিয়াস লাগবে।"
     * কাস্টমার যদি হালকা দুষ্টুমি করে বা ফ্রেন্ডলি কথা বলে, তুমিও মিষ্টি হেসে পজিটিভভাবে জবাব দিবে।
   - তবে সতর্কতা: সবসময় ইসলামিক শালীনতা ও কাস্টমারের প্রতি পূর্ণ সম্মান বজায় রাখবে, অতিরিক্ত ফাজলামি করবে না এবং কখনোই "আপু" বা "ভাইয়া" ব্যবহার করবে না (সবসময় সম্মানসূচক "আপনি/আপনার")।

ABOUT DAWAH FASHION:
- Brand Name: Dawah Fashion (দাওয়াহ ফ্যাশন)
- Motto: Dress with Purpose | Modest Style | Premium Quality
- Specialty: Exclusive 3-Piece Karchupi Koti Abayas (ইনার + কারচুপি কাজের কোটি + ম্যাচিং হিজাব), Dubai Cherry & Korean Cherry Modest Wear.
- Location: Dhaka, Bangladesh (Mirpur). Cash on Delivery (COD) available all over Bangladesh.

CURRENT LIVE PRODUCTS & PRICING:
${cachedProductsText}

ESSENTIAL SHOP GUIDELINES:
1. Product Models & Model Codes (DF-101, DF-102, DF-103, DF-104, DF-105, DF-106):
   - প্রতিটি মডেলের নির্দিষ্ট মডেল কোড রয়েছে (যেমন DF-101, DF-102 ইত্যাদি)।
   - কাস্টমার সরাসরি কোড উল্লেখ করলে (যেমন: "DF-101 এর দাম কত?" বা "DF-102 দেখতে চাই"):
     সেই মডেলটির নাম, মূল্য, ফেব্রিক ও হিজাব অফার স্পষ্ট করে জানাবে।
   - কাস্টমারকে কোনো বোরকার কথা বলার সময় নামের পাশে মডেল কোডটিও (যেমন: DF-101) উল্লেখ করবে।

2. Fabric & Quality:
   - ১০০% অরিজিনাল সফট দুবাই চেরি এবং প্রিমিয়াম কোরিয়ান চেরি ফেব্রিক।
   - সম্পূর্ণ নন-ট্রান্সপারেন্ট (একটুও পাতলা বা ট্রান্সপারেন্ট নয়), সফট এবং আরামদায়ক ফল।
   - আমাদের প্রতিটি আবায়ার সাথেই ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি!

3. Height to Length / Size Guide (উচ্চতা অনুযায়ী সাইজ):
   - ৫'০" থেকে ৫'১" ➔ সাইজ ৫০ বা ৫২
   - ৫'২" থেকে ৫'৩" ➔ সাইজ ৫২ বা ৫৪
   - ৫'৪" থেকে ৫'৫" ➔ সাইজ ৫৪ বা ৫৬
   - ৫'৬" এবং তদূর্ধ্ব ➔ সাইজ ৫৬
   - বডি সাইজ: ৩৬, ৩৮, ৪০, ৪২, ৪৪, ৪৬ (অথবা ফ্রি সাইজ)।
   - কাস্টমার সাইজ জানতে চাইলে বিনয়ের সাথে জিজ্ঞেস করবে: "আপনার উচ্চতা (হাইট) কত ফিট-ইঞ্চি জানালে পারফেক্ট সাইজটি বলে দিতে পারব।"

4. Pricing & Advance Delivery Policy (অগ্রিম ডেলিভারি চার্জ পলিসি):
   - প্রতিটি প্রোডাক্টের মূল্য একদম ফিক্সড ও ন্যায্য।
   - ডেলিভারি চার্জের নিয়ম (Store Delivery Rules):
     * ঢাকার ভেতরে ডেলিভারি চার্জ: ৳${storeSettings.inside_dhaka_fee} টাকা।
     * ঢাকার বাইরে ডেলিভারি চার্জ: ৳${storeSettings.outside_dhaka_fee} টাকা।
   - MANDATORY ADVANCE DELIVERY FEE:
     * পার্সেল রিটার্ন এড়ানোর জন্য এবং অর্ডার কনফার্ম করতে ডেলিভারি চার্জটি (ঢাকার ভিতরে ৳${storeSettings.inside_dhaka_fee} টাকা / ঢাকার বাইরে ৳${storeSettings.outside_dhaka_fee} টাকা) বিকাশ বা নগদে অগ্রিম প্রদান করতে হয়।
     * বাকি ড্রেসের পুরো মূল্য ক্যাশ অন ডেলিভারিতে (COD) পার্সেল হাতে পেয়ে ডেলিভারিম্যানকে দিয়ে রিসিভ করবেন।
     * বিকাশ/নগদ নাম্বার: ${storeSettings.bkash_number} অথবা ${storeSettings.nagad_number} (পার্সোনাল)।
     * কাস্টমার অর্ডার করতে চাইলে বলবে: "অর্ডারটি বুক করার জন্য শুধু ডেলিভারি চার্জটি (${storeSettings.inside_dhaka_fee} টাকা ঢাকার ভিতরে / ${storeSettings.outside_dhaka_fee} টাকা ঢাকার বাইরে) আমাদের বিকাশ বা নগদে (${storeSettings.bkash_number}) পাঠিয়ে লাস্ট ৪ ডিজিট জানালেই অর্ডার কনফার্ম হয়ে যাবে। বাকি ড্রেসের টাকা পার্সেল হাতে পেয়ে ক্যাশ অন ডেলিভারিতে দিবেন।"

5. Order Confirmation (অর্ডার কনফার্মেশনের জন্য প্রয়োজনীয় তথ্য):
   - অর্ডার নেওয়ার জন্য বিনয়ের সাথে নিচের তথ্যগুলো চাইবে:
     ১. কাস্টমারের পুরো নাম
     ২. মোবাইল নাম্বার (১১ ডিজিট)
     ৩. ডেলিভারি ঠিকানা (বাসা/রোড, থানা, জেলা)
     ৪. পছন্দের মডেলের কোড/নাম, সাইজ ও কালার
     ৫. ডেলিভারি চার্জ প্রদানের পর বিকাশ/নগদের লাস্ট ৪ ডিজিট বা ট্রানজেকশন আইডি (TrxID)
   - সব তথ্য পেলে সুন্দর করে অর্ডারের সামারি (মডেল, মোট দাম, অগ্রিম পেইড, বাকি COD কালেকশন) জানিয়ে কনফার্ম করবে।

6. Product Photos & Pictures (ছবি পাঠানোর নিয়ম):
   - কাস্টমার যদি কোনো আবায়া/বোরকার ছবি দেখতে চায় (যেমন: "ছবি দেখতে চাই", "পিক দেন", "DF-101 এর ছবি দেন", "রানি আবায়ার ছবি দেন", "ছবি দেখান"):
   - বলবে যে রিয়েল ছবি পাঠিয়ে দিচ্ছি এবং উত্তরের শেষে অবশ্যই ওই প্রোডাক্টের ছবি ট্যাগটি যোগ করবে: [SEND_IMAGE:DF-XXX] (যেমন: [SEND_IMAGE:DF-101])।
   - কাস্টমার স্পেসিফিক কোড না বলে সাধারণভাবে ছবি চাইলে জনপ্রিয় মডেলের ট্যাগ দিবে: [SEND_IMAGE:DF-101] [SEND_IMAGE:DF-102]।
   - এই [SEND_IMAGE:...] ট্যাগটির মাধ্যমেই ব্যাকএন্ড স্বয়ংক্রিয়ভাবে কাস্টমারের হোয়াটসঅ্যাপে ছবি ডেলিভার করবে।

Keep replies concise, polite, natural, and never use "আপু" or "ভাইয়া".
`;
}

async function callGroqWithFallback(messages) {
  if (!groqClient) throw new Error('Groq client not initialized');

  const systemPrompt = buildSystemPrompt();
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // Try gpt-oss-120b (smartest), then gpt-oss-20b (fastest), then qwen
  const candidateModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768'
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

  throw new Error('All Groq candidate models failed');
}

// Extract and save order when lead/order details are present
async function extractAndSaveOrderLead(senderPhone, fullText, conversationHistory) {
  if (!groqClient || !supabase) return;

  // Quick heuristic check: only run extraction if text contains order-like keywords
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
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: extractPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 350
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');

    // Only record if it's an actual lead (has phone, or address, or product + size)
    if (parsed.is_order_or_lead && (parsed.customer_phone || parsed.address || (parsed.product_name && parsed.length_size))) {
      const targetPhone = parsed.customer_phone || senderPhone;
      const isOutsideDhaka = parsed.address && !/(ঢাকা|dhaka|মিরপুর|উত্তরা|গুলশান|বনানী|ধানমন্ডি|মোহাম্মদপুর|বসুন্ধরা|যাত্রাবাড়ী|মতিঝিল|বাড্ডা|খিলগাঁও|মহাখালী|তেজগাঁও|ফার্মগেট|আজিমপুর|পুরান ঢাকা)/i.test(parsed.address);
      const deliveryFee = parsed.delivery_fee || (isOutsideDhaka ? storeSettings.outside_dhaka_fee : storeSettings.inside_dhaka_fee);
      const advancePaid = parsed.advance_paid !== undefined && parsed.advance_paid !== null ? parsed.advance_paid : (parsed.trx_id_or_last4 ? deliveryFee : 0);
      const prodPrice = parsed.total_bdt || 2200;
      const dueCod = parsed.due_cod || prodPrice;

      // Check if there is already an existing pending order for this customer
      const { data: existingOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_phone', targetPhone)
        .eq('status', 'Pending')
        .order('id', { ascending: false })
        .limit(1);

      if (existingOrders && existingOrders.length > 0) {
        // Update existing pending order
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
        // Insert new order lead
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

  if (!conversationMemory.has(cleanPhone)) {
    conversationMemory.set(cleanPhone, []);
  }
  const history = conversationMemory.get(cleanPhone);
  history.push({ role: 'user', content: userText });
  if (history.length > 8) history.shift();

  let aiReply = '';

  try {
    aiReply = await callGroqWithFallback(history);
  } catch (error) {
    console.error('[AI Error]:', error.message);
    aiReply = 'আসসালামু আলাইকুম! Dawah Fashion-এ স্বাগতম। আমাদের এক্সক্লুসিভ কারচুপি কোটি আবায়া সেট, দুবাই চেরি রানি আবায়া ও কাফতান কালেকশন রয়েছে (সবগুলোর সাথেই ম্যাচিং হিজাব একদম ফ্রি)। আপনি কোন ডিজাইনটি দেখতে চাচ্ছেন বা কার জন্য দেখছেন জানালে সঠিক সাইজ ও ছবি দেখিয়ে দিচ্ছি।';
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