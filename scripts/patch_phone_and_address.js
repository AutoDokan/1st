const fs = require('fs');

let cb = fs.readFileSync('commerce_brain.js', 'utf8');
cb = cb.replace(/\r\n/g, '\n');

// 1. Add normalizeBdPhone and validateBdAddress utility functions
const utilityFns = `
// ==========================================
// BANGLADESHI PHONE & ADDRESS VALIDATION ENGINE
// ==========================================
function normalizeBdPhone(str) {
  if (!str) return null;
  // Convert Bengali numerals to English numerals
  const bnToEn = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
  let cleaned = str.toString().replace(/[০-৯]/g, d => bnToEn[d]);
  // Remove spaces, dashes, parentheses and non-digits except +
  cleaned = cleaned.replace(/[^0-9+]/g, '');
  // Match standard BD mobile: optional +88, 0088, or 88 prefix, then 01[3-9] followed by 8 digits
  const match = cleaned.match(/(?:(?:\\+|00)?88)?(01[3-9]\\d{8})(?!\\d)/);
  if (match) {
    return match[1]; // Standardized 11-digit format: 01XXXXXXXXX
  }
  return null;
}

function validateBdAddress(addr) {
  if (!addr || typeof addr !== 'string') return { valid: false, reason: 'EMPTY' };
  const clean = addr.trim();
  if (clean.length < 8) return { valid: false, reason: 'TOO_SHORT' };

  // Anti-Gibberish: Check word count
  const words = clean.split(/\\s+/).filter(w => w.length > 1);
  if (words.length < 2) return { valid: false, reason: 'NEED_AT_LEAST_TWO_WORDS' };

  // Anti-Gibberish: Reject consonant mash or keyboard mashing
  if (/^[bcdfghjklmnpqrstvwxyz]{6,}$/i.test(clean.replace(/[\\s\\d,.-]+/g, ''))) {
    return { valid: false, reason: 'CONSONANT_GIBBERISH' };
  }
  if (/(.)\\1{4,}/.test(clean)) {
    return { valid: false, reason: 'REPEATED_CHARS' };
  }

  // BD Locations, Districts, Thanas & Standard Structure Keywords
  const bdKeywordsRegex = /(?:ঢাকা|dhaka|চট্টগ্রাম|chittagong|ctg|সিলেট|sylhet|রাজশাহী|rajshahi|খুলনা|khulna|বরিশাল|barisal|রংপুর|rangpur|ময়মনসিংহ|mymensingh|গাজীপুর|gazipur|নারায়ণগঞ্জ|narayanganj|কুমিল্লা|comilla|বগুড়া|bogra|ফেনী|feni|নোয়াখালী|noakhali|যশোর|jessore|পাবনা|pabna|কুষ্টিয়া|kushtia|সিরাজগঞ্জ|sirajganj|টাঙ্গাইল|tangail|কিশোরগঞ্জ|kishoreganj|কক্সবাজার|cox|ব্রাহ্মণবাড়িয়া|b-baria|মানিকগঞ্জ|মুন্সীগঞ্জ|নরসিংদী|ফরিদপুর|মাদারীপুর|গোপালগঞ্জ|শরীয়তপুর|জামালপুর|শেরপুর|নেত্রকোণা|হবিগঞ্জ|মৌলভীবাজার|সুনামগঞ্জ|চাঁদপুর|লক্ষ্মীপুর|রাঙ্গামাটি|বান্দরবান|খাগড়াছড়ি|নাটোর|নওগাঁ|চাঁপাইনবাবগঞ্জ|জয়পুরহাট|দিনাজপুর|ঠাকুরগাঁও|পঞ্চগড়|নীলফামারী|লালমনিরহাট|কুড়িগ্রাম|গাইবান্ধা|চুয়াডাঙ্গা|মেহেরপুর|ঝিনাইদহ|মাগুরা|নড়াইল|বাগেরহাট|সাতক্ষীরা|ঝালকাঠি|পিরোজপুর|পটুয়াখালী|বরগুনা|ভোলা|মিরপুর|mirpur|উত্তরা|uttara|গুলশান|gulshan|বনানী|banani|ধানমন্ডি|dhanmondi|মোহাম্মদপুর|mohammadpur|বসুন্ধরা|bashundhara|বাড্ডা|badda|খিলগাঁও|khilgaon|যাত্রাবাড়ী|jatrabari|মতিঝিল|motijheel|তেজগাঁও|tejgaon|ফার্মগেট|farmgate|আজিমপুর|azimpur|কেরানীগঞ্জ|keraniganj|সাভার|savar|টঙ্গী|tongi|বাসা|house|হোল্ডিং|holding|বাড়ি|bari|রোড|road|rd|গ্রাম|gram|village|ডাকঘর|পোস্ট|post|থানা|thana|উপজেলা|upazila|জেলা|zila|district|সেক্টর|sector|ব্লক|block|লেন|lane|গলি|মোড়|বাজার|bazar|মার্কেট|market|ফ্ল্যাট|flat|তলা|floor)/i;

  if (!bdKeywordsRegex.test(clean)) {
    return { valid: false, reason: 'NO_BD_LANDMARK_OR_KEYWORD' };
  }

  return { valid: true, clean };
}
`;

