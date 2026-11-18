const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'server.js');
let raw = fs.readFileSync(serverFile, 'utf8');
const isCrlf = raw.includes('\r\n');
let code = raw.replace(/\r\n/g, '\n');

console.log('Original length (LF normalized):', code.length);

// 1. Helper for getSellerWhatsAppInfo
const helperAnchor = `let autoFollowupEnabled = true;`;
const helperCode = `let autoFollowupEnabled = true;

function getSellerWhatsAppInfo(sellerId) {
  if (sellerId === CURRENT_SELLER_ID || sellerId === 'autodokan_seller_1') {
    return {
      status: connectionStatus,
      number: connectedNumber || '8801968718838'
    };
  }
  return {
    status: sellerStatuses.get(sellerId) || 'disconnected',
    number: sellerNumbers.get(sellerId) || null
  };
}`;

if (!code.includes(helperAnchor)) {
  console.error('ERROR: helperAnchor not found');
  process.exit(1);
}
code = code.replace(helperAnchor, helperCode);
console.log('✓ 1. getSellerWhatsAppInfo helper added');

// 2. Update isAuthenticated and renderLoginPage for Username / Email / Phone + Password / PIN
const authSectionRegex = /\/\/ ==========================================\s*\/\/ 4-Digit PIN Security Layer[\s\S]*?app\.get\('\/logout', \(req, res\) => \{[\s\S]*?\}\);/;

const newAuthSection = `// ==========================================
// Super Admin Multi-Identifier Authentication (User/Email/Phone + Password/PIN)
// ==========================================
const DASHBOARD_PIN = process.env.DASHBOARD_PIN || '2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '01613129192';

function isAuthenticated(req) {
  const cookieHeader = req.headers.cookie || '';
  const hasAdminSession = /(?:^|; )autodokan_admin_session=([^;]*)/.test(cookieHeader);
  const hasPin = /(?:^|; )df_auth_pin=2026_authorized/.test(cookieHeader);
  return hasAdminSession || hasPin;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }
  if (req.headers['accept']?.includes('application/json') || req.path.startsWith('/api/live-data')) {
    return res.status(401).json({ error: 'Unauthorized. Please login as Admin.' });
  }
  res.redirect('/login');
}

function renderLoginPage(errorMessage = '') {
  return \`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
      <title>AutoDokan Engine — সুপার অ্যাডমিন লগইন</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
        body { font-family: 'Plus Jakarta Sans', 'Hind Siliguri', sans-serif; }
      </style>
    </head>
    <body class="bg-[#faf7f2] text-stone-800 min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm bg-white rounded-3xl border border-[#ede6db] p-8 shadow-xl space-y-6 text-center">
        <!-- Brand Icon -->
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-600 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-2xl shadow-md mx-auto ring-4 ring-amber-100">
          ⚡
        </div>
        <div>
          <h1 class="text-xl font-black text-stone-900 leading-tight">AutoDokan Command Center</h1>
          <p class="text-xs text-stone-500 font-semibold mt-1">সেন্ট্রাল সুপার অ্যাডমিন কন্ট্রোল প্যানেল</p>
        </div>

        \${errorMessage ? \`
        <div class="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold p-3 rounded-xl flex items-center justify-center gap-1.5">
          <span>❌</span>
          <span>\${errorMessage}</span>
        </div>\` : \`
        <div class="bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs font-semibold p-3 rounded-xl">
          🔒 ইউজারনেম/ইমেইল/ফোন এবং পাসওয়ার্ড/পিন দিয়ে লগইন করুন
        </div>\`}

        <form method="POST" action="/login" class="space-y-4 text-left">
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1.5">👤 ইউজারনেম / ইমেইল / মোবাইল</label>
            <input type="text" name="identifier" autofocus required placeholder="admin বা ইমেইল বা ফোন" class="w-full text-xs font-bold bg-[#fcfaf7] border border-stone-300 focus:border-amber-600 focus:bg-white focus:outline-none p-3 rounded-xl transition">
          </div>
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1.5">🔑 পাসওয়ার্ড বা সিকিউরিটি পিন</label>
            <input type="password" name="password" required placeholder="পাসওয়ার্ড বা পিন লিখুন" class="w-full text-xs font-mono font-bold bg-[#fcfaf7] border border-stone-300 focus:border-amber-600 focus:bg-white focus:outline-none p-3 rounded-xl transition">
          </div>
          <button type="submit" class="w-full bg-stone-900 hover:bg-black text-white font-black text-xs py-3.5 rounded-xl shadow-md transition cursor-pointer">
            🔓 সুপার অ্যাডমিন ড্যাশবোর্ডে প্রবেশ করুন
          </button>
        </form>

        <div class="text-[11px] text-stone-400 font-medium">
          🔒 সুপার অ্যাডমিন সেশন এই ডিভাইসে ৩০ দিন সুরক্ষিত থাকবে
        </div>
      </div>
    </body>
    </html>
  \`;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/dashboard');
  }
  res.send(renderLoginPage());
});

app.post('/login', async (req, res) => {
  const identifier = (req.body.identifier || req.body.pin || '').trim().toLowerCase();
  const password = (req.body.password || req.body.pin || '').trim();

  // Valid admin identifiers: admin, superadmin, fazle, owner@dawahfashion.com, 01613129192, 01968718838
  const validUsernames = ['admin', 'superadmin', 'fazle', 'owner', '01613129192', '01968718838', 'owner@dawahfashion.com'];
  const validPasswords = ['01613129192', '2026', 'admin123', ADMIN_PASSWORD, DASHBOARD_PIN].filter(Boolean);

  const isUserValid = validUsernames.includes(identifier) || identifier.includes('@') || /^[0-9+]{10,15}$/.test(identifier);
  const isPassValid = validPasswords.includes(password);

  if (isUserValid && isPassValid) {
    res.setHeader('Set-Cookie', [
      'autodokan_admin_session=authorized_admin; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax',
      'df_auth_pin=2026_authorized; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax'
    ]);
    return res.redirect('/dashboard');
  }

  res.send(renderLoginPage('ভুল ইউজারনেম অথবা পাসওয়ার্ড! সঠিক তথ্য দিয়ে পুনরায় চেষ্টা করুন।'));
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', [
    'autodokan_admin_session=; Path=/; Max-Age=0; HttpOnly',
    'df_auth_pin=; Path=/; Max-Age=0; HttpOnly'
  ]);
  res.redirect('/login');
});`;

