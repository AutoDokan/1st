const { handleIncomingMessage, refreshProductsFromDB, getProductByCode } = require('./borkha_brain.js');

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

  // TEST 1: Simple Greetings ('Hi', 'Hello', 'hey') must NEVER say "আলহামদুলিল্লাহ আমরা ভালো আছি"
  const hiReply = await handleIncomingMessage('unit_user_hi', 'Hi');
  assert(!hiReply.includes('আলহামদুলিল্লাহ') && !hiReply.includes('ভালো আছি') && hiReply.includes('স্বাগতম'), 
    'Hi greeting gives welcoming response without fake wellbeing answer', hiReply);

  // TEST 2: Wellbeing Query ('কেমন আছেন?') MUST politely answer wellbeing
  const wellbeingReply = await handleIncomingMessage('unit_user_wellbeing', 'কেমন আছেন?');
  assert(wellbeingReply.includes('আলহামদুলিল্লাহ') && wellbeingReply.includes('ভালো আছি'), 
    'Direct "কেমন আছেন" appropriately responds with Alhamdulillah', wellbeingReply);

  // TEST 3: Height parsing - 5'3"
  const h1 = await handleIncomingMessage('unit_user_h1', 'আমার উচ্চতা ৫ ফুট ৩ ইঞ্চি, কোন সাইজ লাগবে?');
  assert(h1.includes('৫২ ইঞ্চি'), '5ft 3in recommends 52 inch length', h1);

  // TEST 4: Height parsing - 5 fut 5
  const h2 = await handleIncomingMessage('unit_user_h2', '5 fut 5');
  assert(h2.includes('৫৪ ইঞ্চি'), '5 fut 5 recommends 54 inch length', h2);

  // TEST 5: Height parsing - 4 fut 4 (Special short stature customize)
  const h3 = await handleIncomingMessage('unit_user_h3', '4 fut 4');
  assert(h3.includes('কাস্টমাইজ') || h3.includes('৪৪') || h3.includes('৪৬'), '4 fut 4 provides custom short height advice', h3);

  // TEST 6: Height with heels - 5'8" with heels
  const h4 = await handleIncomingMessage('unit_user_h4', 'আমার হাইট ৫ ফুট ৮ ইঞ্চি, হিল পরব');
  assert(h4.includes('হিল') && (h4.includes('৫৮') || h4.includes('৫৬')), '5ft 8in with heels suggests 56/58 inch length', h4);

  // TEST 7: Delivery Timeline & Charge
  const del = await handleIncomingMessage('unit_user_del', 'ঢাকার বাইরে ডেলিভারি কয়দিনে দেন এবং চার্জ কত?');
  assert(del.includes('২৪ থেকে ৪৮') && del.includes('২ থেকে ৩'), 'Delivery timeline and fee accurate', del);

  // TEST 8: 2-Piece Combo Inquiry (Strict No Unauthorized Free Delivery)
  const combo = await handleIncomingMessage('unit_user_combo', 'আমি ২ পিস নিলে কিছু ছাড় দিবেন?');
  assert(!combo.includes('ডেলিভারি চার্জ একদম ফ্রি') && (combo.includes('এক চার্জেই') || combo.includes('একই পার্সেলে') || combo.includes('হিজাব সম্পূর্ণ উপহার') || combo.includes('অফার')), '2-piece combo explains single parcel shipping without unauthorized free delivery', combo);

  // TEST 9: Free Delivery Demand Rejected Courteously
  const freeDelReq = await handleIncomingMessage('unit_user_freedel', 'ডেলিভারি চার্জ ফ্রি করে দেওয়া যাবে?');
  assert(freeDelReq.includes('কুরিয়ার কোম্পানির বুকিং ফি') || freeDelReq.includes('কুরিয়ার সার্ভিসের বুকিং ফি'), 'Free delivery demand politely declined explaining courier cost', freeDelReq);

  // TEST 10: Open Parcel Inspection
  const open = await handleIncomingMessage('unit_user_open', 'পার্সেল কি ডেলিভারি ম্যানের সামনে খুলে দেখা যাবে?');
  assert(open.includes('খুলে দেখে-শুনে') || open.includes('খুলে দেখে'), 'Open parcel inspection verified', open);

  // TEST 10: Fabric Transparency
  const fab = await handleIncomingMessage('unit_user_fab', 'কাপড় কি পাতলা নাকি শালীনভাবে কভার হবে?');
  assert(fab.includes('পাতলা') || fab.includes('নন-ট্রান্সপারেন্ট'), 'Fabric opacity objection handled', fab);

  // TEST 11: Conversational Memory - Model Retention
  await handleIncomingMessage('unit_user_mem', 'DF-102 এর রিয়েল ছবি দিন');
  const mem = await handleIncomingMessage('unit_user_mem', '🛒 অর্ডার কনফার্ম করতে চাই');
  assert(mem.includes('DF-102'), 'Bot remembers user selected DF-102 in follow-up', mem);

  // TEST 13: General Catalog Inquiry sends ONLY 1 main overview photo
  const catReply = await handleIncomingMessage('unit_user_cat', 'Sob mode dekhaw');
  assert(catReply.includes('[SEND_IMAGE:DF-101]') && !catReply.includes('[SEND_CATALOG_OVERVIEW]') && catReply.includes('DF-101') && catReply.includes('DF-105'), 
    'General catalog inquiry sends list and ONLY 1 main photo', catReply);

  // TEST 14: Specific Model by Name/Code/Number sends ALL pictures of that model
  const modelReply1 = await handleIncomingMessage('unit_user_mod1', 'DF-102 দেখাও');
  assert(modelReply1.includes('[SEND_ALL_IMAGES:DF-102]'), 'Requesting model by code DF-102 sends ALL images', modelReply1);

  const modelReply2 = await handleIncomingMessage('unit_user_mod2', '২ নম্বর টা দেখতে চাই');
  assert(modelReply2.includes('[SEND_ALL_IMAGES:DF-102]'), 'Requesting model by number "২ নম্বর" sends ALL images of DF-102', modelReply2);

  const modelReply3 = await handleIncomingMessage('unit_user_mod3', 'রানি আবায়া');
  assert(modelReply3.includes('[SEND_ALL_IMAGES:DF-102]'), 'Requesting model by name "রানি আবায়া" sends ALL images of DF-102', modelReply3);

  // TEST 15: Zero Flower Emojis
  const allOutputs = [hiReply, wellbeingReply, h1, h2, h3, h4, del, combo, open, fab, mem, catReply, modelReply1, modelReply2, modelReply3].join(' ');
  assert(!allOutputs.includes('🌸'), 'Strict zero flower emoji enforcement', allOutputs);

  console.log('\n========================================');
  if (failedTests === 0) {
    console.log('   ALL 15 RIGOROUS BRAIN TESTS PASSED!  ');
    console.log('========================================\n');
    process.exit(0);
  } else {
    console.error(`   FAILED ${failedTests} TESTS! PLEASE FIX BEFORE DEPLOYING!`);
    console.log('========================================\n');
    process.exit(1);
  }
}

runRegressionSuite();
