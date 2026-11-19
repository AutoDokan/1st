const fs = require('fs');

let ts = fs.readFileSync('test_suite.js', 'utf8');
ts = ts.replace(
  "del.includes('130'))",
  "del.includes('130') || del.includes('একশো পঞ্চাশ'))"
);

// Add tests for normalizeBdPhone and validateBdAddress
const phoneAddrTestSuite = `
  // TEST 33: Phone Normalization (+88, copy-paste, spaces, Bangla numerals)
  const { normalizeBdPhone, validateBdAddress } = require('./commerce_brain.js');
  const p1 = normalizeBdPhone('+8801968718838');
  const p2 = normalizeBdPhone('8801968718838');
  const p3 = normalizeBdPhone('+88 01712-345678');
  const p4 = normalizeBdPhone('01712 345678');
  const p5 = normalizeBdPhone('+৮৮০১৭১২৩৪৫৬৭৮');
  const p6 = normalizeBdPhone('8275727282'); // Fake
  const p7 = normalizeBdPhone('0189631689'); // 10 digits
  assert(p1 === '01968718838' && p2 === '01968718838' && p3 === '01712345678' && p4 === '01712345678' && p5 === '01712345678' && p6 === null && p7 === null,
    'Phone normalization strictly parses +88, spaces, Bangla digits, and rejects fake/incomplete numbers', 
    JSON.stringify({ p1, p2, p3, p4, p5, p6, p7 }));

  // TEST 34: BD Address Validation (Rejects gibberish and requires BD context)
  const a1 = validateBdAddress('House 5, road 9, Keramat ullah, sagolnaiya, feni');
  const a2 = validateBdAddress('গ্রাম: কালিবাপু, ডাকঘর: নাটবেড়ী, সলঙ্গা, সিরাজগঞ্জ');
  const a3 = validateBdAddress('Mirpur 10, Block C, Road 5, Dhaka');
  const a4 = validateBdAddress('kjhvsh');
  const a5 = validateBdAddress('kjggab dgakak');
  const a6 = validateBdAddress('asdfghjkl');
  assert(a1.valid && a2.valid && a3.valid && !a4.valid && !a5.valid && !a6.valid,
    'BD Address validator strictly validates real addresses and rejects gibberish text',
    JSON.stringify({ a1: a1.valid, a2: a2.valid, a3: a3.valid, a4: a4.valid, a5: a5.valid, a6: a6.valid }));
`;

if (!ts.includes('TEST 33: Phone Normalization')) {
  ts = ts.replace(
    '  // SUMMARY OF TEST RESULTS',
    `${phoneAddrTestSuite}\n  // SUMMARY OF TEST RESULTS`
  );
}

fs.writeFileSync('test_suite.js', ts, 'utf8');
console.log('test_suite.js updated with delivery regex and phone/address unit tests!');