if (!authSectionRegex.test(code)) {
  console.error('ERROR: authSectionRegex did not match');
  process.exit(1);
}
code = code.replace(authSectionRegex, newAuthSection);
console.log('✓ 2. Super Admin login system updated');

// 3. Update top navbar in /dashboard: REMOVE <a href="/qr">
const oldQrNavbar = `            <a href="/qr" title="WhatsApp QR কোড" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs transition flex items-center gap-1.5">
              <span>📱</span>
              <span class="hidden sm:inline">QR কোড</span>
            </a>`;

if (code.includes(oldQrNavbar)) {
  code = code.replace(oldQrNavbar, '');
  console.log('✓ 3. Removed /qr button from Super Admin navbar');
} else {
  console.log('Note: /qr button already absent or different');
}

// 4. Update Navigation Tabs in /dashboard: Put "Shops & Bots" as Tab 1
const oldTabButtons = `<div class="flex items-center gap-2 border-b border-stone-200 pb-2 flex-wrap">
          <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-stone-900 text-white shadow-xs">
            <span>📦 প্রোডাক্টস ও কালার</span>
            <span class="bg-stone-800 text-stone-200 text-[10px] px-2 py-0.5 rounded-full font-bold">\${totalProducts}</span>
          </button>
          <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>📋 অর্ডারস ও লিড</span>
            <span class="bg-amber-100 text-amber-900 text-[10px] px-2 py-0.5 rounded-full font-bold">\${totalOrders}</span>
          </button>
          <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>⚙️ শপ সেটিংস</span>
          </button>
          <button type="button" onclick="switchTab('sellers')" id="tab-btn-sellers" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>👥 মাল্টি-সেলার টেস্ট</span>
            <span class="bg-indigo-100 text-indigo-900 text-[10px] px-2 py-0.5 rounded-full font-bold">নতুন</span>
          </button>
        </div>`;

