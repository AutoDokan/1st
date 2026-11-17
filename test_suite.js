const { handleIncomingMessage, refreshProductsFromDB, getProductByCode } = require('./commerce_brain.js');

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
  assert(del.includes('২৪ থেকে ৪৮') && (del.includes('২ থেকে ৩') || del.includes('দুই থেকে তিন')), 'Delivery timeline and fee accurate', del);

  // TEST 8: 2-Piece Combo Inquiry (Strict No Unauthorized Free Delivery)
  const combo = await handleIncomingMessage('unit_user_combo', 'আমি ২ পিস নিলে কিছু ছাড় দিবেন?');
  assert(!combo.includes('ডেলিভারি চার্জ একদম ফ্রি') && (combo.includes('এক চার্জেই') || combo.includes('একই পার্সেলে') || combo.includes('একবারে') || combo.includes('হিজাব') || combo.includes('অফার')), '2-piece combo explains single parcel shipping without unauthorized free delivery', combo);

  // TEST 9: Free Delivery Demand Rejected Courteously
  const freeDelReq = await handleIncomingMessage('unit_user_freedel', 'ডেলিভারি চার্জ ফ্রি করে দেওয়া যাবে?');
  assert((freeDelReq.includes('বুকিং ফি') || freeDelReq.includes('কুরিয়ার') || freeDelReq.includes('কুরিয়ার')) && !freeDelReq.includes('ডেলিভারি চার্জ একদম ফ্রি'), 'Free delivery demand politely declined explaining courier cost', freeDelReq);

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

  // TEST 13: Funnel Stage 1 - Initial Browse sends 1 showcase image, ZERO details dumped, offers to show all
  const catReply = await handleIncomingMessage('unit_user_cat', 'কালেকশন দেখান');
  assert(catReply.includes('[SEND_IMAGE:') && !catReply.includes('৳') && !catReply.includes('প্রাইজ:'), 
    'Stage 1: Initial catalog browse sends 1 showcase image with NO details/prices', catReply);

  // TEST 14: Wanting to see ALL models ("সবগুলো দেখান" / "Sob mode dekhaw") sends [SEND_CATALOG_OVERVIEW]
  const allReply = await handleIncomingMessage('unit_user_all', 'সব মডেল দেখাও');
  assert(allReply.includes('[SEND_CATALOG_OVERVIEW]'), 
    'Customer asking to see all models triggers SEND_CATALOG_OVERVIEW', allReply);

  // TEST 15: Funnel Stage 2 - Model selection sends remaining album images, NO price dumped yet
  const modelReply1 = await handleIncomingMessage('unit_user_mod1', 'DF-102 দেখাও');
  assert(modelReply1.includes('[SEND_ALL_IMAGES:DF-102]') && !modelReply1.includes('প্রাইজ:') && !modelReply1.includes('৳'), 
    'Stage 2: Model choice sends all album images with NO price dump', modelReply1);

  const modelReply2 = await handleIncomingMessage('unit_user_mod2', '২ নম্বর টা দেখতে চাই');
  assert(modelReply2.includes('[SEND_ALL_IMAGES:DF-102]') && !modelReply2.includes('প্রাইজ:'), 
    'Stage 2: Ordinal "২ নম্বর" choice sends all album images with NO price dump', modelReply2);

  // TEST 16: Funnel Stage 3 - Asking for price/details sends full price, fabric, size, and delivery card
  await handleIncomingMessage('unit_user_step3', 'DF-102 দেখাও');
  const priceReply = await handleIncomingMessage('unit_user_step3', 'এটার দাম কত?');
  assert(priceReply.includes('DF-102') && (priceReply.includes('2200') || priceReply.includes('২,২০০') || priceReply.includes('২২০০')) && priceReply.includes('ফেব্রিক') && priceReply.includes('ডেলিভারি চার্জ'), 
    'Stage 3: Asking for price outputs full price, fabric, size and delivery details', priceReply);

  // TEST 18: Question + Photo Intent Preservation
  const qPhotoReply = await handleIncomingMessage('unit_user_qphoto', 'DF-102 এর কাপড়ের কোয়ালিটি কেমন? সাথে একটা রিয়েল ছবি দেখতে চাই');
  assert(qPhotoReply.includes('[SEND_REAL_IMAGE:DF-102]') || qPhotoReply.includes('[SEND_ALL_IMAGES:DF-102]'), 
    'Question + Photo intent preserves image tag', qPhotoReply);

  // TEST 19: Persistent Memory Anti-Repetition (Second message must NOT repeat Salam)
  await handleIncomingMessage('unit_user_sal_repeat', 'Hi');
  const secondReply = await handleIncomingMessage('unit_user_sal_repeat', 'DF-102 এর সাইজ কি কি আছে?');
  assert(!secondReply.includes('আসসালামু আলাইকুম') && !secondReply.includes('স্বাগতম'), 
    'Second turn strictly prevents repeating salam or welcome greeting', secondReply);

  // TEST 20: Out of Stock Inquiry Handling
  const outOfStockReply = await handleIncomingMessage('unit_user_oos', 'DF-106 আছে কি?');
  assert(outOfStockReply.includes('স্টক') || outOfStockReply.includes('নেই') || outOfStockReply.includes('বিকল্প') || outOfStockReply.includes('মডেল'), 
    'Out of stock inquiry correctly handled without hallucination', outOfStockReply);

  // TEST 21: Discount / Promotion Inquiry Handling
  const promoReply = await handleIncomingMessage('unit_user_promo', 'আপনাদের কি কোনো ডিসকাউন্ট বা অফার চলছে?');
  assert(promoReply.includes('অফার') || promoReply.includes('উপহার') || promoReply.includes('হিজাব') || promoReply.includes('ছাড়') || promoReply.includes('ফিক্সড') || promoReply.includes('মূল্য'), 
    'Discount / promotion query answers cleanly with active offer or fixed fair price policy', promoReply);

  // TEST 22: Strict Zero "ভাইয়া/আপু" and Zero Robotic/Flower Emojis
  const allOutputs = [
    hiReply, wellbeingReply, h1, h2, h3, h4, del, combo, open, fab, mem, 
    catReply, allReply, modelReply1, modelReply2, priceReply, qPhotoReply, 
    secondReply, outOfStockReply, promoReply
  ].join(' ');
  const hasGenderedTitle = allOutputs.includes('ভাইয়া') || allOutputs.includes('আপু') || allOutputs.includes('স্যার') || allOutputs.includes('ম্যাম');
  const hasForbiddenEmoji = allOutputs.includes('🌸') || allOutputs.includes('😊');
  assert(!hasGenderedTitle && !hasForbiddenEmoji, 
    'Zero "ভাইয়া/আপু" and zero robotic/flower emojis across entire conversation suite', allOutputs);

  // TEST 23: Payment Submission Guardrail (Verification by Account Manager)
  const paymentReply = await handleIncomingMessage('unit_user_pay_guard', 'বিকাশে ডেলিভারি চার্জ পাঠিয়ে দিয়েছি, লাস্ট ৪ ডিজিট ৫৪৬৭');
  assert((paymentReply.includes('ভেরিফাই') || paymentReply.includes('ম্যানেজার') || paymentReply.includes('অ্যাকাউন্ট') || paymentReply.includes('নোট') || paymentReply.includes('কল') || paymentReply.includes('চেক')), 
    'Payment submission states account manager verification, no hallucinated instant bank confirmation', paymentReply);

  // TEST 24: Multi-User Parallel Isolation (Zero Cross-Talk under Concurrent Calls)
  const [isoReplyA, isoReplyB] = await Promise.all([
    handleIncomingMessage('unit_user_iso_a', 'DF-101 এর দাম কত?'),
    handleIncomingMessage('unit_user_iso_b', 'DF-103 দেখান')
  ]);
  const isIsolatedA = isoReplyA.includes('DF-101') && !isoReplyA.includes('DF-103');
  const isIsolatedB = (isoReplyB.includes('DF-103') || isoReplyB.includes('[SEND_ALL_IMAGES:DF-103]')) && !isoReplyB.includes('DF-101');
  assert(isIsolatedA && isIsolatedB, 
    'Multi-user concurrent requests run in 100% parallel isolation without crosstalk', `UserA: ${isoReplyA}\nUserB: ${isoReplyB}`);

  // TEST 25: Smart Gibberish & Accidental Text Guard
  const gibberishReply = await handleIncomingMessage('unit_user_gibberish', 'asdfgh qwerty 123456');
  const accidentalReply = await handleIncomingMessage('unit_user_accidental', 'ভুল করে মেসেজ দিয়েছি');
  assert(!gibberishReply.includes('[SEND_') && gibberishReply.includes('সমস্যা নেই'), 
    'Gibberish text handled with clean single-line non-intrusive reply without photo tags', gibberishReply);
  assert(accidentalReply.includes('সমস্যা নেই') && !accidentalReply.includes('?'), 
    'Accidental text gracefully acknowledged without sales push', accidentalReply);

  // TEST 26: Goodbye Intent Guard (Strict Zero Question & Zero Sales Pitch)
  const goodbyeReply = await handleIncomingMessage('unit_user_goodbye', 'আল্লাহ হাফেজ');
  assert(goodbyeReply.includes('ভালো থাকবেন') && !goodbyeReply.includes('?') && !goodbyeReply.includes('[SEND_'), 
    'Goodbye intent gives warm farewell with zero sales hooks and zero questions', goodbyeReply);

  // TEST 27: Customer Complaint & Agent Request Escalation Guard
  const complaintReply = await handleIncomingMessage('unit_user_complaint', 'ভোক্তা অধিকারে যাবো, আপনারা প্রতারণা করছেন');
  const agentReqReply = await handleIncomingMessage('unit_user_agent_req', 'বট বন্ধ করে স্টাফ দিন');
  assert(complaintReply.includes('দুঃখিত') && (complaintReply.includes('ইনচার্জ') || complaintReply.includes('সমাধান')), 
    'Severe complaint handled empathetically with incharge escalation', complaintReply);
  assert((agentReqReply.includes('ইনচার্জ') || agentReqReply.includes('দায়িত্বশীল') || agentReqReply.includes('কল')), 
    'Agent request politely handled as human store incharge offering call back', agentReqReply);

  // TEST 28: Live Order Status Lookup
  const noOrderReply = await handleIncomingMessage('unit_user_no_order', 'আমার অর্ডারের খবর কি?');
  const liveOrderReply = await handleIncomingMessage('01712345678', 'আমার অর্ডারের খবর কি?');
  assert(noOrderReply.includes('অর্ডার পাওয়া যায়নি') || noOrderReply.includes('আইডিটি জানালে'), 
    'Non-existent order inquiry prompts for details without hallucinating', noOrderReply);
  assert(liveOrderReply.includes('অর্ডার #2') && liveOrderReply.includes('Approved'), 
    'Live phone lookup returns authentic order status and tracking details from Supabase', liveOrderReply);

  console.log('\n========================================');
  if (failedTests === 0) {
    console.log('   ALL 28 RIGOROUS ENTERPRISE TESTS PASSED!  ');
    console.log('========================================\n');
    process.exit(0);
  } else {
    console.error(`   FAILED ${failedTests} TESTS! PLEASE FIX BEFORE DEPLOYING!`);
    console.log('========================================\n');
    process.exit(1);
  }
}

runRegressionSuite();
