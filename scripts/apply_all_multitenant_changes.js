const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'server.js');
let raw = fs.readFileSync(serverFile, 'utf8');
const isCrlf = raw.includes('\r\n');
let code = raw.replace(/\r\n/g, '\n');

console.log('Original length (LF normalized):', code.length);

// 1. Update /api/settings/update
const targetSettingsRegex = /const updatePayload = \{\s*id: 1,\s*seller_id: CURRENT_SELLER_ID,[\s\S]*?await refreshSettingsFromDB\(\);\s*await refreshProductsFromDB\(\);/;

const replacementSettings = `const targetSeller = req.body.seller_id || CURRENT_SELLER_ID;
  const updatePayload = {
    seller_id: targetSeller,
    inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
    outside_dhaka_fee: Number(outside_dhaka_fee) || 120,
    bkash_number: (bkash_number || '01613-129192').trim(),
    nagad_number: (nagad_number || '01677-557292').trim(),
    promo_offer: (promo_offer !== undefined ? promo_offer : '').trim(),
    extra_config: currentExtra,
    updated_at: new Date().toISOString()
  };

  if (shop_name !== undefined) updatePayload.shop_name = shop_name.trim();
  if (return_policy !== undefined) updatePayload.return_policy = return_policy.trim();
  if (free_delivery_min_amount !== undefined) updatePayload.free_delivery_min_amount = Number(free_delivery_min_amount) || 0;

  const { data: existSetting } = await supabase.from('store_settings').select('id').eq('seller_id', targetSeller).maybeSingle();
  if (existSetting?.id) {
    updatePayload.id = existSetting.id;
    await supabase.from('store_settings').update(updatePayload).eq('id', existSetting.id);
  } else {
    await supabase.from('store_settings').insert(updatePayload);
  }
  await refreshSettingsFromDB(targetSeller);
  await refreshProductsFromDB(targetSeller);`;

if (!targetSettingsRegex.test(code)) {
  console.error('ERROR: targetSettingsRegex did not match');
  process.exit(1);
}
code = code.replace(targetSettingsRegex, replacementSettings);
console.log('✓ 1. /api/settings/update updated');

// 2. Update /api/add-product
const targetAddProdRegex = /const \{ data, error \} = await supabase\.from\('products'\)\.insert\(\{\s*seller_id: CURRENT_SELLER_ID,[\s\S]*?await refreshProductsFromDB\(\);/;

const replacementAddProd = `const targetSeller = req.body.seller_id || CURRENT_SELLER_ID;
    const { data, error } = await supabase.from('products').insert({
      seller_id: targetSeller,
      model_code: cleanCode,
      name: name.trim(),
      fabric: fabric || 'দুবাই চেরি',
      price: discPrice || parsedPrice,
      regular_price: regPrice,
      discount_price: discPrice,
      stock_quantity: stockQty,
      colors: colors ? colors.trim() : null,
      search_keywords: search_keywords ? search_keywords.trim() : null,
      short_description: short_description ? short_description.trim() : null,
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === true || hijab_included === 'true',
      image_url: image_url ? image_url.trim() : null,
      hijab_image_url: hijab_image_url ? hijab_image_url.trim() : null,
      detail_image_url: detail_image_url ? detail_image_url.trim() : null,
      flare_image_url: flare_image_url ? flare_image_url.trim() : null,
      real_image_url: real_image_url ? real_image_url.trim() : null,
      in_stock: in_stock === undefined ? true : (in_stock === true || in_stock === 'true')
    }).select();
    if (!error && data && data.length > 0) insertedItem = data[0];
    await refreshProductsFromDB(targetSeller);`;

if (!targetAddProdRegex.test(code)) {
  console.error('ERROR: targetAddProdRegex did not match');
  process.exit(1);
}
code = code.replace(targetAddProdRegex, replacementAddProd);
console.log('✓ 2. /api/add-product updated');

// 3. Update /dashboard route query logic
const targetDashboardHead = `app.get('/dashboard', requireAuth, async (req, res) => {
  const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
  const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
  const { data: storeSettings } = await supabase.from('store_settings').select('*').eq('id', 1).single();
  const curSettings = storeSettings || { inside_dhaka_fee: 80, outside_dhaka_fee: 150, bkash_number: '01613-129192', nagad_number: '01677-557292' };`;

const replacementDashboardHead = `app.get('/dashboard', requireAuth, async (req, res) => {
  const selectedSeller = req.query.seller_id || 'ALL';

  // Fetch distinct shops for switcher dropdown
  const [settingsRes, invitesRes] = await Promise.all([
    supabase.from('store_settings').select('seller_id, shop_name'),
    supabase.from('seller_invites').select('seller_id, shop_name')
  ]);

  const shopMap = new Map();
  shopMap.set('autodokan_seller_1', 'Dawah Fashion');
  (settingsRes.data || []).forEach(s => {
    if (s.seller_id) shopMap.set(s.seller_id, s.shop_name || s.seller_id);
  });
  (invitesRes.data || []).forEach(i => {
    if (i.seller_id) shopMap.set(i.seller_id, i.shop_name || i.seller_id);
  });

  const storeOptions = [
    { id: 'ALL', name: '🌐 সবগুলো শপ একসাথে (All Stores)' },
    ...Array.from(shopMap.entries()).map(([id, name]) => ({
      id,
      name: id === 'autodokan_seller_1' ? name + ' (মাস্টার শপ)' : name
    }))
  ];

  let ordersQuery = supabase.from('orders').select('*').order('id', { ascending: false });
  let productsQuery = supabase.from('products').select('*').order('id', { ascending: true });

  if (selectedSeller !== 'ALL') {
    ordersQuery = ordersQuery.eq('seller_id', selectedSeller);
    productsQuery = productsQuery.eq('seller_id', selectedSeller);
  }

  const [{ data: orders }, { data: products }] = await Promise.all([
    ordersQuery,
    productsQuery
  ]);

  let storeSettings = null;
  if (selectedSeller !== 'ALL') {
    const { data: s } = await supabase.from('store_settings').select('*').eq('seller_id', selectedSeller).maybeSingle();
    storeSettings = s;
  }
  if (!storeSettings) {
    const { data: s1 } = await supabase.from('store_settings').select('*').eq('id', 1).maybeSingle();
    storeSettings = s1;
  }
  const curSettings = storeSettings || { inside_dhaka_fee: 80, outside_dhaka_fee: 150, bkash_number: '01613-129192', nagad_number: '01677-557292' };`;

if (!code.includes(targetDashboardHead)) {
  console.error('ERROR: targetDashboardHead not found');
  process.exit(1);
}
code = code.replace(targetDashboardHead, replacementDashboardHead);
console.log('✓ 3. /dashboard query & shop switcher data updated');

// 4. Update product cards in /dashboard to show shop badge when ALL
const targetCardTop = `<span class="font-mono font-black text-xs text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">\${p.model_code || 'DF'}</span>
            <button type="button" onclick="toggleStockLive(\${p.id}, \${p.in_stock ? 'false' : 'true'})" class="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition \${p.in_stock ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'}">
              \${p.in_stock ? '● ইন-স্টক' : '✕ স্টক আউট'}
            </button>
          </div>
          <h3 class="font-black text-stone-900 text-sm mt-1 truncate" title="\${p.name}">\${p.name}</h3>`;

const replacementCardTop = `<span class="font-mono font-black text-xs text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">\${p.model_code || 'DF'}</span>
            <button type="button" onclick="toggleStockLive(\${p.id}, \${p.in_stock ? 'false' : 'true'})" class="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition \${p.in_stock ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'}">
              \${p.in_stock ? '● ইন-স্টক' : '✕ স্টক আউট'}
            </button>
          </div>
          \${selectedSeller === 'ALL' ? '<div class="mt-1"><span class="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-md inline-block">🏪 ' + (shopMap.get(p.seller_id) || p.seller_id || 'Dawah Fashion') + '</span></div>' : ''}
          <h3 class="font-black text-stone-900 text-sm mt-1 truncate" title="\${p.name}">\${p.name}</h3>`;

if (!code.includes(targetCardTop)) {
  console.error('ERROR: targetCardTop not found');
  process.exit(1);
}
code = code.replace(targetCardTop, replacementCardTop);
console.log('✓ 4. /dashboard product card shop badge updated');

// 5. Update order rows in /dashboard to show shop badge when ALL
const targetOrderRowTop = `<td class="p-3">
        <div class="font-mono font-black text-xs text-stone-900">#\${o.id}</div>
        <div class="text-[10px] text-stone-400 mt-0.5">\${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
      </td>`;

const replacementOrderRowTop = `<td class="p-3">
        <div class="font-mono font-black text-xs text-stone-900">#\${o.id}</div>
        <div class="text-[10px] text-stone-400 mt-0.5">\${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
        \${selectedSeller === 'ALL' ? '<div class="mt-1"><span class="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[9px] font-bold px-1.5 py-0.5 rounded">🏪 ' + (shopMap.get(o.seller_id) || o.seller_id || 'Dawah Fashion') + '</span></div>' : ''}
      </td>`;

if (!code.includes(targetOrderRowTop)) {
  console.error('ERROR: targetOrderRowTop not found');
  process.exit(1);
}
code = code.replace(targetOrderRowTop, replacementOrderRowTop);
console.log('✓ 5. /dashboard order rows shop badge updated');

// 6. Update top header navbar with Shop Switcher dropdown
const targetNavbarRegex = /<!-- Top Sticky Dark Navbar -->\s*<header class="bg-stone-900 text-white sticky top-0 z-40 px-4 py-3 shadow-md border-b border-stone-800">[\s\S]*?<\/header>/;

const replacementNavbar = `<!-- Top Sticky Dark Navbar with Shop Switcher -->
      <header class="bg-stone-900 text-white sticky top-0 z-40 px-4 py-3 shadow-md border-b border-stone-800">
        <div class="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-base shadow-sm ring-2 ring-amber-400/30">
              ⚡
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="font-black text-base text-white leading-none">AutoDokan Master Admin</h1>
                <span class="bg-amber-400/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded border border-amber-400/30">Super Admin</span>
              </div>
              <div class="flex items-center gap-2 mt-1">
                <div class="inline-flex items-center gap-1.5 bg-stone-800 border border-stone-700 text-stone-300 text-[11px] px-2.5 py-0.5 rounded-full font-bold">
                  <span class="text-amber-400">🏪 সক্রিয় শপ:</span>
                  <span class="text-white">\${selectedSeller === 'ALL' ? 'সবগুলো শপ একসাথে' : (shopMap.get(selectedSeller) || selectedSeller)}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Shop Switcher & Quick Actions -->
          <div class="flex items-center gap-2.5 flex-wrap">
            <div class="flex items-center bg-stone-800 border border-amber-500/50 rounded-xl px-2.5 py-1.5 shadow-inner">
              <span class="text-xs mr-1.5">🏪</span>
              <select onchange="window.location.href='/dashboard?seller_id=' + this.value" class="bg-transparent text-amber-300 font-black text-xs outline-none cursor-pointer">
                \${storeOptions.map(opt => '<option value="' + opt.id + '" class="bg-stone-900 text-white font-bold" ' + (selectedSeller === opt.id ? 'selected' : '') + '>' + opt.name + '</option>').join('')}
              </select>
            </div>
            <a href="/qr" title="WhatsApp QR কোড" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs transition flex items-center gap-1.5">
              <span>📱</span>
              <span class="hidden sm:inline">QR কোড</span>
            </a>
            <a href="/api/export-csv" title="এক্সেল ডাউনলোড" class="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-xl text-xs font-black shadow-2xs flex items-center gap-1.5 transition">
              <span>📥</span>
              <span class="hidden sm:inline">CSV</span>
            </a>
            <a href="/logout" title="লগআউট" class="text-stone-400 hover:text-white px-2 py-2 text-xs transition">
              🔒
            </a>
          </div>
        </div>
      </header>`;

if (!targetNavbarRegex.test(code)) {
  console.error('ERROR: targetNavbarRegex did not match');
  process.exit(1);
}
code = code.replace(targetNavbarRegex, replacementNavbar);
console.log('✓ 6. /dashboard navbar and Shop Switcher updated');

// 7. Update Add Product client-side script to pass selected seller_id
const targetSaveNewProd = `          const payload = {
            model_code: document.getElementById('add_code').value.toUpperCase().trim(),`;

const replacementSaveNewProd = `          const payload = {
            seller_id: '\${selectedSeller === "ALL" ? "autodokan_seller_1" : selectedSeller}',
            model_code: document.getElementById('add_code').value.toUpperCase().trim(),`;

if (!code.includes(targetSaveNewProd)) {
  console.error('ERROR: targetSaveNewProd not found');
  process.exit(1);
}
code = code.replace(targetSaveNewProd, replacementSaveNewProd);
console.log('✓ 7. saveNewProduct seller_id scoping updated');

// 8. Update Save Store Settings client-side script to pass selected seller_id
const targetSaveSettings = `          const payload = {
            shop_name: document.getElementById('set_shop_name').value.trim(),`;

const replacementSaveSettings = `          const payload = {
            seller_id: '\${selectedSeller === "ALL" ? "autodokan_seller_1" : selectedSeller}',
            shop_name: document.getElementById('set_shop_name').value.trim(),`;

if (!code.includes(targetSaveSettings)) {
  console.error('ERROR: targetSaveSettings not found');
  process.exit(1);
}
code = code.replace(targetSaveSettings, replacementSaveSettings);
console.log('✓ 8. saveStoreSettingsLive seller_id scoping updated');

// 9. Update Sellers Tab invite cards to show Merchant Portal link
const targetInviteCard = `              return '<div class="bg-[#fcfaf7] border border-stone-200 rounded-xl p-3.5 flex items-center justify-between flex-wrap gap-2">' +
                '<div>' +
                  '<div class="flex items-center gap-2">' +
                    '<h4 class="font-black text-sm text-stone-900">' + inv.shop_name + '</h4>' +
                    statusBadge +
                  '</div>' +
                  '<p class="text-xs text-stone-500 mt-0.5 font-medium">' +
                    (inv.owner_name ? 'ওনার: ' + inv.owner_name + ' • ' : '') +
                    'আইডি: <span class="font-mono text-[11px] text-stone-700">' + inv.seller_id + '</span> • ' +
                    'তারিখ: ' + (inv.created_at ? new Date(inv.created_at).toLocaleDateString('bn-BD') : 'আজ') +
                  '</p>' +
                '</div>' +
                '<div class="flex items-center gap-2">' +
                  '<button type="button" data-url="' + invUrl + '" onclick="copyInviteLink(this.dataset.url)" class="bg-white border border-stone-300 hover:border-stone-400 text-stone-700 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer">' +
                    'কপি লিংক' +
                  '</button>' +
                  '<a href="/connect?token=' + inv.invite_token + '" target="_blank" class="bg-stone-900 hover:bg-black text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'QR পেজ খুলুন ↗' +
                  '</a>' +
                '</div>' +
              '</div>';`;

const replacementInviteCard = `              const portalUrl = window.location.origin + '/portal?token=' + inv.invite_token;
              return '<div class="bg-[#fcfaf7] border border-stone-200 rounded-xl p-3.5 flex items-center justify-between flex-wrap gap-2">' +
                '<div>' +
                  '<div class="flex items-center gap-2">' +
                    '<h4 class="font-black text-sm text-stone-900">' + inv.shop_name + '</h4>' +
                    statusBadge +
                  '</div>' +
                  '<p class="text-xs text-stone-500 mt-0.5 font-medium">' +
                    (inv.owner_name ? 'ওনার: ' + inv.owner_name + ' • ' : '') +
                    'আইডি: <span class="font-mono text-[11px] text-stone-700">' + inv.seller_id + '</span> • ' +
                    'তারিখ: ' + (inv.created_at ? new Date(inv.created_at).toLocaleDateString('bn-BD') : 'আজ') +
                  '</p>' +
                '</div>' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                  '<button type="button" data-url="' + portalUrl + '" onclick="copyInviteLink(this.dataset.url)" class="bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer">' +
                    'মার্চেন্ট পোর্টাল লিংক 📋' +
                  '</button>' +
                  '<a href="' + portalUrl + '" target="_blank" class="bg-stone-900 hover:bg-black text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'পোর্টাল খুলুন ↗' +
                  '</a>' +
                  '<a href="/connect?token=' + inv.invite_token + '" target="_blank" class="bg-white border border-stone-300 hover:border-stone-400 text-stone-700 text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'QR পেজ ↗' +
                  '</a>' +
                '</div>' +
              '</div>';`;

if (!code.includes(targetInviteCard)) {
  console.error('ERROR: targetInviteCard not found');
  process.exit(1);
}
code = code.replace(targetInviteCard, replacementInviteCard);
console.log('✓ 9. Sellers tab invite card links updated');

// 10. Update /connect route for 1-time redirect
const targetConnectRoute = `  // Auto-start session if not active
  if (!sellerSockets.has(inv.seller_id)) {
    startSellerSession(inv.seller_id);
  }`;

const replacementConnectRoute = `  // 1-Time Invite Flow: If already connected, redirect directly to Merchant Portal
  const isAlreadyConnected = sellerStatuses.get(inv.seller_id) === 'connected' || inv.status === 'CONNECTED';
  if (isAlreadyConnected) {
    return res.redirect('/portal?token=' + encodeURIComponent(token));
  }

  // Auto-start session if not active
  if (!sellerSockets.has(inv.seller_id)) {
    startSellerSession(inv.seller_id);
  }`;

if (!code.includes(targetConnectRoute)) {
  console.error('ERROR: targetConnectRoute not found');
  process.exit(1);
}
code = code.replace(targetConnectRoute, replacementConnectRoute);
console.log('✓ 10. /connect 1-time redirect added');

// 11. Update /connect client script to auto-redirect after scanning
const targetConnectClient = `        if (curStatus === 'connected') {
          const numDisplay = data.number ? (data.number.startsWith('+') ? data.number : '+' + data.number) : '';
          const rawNum = (data.number || '').replace(/[^0-9]/g, '');

          banner.className = 'bg-emerald-50 border border-emerald-300 text-emerald-900 p-3.5 rounded-2xl text-xs font-black flex items-center justify-center gap-2';
          statusText.innerText = '🎉 হোয়াটসঅ্যাপ সফলভাবে কানেক্ট হয়েছে! নম্বর: ' + numDisplay;`;

const replacementConnectClient = `        if (curStatus === 'connected') {
          const numDisplay = data.number ? (data.number.startsWith('+') ? data.number : '+' + data.number) : '';
          const rawNum = (data.number || '').replace(/[^0-9]/g, '');

          banner.className = 'bg-emerald-50 border border-emerald-300 text-emerald-900 p-3.5 rounded-2xl text-xs font-black flex items-center justify-center gap-2';
          statusText.innerText = '🎉 হোয়াটসঅ্যাপ সফলভাবে কানেক্ট হয়েছে! নম্বর: ' + numDisplay + ' (মার্চেন্ট পোর্টালে নিয়ে যাওয়া হচ্ছে...)';
          setTimeout(function() {
            window.location.href = '/portal?token=' + encodeURIComponent(token);
          }, 2000);`;

if (!code.includes(targetConnectClient)) {
  console.error('ERROR: targetConnectClient not found');
  process.exit(1);
}
code = code.replace(targetConnectClient, replacementConnectClient);
console.log('✓ 11. /connect client script redirect added');

// 12. Mount Merchant Portal Router right before Helper Functions
const targetRouterMountAnchor = `// ==========================================
// Smart Helper Functions (Payment, Human Takeover, Auto Courier)
// ==========================================`;

const replacementRouterMount = `// ==========================================
// Dedicated Multi-Tenant Merchant Portal Router
// ==========================================
const { createMerchantPortalRouter } = require('./merchant_portal');
app.use('/', createMerchantPortalRouter({
  supabase,
  sellerStatuses,
  sellerNumbers,
  sellerSockets,
  startSellerSession,
  refreshProductsFromDB,
  refreshSettingsFromDB
}));

// ==========================================
// Smart Helper Functions (Payment, Human Takeover, Auto Courier)
// ==========================================`;

if (!code.includes(targetRouterMountAnchor)) {
  console.error('ERROR: targetRouterMountAnchor not found');
  process.exit(1);
}
code = code.replace(targetRouterMountAnchor, replacementRouterMount);
console.log('✓ 12. Merchant Portal router mounted');

// Restore CRLF if needed
if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(serverFile, code, 'utf8');
console.log('ALL 12 MODIFICATIONS SUCCESSFULLY APPLIED TO server.js!');