if (!cb.includes('function normalizeBdPhone')) {
  cb = cb.replace('function cleanHumanFormatting(text) {', `${utilityFns}\nfunction cleanHumanFormatting(text) {`);
  console.log('[1/3] Added normalizeBdPhone and validateBdAddress');
} else {
  console.log('[1/3] normalizeBdPhone already exists');
}

// 2. Enhance extractAndSaveOrderLead with strict check
const oldExtractValidation = `      // Validate 11-digit Bangladeshi mobile number
      const rawDigits = ((parsed.customer_phone || senderPhone || '').split('@')[0]).replace(/\\D/g, '');
      const validBdPhone = /(?:01[3-9]\\d{8})/.test(rawDigits) ? rawDigits.match(/(01[3-9]\\d{8})/)[1] : (rawDigits.length === 11 ? rawDigits : null);
      const targetPhone = validBdPhone || rawDigits;

      // Validate meaningful address
      const rawAddr = (parsed.address || '').trim();
      const isMeaningfulAddress = rawAddr.length >= 6 && /(?:ঢাকা|dhaka|চট্টগ্রাম|খুলনা|রাজশাহী|সিলেট|বরিশাল|রংপুর|ময়মনসিংহ|থানা|জেলা|রোড|বাসা|গ্রাম|উপজেলা|বাজার|মোড়|মিরপুর|উত্তরা|গুলশান|ধানমন্ডি|বসুন্ধরা|গাজীপুর|নারায়ণগঞ্জ|কুমিল্লা|বগুড়া|হাউজ|house|road|sector|block|thana|district|flat|floor)/i.test(rawAddr);

      // Do NOT create fake orders if both valid phone and meaningful address are absent
      if (!validBdPhone && !isMeaningfulAddress) {
        return;
      }`;

const newExtractValidation = `      // Validate 11-digit Bangladeshi mobile number (handles +88, copy-paste, spaces, Bangla digits)
      const extractedPhone = parsed.customer_phone || senderPhone || '';
      const validBdPhone = normalizeBdPhone(extractedPhone);

      // Validate meaningful address
      const addrRes = validateBdAddress(parsed.address);
      const isMeaningfulAddress = addrRes.valid;
      const cleanAddress = addrRes.clean || (parsed.address || '').trim();

      // STRICT ORDER GUARD: BOTH a verified 11-digit BD mobile phone AND a meaningful address are MANDATORY before creating an order lead!
      if (!validBdPhone || !isMeaningfulAddress) {
        if (parsed.customer_notes && session) session.customer_notes = parsed.customer_notes;
        if (parsed.customer_name && session) session.customer_name = parsed.customer_name;
        return;
      }
      const targetPhone = validBdPhone;`;

