/**
 * AutoDokan Dedicated Multi-Tenant Merchant Portal
 * Isolated, secure, token-authenticated mobile-first portal for invited merchants.
 * Zero cross-tenant leakage: Each merchant can only see and manage their own products, orders, and settings.
 */

const express = require('express');

function createMerchantPortalRouter({ supabase, sellerStatuses, sellerNumbers, sellerSockets, startSellerSession, refreshProductsFromDB, refreshSettingsFromDB }) {
  const router = express.Router();

  // Helper to validate token and extract merchant invite record
  async function authenticateMerchantToken(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const { data: inv, error } = await supabase
        .from('seller_invites')
        .select('*')
        .eq('invite_token', token.trim())
        .maybeSingle();
      if (error || !inv) return null;
      return inv;
    } catch (e) {
      return null;
    }
  }

  // Helper to format courier text
  function formatCourierText(o) {
    const prodPrice = Number(o.total_bdt) || 2200;
    const dueCod = Number(o.due_cod) || prodPrice;
    return 'কাস্টমার: ' + (o.customer_name || 'কাস্টমার') + '\n' +
      'মোবাইল: ' + (o.customer_phone || '') + '\n' +
      'ঠিকানা: ' + (o.address || '') + '\n' +
      'প্রোডাক্ট: [' + (o.model_code || 'PROD') + '] ' + (o.product_details || '') + ' (সাইজ: ' + (o.length_size || 'স্ট্যান্ডার্ড') + ')\n' +
      'ক্যাশ কালেকশন (Due COD): ৳' + dueCod;
  }

  // ========================================================
  // GET /portal — Merchant Control Panel
  // ========================================================
  router.get('/portal', async (req, res) => {
    const token = req.query.token;
    if (!token) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head><meta charset="utf-8"><title>অ্যাক্সেস ডিনাইড</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-[#faf8f5] flex items-center justify-center min-h-screen p-4 text-center">
          <div class="bg-white p-8 rounded-3xl border border-stone-200 shadow-lg max-w-md w-full space-y-3">
            <div class="text-4xl">🔒</div>
            <h1 class="text-lg font-black text-stone-900">মার্চেন্ট অ্যাক্সেস টোকেন পাওয়া যায়নি</h1>
            <p class="text-xs text-stone-600 font-medium">দয়া করে আপনাকে দেওয়া সঠিক মার্চেন্ট পোর্টাল লিঙ্ক ব্যবহার করুন।</p>
          </div>
        </body>
        </html>
      `);
    }

    const inv = await authenticateMerchantToken(token);
    if (!inv) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head><meta charset="utf-8"><title>ইনভাইটেশন পাওয়া যায়নি</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-[#faf8f5] flex items-center justify-center min-h-screen p-4 text-center">
          <div class="bg-white p-8 rounded-3xl border border-stone-200 shadow-lg max-w-md w-full space-y-3">
            <div class="text-4xl">⚠️</div>
            <h1 class="text-lg font-black text-stone-900">ইনভাইটেশন লিঙ্কটি সঠিক নয় বা মেয়াদোত্তীর্ণ</h1>
            <p class="text-xs text-stone-600 font-medium">দয়া করে অ্যাডমিনের সাথে যোগাযোগ করে নতুন লিঙ্ক সংগ্রহ করুন।</p>
          </div>
        </body>
        </html>
      `);
    }

    const sellerId = inv.seller_id;
    const shopName = inv.shop_name;
    const ownerName = inv.owner_name || '';

    // Auto-start session if not active in memory and not permanently disconnected
    if (!sellerSockets.has(sellerId) && inv.status !== 'DISCONNECTED') {
      try {
        startSellerSession(sellerId);
      } catch (e) {}
    }

    // Fetch this merchant's isolated data
    const [productsRes, ordersRes, settingsRes] = await Promise.all([
      supabase.from('products').select('*').eq('seller_id', sellerId).order('id', { ascending: true }),
      supabase.from('orders').select('*').eq('seller_id', sellerId).order('id', { ascending: false }),
      supabase.from('store_settings').select('*').eq('seller_id', sellerId).maybeSingle()
    ]);

    const products = productsRes.data || [];
    const orders = ordersRes.data || [];
    const curSettings = settingsRes.data || {
      inside_dhaka_fee: 80,
      outside_dhaka_fee: 150,
      bkash_number: '',
      nagad_number: '',
      return_policy: 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।'
    };

    // Calculate WhatsApp status
    const rawStatus = sellerStatuses.get(sellerId) || inv.status || 'disconnected';
    const isConnected = rawStatus.toLowerCase() === 'connected';
    const liveNum = sellerNumbers.get(sellerId) || inv.phone || '';

    // Calculate KPIs
    const totalProducts = products.length;
    const inStockProducts = products.filter(p => p.in_stock).length;
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'Pending' || o.status === 'Pending Verification').length;
    const approvedOrders = orders.filter(o => o.status === 'Approved').length;
    const shippedOrders = orders.filter(o => o.status === 'Shipped').length;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled').length;
    const totalRevenue = orders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    // Render Product Cards
    const productCardsHtml = products.map(p => {
      const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '')).toLowerCase();
      const stockStatus = p.in_stock ? 'IN_STOCK' : 'STOCK_OUT';

      return `
      <div class="prod-card bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3 hover:border-amber-400 hover:shadow-md transition" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}">
        <div class="flex gap-3">
          <img src="${p.image_url || 'https://placehold.co/120x150?text=' + encodeURIComponent(p.model_code || 'PROD')}" alt="${p.model_code}" class="w-24 h-28 object-cover rounded-xl bg-stone-100 border border-stone-200 shrink-0">
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="font-mono font-black text-xs text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">${p.model_code || 'PROD'}</span>
              <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition ${p.in_stock ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'}">
                ${p.in_stock ? '● ইন-স্টক' : '✕ স্টক আউট'}
              </button>
            </div>
            <h3 class="font-black text-stone-900 text-sm mt-1 truncate" title="${p.name}">${p.name}</h3>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="font-black text-stone-900 text-base">৳${p.price}</span>
              ${p.regular_price && p.regular_price > p.price ? `<span class="text-stone-400 line-through text-xs font-semibold">৳${p.regular_price}</span>` : ''}
            </div>
            <p class="text-[11px] text-stone-500 mt-0.5 truncate">✨ ${p.fabric || 'ম্যাটেরিয়াল'} • 📏 ${p.sizes || 'সাইজ'}</p>
          </div>
        </div>

        <!-- Colors Management -->
        <div class="bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/80 space-y-1">
          <label class="text-[11px] font-extrabold text-amber-950 flex items-center gap-1">
            <span>🎨 কালারসমূহ (AI কাস্টমারকে এই কালার বলবে):</span>
          </label>
          <div class="flex items-center gap-1.5">
            <input type="text" id="color-input-${p.id}" value="${p.colors || ''}" placeholder="যেমন: কালো, বাদামী, নীল" class="flex-1 bg-white border border-stone-300 text-xs px-2.5 py-1.5 rounded-lg font-medium text-stone-800 focus:border-amber-500 outline-none">
            <button type="button" onclick="saveColorsLive(${p.id})" class="bg-stone-900 hover:bg-black text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs cursor-pointer transition shrink-0">
              সেভ
            </button>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center justify-between gap-1 pt-1 border-t border-stone-100 text-xs">
          <button type="button" onclick="openEditProductModalById(${p.id})" class="text-stone-700 hover:text-stone-900 font-bold px-2.5 py-1 rounded-md hover:bg-stone-100 flex items-center gap-1 cursor-pointer">
            ✏️ এডিট
          </button>
          <button type="button" onclick="deleteProductLive(${p.id}, '${p.model_code}')" class="text-rose-600 hover:text-rose-800 font-bold px-2.5 py-1 rounded-md hover:bg-rose-50 flex items-center gap-1 cursor-pointer">
            🗑️ মুছুন
          </button>
        </div>
      </div>
      `;
    }).join('');

    // Render Order Rows
    const orderRowsHtml = orders.map(o => {
      const prodPrice = Number(o.total_bdt) || 0;
      const dueCod = Number(o.due_cod) || prodPrice;
      const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
      const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
      const searchMeta = (o.id + ' ' + (o.model_code || '') + ' ' + (o.customer_name || '') + ' ' + (o.customer_phone || '') + ' ' + (o.address || '')).toLowerCase();

      return `
      <tr class="order-row border-b border-stone-200 hover:bg-amber-50/40 transition" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
        <td class="p-3">
          <div class="font-mono font-black text-xs text-stone-900">#${o.id}</div>
          <div class="text-[10px] text-stone-400 mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
        </td>
        <td class="p-3">
          <div class="font-black text-stone-900 text-xs">${o.customer_name || 'কাস্টমার'}</div>
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-emerald-700 hover:underline text-xs font-mono font-bold flex items-center gap-1 mt-0.5">
            <span>💬</span>
            <span>${o.customer_phone || ''}</span>
          </a>
        </td>
        <td class="p-3 max-w-[200px]">
          <div class="text-xs text-stone-700 line-clamp-2" title="${o.address || ''}">${o.address || 'ঠিকানা দেওয়া হয়নি'}</div>
        </td>
        <td class="p-3">
          <span class="font-mono font-black text-xs text-stone-900">[${o.model_code || 'PROD'}]</span>
          <div class="text-[11px] text-stone-600 mt-0.5">সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'}</div>
        </td>
        <td class="p-3">
          <span class="font-black text-stone-900 text-xs">৳${dueCod}</span>
        </td>
        <td class="p-3">
          <select onchange="updateOrderStatusLive(${o.id}, this.value)" class="text-xs font-bold rounded-lg px-2 py-1 border outline-none cursor-pointer ${
            o.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
            o.status === 'Shipped' ? 'bg-blue-50 text-blue-800 border-blue-300' :
            o.status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' :
            'bg-amber-50 text-amber-800 border-amber-300'
          }">
            <option value="Pending" ${o.status === 'Pending' || o.status === 'Pending Verification' ? 'selected' : ''}>⏳ Pending</option>
            <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
            <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
            <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
          </select>
        </td>
        <td class="p-3 text-right">
          <button type="button" onclick="copyCourierFormat(${o.id})" title="কুরিয়ার ফরম্যাট কপি" class="bg-stone-100 hover:bg-stone-200 text-stone-800 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-300 transition cursor-pointer">
            📋 কপি
          </button>
        </td>
      </tr>
      `;
    }).join('');

    res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
  <title>${shopName} — মার্চেন্ট কন্ট্রোল প্যানেল</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
    body { font-family: 'Plus Jakarta Sans', 'Hind Siliguri', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  </style>
</head>
<body class="bg-[#faf8f5] text-stone-800 min-h-screen pb-20">
  
  <!-- Merchant Top Navbar -->
  <header class="bg-stone-900 text-white sticky top-0 z-40 px-4 py-3 shadow-md border-b border-stone-800">
    <div class="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-base shadow-sm ring-2 ring-amber-400/30">
          🏪
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="font-black text-base text-white leading-none">${shopName}</h1>
            <span class="bg-amber-400/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded border border-amber-400/30">মার্চেন্ট পোর্টাল</span>
          </div>
          <div class="flex items-center gap-2 mt-1">
            ${isConnected ? `
              <div class="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] px-2.5 py-0.5 rounded-full font-bold">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>+${liveNum} (সক্রিয় ও অটো-রিপ্লাই সচল)</span>
              </div>
            ` : `
              <a href="/connect?token=${token}" class="inline-flex items-center gap-1.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] px-2.5 py-0.5 rounded-full font-bold hover:bg-amber-500/30 transition">
                <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                <span>WhatsApp সংযোগ করতে ক্লিক করুন ↗</span>
              </a>
            `}
          </div>
        </div>
      </div>

      <!-- Merchant Info Pill -->
      <div class="flex items-center gap-2">
        <div class="bg-stone-800 border border-stone-700 text-stone-300 text-xs px-3 py-1.5 rounded-xl font-bold">
          <span>👤 ${ownerName || 'মার্চেন্ট'}</span>
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 py-5 space-y-5">
    
    <!-- 4 Summary KPI Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-xs">
        <div class="text-stone-500 text-[11px] font-extrabold uppercase">মোট প্রোডাক্টস</div>
        <div class="text-2xl font-black mt-0.5 text-stone-900">${totalProducts}</div>
      </div>
      <div class="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs">
        <div class="text-emerald-800 text-[11px] font-extrabold uppercase">ইন-স্টক প্রোডাক্টস</div>
        <div class="text-2xl font-black mt-0.5 text-emerald-800">${inStockProducts} <span class="text-xs text-stone-400 font-bold">/ ${totalProducts}</span></div>
      </div>
      <div class="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-xs">
        <div class="text-stone-500 text-[11px] font-extrabold uppercase">মোট অর্ডার</div>
        <div class="text-2xl font-black mt-0.5 text-stone-900">${totalOrders}</div>
      </div>
      <div class="bg-white p-3.5 rounded-2xl border border-amber-200 shadow-xs">
        <div class="text-amber-800 text-[11px] font-extrabold uppercase">পেন্ডিং অর্ডার</div>
        <div class="text-2xl font-black mt-0.5 text-amber-700">${pendingOrders}</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex items-center gap-2 border-b border-stone-200 pb-2 flex-wrap">
      <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-stone-900 text-white shadow-xs">
        <span>📦 প্রোডাক্টস ও স্টক</span>
        <span class="bg-stone-800 text-stone-200 text-[10px] px-2 py-0.5 rounded-full font-bold">${totalProducts}</span>
      </button>
      <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
        <span>📋 কাস্টমার অর্ডারস</span>
        <span class="bg-amber-100 text-amber-900 text-[10px] px-2 py-0.5 rounded-full font-bold">${totalOrders}</span>
      </button>
      <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
        <span>⚙️ শপ সেটিংস</span>
      </button>
    </div>

    <!-- TAB 1: PRODUCTS -->
    <section id="tab-products" class="space-y-4">
      <div class="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-3">
          <div>
            <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
              <span>📦 প্রোডাক্ট ক্যাটালগ ও কালার ম্যানেজমেন্ট</span>
            </h2>
            <p class="text-xs text-stone-500 font-medium mt-0.5">আপনার প্রোডাক্টের স্টক ও কালার পরিবর্তন করলে WhatsApp AI সাথে সাথে আপডেট পাবে।</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <input type="text" id="prodSearch" oninput="filterProducts(this.value)" placeholder="🔍 প্রোডাক্ট খুঁজুন..." class="bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-3.5 py-2 rounded-xl focus:outline-none focus:border-amber-500">
            <button type="button" onclick="openAddProductModal()" class="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5">
              <span>+ নতুন প্রোডাক্ট যোগ করুন</span>
            </button>
          </div>
        </div>

        <!-- Stock Filter Buttons -->
        <div class="flex items-center gap-2 text-xs font-bold">
          <button type="button" onclick="filterStock('ALL')" id="filter-stock-all" class="stock-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer">সবগুলো (${totalProducts})</button>
          <button type="button" onclick="filterStock('IN_STOCK')" id="filter-stock-instock" class="stock-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">স্টকে আছে (${inStockProducts})</button>
          <button type="button" onclick="filterStock('STOCK_OUT')" id="filter-stock-out" class="stock-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">স্টক আউট (${totalProducts - inStockProducts})</button>
        </div>

        <!-- Products Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="productsGrid">
          ${productCardsHtml || '<div class="col-span-full py-12 text-center text-stone-400 font-medium border-2 border-dashed border-stone-200 rounded-2xl">কোনো প্রোডাক্ট যোগ করা হয়নি। উপরে "+ নতুন প্রোডাক্ট যোগ করুন" চাপুন।</div>'}
        </div>
      </div>
    </section>

    <!-- TAB 2: ORDERS -->
    <section id="tab-orders" class="hidden space-y-4">
      <div class="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-3">
          <div>
            <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
              <span>📋 কাস্টমার অর্ডারস ও ডেলিভারি</span>
            </h2>
            <p class="text-xs text-stone-500 font-medium mt-0.5">WhatsApp AI থেকে স্বয়ংক্রিয়ভাবে সংগৃহীত অর্ডার তালিকা।</p>
          </div>
          <input type="text" id="orderSearch" oninput="filterOrders(this.value)" placeholder="🔍 অর্ডার খুঁজুন (নাম, ফোন, ঠিকানা)..." class="bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-3.5 py-2 rounded-xl focus:outline-none focus:border-amber-500 w-full sm:w-72">
        </div>

        <!-- Status Filter Buttons -->
        <div class="flex items-center gap-2 text-xs font-bold overflow-x-auto pb-1 no-scrollbar">
          <button type="button" onclick="filterOrderStatus('ALL')" id="filter-order-all" class="order-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer">সবগুলো (${totalOrders})</button>
          <button type="button" onclick="filterOrderStatus('Pending')" id="filter-order-pending" class="order-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">Pending (${pendingOrders})</button>
          <button type="button" onclick="filterOrderStatus('Approved')" id="filter-order-approved" class="order-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">Approved (${approvedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Shipped')" id="filter-order-shipped" class="order-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">Shipped (${shippedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Cancelled')" id="filter-order-cancelled" class="order-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">Cancelled (${cancelledOrders})</button>
        </div>

        <!-- Orders Table -->
        <div class="overflow-x-auto border border-stone-200 rounded-xl">
          <table class="w-full text-left text-stone-800 text-xs">
            <thead class="bg-[#faf8f5] text-stone-600 font-bold border-b border-stone-200">
              <tr>
                <th class="p-3">অর্ডার ID</th>
                <th class="p-3">কাস্টমার</th>
                <th class="p-3">ঠিকানা</th>
                <th class="p-3">মডেল ও সাইজ</th>
                <th class="p-3">Due COD</th>
                <th class="p-3">স্ট্যাটাস</th>
                <th class="p-3 text-right">কুরিয়ার কপি</th>
              </tr>
            </thead>
            <tbody id="ordersTableBody">
              ${orderRowsHtml || '<tr><td colspan="7" class="p-8 text-center text-stone-400 font-medium">এখনও কোনো অর্ডার আসেনি।</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 3: SETTINGS -->
    <section id="tab-settings" class="hidden space-y-4">
      <div class="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs max-w-2xl mx-auto space-y-5">
        <div class="border-b border-stone-100 pb-3">
          <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
            <span>⚙️ শপ সেটিংস ও ডেলিভারি রুলস</span>
          </h2>
          <p class="text-xs text-stone-500 font-medium mt-0.5">WhatsApp AI স্বয়ংক্রিয়ভাবে গ্রাহককে এই রেট ও পলিসিগুলো জানাবে।</p>
        </div>

        <form onsubmit="saveMerchantSettingsLive(event)" class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-stone-800 mb-1">🚚 ঢাকা ভেতরে ডেলিভারি চার্জ (টাকা)</label>
              <input type="number" id="set_inside_fee" value="${curSettings.inside_dhaka_fee}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-800 mb-1">🚛 ঢাকা বাইরে ডেলিভারি চার্জ (টাকা)</label>
              <input type="number" id="set_outside_fee" value="${curSettings.outside_dhaka_fee}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-stone-800 mb-1">📱 বিকাশ নাম্বার</label>
              <input type="text" id="set_bkash" value="${curSettings.bkash_number || ''}" placeholder="যেমন: 017XXXXXXXX" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-800 mb-1">📱 নগদ নাম্বার</label>
              <input type="text" id="set_nagad" value="${curSettings.nagad_number || ''}" placeholder="যেমন: 018XXXXXXXX" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-stone-800 mb-1">🎁 বিশেষ অফার / কম্বো ছাড়</label>
            <input type="text" id="set_promo_offer" value="${curSettings.promo_offer || ''}" placeholder="যেমন: ২টি নিলে ১০০ টাকা বিশেষ ছাড়" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-stone-800 mb-1">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি (AI গ্রাহককে বলবে)</label>
            <textarea id="set_return_policy" rows="2" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">${curSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।'}</textarea>
          </div>

          <button type="submit" id="saveSettingsBtn" class="w-full bg-stone-900 hover:bg-black text-white text-xs font-black py-3 rounded-xl shadow-sm transition cursor-pointer">
            💾 সেটিংস সেভ করুন
          </button>
        </form>
      </div>
    </section>

  </main>

  <!-- ADD PRODUCT MODAL -->
  <div id="addProductModal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-stone-100 pb-3">
        <h3 class="font-black text-stone-900 text-base">➕ নতুন প্রোডাক্ট যোগ করুন</h3>
        <button type="button" onclick="closeAddProductModal()" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-bold cursor-pointer">✕</button>
      </div>
      <form onsubmit="saveNewProductLive(event)" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড *</label>
            <input type="text" id="add_code" required placeholder="যেমন: BJ-104" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-mono font-bold">
          </div>
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">বিক্রয় মূল্য (টাকা) *</label>
            <input type="number" id="add_price" required placeholder="যেমন: 1850" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-bold">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1">প্রোডাক্টের নাম *</label>
          <input type="text" id="add_name" required placeholder="যেমন: প্রিমিয়াম জেনুইন লেদার শু" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
        </div>
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1">কালারসমূহ (কমা দিয়ে লিখুন)</label>
          <input type="text" id="add_colors" placeholder="যেমন: ব্ল্যাক, চকোলেট ব্রাউন" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">ফেব্রিক / উপাদান</label>
            <input type="text" id="add_fabric" placeholder="যেমন: জেনুইন লেদার" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
          </div>
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">সাইজসমূহ</label>
            <input type="text" id="add_sizes" placeholder="যেমন: ৩৯, ৪০, ৪১, ৪২, ৪৩" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1">ছবির সরাসরি URL</label>
          <input type="url" id="add_img" placeholder="https://..." class="w-full border border-stone-300 p-2 rounded-xl text-xs font-mono">
        </div>
        <button type="submit" id="addSubmitBtn" class="w-full bg-stone-900 hover:bg-black text-white font-black text-xs py-2.5 rounded-xl transition cursor-pointer">
          + প্রোডাক্ট সেভ করুন
        </button>
      </form>
    </div>
  </div>

  <!-- EDIT PRODUCT MODAL -->
  <div id="editProductModal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-stone-100 pb-3">
        <h3 class="font-black text-stone-900 text-base">✏️ প্রোডাক্ট এডিট: <span id="edit_code_label" class="font-mono text-amber-900"></span></h3>
        <button type="button" onclick="closeEditProductModal()" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-bold cursor-pointer">✕</button>
      </div>
      <form onsubmit="saveEditedProductLive(event)" class="space-y-3">
        <input type="hidden" id="edit_id">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড</label>
            <input type="text" id="edit_code" required class="w-full border border-stone-300 p-2 rounded-xl text-xs font-mono font-bold">
          </div>
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">বিক্রয় মূল্য (টাকা)</label>
            <input type="number" id="edit_price" required class="w-full border border-stone-300 p-2 rounded-xl text-xs font-bold">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1">প্রোডাক্টের নাম</label>
          <input type="text" id="edit_name" required class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
        </div>
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1">কালারসমূহ (কমা দিয়ে লিখুন)</label>
          <input type="text" id="edit_colors" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">ফেব্রিক / উপাদান</label>
            <input type="text" id="edit_fabric" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
          </div>
          <div>
            <label class="block text-xs font-bold text-stone-700 mb-1">সাইজসমূহ</label>
            <input type="text" id="edit_sizes" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1">ছবির সরাসরি URL</label>
          <input type="url" id="edit_img" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-mono">
        </div>
        <button type="submit" id="editSubmitBtn" class="w-full bg-stone-900 hover:bg-black text-white font-black text-xs py-2.5 rounded-xl transition cursor-pointer">
          💾 পরিবর্তন সেভ করুন
        </button>
      </form>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"></div>

  <script>
    const token = '${token}';
    window.__MERCHANT_PRODUCTS__ = ${JSON.stringify(products)};
    window.__MERCHANT_ORDERS__ = ${JSON.stringify(orders)};

    function showToast(msg) {
      const c = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = 'bg-stone-900 text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-xl border border-stone-700 pointer-events-auto transition transform translate-y-2 opacity-0';
      t.innerText = msg;
      c.appendChild(t);
      setTimeout(() => { t.classList.remove('translate-y-2', 'opacity-0'); }, 10);
      setTimeout(() => {
        t.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => t.remove(), 300);
      }, 3000);
    }

    function switchTab(name) {
      document.querySelectorAll('section[id^="tab-"]').forEach(s => s.classList.add('hidden'));
      document.getElementById('tab-' + name)?.classList.remove('hidden');

      document.querySelectorAll('.tab-btn').forEach(b => {
        b.className = 'tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs';
      });
      const activeBtn = document.getElementById('tab-btn-' + name);
      if (activeBtn) activeBtn.className = 'tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-stone-900 text-white shadow-xs';
    }

    // Live Stock Toggle
    async function toggleStockLive(id, newStock) {
      try {
        const res = await fetch('/api/portal/toggle-stock?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, in_stock: newStock })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.in_stock ? '✅ প্রোডাক্টটি ইন-স্টক করা হয়েছে!' : '❌ প্রোডাক্টটি স্টক আউট করা হয়েছে!');
          setTimeout(() => window.location.reload(), 500);
        } else {
          alert('স্টক আপডেট ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (e) {
        alert('এরর: ' + e.message);
      }
    }

    // Live Colors Save
    async function saveColorsLive(id) {
      const input = document.getElementById('color-input-' + id);
      if (!input) return;
      const colors = input.value.trim();
      try {
        const res = await fetch('/api/portal/save-colors?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, colors })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ কালার সেভ হয়েছে! AI এখন এই কালার জানবে।');
        } else {
          alert('কালার সেভ ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (e) {
        alert('এরর: ' + e.message);
      }
    }

    // Open/Close Modals
    function openAddProductModal() { document.getElementById('addProductModal').classList.remove('hidden'); }
    function closeAddProductModal() { document.getElementById('addProductModal').classList.add('hidden'); }
    function closeEditProductModal() { document.getElementById('editProductModal').classList.add('hidden'); }

    function openEditProductModalById(id) {
      const p = (window.__MERCHANT_PRODUCTS__ || []).find(x => x.id == id);
      if (!p) return;
      document.getElementById('edit_id').value = p.id;
      document.getElementById('edit_code').value = p.model_code || '';
      document.getElementById('edit_code_label').innerText = p.model_code || '';
      document.getElementById('edit_name').value = p.name || '';
      document.getElementById('edit_price').value = p.price || '';
      document.getElementById('edit_colors').value = p.colors || '';
      document.getElementById('edit_fabric').value = p.fabric || '';
      document.getElementById('edit_sizes').value = p.sizes || '';
      document.getElementById('edit_img').value = p.image_url || '';
      document.getElementById('editProductModal').classList.remove('hidden');
    }

    // Save New Product
    async function saveNewProductLive(e) {
      e.preventDefault();
      const btn = document.getElementById('addSubmitBtn');
      btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true;

      const payload = {
        model_code: document.getElementById('add_code').value.toUpperCase().trim(),
        name: document.getElementById('add_name').value.trim(),
        price: document.getElementById('add_price').value,
        fabric: document.getElementById('add_fabric').value.trim(),
        sizes: document.getElementById('add_sizes').value.trim(),
        colors: document.getElementById('add_colors').value.trim(),
        image_url: document.getElementById('add_img').value.trim()
      };

      try {
        const res = await fetch('/api/portal/add-product?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 নতুন প্রোডাক্ট যুক্ত হয়েছে!');
          closeAddProductModal();
          setTimeout(() => window.location.reload(), 500);
        } else {
          alert('যোগ ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (err) {
        alert('এরর: ' + err.message);
      } finally {
        btn.innerText = '+ প্রোডাক্ট সেভ করুন'; btn.disabled = false;
      }
    }

    // Save Edited Product
    async function saveEditedProductLive(e) {
      e.preventDefault();
      const btn = document.getElementById('editSubmitBtn');
      btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true;

      const payload = {
        id: document.getElementById('edit_id').value,
        model_code: document.getElementById('edit_code').value.toUpperCase().trim(),
        name: document.getElementById('edit_name').value.trim(),
        price: document.getElementById('edit_price').value,
        fabric: document.getElementById('edit_fabric').value.trim(),
        sizes: document.getElementById('edit_sizes').value.trim(),
        colors: document.getElementById('edit_colors').value.trim(),
        image_url: document.getElementById('edit_img').value.trim()
      };

      try {
        const res = await fetch('/api/portal/edit-product?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('💾 পরিবর্তন সেভ হয়েছে!');
          closeEditProductModal();
          setTimeout(() => window.location.reload(), 500);
        } else {
          alert('এডিট ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (err) {
        alert('এরর: ' + err.message);
      } finally {
        btn.innerText = '💾 পরিবর্তন সেভ করুন'; btn.disabled = false;
      }
    }

    // Delete Product
    async function deleteProductLive(id, code) {
      if (!confirm(code + ' প্রোডাক্টটি মুছে ফেলতে চান?')) return;
      try {
        const res = await fetch('/api/portal/delete-product?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🗑️ ' + code + ' মোছা হয়েছে');
          setTimeout(() => window.location.reload(), 500);
        } else {
          alert('মুছতে ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (e) {
        alert('এরর: ' + e.message);
      }
    }

    // Save Settings
    async function saveMerchantSettingsLive(e) {
      e.preventDefault();
      const btn = document.getElementById('saveSettingsBtn');
      btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true;

      const payload = {
        inside_dhaka_fee: document.getElementById('set_inside_fee').value,
        outside_dhaka_fee: document.getElementById('set_outside_fee').value,
        bkash_number: document.getElementById('set_bkash').value.trim(),
        nagad_number: document.getElementById('set_nagad').value.trim(),
        promo_offer: document.getElementById('set_promo_offer').value.trim(),
        return_policy: document.getElementById('set_return_policy').value.trim()
      };

      try {
        const res = await fetch('/api/portal/update-settings?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('💾 সেটিংস সফলভাবে সেভ হয়েছে!');
        } else {
          alert('সেভ ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (err) {
        alert('এরর: ' + err.message);
      } finally {
        btn.innerText = '💾 সেটিংস সেভ করুন'; btn.disabled = false;
      }
    }

    // Update Order Status
    async function updateOrderStatusLive(order_id, status) {
      try {
        const res = await fetch('/api/portal/update-order-status?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id, status })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ অর্ডার #' + order_id + ' এর স্ট্যাটাস ' + status + ' করা হয়েছে!');
          const row = document.querySelector('[data-order-id="' + order_id + '"]');
          if (row) row.setAttribute('data-status', status);
        } else {
          alert('স্ট্যাটাস আপডেট ব্যর্থ: ' + (data.error || 'সমস্যা'));
        }
      } catch (e) {
        alert('এরর: ' + e.message);
      }
    }

    // Copy Courier Format
    function copyCourierFormat(id) {
      const o = (window.__MERCHANT_ORDERS__ || []).find(x => x.id == id);
      if (!o) return;
      const text = [
        'কাস্টমার: ' + (o.customer_name || 'কাস্টমার'),
        'মোবাইল: ' + (o.customer_phone || ''),
        'ঠিকানা: ' + (o.address || ''),
        'প্রোডাক্ট: [' + (o.model_code || 'PROD') + '] ' + (o.product_details || '') + ' (সাইজ: ' + (o.length_size || 'স্ট্যান্ডার্ড') + ')',
        'ক্যাশ কালেকশন (Due COD): ৳' + (o.due_cod || o.total_bdt || 0)
      ].join('\\n');
      navigator.clipboard.writeText(text);
      showToast('📋 কুরিয়ার ফরম্যাট কপি হয়েছে!');
    }

    // Filters
    let currentStockFilter = 'ALL';
    function filterStock(st) {
      currentStockFilter = st;
      document.querySelectorAll('.stock-filter-btn').forEach(b => {
        b.className = 'stock-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer';
      });
      const active = document.getElementById('filter-stock-' + (st === 'ALL' ? 'all' : (st === 'IN_STOCK' ? 'instock' : 'out')));
      if (active) active.className = 'stock-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer';
      applyProdFilters();
    }
    function filterProducts() { applyProdFilters(); }
    function applyProdFilters() {
      const q = (document.getElementById('prodSearch')?.value || '').toLowerCase().trim();
      document.querySelectorAll('.prod-card').forEach(c => {
        const search = c.getAttribute('data-search') || '';
        const stock = c.getAttribute('data-stock') || '';
        const matchStock = (currentStockFilter === 'ALL') || (stock === currentStockFilter);
        const matchSearch = !q || search.includes(q);
        c.style.display = (matchStock && matchSearch) ? 'block' : 'none';
      });
    }

    let currentOrderFilter = 'ALL';
    function filterOrderStatus(st) {
      currentOrderFilter = st;
      document.querySelectorAll('.order-filter-btn').forEach(b => {
        b.className = 'order-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer';
      });
      const active = document.getElementById('filter-order-' + (st === 'ALL' ? 'all' : st.toLowerCase()));
      if (active) active.className = 'order-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer';
      applyOrderFilters();
    }
    function filterOrders() { applyOrderFilters(); }
    function applyOrderFilters() {
      const q = (document.getElementById('orderSearch')?.value || '').toLowerCase().trim();
      document.querySelectorAll('.order-row').forEach(r => {
        const search = r.getAttribute('data-search') || '';
        const status = r.getAttribute('data-status') || '';
        const matchStatus = (currentOrderFilter === 'ALL') || (status === currentOrderFilter);
        const matchSearch = !q || search.includes(q);
        r.style.display = (matchStatus && matchSearch) ? '' : 'none';
      });
    }
  </script>
</body>
</html>
    `);
  });

  // ========================================================
  // PORTAL APIS (Strictly Authenticated and Scoped by Token)
  // ========================================================

  router.post('/api/portal/toggle-stock', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, in_stock } = req.body;
    const isStock = in_stock === true || in_stock === 'true';

    const { error } = await supabase
      .from('products')
      .update({ in_stock: isStock })
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, in_stock: isStock, id });
  });

  router.post('/api/portal/save-colors', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, colors } = req.body;
    const { error } = await supabase
      .from('products')
      .update({ colors: colors ? colors.trim() : null })
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id, colors });
  });

  router.post('/api/portal/add-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { model_code, name, fabric, price, sizes, regular_price, colors, image_url } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });

    const parsedPrice = parseFloat(price);
    const regPrice = regular_price ? parseFloat(regular_price) : parsedPrice;
    const cleanCode = model_code ? model_code.toUpperCase().trim() : 'PROD-' + Math.floor(Math.random() * 899 + 100);

    const { data, error } = await supabase.from('products').insert({
      seller_id: inv.seller_id,
      model_code: cleanCode,
      name: name.trim(),
      fabric: fabric ? fabric.trim() : null,
      price: parsedPrice,
      regular_price: regPrice,
      sizes: sizes ? sizes.trim() : null,
      colors: colors ? colors.trim() : null,
      image_url: image_url ? image_url.trim() : null,
      in_stock: true
    }).select();

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, product: data?.[0] });
  });

  router.post('/api/portal/edit-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, model_code, name, fabric, price, sizes, regular_price, colors, image_url } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });

    const updateFields = {};
    if (model_code !== undefined) updateFields.model_code = model_code.toUpperCase().trim();
    if (name !== undefined) updateFields.name = name.trim();
    if (fabric !== undefined) updateFields.fabric = fabric.trim();
    if (price !== undefined) updateFields.price = parseFloat(price);
    if (regular_price !== undefined) updateFields.regular_price = parseFloat(regular_price);
    if (sizes !== undefined) updateFields.sizes = sizes.trim();
    if (colors !== undefined) updateFields.colors = colors.trim();
    if (image_url !== undefined) updateFields.image_url = image_url.trim();

    const { error } = await supabase
      .from('products')
      .update(updateFields)
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id });
  });

  router.post('/api/portal/delete-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id } = req.body;
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id });
  });

  router.post('/api/portal/update-settings', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { inside_dhaka_fee, outside_dhaka_fee, bkash_number, nagad_number, return_policy, promo_offer } = req.body;

    const payload = {
      seller_id: inv.seller_id,
      shop_name: inv.shop_name,
      inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
      outside_dhaka_fee: Number(outside_dhaka_fee) || 150,
      bkash_number: (bkash_number || '').trim(),
      nagad_number: (nagad_number || '').trim(),
      return_policy: (return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।').trim(),
      promo_offer: (promo_offer || '').trim(),
      updated_at: new Date().toISOString()
    };

    const { data: curSettings } = await supabase.from('store_settings').select('id').eq('seller_id', inv.seller_id).maybeSingle();
    if (curSettings?.id) {
      await supabase.from('store_settings').update(payload).eq('id', curSettings.id);
    } else {
      await supabase.from('store_settings').insert(payload);
    }

    await refreshSettingsFromDB(inv.seller_id);
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, settings: payload });
  });

  router.post('/api/portal/update-order-status', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { order_id, status } = req.body;
    if (!order_id || !status) return res.status(400).json({ error: 'Missing order_id or status' });

    const { error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', order_id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, order_id, status });
  });

  return router;
}

module.exports = { createMerchantPortalRouter };
