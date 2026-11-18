const fs = require('fs');

let mp = fs.readFileSync('merchant_portal.js', 'utf8');
mp = mp.replace(/\r\n/g, '\n');

const hardFiveCheck = `      if (studioUploadedImages.length < 5) {
        alert('⚠️ প্রোডাক্ট সেভ করতে ন্যূনতম ৫টি বিভিন্ন অ্যাঙ্গেলের ছবি আপলোড করা আবশ্যক! বর্তমানে আছে: ' + studioUploadedImages.length + 'টি ছবি। দয়া করে আরও ' + (5 - studioUploadedImages.length) + 'টি ছবি যুক্ত করুন।');
        return;
      }`;

if (mp.includes(hardFiveCheck)) {
  mp = mp.replace(hardFiveCheck, `      if (studioUploadedImages.length === 0) {
        alert('⚠️ প্রোডাক্ট সেভ করতে অন্তত ১টি ছবি আপলোড করা আবশ্যক! ছবি ছাড়া কোনো প্রোডাক্ট সেভ হবে না।');
        return;
      }`);
  fs.writeFileSync('merchant_portal.js', mp, 'utf8');
  console.log('Removed strict 5-image restriction, enforced minimum 1 photo requirement!');
} else {
  console.log('hardFiveCheck block not found, checking manual string');
}
