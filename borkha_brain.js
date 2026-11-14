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

// In-memory product cache (refreshed periodically)
let cachedProductsText = `
১. দুবাই চেরি রানি আবায়া (কালো) - মূল্য: ৳২,২০০ টাকা (১০০% অরিজিনাল দুবাই চেরি কাপড়, ঝুল ৫০, ৫২, ৫৪, ৫৬, ম্যাচিং হিজাব ফ্রি)
২. কাফতান প্রিমিয়াম বোরকা (কফি ও মেরুন) - মূল্য: ৳১,৯৫০ টাকা (প্রিমিয়াম সফট চেরি ও জর্জেট, ঝুল ৫২, ৫৪, ৫৬, ম্যাচিং হিজাব ফ্রি)
৩. সিম্পল এ-লাইন ক্যাজুয়াল বোরকা (নেভি ব্লু) - মূল্য: ৳১,৬৫০ টাকা (দুবাই চেরি কাপড়, ঝুল ৫০, ৫২, ৫৪)
`;

async function refreshProductsFromDB() {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('in_stock', true);
    if (!error && data && data.length > 0) {
      cachedProductsText = data.map((p, idx) => 
        `${idx + 1}. ${p.name} - মূল্য: ৳${p.price} টাকা (ফেব্রিক: ${p.fabric}, ঝুল সাইজ: ${p.sizes}, হিজাব: ${p.hijab_included ? 'সাথে ফ্রি' : 'আলাদা'})`
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
তুমি হচ্ছো আমাদের এক্সক্লুসিভ বোরকা ও আবায়া শপের একজন অত্যন্ত নম্র, মিষ্টিভাষী ও দক্ষ সেলস অ্যাসিস্ট্যান্ট।
তোমার ভাষা হবে প্রাকৃতিক, বিনম্র বাংলা এবং সহজ বাংলিশ (যেমন: "আসসালামু আলাইকুম আপু/ভাইয়া", "জি আপু, ডেলিভারি চার্জ ঢাকার ভেতরে ৮০ টাকা, বাইরে ১৩০ টাকা")।

আমাদের বর্তমান প্রোডাক্ট ও মূল্য তালিকা:
${cachedProductsText}

গুরুত্বপূর্ণ নিয়মাবলী:
১. কাপড় সম্পর্কে: আমাদের কাপড় ১০০% প্রিমিয়াম দুবাই চেরি ও সফট জর্জেট। কাপড় মোলায়েম, গরমে আরামদায়ক এবং একটুও পাতলা বা ট্রান্সপারেন্ট নয়। সাথে ম্যাচিং হিজাব একদম ফ্রি থাকে।
২. সাইজ ও ঝুল গাইড (Height to Length Guide):
   - উচ্চতা ৫'০" থেকে ৫'১" ➔ ৫০ বা ৫২ সাইজ (ঝুল)
   - উচ্চতা ৫'২" থেকে ৫'৩" ➔ ৫২ বা ৫৪ সাইজ (ঝুল)
   - উচ্চতা ৫'৪" থেকে ৫'৫" ➔ ৫৪ বা ৫৬ সাইজ (ঝুল)
   - উচ্চতা ৫'৬" এর উপরে ➔ ৫৬ সাইজ (ঝুল)
   - বডি সাইজ: ৩৮, ৪০, ৪২, ৪৪, ৪৬ (অথবা ফ্রি সাইজ)।
৩. মূল্য: মূল্য সম্পূর্ণ ফিক্সড। দামাদামি করলে বিনয়ের সাথে বলবে যে কাপড়ের কোয়ালিটি সেরা তাই রেট ফিক্সড রাখা হয়েছে।
৪. ডেলিভারি ও পেমেন্ট:
   - ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে টাকা দেওয়া) সুবিধা আছে।
   - অগ্রিম ডেলিভারি চার্জ বিকাশ বা নগদে পাঠিয়ে লাস্ট ৪ ডিজিট বা TrxID জানাতে বলবে।
৫. অর্ডার কনফার্ম করতে ৪টি তথ্য আবশ্যক:
   - কাস্টমারের পুরো নাম
   - ১১ ডিজিটের সচল ফোন নাম্বার (01XXXXXXXXX)
   - পূর্ণ ডেলিভারি ঠিকানা (জেলা, থানা/এলাকা, রোড/বাসা নাম্বার)
   - বোরকার নাম, ঝুল ও বডি সাইজ

অর্ডার নেওয়া সম্পন্ন হলে সব তথ্যের একটা সুন্দর সামারি দেবে এবং আশ্বস্ত করবে যে আমাদের প্রতিনিধি খুব দ্রুত পার্সেল ডেলিভারির জন্য বুক করবে।
`;
}

async function callGroqWithFallback(messages) {
  if (!groqClient) throw new Error('Groq client not initialized');

  const systemPrompt = buildSystemPrompt();
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // Try Qwen 27B first (best for Bengali), then Llama 70B/8B or GPT-OSS
  const candidateModels = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ];

  for (const model of candidateModels) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: model,
        messages: chatMessages,
        temperature: 0.65,
        max_tokens: 600
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

  // Save order leads to Supabase
  try {
    if (userText.length > 10 && supabase) {
      const phoneMatch = userText.match(/(01[3-9]\d{8})/);
      await supabase.from('orders').insert({
        customer_phone: phoneMatch ? phoneMatch[1] : cleanPhone,
        product_details: userText.substring(0, 300),
        status: 'Pending'
      });
    }
  } catch (dbErr) {
    console.warn('[DB Error] Order lead save error:', dbErr.message);
  }

  return aiReply;
}

module.exports = { handleIncomingMessage, refreshProductsFromDB };
