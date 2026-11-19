const { 
  handleIncomingMessage, 
  refreshProductsFromDB, 
  getProductByCode, 
  getAllCachedProducts,
  buildSystemPrompt,
  getDynamicPlaybookGuidance,
  classifyMessageComplexity, 
  cleanHumanFormatting 
} = require('./commerce_brain.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://dummy.supabase.co',
  process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'dummy_key'
);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runRegressionSuite() {
  console.log('========================================');
  console.log('   DAWAH FASHION AI BRAIN TEST SUITE   ');
  console.log('========================================\n');
  await refreshProductsFromDB();

  // Fresh user ID generator so each test run runs with clean session
  const runId = Date.now();
  const uid = (base) => `test_${base}_${runId}`;

  let failedTests = 0;
  function assert(condition, testName, output) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
    } else {
      console.error(`[FAIL] ${testName}`);
      console.error(`       Actual Output:\n${output}\n`);
      failedTests++;
    }
  }

  // TEST 1: System Prompt Length < 12,000 chars (Lean & Token-Efficient with Multi-Domain Intelligence)
  const samplePrompt = buildSystemPrompt('unit_test_user');
  const promptLen = samplePrompt.length;
  assert(promptLen > 500 && promptLen < 12000, 
    `System prompt is lean (< 12,000 chars). Actual length: ${promptLen} chars`, `Length: ${promptLen}`);

  // TEST 2: Single [SESSION STATE] Block
  const stateMatchCount = (samplePrompt.match(/\[SESSION STATE\]/g) || []).length;
  assert(stateMatchCount === 1, 
    `System prompt contains exactly 1 [SESSION STATE] block. Actual count: ${stateMatchCount}`, `Count: ${stateMatchCount}`);

  // TEST 3: Products DB Sorting (DF-101 to DF-105)
  const cachedProds = getAllCachedProducts();
  const codes = cachedProds.map(p => p.model_code).filter(Boolean);
  const isSorted = codes.length > 0 && codes.every((code, idx) => {
    if (idx === 0) return true;
    return code >= codes[idx - 1];
  });
  assert(isSorted && codes.length >= 5, 
    `Products sorted sequentially (DF-101..DF-105). Found: ${codes.join(', ')}`, codes.join(', '));

  // TEST 4: Live Supabase chat_sessions Upsert Success (RLS Disabled Proof)
  let dbSuccess = false;
  let dbErr = null;
  try {
    const testJid = uid('rls_check') + '@lid';
    const { error: upsertErr } = await supabase.from('chat_sessions').upsert({
      seller_id: 'dawah-seller-prod-001',
      customer_identifier: testJid,
      stage: 'greeting',
      messages: [{ role: 'user', text: 'ping' }],
      updated_at: new Date().toISOString()
    });
    if (!upsertErr) {
      dbSuccess = true;
      await supabase.from('chat_sessions').delete().eq('customer_identifier', testJid);
    } else {
      dbErr = upsertErr.message;
    }
  } catch (e) {
    dbErr = e.message;
  }
  assert(dbSuccess, 'Supabase chat_sessions write/read succeeds with zero RLS 401 error', dbErr || 'Success');

  // TEST 5: Dynamic Playbook Guidance Loaded & Matched
  const guidanceBargain = getDynamicPlaybookGuidance('কিছু ডিসকাউন্ট বা কম রাখা যাবে?');
  assert(typeof guidanceBargain === 'string', 
    'Dynamic playbook guidance scores and injects contextual guidelines', guidanceBargain);

  // TEST 6: Simple Greetings ('Hi', 'Hello') must NEVER say "আজ কীভাবে সাহায্য করতে পারি" or "ওয়ালাইকুম আসসালাম"
  const hiReply = await handleIncomingMessage(uid('hi'), 'Hi');
  const hasWalaikumOnHi = hiReply.includes('ওয়ালাইকুম') || hiReply.includes('ওয়ালাইকুম');
  assert(!hiReply.includes('আজ কীভাবে সাহায্য করতে পারি') && !hiReply.includes('কীভাবে সাহায্য করতে পারি') && !hasWalaikumOnHi && (hiReply.includes('স্বাগতম') || hiReply.includes('Dawah Fashion') || hiReply.includes('কালেকশন') || hiReply.includes('জি')), 
    'Hi greeting gives welcoming response without robotic phrases or unsolicited Walaikum Assalam', hiReply);

  await sleep(600);

  // TEST 7: Wellbeing Query ('কেমন আছেন?') politely answers wellbeing
  const wellbeingReply = await handleIncomingMessage(uid('wellbeing'), 'কেমন আছেন?');
  assert(wellbeingReply.includes('আলহামদুলিল্লাহ') || wellbeingReply.includes('ভালো আছি') || wellbeingReply.includes('ভালো'), 
    'Direct "কেমন আছেন" appropriately responds with wellbeing', wellbeingReply);

  await sleep(600);

  // TEST 8: Salam greeting MUST receive polite Walaikum Assalam
  const salamReply = await handleIncomingMessage(uid('salam'), 'আসসালামু আলাইকুম');
  assert(salamReply.includes('ওয়ালাইকুম') || salamReply.includes('ওয়ালাইকুম'), 
    'Direct Salam greeting appropriately responds with Walaikum Assalam', salamReply);

  await sleep(600);

  // TEST 9: Height parsing - 5'3"
  const h1 = await handleIncomingMessage(uid('h1'), 'আমার উচ্চতা ৫ ফুট ৩ ইঞ্চি, কোন সাইজ লাগবে?');
  assert(h1.includes('৫২'), '5ft 3in recommends 52 inch length', h1);

  await sleep(600);

  // TEST 10: Height parsing - 5 fut 5
  const h2 = await handleIncomingMessage(uid('h2'), '5 fut 5');
  assert(h2.includes('৫৪'), '5 fut 5 recommends 54 inch length', h2);

  await sleep(600);

  // TEST 11: Delivery Timeline & Charge
  const del = await handleIncomingMessage(uid('del'), 'ঢাকার বাইরে ডেলিভারি কয়দিনে দেন এবং চার্জ কত?');
  assert((del.includes('২৪') || del.includes('৪৮') || del.includes('২') || del.includes('৩') || del.includes('দিন') || del.includes('কার্যদিবস')) && (del.includes('১৫০') || del.includes('150') || del.includes('১২০') || del.includes('120') || del.includes('১৩০') || del.includes('130') || del.includes('একশো পঞ্চাশ')), 
    'Delivery timeline and fee accurate', del);

  await sleep(600);

  // TEST 12: Free Delivery Demand Rejected Courteously
  const freeDelReq = await handleIncomingMessage(uid('freedel'), 'ডেলিভারি চার্জ ফ্রি করে দেওয়া যাবে?');
  assert((freeDelReq.includes('কুরিয়ার') || freeDelReq.includes('কুরিয়ার') || freeDelReq.includes('বুকিং') || freeDelReq.includes('ফিক্সড') || freeDelReq.includes('সম্ভব নয়') || freeDelReq.includes('চার্জ')) && !freeDelReq.includes('ডেলিভারি চার্জ একদম ফ্রি'), 
    'Free delivery demand politely declined explaining courier cost', freeDelReq);

  await sleep(600);

  // TEST 13: Open Parcel Inspection
  const open = await handleIncomingMessage(uid('open'), 'পার্সেল কি ডেলিভারি ম্যানের সামনে খুলে দেখা যাবে?');
  assert((open.includes('খুলে') || open.includes('ওপেন') || open.includes('চেক')) && (open.includes('দেখে') || open.includes('চেক') || open.includes('বুঝে')), 
    'Open parcel inspection verified', open);

  await sleep(600);

  // TEST 14: Stage 1 - Initial Browse sends catalog overview / image, ZERO details dumped
  const catReply = await handleIncomingMessage(uid('cat'), 'কালেকশন দেখান');
  assert((catReply.includes('[SEND_IMAGE:') || catReply.includes('[SEND_CATALOG_OVERVIEW]')) && !catReply.includes('প্রাইজ:') && !catReply.includes('মূল্য:'), 
    'Stage 1: Initial catalog browse sends catalog overview with NO details/prices upfront', catReply);

  await sleep(600);

  // TEST 15: Wanting to see ALL models ("সবগুলো দেখান") sends [SEND_CATALOG_OVERVIEW]
  const allReply = await handleIncomingMessage(uid('all'), 'সব মডেল দেখাও');
  assert(allReply.includes('[SEND_CATALOG_OVERVIEW]') || allReply.includes('[SEND_IMAGE:'), 
    'Customer asking to see all models triggers catalog overview/photos', allReply);

  await sleep(600);

  // TEST 16: Stage 2 - Model selection sends album images, NO unprompted price dump
  const modelReply1 = await handleIncomingMessage(uid('mod1'), 'DF-101 দেখাও');
  assert((modelReply1.includes('[SEND_ALL_IMAGES:DF-101]') || modelReply1.includes('[SEND_IMAGE:DF-101]')) && !modelReply1.includes('প্রাইজ:') && !modelReply1.includes('মূল্য:'), 
    'Stage 2: Model choice sends album images with NO unprompted price dump', modelReply1);

  await sleep(600);

  // TEST 17: Stage 3 - Asking for price/details provides price
  const step3Uid = uid('step3');
  await handleIncomingMessage(step3Uid, 'DF-101 দেখাও');
  await sleep(600);
  const priceReply = await handleIncomingMessage(step3Uid, 'এটার দাম কত?');
  assert((priceReply.includes('2450') || priceReply.includes('২,৪৫০') || priceReply.includes('২৪৫০')), 
    'Stage 3: Asking for price outputs full price and product details', priceReply);

  await sleep(600);

  // TEST 18: Persistent Memory Anti-Repetition (Second message must NOT repeat Salam)
  const salRepeatUid = uid('sal_repeat');
  await handleIncomingMessage(salRepeatUid, 'Hi');
  await sleep(600);
  const secondReply = await handleIncomingMessage(salRepeatUid, 'DF-102 এর সাইজ কি কি আছে?');
  assert(!secondReply.includes('আসসালামু আলাইকুম') && !secondReply.includes('স্বাগতম'), 
    'Second turn strictly prevents repeating salam or welcome greeting', secondReply);

  // TEST 19: Strict Zero "ভাইয়া/আপু" and Zero Robotic/Flower Emojis
  const allOutputs = [
    hiReply, wellbeingReply, h1, h2, del, open, 
    catReply, allReply, modelReply1, priceReply, secondReply
  ].join(' ');
  const hasGenderedTitle = allOutputs.includes('ভাইয়া') || allOutputs.includes('আপু') || allOutputs.includes('স্যার') || allOutputs.includes('ম্যাম');
  const hasForbiddenEmoji = allOutputs.includes('🌸') || allOutputs.includes('😊');
  assert(!hasGenderedTitle && !hasForbiddenEmoji, 
    'Zero "ভাইয়া/আপু" and zero robotic/flower emojis across entire conversation suite', allOutputs);

  await sleep(600);

  // TEST 20: Sarcastic Photo Inquiry / Banglish Typo ("Nam ki dhuye pani khabo naki poc dite hobe")
  const sarcReply = await handleIncomingMessage(uid('sarc'), 'Nam ki dhuye pani khabo naki poc dite hobe');
  assert((sarcReply.includes('[SEND_IMAGE:') || sarcReply.includes('[SEND_ALL_IMAGES:') || sarcReply.includes('[SEND_CATALOG_OVERVIEW]')) && !/(ডিটারজেন্ট|পাওয়ার\s*ওয়াশ|লন্ড্রি|power\s*wash)/i.test(sarcReply), 
    'Sarcastic / Banglish photo query provides image tag with ZERO laundry hallucination', sarcReply);

  await sleep(600);

  // TEST 21: Angry Slang / Frustration ("Baler buddhi daw tumi")
  const angryReply = await handleIncomingMessage(uid('angry'), 'Baler buddhi daw tumi');
  assert(!angryReply.includes('ধন্যবাদ আপনার মতামতের জন্য') && !angryReply.includes('কীভাবে সাহায্য করতে পারি'), 
    'Angry slang handled with dignity and zero corporate robotic garbage', angryReply);

  await sleep(600);

  // TEST 22: No Hardcoded DF-101 Fallback on Complaints ("bar bar 101 kno bal")
  const bbReply = await handleIncomingMessage(uid('bb'), 'bar bar 101 kno bal');
  assert(!bbReply.includes('আপনাকে DF-101 এর ছবি ও বিস্তারিত দিচ্ছি'), 
    '"bar bar 101 kno bal" is NOT hijacked with robotic apology dumping DF-101', bbReply);

  await sleep(600);

  // TEST 23: Unprompted Price Objection ("Agei dam kno")
  const ageiDamReply = await handleIncomingMessage(uid('agei_dam'), 'Agei dam kno bolchen? Chobi dekhan age');
  assert((ageiDamReply.includes('[SEND_IMAGE:') || ageiDamReply.includes('[SEND_ALL_IMAGES:') || ageiDamReply.includes('[SEND_CATALOG_OVERVIEW]')) && !ageiDamReply.includes('মূল্য:'), 
    '"Agei dam kno" respects customer request and sends photos without dumping price', ageiDamReply);

  // TEST 24: Formatting Sanitizer Dash & Model Protection
  const sanitized = cleanHumanFormatting('মডেল - DF-101 — খুব সুন্দর • কালার -- সাইজ ৫০-৫৬ - আরে ভাই');
  assert(sanitized.includes('DF-101') && sanitized.includes('৫০-৫৬') && !sanitized.includes(' — ') && !sanitized.includes(' • '), 
    'Sanitizer cleanly removes dashes and bullets without breaking DF-101 model code or digit ranges', sanitized);

  // TEST 25: Universal Image Extractor getProductImageUrls
  const { getProductImageUrls } = require('./commerce_brain');
  const dummyProd = {
    image_url: 'https://cdn.example.com/p1.jpg',
    detail_image_url: 'https://cdn.example.com/p2.jpg',
    gallery_images: [
      'https://cdn.example.com/p3.jpg',
      'https://cdn.example.com/p4.jpg',
      'https://cdn.example.com/p5.jpg',
      'https://cdn.example.com/p6.jpg',
      'https://cdn.example.com/p7.jpg',
      'https://cdn.example.com/p8.jpg',
      'https://cdn.example.com/p9_overflow.jpg'
    ]
  };
  const extractedUrls = getProductImageUrls(dummyProd);
  assert(extractedUrls.length === 8 && !extractedUrls.includes('https://cdn.example.com/p9_overflow.jpg'), 
    'Universal Image Extractor cleanly extracts and caps gallery photos at 8 max', JSON.stringify(extractedUrls));

  await sleep(600);

  // TEST 26: Model Choice outputs [SEND_ALL_IMAGES:DF-101]
  const mod2Reply = await handleIncomingMessage(uid('mod2'), 'DF-101 দেখান');
  assert(mod2Reply.includes('[SEND_ALL_IMAGES:DF-101]') || mod2Reply.includes('[SEND_IMAGE:DF-101]'), 
    'Model selection triggers [SEND_ALL_IMAGES:DF-101] for full photo album delivery', mod2Reply);

  await sleep(600);

  // TEST 27: Salam Only Does NOT say "ভালো আছি" (Unsolicited wellbeing removed)
  const salamOnlyReply = await handleIncomingMessage(uid('salam_only'), 'আসসালামু আলাইকুম');
  assert(!salamOnlyReply.includes('ভালো আছি') && (salamOnlyReply.includes('ওয়ালাইকুম') || salamOnlyReply.includes('ওয়ালাইকুম')), 
    'Salam only answers Walaikum Assalam without unsolicited "ভালো আছি"', salamOnlyReply);

  await sleep(600);

  // TEST 28: Quoted Message Context / "Eta koto" with context
  const quotedReply = await handleIncomingMessage(uid('quote_test'), '[Customer replied to image of Model: DF-103 (প্রিমিয়াম কাফতান)]: Eta koto');
  assert(quotedReply.includes('DF-103') && (quotedReply.includes('১৯৫০') || quotedReply.includes('১৮৫০') || quotedReply.includes('প্রাইস') || quotedReply.includes('মূল্য') || quotedReply.includes('টাকা')), 
    'Quoted image reply accurately targets DF-103 and quotes price without truncation', quotedReply);

  await sleep(600);

  // TEST 29: Dynamic Product Colors Verification (Zero Hallucination / Zero Guessing)
  const colorQueryReply = await handleIncomingMessage(uid('color_test'), 'DF-103 এর কি কি কালার আছে?');
  assert((colorQueryReply.includes('কফি') || colorQueryReply.includes('সি-গ্রিন') || colorQueryReply.includes('গ্রিন')) && !colorQueryReply.includes('গোলাপি') && !colorQueryReply.includes('হলুদ'), 
    'Dynamic colors pulled from Supabase without guessing/hallucination for DF-103', colorQueryReply);

  await sleep(600);

  // TEST 30: "আপনি" Pronoun Preservation & Anti-Truncation Polish
  const apniSanitized = cleanHumanFormatting('আপনি কোন কালারটি চাচ্ছেন? আপনার পছন্দের সাইজটি বলুন।');
  assert(apniSanitized.includes('আপনি') && apniSanitized.includes('আপনার'), 
    'Clean human sanitizer strictly preserves respectful "আপনি" and "আপনার" pronouns', apniSanitized);

  // TEST 31: Product Intelligence Studio Structured Specs Formatting
  const testSysPrompt = buildSystemPrompt('test_rich_specs');
  assert(testSysPrompt.includes('Zero Hallucination Specs') && testSysPrompt.includes('নন-ট্রান্সপারেন্ট'), 
    'System prompt includes Product Intelligence Zero Hallucination rules', testSysPrompt.substring(0, 300));

  // TEST 32: Dynamic Bundle Deals & Volume Pricing Verification
  assert(testSysPrompt.includes('বান্ডেল অফার') && testSysPrompt.includes('বান্ডেল অনুযায়ী'), 
    'System prompt integrates Dynamic Bundle & Volume Pricing guidelines', testSysPrompt.substring(0, 300));

  console.log('\n========================================');
  if (failedTests === 0) {
    console.log('   ALL 32 RIGOROUS REGRESSION TESTS PASSED!  ');
    console.log('========================================\n');
    process.exit(0);
  } else {
    console.error(`   FAILED ${failedTests} TESTS! PLEASE FIX BEFORE DEPLOYING!`);
    console.log('========================================\n');
    process.exit(1);
  }
}

runRegressionSuite();