if (cb.includes(oldExtractValidation)) {
  cb = cb.replace(oldExtractValidation, newExtractValidation);
  console.log('[2/3] Replaced oldExtractValidation with strict mandatory validation');
} else {
  console.warn('[2/3] oldExtractValidation block not matched');
}

// Also ensure cleanAddress is passed to orders update/insert
cb = cb.replace(
  `address: parsed.address || existing.address,`,
  `address: cleanAddress || existing.address,`
);
cb = cb.replace(
  `address: parsed.address || null,`,
  `address: cleanAddress || null,`
);

// 3. Update buildSystemPrompt with instructions for +88 and address
const oldPromptOrderSection = `   - ধাপ ১: মডেল এবং সাইজ উভয়ই নিশ্চিত হওয়ার পর (অথবা কাস্টমার সরাসরি "অর্ডার করব / নিতে চাই" বললে) বুকিংয়ের জন্য কাস্টমারের নাম, সম্পূর্ণ ডেলিভারি ঠিকানা ও মোবাইল নম্বর চাও।`;

const newPromptOrderSection = `   - ধাপ ১: মডেল এবং সাইজ উভয়ই নিশ্চিত হওয়ার পর (অথবা কাস্টমার সরাসরি "অর্ডার করব / নিতে চাই" বললে) বুকিংয়ের জন্য কাস্টমারের নাম, সম্পূর্ণ ডেলিভারি ঠিকানা ও মোবাইল নম্বর চাও।
   - মোবাইল নম্বর ভ্যালিডেশন (+88 ও কপি-পেস্ট সাপোর্ট):
     * কাস্টমার ফোন নম্বর কপি-পেস্ট করে দিলে বা +88 সহ দিলে (যেমন: +8801712345678 বা 8801712345678 বা ০১৭...) স্বাভাবিকভাবে গ্রহণ করবে এবং সামারিতে ১১ ডিজিটের স্ট্যান্ডার্ড নম্বরে দেখাবে।
     * ভুল, অসম্পূর্ণ বা ভুয়া নম্বর (যেমন: ৮ ডিজিট, ১০ ডিজিট, বা 01 ছাড়া অন্য কোনো সংখ্যা যেমন 8275727282) দিলে কখনই অর্ডার কনফার্ম করবে না। বলবে: "আপনার মোবাইল নম্বরটি সঠিক নয় বা কিছু সংখ্যা কম আছে বলে মনে হচ্ছে। দয়া করে আপনার চালু থাকা সঠিক ১১ ডিজিটের মোবাইল নম্বরটি দিন (যেমন: 017XXXXXXXX)।"
   - ডেলিভারি ঠিকানা ভ্যালিডেশন:
     * কাস্টমারের ঠিকানা অবশ্যই স্পষ্ট ও সম্পূর্ণ হতে হবে (বাসা/রোড নম্বর, এলাকা/থানা এবং জেলা)।
     * অসম্পূর্ণ বা কিবোর্ড ম্যাশ করা অক্ষর (যেমন: kjhvsh, abc, asdfgh) দিলে বলবে: "পার্সেল সঠিক ঠিকানায় দ্রুত ডেলিভারি করার জন্য দয়া করে আপনার বিস্তারিত ঠিকানা দিন (বাসা/হোল্ডিং নম্বর, রোড, এলাকা/থানা ও জেলা)।"`;

if (cb.includes(oldPromptOrderSection)) {
  cb = cb.replace(oldPromptOrderSection, newPromptOrderSection);
  console.log('[3/3] Enhanced buildSystemPrompt with +88 phone & address validation instructions');
} else {
  console.warn('[3/3] oldPromptOrderSection not matched');
}

fs.writeFileSync('commerce_brain.js', cb, 'utf8');
console.log('Finished updating commerce_brain.js!');
