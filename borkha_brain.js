const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

// Initialize AI clients
const geminiApiKey = process.env.GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

let geminiModel = null;
if (geminiApiKey) {
  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  } catch (err) {
    console.warn('[AI] Gemini init warning:', err.message);
  }
}

let groqClient = null;
if (groqApiKey) {
  try {
    groqClient = new Groq({ apiKey: groqApiKey });
  } catch (err) {
    console.warn('[AI] Groq init warning:', err.message);
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Conversation memory per user (in-memory sliding window)
const conversationMemory = new Map();

const BORKHA_SYSTEM_PROMPT = `
তুমি হচ্ছো আমাদের এক্সক্লুসিভ বোরকা ও আবায়া শপের একজন প্রফেশনাল, নম্র এবং বিশ্বস্ত সেলস অ্যাসিস্ট্যান্ট।
তোমার ভাষা হবে অত্যন্ত মিষ্টি, মার্জিত বাংলা এবং সহজ বাংলিশ (যেমন: "আসসালামু আলাইকুম আপু/ভাইয়া", "জি আপু, ডেলিভারি চার্জ ঢাকার ভেতরে ৮০ টাকা, বাইরে ১৩০ টাকা")।

তোমার ক্যাটালগ ও নিয়মাবলী:
১. কাপড়: আমাদের বোরকাগুলো ১০০% অরিজিনাল দুবাই চেরি (Dubai Cherry) কাপড়ে তৈরি। কাপড় সফট, গরমে আরামদায়ক এবং একটুও পাতলা বা ট্রান্সপারেন্ট নয়। সাথে ম্যাচিং হিজাব থাকে।
২. সাইজ ও ঝুল (Height to Length Guide):
   - উচ্চতা ৫'০" থেকে ৫'১" ➔ ৫০ বা ৫২ সাইজ (ঝুল)
   - উচ্চতা ৫'২" থেকে ৫'৩" ➔ ৫২ বা ৫৪ সাইজ (ঝুল)
   - উচ্চতা ৫'৪" থেকে ৫'৫" ➔ ৫৪ বা ৫৬ সাইজ (ঝুল)
   - উচ্চতা ৫'৬" এর উপরে ➔ ৫৬ সাইজ (ঝুল)
   - বডি সাইজ: ৩৮, ৪০, ৪২, ৪৪, ৪৬ (বা ফ্রি সাইজ)।
৩. মূল্য: ফিক্সড দাম। অতিরিক্ত দামাদামি করলে বিনয়ের সাথে বলবে যে কাপড়ের কোয়ালিটি সেরা তাই রেট ফিক্সড।
৪. ডেলিভারি ও পেমেন্ট:
   - ক্যাশ অন ডেলিভারি (COD) সুবিধা আছে।
   - অগ্রিম ডেলিভারি চার্জ বিকাশ বা নগদে পাঠাতে চাইলে আমাদের পার্সোনাল নাম্বারে পাঠিয়ে লাস্ট ৪ ডিজিট বা TrxID জানাতে বলবে।
৫. অর্ডার কনফার্ম করতে ৪টি তথ্য আবশ্যক:
   - কাস্টমারের পুরো নাম
   - ১১ ডিজিটের একটিভ ফোন নাম্বার (01XXXXXXXXX)
   - ফুল ঠিকানা (জেলা, থানা/উপজেলা, রোড/বাড়ি নাম্বার)
   - বোরকার নাম, ঝুল ও বডি সাইজ

অর্ডার সম্পূর্ণ হলে সব তথ্যের একটা সুন্দর সামারি দেবে এবং বলবে যে অর্ডারটি পেন্ডিং রয়েছে, আমাদের টিম দ্রুত পার্সেল প্রসেস করবে।
`;

async function callGemini(messages) {
  if (!geminiModel) throw new Error('Gemini model not initialized');
  const chat = geminiModel.startChat({
    history: messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
  });
  const lastMsg = messages[messages.length - 1].content;
  const result = await chat.sendMessage(BORKHA_SYSTEM_PROMPT + '\n\n' + lastMsg);
  return result.response.text();
}

async function callGroq(messages) {
  if (!groqClient) throw new Error('Groq client not initialized');
  const chatMessages = [
    { role: 'system', content: BORKHA_SYSTEM_PROMPT },
    ...messages
  ];
  const completion = await groqClient.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: chatMessages,
    temperature: 0.7,
    max_tokens: 500
  });
  return completion.choices[0].message.content;
}

// Order extraction regex helper to detect when customer provides full info
function checkOrderInfo(text, senderNumber) {
  const phoneMatch = text.match(/(01[3-9]\d{8})/);
  const trxMatch = text.match(/([A-Z0-9]{8,12})/i);
  return {
    phone: phoneMatch ? phoneMatch[1] : senderNumber,
    trx: trxMatch ? trxMatch[1] : null
  };
}

async function handleIncomingMessage(senderId, userText) {
  // Clean phone number
  const cleanPhone = senderId.replace(/[^0-9]/g, '');

  // Retrieve or create conversation history (sliding window: max 6 messages)
  if (!conversationMemory.has(cleanPhone)) {
    conversationMemory.set(cleanPhone, []);
  }
  const history = conversationMemory.get(cleanPhone);
  history.push({ role: 'user', content: userText });
  if (history.length > 6) history.shift();

  let aiReply = '';

  // Dual-Engine Execution: Gemini 1st -> Groq Fallback
  try {
    aiReply = await callGemini(history);
  } catch (geminiError) {
    console.warn('[AI Fallback] Gemini failed/rate-limited, switching to Groq:', geminiError.message);
    try {
      aiReply = await callGroq(history);
    } catch (groqError) {
      console.error('[AI Critical] Both Gemini and Groq failed:', groqError.message);
      aiReply = 'আসসালামু আলাইকুম! আমাদের সিস্টেমে সাময়িক রক্ষণাবেক্ষণ চলছে। আপনার মেসেজটি আমরা পেয়েছি, আমাদের প্রতিনিধি খুব দ্রুত আপনার সাথে সরাসরি যোগাযোগ করবেন। ধন্যবাদ!';
    }
  }

  history.push({ role: 'assistant', content: aiReply });

  // If user provides phone number or order confirmation, save to Supabase
  try {
    const extracted = checkOrderInfo(userText, cleanPhone);
    if (userText.length > 15 && supabase) {
      // Save order lead to Supabase
      await supabase.from('orders').insert({
        customer_phone: cleanPhone,
        product_details: userText.substring(0, 300),
        status: 'Pending'
      });
    }
  } catch (dbErr) {
    console.warn('[DB Error] Order lead save error:', dbErr.message);
  }

  return aiReply;
}

module.exports = { handleIncomingMessage };
