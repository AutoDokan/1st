const { handleIncomingMessage, refreshProductsFromDB, getProductByCode } = require('./borkha_brain.js');

async function runRegressionSuite() {
  console.log('--- STARTING REGRESSION TEST SUITE ---');
  await refreshProductsFromDB();

  // Test 1: Height to Size Recommender (Screenshot 1)
  const q1 = await handleIncomingMessage('reg_user_1', 'আমার উচ্চতা ৫ ফুট ৩ ইঞ্চি, কোন সাইজ লাগবে?');
  console.log('\n[TEST 1 - Height Sizing]:', q1.includes('৫২ ইঞ্চি') ? 'PASS' : 'FAIL');
  if (!q1.includes('৫২ ইঞ্চি')) console.log('Output was:\n', q1);

  // Test 2: Delivery Timeline & Charge (Screenshot 2)
  const q2 = await handleIncomingMessage('reg_user_2', 'ঢাকার বাইরে ডেলিভারি কয়দিনে দেন এবং চার্জ কত?');
  console.log('\n[TEST 2 - Delivery Timeline & Charge]:', (q2.includes('২৪ থেকে ৪৮') && q2.includes('২ থেকে ৩')) ? 'PASS' : 'FAIL');
  if (!q2.includes('২ থেকে ৩')) console.log('Output was:\n', q2);

  // Test 3: 2-Piece Combo Offer (Screenshot 3)
  const q3 = await handleIncomingMessage('reg_user_3', 'আমি ২ পিস নিলে কিছু ছাড় দিবেন?');
  console.log('\n[TEST 3 - 2-Piece Combo Offer]:', q3.includes('কম্বো অফারে') ? 'PASS' : 'FAIL');
  if (!q3.includes('কম্বো অফারে')) console.log('Output was:\n', q3);

  // Test 4: Open Parcel Inspection (Screenshot 4)
  const q4 = await handleIncomingMessage('reg_user_4', 'পার্সেল কি ডেলিভারি ম্যানের সামনে খুলে দেখা যাবে?');
  console.log('\n[TEST 4 - Open Parcel]:', q4.includes('খুলে দেখে-শুনে') ? 'PASS' : 'FAIL');
  if (!q4.includes('খুলে দেখে-শুনে')) console.log('Output was:\n', q4);

  // Test 5: Fabric Thinness & Transparency (Screenshot 5)
  const q5 = await handleIncomingMessage('reg_user_5', 'কাপড় কি পাতলা নাকি শালীনভাবে কভার হবে?');
  console.log('\n[TEST 5 - Fabric Quality]:', q5.includes('মোটেও পাতলা নয়') || q5.includes('একেবারেই পাতলা') || q5.includes('নন-ট্রান্সপারেন্ট') ? 'PASS' : 'FAIL');
  if (!q5.includes('পাতলা')) console.log('Output was:\n', q5);

  // Test 6: Memory - Model Retention
  await handleIncomingMessage('reg_user_6', 'DF-102 এর রিয়েল ছবি দিন');
  const q6 = await handleIncomingMessage('reg_user_6', '🛒 অর্ডার কনফার্ম করতে চাই');
  console.log('\n[TEST 6 - Model Memory]:', q6.includes('DF-102') ? 'PASS' : 'FAIL');
  if (!q6.includes('DF-102')) console.log('Output was:\n', q6);

  // Test 7: Verify No 🌸 Emojis Anywhere in Replies
  const allReplies = [q1, q2, q3, q4, q5, q6].join(' ');
  console.log('\n[TEST 7 - Zero Flower Emoji]:', !allReplies.includes('🌸') ? 'PASS' : 'FAIL');

  console.log('\n--- REGRESSION SUITE COMPLETED ---');
  process.exit(0);
}

runRegressionSuite();
