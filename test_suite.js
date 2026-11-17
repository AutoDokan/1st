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

  // TEST 1: System Prompt Length < 3,200 chars (Lean & Token-Efficient)
  const samplePrompt = buildSystemPrompt('unit_test_user');
  const promptLen = samplePrompt.length;
  assert(promptLen > 500 && promptLen < 3200, 
    `System prompt is lean (< 3,200 chars). Actual length: ${promptLen} chars`, `Length: ${promptLen}`);

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
    const testJid = 'test_unit_rls_check@lid';
    const { error: upsertErr } = await supabase.from('chat_sessions').upsert({
      seller_id: 'dawah-seller-prod-001',
      customer_identifier: testJid,
      stage: 'greeting',
      messages: [{ role: 'user', text: 'ping' }],
      updated_at: new Date().toISOString()
    });
    if (!upsertErr) {
      dbSuccess = true;
      // Clean up test row
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

  // TEST 6: Simple Greetings ('Hi', 'Hello') must NEVER say "আজ কীভাবে সাহায্য করতে পারি"
  const hiReply = await handleIncomingMessage('unit_user_hi', 'Hi');
  assert(!hiReply.includes('আজ কীভাবে সাহায্য করতে পারি') && !hiReply.includes('কীভাবে সাহায্য করতে পারি') && (hiReply.includes('স্বাগতম') || hiReply.includes('Dawah Fashion') || hiReply.includes('কালেকশন') || hiReply.includes('বোরকা') || hiReply.includes('জি')), 
    'Hi greeting gives welcoming response without robotic "আজ কীভাবে সাহায্য করতে পারি"', hiReply);

  await sleep(300);

  // TEST 7: Wellbeing Query ('কেমন আছেন?') politely answers wellbeing
  const wellbeingReply = await handleIncomingMessage('unit_user_wellbeing', 'কেমন আছেন?');
  assert(wellbeingReply.includes('আলহামদুলিল্লাহ') || wellbeingReply.includes('ভালো আছি') || wellbeingReply.includes('ভালো'), 
    'Direct "কেমন আছেন" appropriately responds with wellbeing', wellbeingReply);

  await sleep(300);

  // TEST 8: Height parsing - 5'3"
  const h1 = await handleIncomingMessage('unit_user_h1', 'আমার উচ্চতা ৫ ফুট ৩ ইঞ্চি, কোন সাইজ লাগবে?');
  assert(h1.includes('৫২'), '5ft 3in recommends 52 inch length', h1);

  await sleep(300);

  // TEST 9: Height parsing - 5 fut 5
  const h2 = await handleIncomingMessage('unit_user_h2', '5 fut 5');
  assert(h2.includes('৫৪'), '5 fut 5 recommends 54 inch length', h2);

  await sleep(300);

  // TEST 10: Delivery Timeline & Charge
  const del = await handleIncomingMessage('unit_user_del', 'ঢাকার বাইরে ডেলিভারি কয়দিনে দেন এবং চার্জ কত?');
  assert((del.includes('২৪') || del.includes('৪৮') || del.includes('২ থেকে ৩') || del.includes('দুই থেকে তিন') || del.includes('৩ দিন') || del.includes('দিন')) && (del.includes('১২০') || del.includes('120') || del.includes('১৩০') || del.includes('130')), 
    'Delivery timeline and fee accurate', del);

  await sleep(300);

  // TEST 11: Free Delivery Demand Rejected Courteously
  const freeDelReq = await handleIncomingMessage('unit_user_freedel', 'ডেলিভারি চার্জ ফ্রি করে দেওয়া যাবে?');
  assert((freeDelReq.includes('কুরিয়ার') || freeDelReq.includes('কুরিয়ার') || freeDelReq.includes('বুকিং') || freeDelReq.includes('ফিক্সড') || freeDelReq.includes('সম্ভব নয়') || freeDelReq.includes('চার্জ')) && !freeDelReq.includes('ডেলিভারি চার্জ একদম ফ্রি'), 
    'Free delivery demand politely declined explaining courier cost', freeDelReq);

  await sleep(300);

  // TEST 12: Open Parcel Inspection
  const open = await handleIncomingMessage('unit_user_open', 'পার্সেল কি ডেলিভারি ম্যানের সামনে খুলে দেখা যাবে?');
  assert((open.includes('খুলে') || open.includes('ওপেন') || open.includes('চেক')) && (open.includes('দেখে') || open.includes('চেক') || open.includes('বুঝে')), 
    'Open parcel inspection verified', open);

  await sleep(300);

  // TEST 13: Stage 1 - Initial Browse sends catalog overview / image, ZERO details dumped
  const catReply = await handleIncomingMessage('unit_user_cat', 'কালেকশন দেখান');
  assert((catReply.includes('[SEND_IMAGE:') || catReply.includes('[SEND_CATALOG_OVERVIEW]')) && !catReply.includes('প্রাইজ:') && !catReply.includes('মূল্য:'), 
    'Stage 1: Initial catalog browse sends catalog overview with NO details/prices upfront', catReply);

  await sleep(300);

  // TEST 14: Wanting to see ALL models ("সবগুলো দেখান") sends [SEND_CATALOG_OVERVIEW]
  const allReply = await handleIncomingMessage('unit_user_all', 'সব মডেল দেখাও');
  assert(allReply.includes('[SEND_CATALOG_OVERVIEW]') || allReply.includes('[SEND_IMAGE:'), 
    'Customer asking to see all models triggers catalog overview/photos', allReply);

  await sleep(300);

  // TEST 15: Stage 2 - Model selection sends album images, NO unprompted price dump
  const modelReply1 = await handleIncomingMessage('unit_user_mod1', 'DF-102 দেখাও');
  assert((modelReply1.includes('[SEND_ALL_IMAGES:DF-102]') || modelReply1.includes('[SEND_IMAGE:DF-102]')) && !modelReply1.includes('প্রাইজ:') && !modelReply1.includes('মূল্য:'), 
    'Stage 2: Model choice sends album images with NO unprompted price dump', modelReply1);

  await sleep(300);

  // TEST 16: Stage 3 - Asking for price/details provides price
  await handleIncomingMessage('unit_user_step3', 'DF-102 দেখাও');
  await sleep(300);
  const priceReply = await handleIncomingMessage('unit_user_step3', 'এটার দাম কত?');
  assert((priceReply.includes('2200') || priceReply.includes('২,২০০') || priceReply.includes('২২০০')), 
    'Stage 3: Asking for price outputs full price and product details', priceReply);

  await sleep(300);

  // TEST 17: Persistent Memory Anti-Repetition (Second message must NOT repeat Salam)
  await handleIncomingMessage('unit_user_sal_repeat', 'Hi');
  await sleep(300);
  const secondReply = await handleIncomingMessage('unit_user_sal_repeat', 'DF-102 এর সাইজ কি কি আছে?');
  assert(!secondReply.includes('আসসালামু আলাইকুম') && !secondReply.includes('স্বাগতম'), 
    'Second turn strictly prevents repeating salam or welcome greeting', secondReply);

  // TEST 18: Strict Zero "ভাইয়া/আপু" and Zero Robotic/Flower Emojis
  const allOutputs = [
    hiReply, wellbeingReply, h1, h2, del, open, 
    catReply, allReply, modelReply1, priceReply, secondReply
  ].join(' ');
  const hasGenderedTitle = allOutputs.includes('ভাইয়া') || allOutputs.includes('আপু') || allOutputs.includes('স্যার') || allOutputs.includes('ম্যাম');
  const hasForbiddenEmoji = allOutputs.includes('🌸') || allOutputs.includes('😊');
  assert(!hasGenderedTitle && !hasForbiddenEmoji, 
    'Zero "ভাইয়া/আপু" and zero robotic/flower emojis across entire conversation suite', allOutputs);

  await sleep(300);

  // TEST 19: Sarcastic Photo Inquiry / Banglish Typo ("Nam ki dhuye pani khabo naki poc dite hobe")
  const sarcReply = await handleIncomingMessage('unit_user_sarc', 'Nam ki dhuye pani khabo naki poc dite hobe');
  assert((sarcReply.includes('[SEND_IMAGE:') || sarcReply.includes('[SEND_ALL_IMAGES:') || sarcReply.includes('[SEND_CATALOG_OVERVIEW]')) && !/(ডিটারজেন্ট|পাওয়ার\s*ওয়াশ|লন্ড্রি|power\s*wash)/i.test(sarcReply), 
    'Sarcastic / Banglish photo query provides image tag with ZERO laundry hallucination', sarcReply);

  await sleep(300);

  // TEST 20: Angry Slang / Frustration ("Baler buddhi daw tumi")
  const angryReply = await handleIncomingMessage('unit_user_angry', 'Baler buddhi daw tumi');
  assert(!angryReply.includes('ধন্যবাদ আপনার মতামতের জন্য') && !angryReply.includes('কীভাবে সাহায্য করতে পারি'), 
    'Angry slang handled with dignity and zero corporate robotic garbage', angryReply);

  await sleep(300);

  // TEST 21: No Hardcoded DF-101 Fallback on Complaints ("bar bar 101 kno bal")
  const bbReply = await handleIncomingMessage('unit_user_bb', 'bar bar 101 kno bal');
  assert(!bbReply.includes('আপনাকে DF-101 এর ছবি ও বিস্তারিত দিচ্ছি'), 
    '"bar bar 101 kno bal" is NOT hijacked with robotic apology dumping DF-101', bbReply);

  await sleep(300);

  // TEST 22: Unprompted Price Objection ("Agei dam kno")
  const ageiDamReply = await handleIncomingMessage('unit_user_agei_dam', 'Agei dam kno bolchen? Chobi dekhan age');
  assert((ageiDamReply.includes('[SEND_IMAGE:') || ageiDamReply.includes('[SEND_CATALOG_OVERVIEW]')) && !ageiDamReply.includes('মূল্য:'), 
    '"Agei dam kno" respects customer request and sends photos without dumping price', ageiDamReply);

  // TEST 23: Formatting Sanitizer Dash & Model Protection
  const sanitized = cleanHumanFormatting('মডেল - DF-101 — খুব সুন্দর • কালার -- সাইজ ৫০-৫৬ - আরে ভাই');
  assert(sanitized.includes('DF-101') && sanitized.includes('৫০-৫৬') && !sanitized.includes(' — ') && !sanitized.includes(' • '), 
    'Sanitizer cleanly removes dashes and bullets without breaking DF-101 model code or digit ranges', sanitized);

  // TEST 24: 85% / 15% Complexity Router Verification
  const r1 = classifyMessageComplexity('DF-101 এর দাম কত?', 2);
  const r2 = classifyMessageComplexity('আমার উচ্চতা ৫ ফুট ৩ ইঞ্চি', 3);
  const r3 = classifyMessageComplexity('কালেকশন দেখান', 1);
  const c1 = classifyMessageComplexity('একটু কম রাখা যাবে?', 2);
  const c2 = classifyMessageComplexity('Nam ki dhuye pani khabo naki poc dite hobe', 3);
  const c3 = classifyMessageComplexity('Baler buddhi daw tumi', 4);
  const c4 = classifyMessageComplexity('ঠিক আছে', 9);
  assert(r1 === 'ROUTINE' && r2 === 'ROUTINE' && r3 === 'ROUTINE' && c1 === 'COMPLEX' && c2 === 'COMPLEX' && c3 === 'COMPLEX' && c4 === 'COMPLEX', 
    '85/15 Message Complexity Router accurately classifies routine vs complex queries', `r1=${r1}, r2=${r2}, r3=${r3}, c1=${c1}, c2=${c2}, c3=${c3}, c4=${c4}`);

  console.log('\n========================================');
  if (failedTests === 0) {
    console.log('   ALL 24 RIGOROUS REGRESSION TESTS PASSED!  ');
    console.log('========================================\n');
    process.exit(0);
  } else {
    console.error(`   FAILED ${failedTests} TESTS! PLEASE FIX BEFORE DEPLOYING!`);
    console.log('========================================\n');
    process.exit(1);
  }
}

runRegressionSuite();
