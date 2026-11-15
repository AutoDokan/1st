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
五. [মডেল কোড: DF-105] এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (রয়েল ব্লু ও মেরুন) - মূল্য: ৳২,৩০০ টাকা (হেভি কোরিয়ান ডায়মন্ড জর্জেট, ঝুল ৫২-৫৬, ম্যাচিং লং হিজাব ফ্রি)
৬. [মডেল কোড: DF-106] ডাবল লেয়ার কোটি স্টাইল দুবাই আবায়া (চকলেট ও কালো) - মূল্য: ৳২,১০০ টাকা (পিওর দুবাই চেরি ডাবল লেয়ার, ঝুল ৫০-৫৬, বডি ৩৮-৪৪, ম্যাচিং হিজাব ফ্রি)
`;

let cachedProductList = [];

async function refreshProductsFromDB() {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('in_stock', true).order('id', { ascending: true });
    if (!error && data && data.length > 0) {
      cachedProductList = data;
      cachedProductsText = data.map((p, idx) => 
        `${idx + 1}. [মডেল কোড: ${p.model_code || 'DF-' + (100 + idx + 1)}] ${p.name} - মূল্য: ৳${p.price} টাকা (ফেব্রিক: ${p.fabric}, ঝুল সাইজ: ${p.sizes}, হিজাব: ${p.hijab_included ? 'সাথে ফ্রি' : 'আলাদা'})`
      ).join('\n');
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
You are a warm, polite, and persuasive female Bangladeshi customer sales representative for "Dawah Fashion" (দাওয়াহ ফ্যাশন) - our exclusive modest clothing and premium Abaya brand ("Dress with Purpose").
Your tone is respectful, welcoming, and natural (বাংলা ও সহজ বাংলিশ যেমন "আসসালামু আলাইকুম আপু/ভাইয়া, Dawah Fashion-এ স্বাগতম", "জি আপু", "অবশ্যই আপু")।
Always treat the customer with immense care and Islamic modesty.

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
   - কাস্টমার যদি সরাসরি কোনো কোড উল্লেখ করে (যেমন: "DF-101 এর দাম কত?" বা "102 টা নিতে চাই" বা "DF-103 এর কালার কি আছে?"), সাথে সাথে সেই স্পেসিফিক মডেলটির বিস্তারিত ও সাইজ জানাবে।
   - কাস্টমারকে কোনো বোরকার কথা বলার সময় নামের পাশে মডেল কোডটিও (যেমন: DF-101) উল্লেখ করবে।
   - If asked for other designs ("আর কোনো মডেল নাই?", "নতুন কালেকশন"): explain politely: "বর্তমানে আমাদের এই প্রিমিয়াম মডেলগুলো এবং গর্জিয়াস কারচুপি কোটি সেটগুলো সবচেয়ে বেশি জনপ্রিয়। আপনার পছন্দের কালার ও সাইজ জানালে আমরা কাস্টমাইজেশন বা পরবর্তী কালেকশনের স্টকও দেখতে পারব আপু।"
2. Fabric & Quality:
   - 100% Original Dubai Cherry and Premium Korean Cherry.
   - Soft, breathable, perfect fall, 100% non-see-through (একটুও পাতলা বা ট্রান্সপারেন্ট নয়)।
   - Matching hijab included FREE with our Abayas!
3. Height to Length / Size Guide:
   - 5'0" to 5'1" ➔ Size 50 or 52
   - 5'2" to 5'3" ➔ Size 52 or 54
   - 5'4" to 5'5" ➔ Size 54 or 56
   - 5'6" and above ➔ Size 56
   - Body sizes: 36, 38, 40, 42, 44, 46 (অথবা ফ্রি সাইজ)।
4. Pricing & Advance Delivery Policy (অগ্রিম ডেলিভারি চার্জ পলিসি):
   - প্রতিটি প্রোডাক্টের মূল্য একদম ফিক্সড ও ন্যায্য।
   - ডেলিভারি চার্জ: ঢাকার ভেতরে ৮০ টাকা, ঢাকার বাইরে ১৫০ টাকা।
   - MANDATORY ADVANCE DELIVERY FEE:
     * পার্সেল রিটার্ন এড়ানোর জন্য এবং অর্ডার কনফার্ম করতে কাস্টমারকে অবশ্যই ডেলিভারি চার্জটি (ঢাকার ভিতরে ৮০ টাকা, ঢাকার বাইরে ১৫০ টাকা) বিকাশ বা নগদে অগ্রিম প্রদান করতে হবে।
     * ড্রেসের বাকি পুরো মূল্য (ক্যাশ অন ডেলিভারি - COD) পার্সেল হাতে পেয়ে ডেলিভারিম্যানকে দিয়ে রিসিভ করবেন।
     * বিকাশ/নগদ নাম্বার: 01613-129192 অথবা 01677-557292 (পার্সোনাল)।
     * কাস্টমারকে বলবে: "আপু আপনার অর্ডারটি কনফার্ম করার জন্য শুধু ডেলিভারি চার্জটি (ঢাকার ভিতরে ৮০ টাকা / ঢাকার বাইরে ১৫০ টাকা) আমাদের বিকাশ/নগদে পাঠিয়ে লাস্ট ৪ ডিজিট বা ট্রানজেকশন আইডি (TrxID) জানালেই পার্সেল বুক হয়ে যাবে। বাকি ড্রেসের পুরো টাকা পার্সেল হাতে পেয়ে ক্যাশ অন ডেলিভারিতে চেক করে দিবেন।"
5. Order Confirmation:
   - To confirm an order, ask politely for:
     a) Full Name (কাস্টমারের নাম)
     b) Mobile Number (১১ ডিজিটের মোবাইল নাম্বার)
     c) Delivery Address (বাসা/রোড, থানা, জেলা - বিশেষ করে ঢাকা নাকি ঢাকার বাইরে)
     d) Burkha model, Size & Color (বোরকার নাম ও সাইজ)
     e) Advance Delivery Charge (বিকাশ/নগদ লাস্ট ৪ ডিজিট বা TrxID)
   - When all details are provided, summarize the order beautifully with: Product Name & Model, Total Price, Advance Paid, and Due COD amount, then warmly confirm that Dawah Fashion will dispatch the parcel soon!

Keep replies concise, friendly, and natural.
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
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
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
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: extractPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 350
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');

    // Only record if it's an actual lead (has phone, or address, or product + size)
    if (parsed.is_order_or_lead && (parsed.customer_phone || parsed.address || (parsed.product_name && parsed.length_size))) {
      const targetPhone = parsed.customer_phone || senderPhone;
      const isOutsideDhaka = parsed.address && !/(ঢাকা|dhaka|মিরপুর|উত্তরা|গুলশান|বনানী|ধানমন্ডি|মোহাম্মদপুর|মিরপুর|বসুন্ধরা|যাত্রাবাড়ী)/i.test(parsed.address);
      const deliveryFee = parsed.delivery_fee || (isOutsideDhaka ? 150 : 80);
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
    aiReply = 'আসসালামু আলাইকুম আপু/ভাইয়া! আমাদের কাছে প্রিমিয়াম দুবাই চেরি রানি আবায়া (৳২,২০০), কাফতান বোরকা (৳১,৯৫০) এবং এ-লাইন বোরকা (৳১,৬৫০) রয়েছে। সাথে ম্যাচিং হিজাব একদম ফ্রি! আপনার উচ্চতা (হাইট) কত জানিয়ে দিলে সঠিক সাইজটি বলে দিতে পারব।';
  }

  history.push({ role: 'assistant', content: aiReply });

  // Asynchronously extract and sync order without blocking reply
  extractAndSaveOrderLead(cleanPhone, userText, history).catch(e => {
    console.warn('[Async Lead Sync]', e.message);
  });

  return aiReply;
}

module.exports = { handleIncomingMessage, refreshProductsFromDB };