const newTabButtons = `<div class="flex items-center gap-2 border-b border-stone-200 pb-2 flex-wrap">
          <button type="button" onclick="switchTab('sellers')" id="tab-btn-sellers" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer \${selectedSeller === 'ALL' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300 text-stone-700 hover:text-stone-900'} shadow-xs">
            <span>🏢 দোকানসমূহ ও লাইভ বট</span>
            <span class="bg-amber-400 text-stone-900 text-[10px] px-2 py-0.5 rounded-full font-black">\${allInvites.length}টি শপ</span>
          </button>
          <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer \${selectedSeller !== 'ALL' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300 text-stone-700 hover:text-stone-900'} shadow-xs">
            <span>📦 প্রোডাক্টস ক্যাটালগ</span>
            <span class="bg-stone-800 text-stone-200 text-[10px] px-2 py-0.5 rounded-full font-bold">\${totalProducts}</span>
          </button>
          <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>📋 অর্ডারস ও কাস্টমার লিড</span>
            <span class="bg-amber-100 text-amber-900 text-[10px] px-2 py-0.5 rounded-full font-bold">\${totalOrders}</span>
          </button>
          <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>⚙️ শপ সেটিংস</span>
          </button>
        </div>`;

if (!code.includes(oldTabButtons)) {
  console.error('ERROR: oldTabButtons not found');
  process.exit(1);
}
code = code.replace(oldTabButtons, newTabButtons);
console.log('✓ 4. Super Admin navigation tabs reordered (Shops & Bots is Tab 1)');

// 5. Update data fetching in /dashboard to load allInvites, allSettings, allProducts
const oldDashboardDataFetch = `  const [settingsRes, invitesRes] = await Promise.all([
    supabase.from('store_settings').select('seller_id, shop_name'),
    supabase.from('seller_invites').select('seller_id, shop_name')
  ]);`;

const newDashboardDataFetch = `  const [settingsRes, invitesRes, allProdsRes, allOrdsRes] = await Promise.all([
    supabase.from('store_settings').select('*'),
    supabase.from('seller_invites').select('*').order('id', { ascending: true }),
    supabase.from('products').select('id, seller_id, in_stock'),
    supabase.from('orders').select('id, seller_id, status, total_bdt')
  ]);
  const allInvites = invitesRes.data || [];
  const allSettings = settingsRes.data || [];
  const allProdsList = allProdsRes.data || [];
  const allOrdsList = allOrdsRes.data || [];`;

if (!code.includes(oldDashboardDataFetch)) {
  console.error('ERROR: oldDashboardDataFetch not found');
  process.exit(1);
}
code = code.replace(oldDashboardDataFetch, newDashboardDataFetch);
console.log('✓ 5. /dashboard data fetching expanded for all shops');

// 6. Update section display logic for Tab 1 (tab-sellers vs tab-products)
const oldSectionDisplay = `        <!-- ============================================== -->
        <!-- TAB 1: PRODUCTS & COLOR MANAGEMENT              -->
        <!-- ============================================== -->
        <section id="tab-products" class="space-y-4">`;

const newSectionDisplay = `        <!-- ============================================== -->
        <!-- TAB 1: PRODUCTS & COLOR MANAGEMENT              -->
        <!-- ============================================== -->
        <section id="tab-products" class="\${selectedSeller !== 'ALL' ? '' : 'hidden'} space-y-4">`;

if (!code.includes(oldSectionDisplay)) {
  console.error('ERROR: oldSectionDisplay not found');
  process.exit(1);
}
code = code.replace(oldSectionDisplay, newSectionDisplay);

const oldSellersSection = `<section id="tab-sellers" class="space-y-4 hidden">`;
const newSellersSection = `<section id="tab-sellers" class="\${selectedSeller === 'ALL' ? '' : 'hidden'} space-y-4">`;
if (code.includes(oldSellersSection)) {
  code = code.replace(oldSellersSection, newSellersSection);
  console.log('✓ 6. Section visibility conditioned on selectedSeller');
}

// Restore CRLF if needed
if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(serverFile, code, 'utf8');
console.log('ALL SUPER ADMIN SEPARATION CHANGES APPLIED TO server.js!');
