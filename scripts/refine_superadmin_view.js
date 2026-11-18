const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'server.js');
let raw = fs.readFileSync(serverFile, 'utf8');
const isCrlf = raw.includes('\r\n');
let code = raw.replace(/\r\n/g, '\n');

// 1. Update /api/sellers/invites to use getSellerWhatsAppInfo
const oldInvitesAugment = `    const augmented = (data || []).map(inv => ({
      ...inv,
      live_status: sellerStatuses.get(inv.seller_id) || inv.status,
      live_number: sellerNumbers.get(inv.seller_id) || inv.phone || null
    }));`;

const newInvitesAugment = `    const augmented = (data || []).map(inv => {
      const waInfo = getSellerWhatsAppInfo(inv.seller_id);
      return {
        ...inv,
        live_status: waInfo.status,
        live_number: waInfo.number || inv.phone || null
      };
    });`;

if (code.includes(oldInvitesAugment)) {
  code = code.replace(oldInvitesAugment, newInvitesAugment);
  console.log('✓ 1. /api/sellers/invites updated with getSellerWhatsAppInfo');
} else {
  console.log('Note: /api/sellers/invites already updated or different');
}

// 2. Update badge on sellers tab header: replace "মাস্টার ওনার: Dawah Fashion..."
const oldMasterOwnerBadge = `<div class="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>মাস্টার ওনার: Dawah Fashion (+8801968718838)</span>
                </div>`;

const newMasterOwnerBadge = `<div class="bg-stone-800 border border-stone-700 text-amber-300 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span>সুপার অ্যাডমিন: সেন্ট্রাল প্ল্যাটফর্ম কন্ট্রোল (কোনো ব্যক্তিগত WhatsApp নেই)</span>
                </div>`;

if (code.includes(oldMasterOwnerBadge)) {
  code = code.replace(oldMasterOwnerBadge, newMasterOwnerBadge);
  console.log('✓ 2. Replaced master owner badge in sellers tab');
} else {
  console.log('Note: oldMasterOwnerBadge not found');
}

// 3. Update loadSellerInvites card buttons to include "ক্যাটালগ ইন্সপেক্ট 🔍"
const oldCardButtons = `'<a href="/connect?token=' + inv.invite_token + '" target="_blank" class="bg-white border border-stone-300 hover:border-stone-400 text-stone-700 text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'QR পেজ ↗' +
                  '</a>' +
                '</div>'`;

const newCardButtons = `'<a href="/connect?token=' + inv.invite_token + '" target="_blank" class="bg-white border border-stone-300 hover:border-stone-400 text-stone-700 text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'QR পেজ ↗' +
                  '</a>' +
                  '<a href="/dashboard?seller_id=' + inv.seller_id + '" class="bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-900 text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'ক্যাটালগ ইন্সপেক্ট 🔍' +
                  '</a>' +
                '</div>'`;

if (code.includes(oldCardButtons)) {
  code = code.replace(oldCardButtons, newCardButtons);
  console.log('✓ 3. Added catalog inspect button to shop cards');
}

// 4. Update page title
code = code.replace('<title>Dawah Fashion — স্মার্ট কন্ট্রোল প্যানেল</title>', '<title>AutoDokan Engine — সুপার অ্যাডমিন কমান্ড সেন্টার</title>');

// Restore CRLF if needed
if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(serverFile, code, 'utf8');
console.log('Refinements successfully applied to server.js!');
