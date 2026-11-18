/**
 * AutoDokan Dedicated Multi-Tenant Merchant Portal
 * Isolated, secure, token-authenticated mobile/desktop portal for invited merchants.
 * 100% Apple HIG Pro Dark Mode Edition — High eye-comfort, zero harsh blue glare.
 * Features:
 *  - Spacious, non-cluttered cards with large PC-friendly fonts
 *  - Direct multi-photo upload with strict [Min 5 - Max 8] policy
 *  - 3-Step Safe Product Deletion Modal with countdown safety lock
 *  - Advanced Store Settings (Free delivery threshold, COD fraud protection, AI persona tuning)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

function createMerchantPortalRouter({
  supabase,
  sellerStatuses,
  sellerNumbers,
  sellerSockets,
  startSellerSession,
  refreshProductsFromDB,
  refreshSettingsFromDB
}) {
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

  // Helper to format currency in Apple's clean numeral format
  function formatMoney(amount) {
    return '৳' + (Number(amount) || 0).toLocaleString('en-IN');
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
  // GET /api/portal/verify-token — Quick validation endpoint for login
  router.get('/api/portal/verify-token', async (req, res) => {
    const token = req.query.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ success: false, error: 'টোকেনটি সঠিক নয় বা মেয়াদোত্তীর্ণ' });
    return res.json({ success: true, shop_name: inv.shop_name, seller_id: inv.seller_id });
  });

  // ========================================================
  // GET /portal — Merchant Control Panel & Dynamic Login
  // ========================================================
  router.get('/portal', async (req, res) => {
    const token = req.query.token;
    if (!token) {
      return res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
  <title>মার্চেন্ট পোর্টাল লগইন — অটোদোকান</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
    body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Plus Jakarta Sans", "Hind Siliguri", sans-serif; }
  </style>
  <script>
    (function() {
      try {
        var saved = localStorage.getItem('autodokan_merchant_token');
        if (saved && saved.trim()) {
          window.location.replace('/portal?token=' + encodeURIComponent(saved.trim()));
        }
      } catch(e) {}
    })();
  </script>
</head>
<body class="bg-[#000000] text-white flex items-center justify-center min-h-screen p-4 font-sans selection:bg-[#30D158] selection:text-black">
  <div class="bg-[#1C1C1E] border border-white/[0.12] rounded-[28px] max-w-md w-full p-8 shadow-[0_24px_70px_rgba(0,0,0,0.8)] space-y-6 text-center">
    <div class="flex items-center justify-center">
      <div class="w-16 h-16 rounded-[22px] bg-gradient-to-tr from-[#30D158]/30 via-emerald-500/20 to-[#30D158]/10 border border-[#30D158]/30 flex items-center justify-center text-3xl shadow-[0_0_30px_rgba(48,209,88,0.25)]">
        🛍️
      </div>
    </div>
    <div>
      <h1 class="text-2xl font-black text-white tracking-tight">মার্চেন্ট পোর্টাল লগইন</h1>
      <p class="text-xs sm:text-sm text-[rgba(235,235,245,0.60)] mt-1.5">আপনার শপের সিক্রেট ইনভাইট টোকেন বা কোড দিয়ে সরাসরি পোর্টালে প্রবেশ করুন।</p>
    </div>
    <form onsubmit="handlePortalLogin(event)" class="space-y-4 text-left">
      <div>
        <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] uppercase tracking-wider mb-2">ইনভাইটেশন টোকেন / শপ কি</label>
        <input type="text" id="merchantTokenInput" placeholder="যেমন: inv_dawah_fashion" required autofocus class="w-full bg-[#2C2C2E] border border-white/[0.10] text-white font-mono text-sm px-4 py-3 rounded-[16px] focus:outline-none focus:border-[#30D158] focus:ring-1 focus:ring-[#30D158] transition">
      </div>
      <button type="submit" id="loginSubmitBtn" class="w-full bg-white hover:bg-[#E5E5EA] text-black font-extrabold text-sm py-3.5 rounded-[16px] transition cursor-pointer shadow-[0_4px_20px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 active:scale-95">
        <span>লগইন করুন</span>
        <span>→</span>
      </button>
      <div class="pt-2 text-center">
        <button type="button" onclick="document.getElementById('merchantTokenInput').value='inv_dawah_fashion'; handlePortalLogin(event);" class="text-[11px] text-[#30D158] hover:underline font-semibold cursor-pointer inline-flex items-center gap-1">
          <span>💡 ডেমো টেস্ট শপ:</span>
          <span class="font-mono">inv_dawah_fashion</span>
        </button>
      </div>
    </form>
    <div class="text-[11px] text-[rgba(235,235,245,0.40)] border-t border-white/[0.06] pt-4">
      AutoDokan Enterprise AI Commerce • End-to-End Dynamic Sync
    </div>
  </div>
  <script>
    async function handlePortalLogin(e) {
      if (e && e.preventDefault) e.preventDefault();
      var input = document.getElementById('merchantTokenInput');
      var val = (input ? input.value : '').trim();
      if (!val) return alert('দয়া করে আপনার সঠিক মার্চেন্ট টোকেন লিখুন');
      var btn = document.getElementById('loginSubmitBtn');
      if (btn) { btn.innerText = 'ভেরিফাই হচ্ছে...'; btn.disabled = true; }
      try {
        var res = await fetch('/api/portal/verify-token?token=' + encodeURIComponent(val));
        var data = await res.json();
        if (data.success) {
          localStorage.setItem('autodokan_merchant_token', val);
          window.location.href = '/portal?token=' + encodeURIComponent(val);
        } else {
          alert('ভুল টোকেন: ' + (data.error || 'টোকেনটি পাওয়া যায়নি'));
          if (btn) { btn.innerText = 'লগইন করুন →'; btn.disabled = false; }
        }
      } catch (err) {
        localStorage.setItem('autodokan_merchant_token', val);
        window.location.href = '/portal?token=' + encodeURIComponent(val);
      }
    }
  </script>
</body>
</html>`);
    }

    const inv = await authenticateMerchantToken(token);
    if (!inv) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="bn">
<head><meta charset="utf-8"><title>ইনভাইটেশন পাওয়া যায়নি</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-[#000000] text-white flex items-center justify-center min-h-screen p-4 text-center font-sans">
  <div class="bg-[#1C1C1E] p-8 rounded-[24px] border border-white/[0.08] shadow-2xl max-w-md w-full space-y-4">
    <div class="text-4xl">⚠️</div>
    <h1 class="text-lg font-bold text-white">ইনভাইটেশন লিঙ্কটি সঠিক নয় বা মেয়াদোত্তীর্ণ</h1>
    <p class="text-xs text-[rgba(235,235,245,0.60)]">দয়া করে সঠিক টোকেন দিয়ে পুনরায় চেষ্টা করুন।</p>
    <div class="pt-2">
      <a href="/portal" onclick="try{localStorage.removeItem('autodokan_merchant_token');}catch(e){}" class="inline-block bg-white text-black font-bold text-xs px-5 py-2.5 rounded-[12px] hover:bg-[#E5E5EA] transition cursor-pointer">
        লগইন পেজে যান →
      </a>
    </div>
  </div>
</body>
</html>`);
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
      promo_offer: '',
      return_policy: 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।',
      bot_persona_name: 'AI ইনচার্জ',
      free_delivery_min_amount: 0,
      extra_config: {}
    };

    const extra = curSettings.extra_config || {};

    // Calculate WhatsApp status
    const rawStatus = sellerStatuses.get(sellerId) || inv.status || 'disconnected';
    const isConnected = rawStatus.toLowerCase() === 'connected';
    const liveNum = sellerNumbers.get(sellerId) || inv.phone || '';

    // Calculate KPIs
    const totalProducts = products.length;
    const inStockProducts = products.filter(p => p.in_stock && (p.stock_quantity === undefined || p.stock_quantity === null || Number(p.stock_quantity) > 0)).length;
    const lowStockProducts = products.filter(p => p.in_stock && (Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= 5)).length;
    const stockOutProducts = products.filter(p => !p.in_stock || Number(p.stock_quantity) === 0).length;
    const totalInventoryValue = products.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock_quantity) || 1)), 0);

    const totalOrders = orders.length;
    const isBooked = o => o.status === 'Pending' || o.status === 'Pending Verification' || o.status === 'Booked';
    const isConfirmed = o => o.status === 'Approved' || o.status === 'Confirmed';
    const isShipped = o => o.status === 'Shipped' || o.status === 'In Transit' || o.status === 'Dispatched';
    const isDelivered = o => o.status === 'Delivered' || o.status === 'Completed';
    const isReturned = o => o.status === 'Returned';
    const isCancelled = o => o.status === 'Cancelled';

    const bookedOrders = orders.filter(isBooked).length;
    const confirmedOrders = orders.filter(isConfirmed).length;
    const shippedOrders = orders.filter(isShipped).length;
    const deliveredOrders = orders.filter(isDelivered).length;
    const returnedOrders = orders.filter(isReturned).length;
    const cancelledOrders = orders.filter(isCancelled).length;

    const validOrders = orders.filter(o => !isCancelled(o) && !isReturned(o));
    const totalRevenue = validOrders.reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);
    const deliveredRevenue = orders.filter(isDelivered).reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    // Dynamic Sales Velocity (Today vs Last 7 Days)
    const nowMs = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const sevenDaysAgoMs = nowMs - (7 * 24 * 60 * 60 * 1000);

    const todayOrders = validOrders.filter(o => {
      const t = new Date(o.created_at || o.order_date || 0).getTime();
      return t >= todayStartMs;
    });
    const todayRevenue = todayOrders.reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    const last7DaysOrders = validOrders.filter(o => {
      const t = new Date(o.created_at || o.order_date || 0).getTime();
      return t >= sevenDaysAgoMs;
    });
    const last7DaysRevenue = last7DaysOrders.reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    const allSkus = Array.from(new Set([
      ...products.map(p => p.model_code).filter(Boolean),
      ...orders.map(o => o.model_code).filter(Boolean)
    ])).sort();

    // ========================================================
    // Render Advanced Product Cards (Apple HIG Pro Dark Theme - Spacious & Large Font)
    // ========================================================
    const productCardsHtml = products.map(p => {
      const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '') + ' ' + (p.sizes || '')).toLowerCase();
      const isOut = !p.in_stock || (Number(p.stock_quantity) === 0);
      const isLow = !isOut && (Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= 5);
      const stockStatus = isOut ? 'STOCK_OUT' : (isLow ? 'LOW_STOCK' : 'IN_STOCK');
      const mainImg = p.image_url || 'https://placehold.co/300x380/1c1c1e/ffffff?text=' + encodeURIComponent(p.model_code || 'PROD');
      const hasDiscount = p.regular_price && Number(p.regular_price) > Number(p.price);

      // Extract all gallery photos (up to 8)
      const gallery = [
        p.image_url,
        p.detail_image_url,
        p.real_image_url,
        p.hijab_image_url,
        p.flare_image_url,
        ...(p.custom_attributes?.gallery_images || [])
      ].filter(u => typeof u === 'string' && u.trim());
      const uniqueGallery = Array.from(new Set(gallery)).slice(0, 8);

      // Sizes chips with clean tokens and separate extra notes
      const rawSizeTokens = (p.sizes || 'স্ট্যান্ডার্ড').split(',').map(s => s.trim()).filter(Boolean);
      let extraSizeNotes = [];
      const cleanSizes = rawSizeTokens.map(tok => {
        const parenMatch = tok.match(/\(([^)]+)\)/);
        if (parenMatch) {
          extraSizeNotes.push(parenMatch[1].trim());
        }
        return tok.replace(/\([^)]+\)/g, '').trim();
      }).filter(Boolean);
      // Colors chips
      const colorChips = (p.colors || '').split(',').map(c => c.trim()).filter(Boolean);

      // Dynamic Bundle & Offer Badges
      const cAttr = p.custom_attributes || {};
      const hasBundle = cAttr.bundle_active === true || cAttr.bundle_active === 'true';
      const bundleBadge = hasBundle ? (cAttr.bundle_label || '🔥 বান্ডেল অফার') : '';

      return `
      <div class="prod-card bg-[#1C1C1E] rounded-[26px] border border-white/[0.08] hover:border-white/[0.18] p-6 sm:p-7 shadow-[0_8px_32px_rgba(0,0,0,0.6)] space-y-5 transition-all flex flex-col justify-between" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}" data-gallery="${encodeURIComponent(JSON.stringify(uniqueGallery))}">
        
        <div class="space-y-4">
          <!-- Card Header: Model Badge & Instant Stock Toggle Switch -->
          <div class="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3.5">
            <div class="flex items-center gap-2 flex-wrap">
              <input type="checkbox" class="prod-select-cb w-4 h-4 rounded accent-[#30D158] cursor-pointer" data-id="${p.id}" data-name="${(p.name || '').replace(/"/g, '&quot;')}" onchange="updateSelectedCount()" title="প্রোডাক্ট নির্বাচন করুন">
              <span class="font-mono font-bold text-sm bg-[#2C2C2E] text-white px-3 py-1 rounded-[10px] border border-white/[0.1]">${p.model_code || 'PROD'}</span>
              ${hasBundle ? `
                <span class="inline-flex items-center gap-1 text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-[10px] shadow-xs">
                  <span>🔥</span><span>${bundleBadge}</span>
                </span>
              ` : ''}
              
              <!-- 1-Click Inline Quick-Edit Stock Inventory -->
              <div class="inline-flex items-center">
                <div id="stock-view-${p.id}" class="text-xs text-[rgba(235,235,245,0.75)] bg-[#2C2C2E] px-2.5 py-1 rounded-[8px] border border-white/[0.06] hover:border-white/30 hover:text-white transition cursor-pointer flex items-center gap-1.5 group/stock" onclick="startInlineEditStock(${p.id}, ${p.stock_quantity || 1})" title="ক্লিক করে সরাসরি ইনভেন্টরি স্টক পরিবর্তন করুন">
                  <span>📦 <span id="stock-val-${p.id}">${p.stock_quantity || 1}</span> পিস ইনভেন্টরি</span>
                  <span class="opacity-0 group-hover/stock:opacity-100 text-[10px] text-[rgba(235,235,245,0.40)] transition">✎</span>
                </div>
                <div id="stock-edit-${p.id}" class="hidden flex items-center gap-1">
                  <input type="number" id="stock-input-${p.id}" value="${p.stock_quantity || 1}" min="0" class="w-16 px-2 py-0.5 text-xs font-bold bg-[#1C1C1E] border border-[#30D158]/50 rounded-[8px] text-white focus:outline-hidden focus:border-[#30D158]" onkeydown="if(event.key==='Enter') saveInlineStock(${p.id}); else if(event.key==='Escape') cancelInlineStock(${p.id}, ${p.stock_quantity || 1});">
                  <button type="button" onclick="saveInlineStock(${p.id})" class="px-2 py-0.5 rounded-[6px] bg-[#30D158] hover:bg-[#34C759] active:scale-95 text-black font-bold text-[10px]" title="সংরক্ষণ (Enter)">✓</button>
                  <button type="button" onclick="cancelInlineStock(${p.id}, ${p.stock_quantity || 1})" class="px-2 py-0.5 rounded-[6px] bg-white/15 hover:bg-white/25 active:scale-95 text-white font-bold text-[10px]" title="বাতিল (Esc)">✕</button>
                </div>
                <span id="stock-toast-${p.id}" class="hidden text-[11px] text-[#30D158] font-bold ml-1.5 animate-pulse">✓ সেভড</span>
              </div>
            </div>

            <!-- 1-Click Instant Stock Toggle -->
            <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition flex items-center gap-2 ${isOut ? 'bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30 hover:bg-[#FF453A]/25' : (isLow ? 'bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30 hover:bg-[#FF9F0A]/25' : 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 hover:bg-[#30D158]/25')}">
              <span class="w-2 h-2 rounded-full ${isOut ? 'bg-[#FF453A]' : (isLow ? 'bg-[#FF9F0A] animate-pulse' : 'bg-[#30D158] animate-pulse')}"></span>
              <span>${isOut ? 'স্টক আউট' : (isLow ? 'লো-স্টক (' + (p.stock_quantity || 1) + ')' : 'ইন-স্টক')}</span>
            </button>
          </div>

          <!-- Product Media & Details Layout (Spacious) -->
          <div class="flex gap-4 sm:gap-5 items-start">
            <!-- Product Photo with Multiple Thumbnail Switcher & 1-Click Enlarge -->
            <div class="shrink-0 space-y-2">
              <div class="relative group/cardimg cursor-pointer rounded-[18px] overflow-hidden" onclick="openCatalogLightbox(${p.id})" title="বড় করে দেখতে ছবিতে ক্লিক করুন">
                <img id="img-preview-${p.id}" src="${mainImg}" alt="${p.model_code}" class="w-28 h-36 sm:w-32 sm:h-40 object-cover rounded-[18px] bg-[#2C2C2E] border border-white/[0.1] shadow-md transition duration-200 group-hover/cardimg:scale-105">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover/cardimg:opacity-100 transition flex items-center justify-center pointer-events-none">
                  <span class="bg-black/80 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full border border-white/20 shadow-md">🔍 বড় দেখুন</span>
                </div>
              </div>
              
              <!-- Multi-Photo Switcher Dots (Up to 8) -->
              ${uniqueGallery.length > 1 ? `
                <div class="flex items-center gap-1.5 justify-center flex-wrap max-w-[128px]">
                  ${uniqueGallery.map((gUrl, gIdx) => `
                    <button type="button" onclick="switchCardPhoto(${p.id}, '${gUrl}')" class="w-3 h-3 rounded-full bg-white/30 hover:bg-white transition" title="ছবি ${gIdx + 1}"></button>
                  `).join('')}
                </div>
              ` : ''}
              <div class="text-[11px] text-center text-[rgba(235,235,245,0.40)] font-mono font-medium">📸 ${uniqueGallery.length}টি ছবি</div>
            </div>

            <!-- Product Specs & Title -->
            <div class="flex-1 min-w-0 space-y-2">
              <h3 class="font-bold text-white text-base sm:text-lg leading-snug line-clamp-2" title="${p.name}">${p.name}</h3>
              
              <!-- Pricing Engine with 1-Click Inline Quick-Edit -->
              <div class="flex items-baseline gap-2.5 pt-1 group/price relative">
                <!-- View Mode -->
                <div id="price-view-${p.id}" class="flex items-baseline gap-2 cursor-pointer hover:opacity-90 transition" onclick="startInlineEditPrice(${p.id}, ${p.price})" title="ক্লিক করে সরাসরি মূল্য পরিবর্তন করুন">
                  <span id="price-val-${p.id}" class="font-extrabold text-white text-xl sm:text-2xl">৳${p.price}</span>
                  <span class="opacity-0 group-hover/price:opacity-100 text-[10px] text-[rgba(235,235,245,0.50)] bg-white/10 px-1.5 py-0.5 rounded transition">✎ এডিট</span>
                  ${hasDiscount ? `<span class="text-[rgba(235,235,245,0.35)] line-through text-sm font-mono font-medium">৳${p.regular_price}</span>` : ''}
                  ${hasDiscount ? `<span class="text-xs text-[#30D158] font-semibold bg-[#30D158]/15 border border-[#30D158]/25 px-2 py-0.5 rounded-[6px]">ছাড়</span>` : ''}
                </div>
                <!-- Edit Mode (Hidden initially) -->
                <div id="price-edit-${p.id}" class="hidden flex items-center gap-1.5">
                  <span class="text-white font-bold text-base">৳</span>
                  <input type="number" id="price-input-${p.id}" value="${p.price}" min="0" class="w-24 px-2 py-1 text-base font-bold bg-[#1C1C1E] border border-[#30D158]/50 rounded-[10px] text-white focus:outline-hidden focus:border-[#30D158]" onkeydown="if(event.key==='Enter') saveInlinePrice(${p.id}); else if(event.key==='Escape') cancelInlinePrice(${p.id}, ${p.price});">
                  <button type="button" onclick="saveInlinePrice(${p.id})" class="p-1.5 rounded-[8px] bg-[#30D158] hover:bg-[#34C759] active:scale-95 text-black font-bold text-xs" title="সংরক্ষণ (Enter)">✓</button>
                  <button type="button" onclick="cancelInlinePrice(${p.id}, ${p.price})" class="p-1.5 rounded-[8px] bg-white/15 hover:bg-white/25 active:scale-95 text-white font-bold text-xs" title="বাতিল (Esc)">✕</button>
                </div>
                <span id="price-toast-${p.id}" class="hidden text-xs text-[#30D158] font-bold ml-1 animate-pulse">✓ সেভড</span>
              </div>

              <!-- Material / Fabric -->
              <div class="text-xs sm:text-sm text-[rgba(235,235,245,0.70)] flex items-center gap-1.5 pt-1">
                <span>✨</span>
                <span class="truncate">${p.fabric || 'স্ট্যান্ডার্ড প্রিমিয়াম কোয়ালিটি'}</span>
              </div>

              <!-- Available Sizes Chips -->
              <div class="cursor-pointer group/cardsizematrix pt-1" onclick="openSizeStockModal(${p.id})" title="ক্লিক করে সাইজ ও সাইজভিত্তিক স্টক দেখুন বা পরিবর্তন করুন">
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${cleanSizes.map(sz => `
                    <span class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] group-hover/cardsizematrix:bg-[#3A3A3C] text-[rgba(235,235,245,0.9)] border border-white/[0.08] transition shadow-xs">
                      ${sz}
                    </span>
                  `).join('')}
                </div>
                ${extraSizeNotes.length > 0 ? `
                  <div class="text-[11px] text-[rgba(235,235,245,0.50)] mt-1">
                    💡 ${extraSizeNotes.join(', ')}
                  </div>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Color Swatches (if any) -->
          ${colorChips.length > 0 ? `
            <div class="bg-[#2C2C2E] p-3 rounded-[16px] border border-white/[0.06] flex items-center gap-2 flex-wrap text-xs sm:text-sm">
              <span class="text-xs text-[rgba(235,235,245,0.40)] font-semibold uppercase tracking-wider">উপলব্ধ রং:</span>
              ${colorChips.map(col => `<span class="text-xs sm:text-sm px-3 py-1 rounded-full bg-[#1C1C1E] text-white border border-white/[0.08] font-medium">${col}</span>`).join('')}
            </div>
          ` : ''}

          <!-- AI Sales Intelligence Note (AI বট কাস্টমারকে যা বলবে) -->
          <div class="bg-[#2C2C2E] p-3.5 sm:p-4 rounded-[16px] border border-white/[0.06] space-y-2">
            <div class="flex items-center justify-between text-xs sm:text-sm">
              <span class="font-semibold text-[rgba(235,235,245,0.80)] flex items-center gap-1.5">
                <span>🤖</span><span>AI বিক্রয় নোট (গ্রাহককে কনভিন্সিং তথ্য):</span>
              </span>
              <button type="button" onclick="editAINotesPrompt(${p.id}, '${(p.short_description || '').replace(/'/g, "\\'")}')" class="text-white hover:underline text-xs font-semibold cursor-pointer">
                ✏️ এডিট
              </button>
            </div>
            <p id="ai-notes-${p.id}" class="text-xs sm:text-sm text-[rgba(235,235,245,0.85)] leading-relaxed italic line-clamp-2">
              ${p.short_description || 'কোনো বিশেষ নির্দেশনা দেওয়া নেই। AI স্ট্যান্ডার্ড ক্যাটালগ দেখে নিখুঁত বাংলায় উত্তর দেবে।'}
            </p>
          </div>
        </div>

        <!-- Action Buttons (Spacious & Clean) -->
        <div class="flex items-center justify-between gap-3 pt-3.5 border-t border-white/[0.06] text-xs sm:text-sm mt-3">
          <button type="button" onclick="openEditProductModalById(${p.id})" class="flex-1 bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold py-2.5 rounded-[14px] border border-white/[0.08] transition flex items-center justify-center gap-2 cursor-pointer shadow-xs">
            <span>✏️ সম্পূর্ণ প্রোডাক্ট এডিট</span>
          </button>
          <button type="button" onclick="openSafeDeleteModal(${p.id}, '${p.model_code}', '${p.name.replace(/'/g, "\\'")}', '${mainImg}')" class="bg-[#2C2C2E] hover:bg-[#FF453A]/20 text-[#FF453A] font-semibold px-4 py-2.5 rounded-[14px] border border-[#FF453A]/20 transition flex items-center justify-center gap-1.5 cursor-pointer" title="মুছে ফেলুন">
            <span>🗑️</span>
          </button>
        </div>

      </div>
      `;
    }).join('');

    // ========================================================
    // Render Amazon Seller Central Style Spreadsheet Table Rows
    // ========================================================
    const productTableRowsHtml = products.map(p => {
      const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '') + ' ' + (p.sizes || '')).toLowerCase();
      const isOut = !p.in_stock || (Number(p.stock_quantity) === 0);
      const isLow = !isOut && (Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= 5);
      const stockStatus = isOut ? 'STOCK_OUT' : (isLow ? 'LOW_STOCK' : 'IN_STOCK');
      const mainImg = p.image_url || 'https://placehold.co/300x380/1c1c1e/ffffff?text=' + encodeURIComponent(p.model_code || 'PROD');
      const hasDiscount = p.regular_price && Number(p.regular_price) > Number(p.price);

      // Extract all gallery photos (up to 8)
      const gallery = [
        p.image_url,
        p.detail_image_url,
        p.real_image_url,
        p.hijab_image_url,
        p.flare_image_url,
        ...(p.custom_attributes?.gallery_images || [])
      ].filter(u => typeof u === 'string' && u.trim());
      const uniqueGallery = Array.from(new Set(gallery)).slice(0, 8);

      // Sizes chips with clean tokens and separate extra notes
      const rawSizeTokens = (p.sizes || 'স্ট্যান্ডার্ড').split(',').map(s => s.trim()).filter(Boolean);
      let extraSizeNotes = [];
      const cleanSizes = rawSizeTokens.map(tok => {
        const parenMatch = tok.match(/\(([^)]+)\)/);
        if (parenMatch) {
          extraSizeNotes.push(parenMatch[1].trim());
        }
        return tok.replace(/\([^)]+\)/g, '').trim();
      }).filter(Boolean);

      // Dynamic Bundle & Offer Badges
      const cAttr = p.custom_attributes || {};
      const hasBundle = cAttr.bundle_active === true || cAttr.bundle_active === 'true';
      const bundleBadge = hasBundle ? (cAttr.bundle_label || '🔥 বান্ডেল অফার') : '';

      return `
      <tr class="prod-table-row border-b border-white/[0.04] hover:bg-[#2C2C2E]/40 transition text-sm" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}" data-gallery="${encodeURIComponent(JSON.stringify(uniqueGallery))}">
        <!-- Col 0: Multi-Select Checkbox -->
        <td class="p-4 text-center align-middle w-10">
          <input type="checkbox" class="prod-select-cb w-4 h-4 rounded accent-[#30D158] cursor-pointer" data-id="${p.id}" data-name="${(p.name || '').replace(/"/g, '&quot;')}" onchange="updateSelectedCount()" title="প্রোডাক্ট নির্বাচন করুন">
        </td>

        <!-- Col 1: Status & Quick Stock Switch -->
        <td class="p-4 align-middle">
          <div class="space-y-1">
            ${isOut ? `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-bold bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30">
                <span class="w-1.5 h-1.5 rounded-full bg-[#FF453A]"></span>স্টক আউট
              </span>
            ` : (isLow ? `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-bold bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30" title="স্টক সীমিত, দ্রুত রি-স্টক করুন">
                <span class="w-1.5 h-1.5 rounded-full bg-[#FF9F0A] animate-pulse"></span>লো-স্টক (${p.stock_quantity})
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-bold bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30">
                <span class="w-1.5 h-1.5 rounded-full bg-[#30D158] animate-pulse"></span>অ্যাক্টিভ
              </span>
            `)}
            <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-[11px] text-[rgba(235,235,245,0.40)] hover:text-white underline cursor-pointer block font-medium">
              ${p.in_stock ? 'স্টক আউট করুন' : 'ইন-স্টক করুন'}
            </button>
          </div>
        </td>

        <!-- Col 2: Image Thumbnail with Mini Gallery Preview -->
        <td class="p-4 align-middle">
          <div class="flex items-center gap-2">
            <div class="relative group/tblimg cursor-pointer shrink-0 rounded-[14px] overflow-hidden shadow-xs border border-white/[0.1] bg-[#2C2C2E]" onclick="openCatalogLightbox(${p.id})" title="বড় করে দেখতে ক্লিক করুন">
              <img id="tbl-img-preview-${p.id}" src="${mainImg}" alt="${p.model_code}" class="w-12 h-16 sm:w-14 sm:h-18 object-cover group-hover/tblimg:scale-105 transition duration-200">
              ${uniqueGallery.length > 1 ? `
                <span class="absolute bottom-1 right-1 bg-black/80 backdrop-blur-xs text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-[5px] border border-white/20">
                  ${uniqueGallery.length}
                </span>
              ` : ''}
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover/tblimg:opacity-100 transition flex items-center justify-center pointer-events-none">
                <span class="text-white text-xs">🔍</span>
              </div>
            </div>
            ${uniqueGallery.length > 1 ? `
              <div class="flex flex-col gap-1">
                ${uniqueGallery.slice(0, 3).map((g, gIdx) => `
                  <img src="${g}" onclick="event.stopPropagation(); document.getElementById('tbl-img-preview-${p.id}').src='${g}';" class="w-4 h-5 rounded-[4px] object-cover border border-white/15 hover:border-white cursor-pointer hover:scale-110 transition shadow-xs" title="ছবি ${gIdx+1}">
                `).join('')}
              </div>
            ` : ''}
          </div>
        </td>

        <!-- Col 3: SKU & Title Details -->
        <td class="p-4 align-middle max-w-[280px]">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-mono font-bold text-xs bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[6px] border border-white/[0.1]">${p.model_code || 'PROD'}</span>
            ${hasBundle ? `<span class="inline-flex items-center gap-1 text-[10px] text-amber-300 font-bold bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-[6px]">🔥 ${bundleBadge}</span>` : ''}
            ${hasDiscount ? `<span class="text-[10px] text-[#30D158] font-bold bg-[#30D158]/15 border border-[#30D158]/25 px-1.5 py-0.5 rounded-[4px]">অফার</span>` : ''}
          </div>
          <div class="font-bold text-white text-sm mt-1 truncate" title="${p.name.replace(/"/g, '&quot;')}">${p.name}</div>
          <div class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5 truncate" title="${(p.fabric || 'স্ট্যান্ডার্ড').replace(/"/g, '&quot;')}">✨ ${p.fabric || 'স্ট্যান্ডার্ড প্রিমিয়াম কোয়ালিটি'}</div>
        </td>

        <!-- Col 4: Sizes -->
        <td class="p-4 align-middle">
          <div class="cursor-pointer group/sizematrix inline-block" onclick="openSizeStockModal(${p.id})" title="ক্লিক করে সাইজ ও সাইজভিত্তিক স্টক দেখুন বা পরিবর্তন করুন">
            <div class="flex items-center gap-1.5 flex-wrap max-w-[150px]">
              ${cleanSizes.map(sz => `
                <span class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] group-hover/sizematrix:bg-[#3A3A3C] text-[rgba(235,235,245,0.9)] border border-white/[0.08] transition shadow-xs">
                  ${sz}
                </span>
              `).join('')}
            </div>
            ${extraSizeNotes.length > 0 ? `
              <div class="text-[10px] text-[rgba(235,235,245,0.45)] mt-1 truncate max-w-[150px]" title="${extraSizeNotes.join(', ')}">
                💡 ${extraSizeNotes[0]}
              </div>
            ` : ''}
          </div>
        </td>

        <!-- Col 5: Price with 1-Click Inline Quick-Edit -->
        <td class="p-4 align-middle">
          <div class="inline-flex items-center group/tblprice">
            <div id="tbl-price-view-${p.id}" class="flex items-baseline gap-1.5 cursor-pointer hover:opacity-85 transition" onclick="startInlineEditPrice(${p.id}, ${p.price})" title="ক্লিক করে সরাসরি মূল্য এডিট করুন">
              <span id="tbl-price-val-${p.id}" class="font-extrabold text-white text-base font-mono">৳${Number(p.price).toLocaleString('en-IN')}</span>
              <span class="opacity-0 group-hover/tblprice:opacity-100 text-[10px] text-[rgba(235,235,245,0.50)] transition">✎</span>
            </div>
            <div id="tbl-price-edit-${p.id}" class="hidden flex items-center gap-1">
              <span class="text-white text-xs font-bold">৳</span>
              <input type="number" id="tbl-price-input-${p.id}" value="${p.price}" min="0" class="w-20 px-1.5 py-0.5 text-xs font-bold bg-[#1C1C1E] border border-[#30D158]/50 rounded-[6px] text-white focus:outline-hidden focus:border-[#30D158]" onkeydown="if(event.key==='Enter') saveInlinePrice(${p.id}); else if(event.key==='Escape') cancelInlinePrice(${p.id}, ${p.price});">
              <button type="button" onclick="saveInlinePrice(${p.id})" class="px-1.5 py-0.5 rounded-[4px] bg-[#30D158] hover:bg-[#34C759] text-black font-bold text-[10px]" title="সেভ (Enter)">✓</button>
              <button type="button" onclick="cancelInlinePrice(${p.id}, ${p.price})" class="px-1.5 py-0.5 rounded-[4px] bg-white/20 hover:bg-white/30 text-white font-bold text-[10px]" title="বাতিল (Esc)">✕</button>
            </div>
            <span id="tbl-price-toast-${p.id}" class="hidden text-[10px] text-[#30D158] font-bold ml-1 animate-pulse">✓</span>
          </div>
          ${hasDiscount ? `<div class="text-[11px] text-[rgba(235,235,245,0.40)] line-through font-mono mt-0.5">৳${Number(p.regular_price).toLocaleString('en-IN')}</div>` : ''}
        </td>

        <!-- Col 6: Inventory Stock with Quick +/- Buttons & Inline Type -->
        <td class="p-4 align-middle">
          <div class="inline-flex items-center gap-1 group/tblstock">
            <button type="button" onclick="stepStock(${p.id}, -1)" class="w-6 h-6 rounded-[6px] bg-[#2C2C2E] hover:bg-[#3A3A3C] active:scale-95 text-white text-xs font-bold flex items-center justify-center border border-white/[0.08] cursor-pointer" title="১ পিস কমান">-</button>
            
            <div id="tbl-stock-view-${p.id}" class="text-xs font-mono font-bold text-white bg-[#2C2C2E] px-2.5 py-1 rounded-[6px] border border-white/[0.08] hover:border-white/30 hover:text-white cursor-pointer transition flex items-center gap-1" onclick="startInlineEditStock(${p.id}, ${p.stock_quantity || 1})" title="সরাসরি স্টক সংখ্যা লিখুন">
              <span id="tbl-stock-val-${p.id}">${p.stock_quantity || 1}</span>
              <span class="opacity-0 group-hover/tblstock:opacity-100 text-[9px] text-[rgba(235,235,245,0.40)]">✎</span>
            </div>

            <button type="button" onclick="stepStock(${p.id}, 1)" class="w-6 h-6 rounded-[6px] bg-[#2C2C2E] hover:bg-[#3A3A3C] active:scale-95 text-white text-xs font-bold flex items-center justify-center border border-white/[0.08] cursor-pointer" title="১ পিস বাড়ান">+</button>

            <div id="tbl-stock-edit-${p.id}" class="hidden flex items-center gap-1">
              <input type="number" id="tbl-stock-input-${p.id}" value="${p.stock_quantity || 1}" min="0" class="w-14 px-1 py-0.5 text-xs font-bold bg-[#1C1C1E] border border-[#30D158]/50 rounded-[6px] text-white focus:outline-hidden focus:border-[#30D158]" onkeydown="if(event.key==='Enter') saveInlineStock(${p.id}); else if(event.key==='Escape') cancelInlineStock(${p.id}, ${p.stock_quantity || 1});">
              <button type="button" onclick="saveInlineStock(${p.id})" class="px-1.5 py-0.5 rounded-[4px] bg-[#30D158] hover:bg-[#34C759] text-black font-bold text-[10px]" title="সেভ">✓</button>
              <button type="button" onclick="cancelInlineStock(${p.id}, ${p.stock_quantity || 1})" class="px-1.5 py-0.5 rounded-[4px] bg-white/20 hover:bg-white/30 text-white font-bold text-[10px]" title="বাতিল">✕</button>
            </div>
            <span id="tbl-stock-toast-${p.id}" class="hidden text-[10px] text-[#30D158] font-bold ml-1 animate-pulse">✓</span>
          </div>
        </td>

        <!-- Col 7: AI Status -->
        <td class="p-4 align-middle">
          <div class="space-y-1">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-semibold bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30">
              <span>🤖 AI সিঙ্কড</span>
            </span>
            <div class="text-[10px] text-[rgba(235,235,245,0.40)] truncate max-w-[120px]" title="${(p.short_description || 'স্বয়ংক্রিয় সেলস অ্যাসিস্ট্যান্ট সক্রিয়').replace(/"/g, '&quot;')}">
              ${p.short_description || 'স্বয়ংক্রিয় রেডি'}
            </div>
          </div>
        </td>

        <!-- Col 8: Actions -->
        <td class="p-4 align-middle text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button type="button" onclick="openEditProductModalById(${p.id})" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white text-xs font-semibold px-2.5 py-1.5 rounded-[10px] border border-white/[0.08] transition flex items-center gap-1 cursor-pointer" title="সম্পূর্ণ প্রোডাক্ট এডিট">
              <span>✏️ এডিট</span>
            </button>
            <button type="button" onclick="openSafeDeleteModal(${p.id}, '${p.model_code}', '${p.name.replace(/'/g, "\\'")}', '${mainImg}')" class="bg-[#2C2C2E] hover:bg-[#FF453A]/20 text-[#FF453A] text-xs font-semibold px-2.5 py-1.5 rounded-[10px] border border-[#FF453A]/20 transition flex items-center justify-center cursor-pointer" title="মুছে ফেলুন">
              <span>🗑️</span>
            </button>
          </div>
        </td>
      </tr>
      `;
    }).join('');

    // ========================================================
    // Render Order Rows (Apple HIG Orders Table)
    // ========================================================
    const orderRowsHtml = orders.map(o => {
      const prodPrice = Number(o.total_bdt) || 0;
      const dueCod = Number(o.due_cod) || prodPrice;
      const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
      const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
      const searchMeta = (o.id + ' ' + (o.model_code || '') + ' ' + (o.customer_name || '') + ' ' + (o.customer_phone || '') + ' ' + (o.address || '')).toLowerCase();

      // Dynamic Actor / Confirmed By Resolution (AI vs Merchant/Manual)
      const isManual = (o.order_notes || '').toLowerCase().includes('manual') || o.source_channel === 'MANUAL';
      const botPersona = curSettings.bot_persona_name || 'AI ইনচার্জ';
      const confirmedByTitle = isManual ? '👤 মার্চেন্ট নিজে' : `🤖 ${botPersona} (AI)`;
      const confirmedByBadge = isManual 
        ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' 
        : 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30';

      return `
      <tr class="order-row border-b border-white/[0.04] hover:bg-[#2C2C2E]/40 transition text-sm" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-model="${o.model_code || 'PROD'}" data-created="${o.created_at || ''}" data-due="${dueCod}" data-search="${searchMeta}">
        <td class="p-4">
          <div class="font-mono font-bold text-white text-sm">#${o.id}</div>
          <div class="text-xs text-[rgba(235,235,245,0.40)] mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
        </td>
        <td class="p-4">
          <div class="font-bold text-white text-sm">${o.customer_name || 'কাস্টমার'}</div>
          <div class="text-xs text-[rgba(235,235,245,0.60)] font-mono mt-0.5">📞 ${o.customer_phone || ''}</div>
          <!-- Distinct WhatsApp Origin Badge -->
          <div class="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <a href="https://wa.me/${waPhone}" target="_blank" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-[#30D158]/15 border border-[#30D158]/30 text-[#30D158] text-[11px] font-mono font-bold hover:bg-[#30D158]/25 transition" title="গ্রাহকের সাথে হোয়াটসঅ্যাপে চ্যাট করুন">
              <span>💬 WhatsApp:</span>
              <span>${o.customer_phone || ''}</span>
            </a>
          </div>
        </td>
        <td class="p-4 max-w-[220px]">
          <div class="text-xs sm:text-sm text-[rgba(235,235,245,0.85)] line-clamp-2" title="${o.address || ''}">
            <span>📍 ${o.address || 'ঠিকানা দেওয়া হয়নি'}</span>
          </div>
        </td>
        <td class="p-4">
          <span class="font-mono font-bold text-white text-sm">[${o.model_code || 'PROD'}]</span>
          <div class="text-xs text-[rgba(235,235,245,0.50)] mt-0.5">সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'}</div>
        </td>
        <td class="p-4">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-xs font-semibold border ${confirmedByBadge}">
            <span>${confirmedByTitle}</span>
          </span>
        </td>
        <td class="p-4">
          <span class="font-extrabold text-white text-base font-mono">৳${dueCod}</span>
        </td>
        <td class="p-4">
          <select onchange="updateOrderStatusLive(${o.id}, this.value)" class="text-xs sm:text-sm font-semibold rounded-[12px] px-3 py-1.5 border outline-none cursor-pointer ${
            (o.status === 'Approved' || o.status === 'Confirmed') ? 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30' :
            (o.status === 'Shipped' || o.status === 'In Transit') ? 'bg-sky-500/15 text-sky-400 border-sky-500/30' :
            (o.status === 'Delivered' || o.status === 'Completed') ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
            (o.status === 'Cancelled' || o.status === 'Returned') ? 'bg-[#FF453A]/15 text-[#FF453A] border-[#FF453A]/30' :
            'bg-[#FF9F0A]/15 text-[#FF9F0A] border-[#FF9F0A]/30'
          }">
            <option value="Booked" class="bg-[#1C1C1E] text-white" ${(o.status === 'Booked' || o.status === 'Pending' || o.status === 'Pending Verification') ? 'selected' : ''}>📦 Booked</option>
            <option value="Approved" class="bg-[#1C1C1E] text-white" ${(o.status === 'Approved' || o.status === 'Confirmed') ? 'selected' : ''}>✅ Confirmed</option>
            <option value="Shipped" class="bg-[#1C1C1E] text-white" ${(o.status === 'Shipped' || o.status === 'In Transit') ? 'selected' : ''}>🚚 Shipped</option>
            <option value="Delivered" class="bg-[#1C1C1E] text-white" ${(o.status === 'Delivered' || o.status === 'Completed') ? 'selected' : ''}>🎉 Delivered</option>
            <option value="Returned" class="bg-[#1C1C1E] text-white" ${o.status === 'Returned' ? 'selected' : ''}>↩️ Returned</option>
            <option value="Cancelled" class="bg-[#1C1C1E] text-white" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
          </select>
        </td>
        <td class="p-4 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button type="button" onclick="openOrderDetailsModal(${o.id})" title="অর্ডারের পূর্ণাঙ্গ বিস্তারিত দেখুন" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white text-xs font-semibold px-2.5 py-1.5 rounded-[10px] border border-white/[0.1] transition flex items-center gap-1 cursor-pointer shadow-xs active:scale-95">
              <span>🔍 ডিটেইলস</span>
            </button>
            <button type="button" onclick="printOrderMemo(${o.id})" title="কাস্টমার ক্যাশ মেমো / পার্সেল স্লিপ প্রিন্ট" class="bg-[#2C2C2E] hover:bg-white hover:text-black text-white text-xs font-semibold px-2.5 py-1.5 rounded-[10px] border border-white/[0.1] transition flex items-center gap-1 cursor-pointer shadow-xs active:scale-95">
              <span>🖨️ মেমো</span>
            </button>
            <button type="button" onclick="copyCourierFormat(${o.id})" title="কুরিয়ার ফরম্যাট কপি" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[rgba(235,235,245,0.80)] hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-[10px] border border-white/[0.08] transition cursor-pointer">
              📋
            </button>
          </div>
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
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Plus Jakarta Sans", "Hind Siliguri", sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .apple-glass {
      background-color: rgba(28, 28, 30, 0.75);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
    }

    /* ========================================== */
    /* APPLE HIG LIGHT MODE STYLES                */
    /* ========================================== */
    body.light-mode {
      background-color: #F2F2F7 !important;
      color: #1C1C1E !important;
    }
    body.light-mode header.apple-glass {
      background-color: rgba(255, 255, 255, 0.90) !important;
      border-bottom-color: rgba(0, 0, 0, 0.08) !important;
      box-shadow: 0 1px 12px rgba(0, 0, 0, 0.03) !important;
    }

    /* All White Cards in Light Mode */
    body.light-mode .prod-card,
    body.light-mode .metric-card,
    body.light-mode .tab-box,
    body.light-mode .tabs-bar,
    body.light-mode .modal-card,
    body.light-mode [class*="bg-[#1C1C1E]"] {
      background-color: #FFFFFF !important;
      border-color: rgba(0, 0, 0, 0.08) !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
      color: #1C1C1E !important;
    }

    /* Secondary Light Gray Boxes, Chips, Badges, Dropdowns, AI Notes */
    body.light-mode [class*="bg-[#2C2C2E]"] {
      background-color: #F2F2F7 !important;
      border-color: rgba(0, 0, 0, 0.08) !important;
      color: #1C1C1E !important;
    }

    /* Thumbnail Dots on Card */
    body.light-mode button[onclick*="switchCardPhoto"] {
      background-color: rgba(0, 0, 0, 0.2) !important;
    }
    body.light-mode button[onclick*="switchCardPhoto"]:hover {
      background-color: rgba(0, 0, 0, 0.7) !important;
    }

    /* Delete Button on Card */
    body.light-mode button[onclick*="openSafeDeleteModal"],
    body.light-mode [class*="hover:bg-[#FF453A]"] {
      background-color: #FFF2F2 !important;
      border-color: rgba(255, 69, 58, 0.25) !important;
      color: #FF3B30 !important;
    }

    /* Inputs & Textareas */
    body.light-mode input,
    body.light-mode textarea,
    body.light-mode select {
      background-color: #F2F2F7 !important;
      color: #1C1C1E !important;
      border-color: rgba(0, 0, 0, 0.12) !important;
    }
    body.light-mode input::placeholder,
    body.light-mode textarea::placeholder {
      color: #8E8E93 !important;
    }

    /* Typography in Light Mode */
    body.light-mode h1,
    body.light-mode h2,
    body.light-mode h3,
    body.light-mode h4 {
      color: #1C1C1E !important;
    }
    body.light-mode [class*="text-2xl"],
    body.light-mode [class*="text-3xl"],
    body.light-mode [class*="text-xl"] {
      color: #000000 !important;
    }
    body.light-mode .text-white:not(.keep-white) {
      color: #1C1C1E !important;
    }
    body.light-mode [class*="text-[rgba(235,235,245,0.85)"],
    body.light-mode [class*="text-[rgba(235,235,245,0.80)"],
    body.light-mode [class*="text-[rgba(235,235,245,0.70)"] {
      color: #3A3A3C !important;
    }
    body.light-mode [class*="text-[rgba(235,235,245,0.60)"],
    body.light-mode [class*="text-[rgba(235,235,245,0.45)"],
    body.light-mode [class*="text-[rgba(235,235,245,0.40)"] {
      color: #636366 !important;
    }
    body.light-mode [class*="text-[rgba(235,235,245,0.35)"] {
      color: #8E8E93 !important;
    }

    /* Subtle Borders in Light Mode */
    body.light-mode [class*="border-white/"],
    body.light-mode [class*="border-white"] {
      border-color: rgba(0, 0, 0, 0.08) !important;
    }

    /* Buttons */
    body.light-mode button[class*="bg-[#1C1C1E]"],
    body.light-mode a[class*="bg-[#1C1C1E]"],
    body.light-mode button[class*="bg-[#2C2C2E]"] {
      background-color: #F2F2F7 !important;
      color: #1C1C1E !important;
      border-color: rgba(0, 0, 0, 0.1) !important;
    }
    body.light-mode button[class*="bg-[#1C1C1E]"]:hover,
    body.light-mode a[class*="bg-[#1C1C1E]"]:hover,
    body.light-mode button[class*="bg-[#2C2C2E]"]:hover {
      background-color: #E5E5EA !important;
      color: #000000 !important;
    }

    /* Primary White Buttons Inverted to Apple Dark in Light Mode */
    body.light-mode button.bg-white {
      background-color: #1C1C1E !important;
      color: #FFFFFF !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15) !important;
    }
    body.light-mode button.bg-white * {
      color: #FFFFFF !important;
    }

    /* Keep colored status badges vibrant */
    body.light-mode [class*="text-[#30D158]"] {
      color: #28CD41 !important;
    }
    body.light-mode [class*="text-[#FF453A]"] {
      color: #FF3B30 !important;
    }
    body.light-mode [class*="text-[#FF9F0A]"] {
      color: #FF9500 !important;
    }

    /* Tabs & Filters */
    body.light-mode .tab-btn {
      color: #636366 !important;
    }
    body.light-mode .tab-btn:hover {
      color: #000000 !important;
    }
    body.light-mode .tab-btn[class*="bg-[#2C2C2E]"] {
      background-color: #E5E5EA !important;
      color: #000000 !important;
      font-weight: 700 !important;
    }
    body.light-mode .tab-btn [class*="bg-[#3A3A3C]"] {
      background-color: #D1D1D6 !important;
      color: #000000 !important;
    }
    body.light-mode .order-filter-btn[class*="bg-[#2C2C2E]"],
    body.light-mode .stock-filter-btn[class*="bg-[#2C2C2E]"] {
      background-color: #E5E5EA !important;
      color: #000000 !important;
      font-weight: 700 !important;
    }

    /* Table */
    body.light-mode table thead {
      background-color: #F2F2F7 !important;
    }
    body.light-mode table thead th {
      color: #636366 !important;
    }
    body.light-mode table tbody tr {
      border-bottom: 1px solid rgba(0, 0, 0, 0.06) !important;
    }
    body.light-mode table tbody td {
      color: #1C1C1E !important;
    }

    /* ======================================================== */
    /* CLEAN THERMAL POS & A4 PRINT MEDIA STYLES                */
    /* ======================================================== */
    @media print {
      body * {
        visibility: hidden !important;
      }
      #printableMemoModal,
      #printableMemoModal * {
        visibility: visible !important;
      }
      #printableMemoModal {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        background: #FFFFFF !important;
        color: #000000 !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
        display: block !important;
      }
      #printableMemoModal > div {
        background: #FFFFFF !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 auto !important;
        max-width: 100% !important;
      }
      #memoPrintContent {
        background: #FFFFFF !important;
        color: #000000 !important;
        border: none !important;
        box-shadow: none !important;
        padding: 10px !important;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body class="bg-[#000000] text-[rgba(235,235,245,0.70)] min-h-screen pb-24 selection:bg-white/20 selection:text-white transition-colors duration-200">
  <script>
    (function() {
      try {
        if (localStorage.getItem('autodokan_merchant_theme') === 'light') {
          document.body.classList.add('light-mode');
        }
      } catch(e) {}
    })();
  </script>
  
  <!-- Apple Frosted Glass Top Navbar -->
  <header class="apple-glass border-b border-white/[0.08] sticky top-0 z-40 px-5 sm:px-8 py-4 transition-colors duration-200">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
      
      <div class="flex items-center gap-3.5">
        <div class="w-11 h-11 rounded-[16px] bg-[#1C1C1E] border border-white/[0.12] text-white flex items-center justify-center font-bold text-xl shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
          🏪
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="font-bold text-base sm:text-xl text-white tracking-tight">${shopName}</h1>
            <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.70)] text-xs font-semibold px-2.5 py-0.5 rounded-full border border-white/[0.06]">মার্চেন্ট পোর্টাল</span>
          </div>
          <div class="flex items-center gap-2.5 mt-0.5 text-xs sm:text-sm text-[rgba(235,235,245,0.40)]">
            <span class="inline-flex items-center gap-1.5 ${isConnected ? 'text-[#30D158]' : 'text-[rgba(235,235,245,0.60)]'} font-medium">
              <span class="w-2 h-2 rounded-full ${isConnected ? 'bg-[#30D158] animate-pulse' : 'bg-[rgba(235,235,245,0.30)]'}"></span>
              <span>${isConnected ? 'WhatsApp বট সক্রিয় (+' + liveNum + ')' : 'বট অপেক্ষমাণ'}</span>
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <!-- Dual Mode Toggle Button (Light / Dark) -->
        <button type="button" onclick="toggleTheme()" id="themeToggleBtn" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-[12px] border border-white/[0.08] transition flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95" title="থিম পরিবর্তন করুন (লাইট / ডার্ক)">
          <span id="themeToggleIcon" class="text-xs">☀️</span>
          <span id="themeToggleText" class="hidden sm:inline">লাইট মোড</span>
        </button>

        <a href="/connect?token=${token}" target="_blank" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white text-xs sm:text-sm font-semibold px-3.5 py-1.5 rounded-[12px] border border-white/[0.08] transition flex items-center gap-1.5 shadow-xs">
          <span>📲 WhatsApp QR লিঙ্ক</span>
        </a>

        <!-- Logout Button -->
        <button type="button" onclick="logoutMerchantPortal()" class="bg-[#1C1C1E] hover:bg-[#FF453A]/15 text-[rgba(235,235,245,0.70)] hover:text-[#FF453A] text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-[12px] border border-white/[0.08] hover:border-[#FF453A]/30 transition flex items-center gap-1 shadow-xs cursor-pointer active:scale-95" title="লগআউট করে টোকেন পরিবর্তন করুন">
          <span>🚪</span>
          <span class="hidden sm:inline">লগআউট</span>
        </button>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">

    <!-- Navigation Tabs (Apple Segmented Control Style - Direct, Sleek & Zero Clutter) -->
    <div class="tabs-bar bg-[#1C1C1E] border border-white/[0.08] p-1.5 rounded-[18px] flex items-center justify-between gap-3 overflow-x-auto no-scrollbar shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-4 sm:px-5 py-2 rounded-[13px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]">
          <span>📦 প্রোডাক্টস স্টুডিও</span>
          <span class="bg-[#3A3A3C] text-white text-[11px] px-2 py-0.5 rounded-full font-bold">${totalProducts}</span>
        </button>

        <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-4 sm:px-5 py-2 rounded-[13px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white">
          <span>📋 কাস্টমার অর্ডারস</span>
          <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.50)] text-[11px] px-2 py-0.5 rounded-full font-bold">${totalOrders}</span>
        </button>

        <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-4 sm:px-5 py-2 rounded-[13px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white">
          <span>⚙️ শপ সেটিংস ও পলিসি</span>
        </button>
      </div>

      <!-- Quick KPI summary pills embedded right in the tab bar on the right -->
      <div class="hidden md:flex items-center gap-2.5 pr-2 text-xs font-medium shrink-0">
        <div onclick="openSalesHistoryModal()" class="cursor-pointer hover:opacity-85 transition flex items-center gap-1.5 bg-[#2C2C2E]/70 px-3 py-1.5 rounded-[12px] border border-emerald-500/25 text-emerald-400" title="ক্লিক করে বিক্রয় হিস্ট্রি ও অ্যানালিটিক্স দেখুন">
          <span>💰 বিক্রয়:</span>
          <span class="font-bold font-mono">৳${formatMoney(totalRevenue)}</span>
          <span class="text-[10px] text-emerald-300 font-normal">(${todayOrders.length > 0 ? 'আজকে ৳' + Number(todayRevenue).toLocaleString('en-IN') : 'হিস্ট্রি'})</span>
        </div>
        <div class="flex items-center gap-1.5 bg-[#2C2C2E]/70 px-3 py-1.5 rounded-[12px] border border-cyan-500/25 text-cyan-400" title="ওয়্যারহাউজ স্টক সম্পদ">
          <span>💎 ইনভেন্টরি:</span>
          <span class="font-bold font-mono">৳${formatMoney(totalInventoryValue)}</span>
        </div>
      </div>
    </div>

    <!-- TAB 1: PRODUCTS STUDIO -->
    <section id="tab-products" class="space-y-6">
      <div class="tab-box bg-[#1C1C1E] rounded-[28px] border border-white/[0.08] p-6 sm:p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] space-y-6">
        
        <!-- Search, Stock Filters & Add Product Action Bar -->
        <div class="flex flex-col lg:flex-row lg:items-center justify-between border-b border-white/[0.06] pb-5 gap-4">
          <div>
            <h2 class="font-bold text-lg sm:text-xl text-white tracking-tight flex items-center gap-2">
              <span>📦 প্রোডাক্ট ক্যাটালগ ও AI ইনভেন্টরি ম্যানেজমেন্ট</span>
            </h2>
            <div class="text-xs sm:text-sm text-[rgba(235,235,245,0.60)] mt-1 flex items-center gap-2.5 flex-wrap">
              <span>মোট <strong class="text-white font-bold">${totalProducts}টি</strong> পণ্য (<strong class="text-[#30D158] font-bold">${inStockProducts}টি স্টকে সক্রিয়</strong>)</span>
              <span>•</span>
              <span class="text-cyan-400 font-bold font-mono">ইনভেন্টরি সম্পদ: ৳${formatMoney(totalInventoryValue)}</span>
            </div>
          </div>

          <div class="flex items-center gap-3 flex-wrap w-full sm:w-auto">
            <input type="text" id="prodSearch" oninput="filterProducts(this.value)" placeholder="🔍 কোড, নাম, ফেব্রিক, কালার খুঁজুন..." class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs sm:text-sm px-4 py-2.5 rounded-[14px] focus:outline-none focus:border-white/40 transition w-full sm:w-72">
            
            <button type="button" onclick="openAddProductModal()" class="bg-white hover:bg-[#E5E5EA] text-black font-semibold text-xs sm:text-sm px-5 py-2.5 rounded-[14px] shadow-[0_2px_12px_rgba(255,255,255,0.15)] transition cursor-pointer flex items-center gap-2 active:scale-95 shrink-0">
              <span>➕ নতুন প্রোডাক্ট যোগ করুন</span>
            </button>
          </div>
        </div>

        <!-- Stock Filter Buttons & View Switcher (Amazon Grid vs Cards) -->
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 text-xs sm:text-sm font-semibold flex-wrap">
            <button type="button" onclick="filterStock('ALL')" id="filter-stock-all" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer">সবগুলো (${totalProducts})</button>
            <button type="button" onclick="filterStock('IN_STOCK')" id="filter-stock-instock" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">স্টকে আছে (${inStockProducts})</button>
            <button type="button" onclick="filterStock('LOW_STOCK')" id="filter-stock-low_stock" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">⚠️ লো-স্টক (${lowStockProducts})</button>
            <button type="button" onclick="filterStock('STOCK_OUT')" id="filter-stock-out" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">স্টক আউট (${stockOutProducts})</button>
          </div>

          <!-- Amazon Grid vs Rich Cards View Switcher -->
          <div class="flex items-center gap-1 bg-[#2C2C2E] p-1 rounded-[14px] border border-white/[0.08]">
            <button type="button" onclick="switchProductView('table')" id="view-mode-table-btn" class="px-3 py-1.5 rounded-[10px] text-xs font-bold bg-white text-black shadow-xs transition cursor-pointer flex items-center gap-1.5" title="অ্যামাজন সেলার সেন্ট্রাল স্প্রেডশিট গ্রিড ভিউ">
              <span>📋 টেবিল গ্রিড (Amazon)</span>
            </button>
            <button type="button" onclick="switchProductView('cards')" id="view-mode-cards-btn" class="px-3 py-1.5 rounded-[10px] text-xs font-semibold text-[rgba(235,235,245,0.60)] hover:text-white transition cursor-pointer flex items-center gap-1.5" title="শোকেস কার্ড ভিউ">
              <span>🖼️ কার্ড ভিউ</span>
            </button>
          </div>
        </div>

        <!-- 1. Amazon-Style Spreadsheet Table View -->
        <div id="productsTableView" class="overflow-x-auto border border-white/[0.06] rounded-[22px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <table class="w-full text-left text-[rgba(235,235,245,0.70)] text-sm">
            <thead class="bg-[#2C2C2E] text-[rgba(235,235,245,0.50)] font-semibold border-b border-white/[0.06] text-xs uppercase tracking-wider">
              <tr>
                <th class="p-4 w-10 text-center">
                  <input type="checkbox" id="selectAllProds" onchange="toggleSelectAllProds(this.checked)" class="w-4 h-4 rounded accent-[#30D158] cursor-pointer" title="সবগুলো নির্বাচন করুন">
                </th>
                <th class="p-4">স্ট্যাটাস</th>
                <th class="p-4">ছবি</th>
                <th class="p-4">SKU / মডেল ও বিবরণ</th>
                <th class="p-4">সাইজ</th>
                <th class="p-4">বিক্রয় মূল্য</th>
                <th class="p-4">ইনভেন্টরি স্টক</th>
                <th class="p-4">AI ব্রেন</th>
                <th class="p-4 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody id="productsTableBody">
              ${productTableRowsHtml || '<tr><td colspan="9" class="p-12 text-center text-[rgba(235,235,245,0.35)] font-semibold">এখনও কোনো প্রোডাক্ট নেই। উপরে "+ নতুন প্রোডাক্ট যোগ করুন" বাটনে চাপ দিন।</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- 2. Products Grid (Spacious 2-column Desktop Grid: Cards do NOT stick together) -->
        <div class="hidden grid grid-cols-1 lg:grid-cols-2 gap-7 lg:gap-8" id="productsGrid">
          ${productCardsHtml || '<div class="col-span-full py-20 text-center text-[rgba(235,235,245,0.35)] font-semibold border border-dashed border-white/[0.08] rounded-[24px]">এখনও কোনো প্রোডাক্ট যোগ করা হয়নি। উপরে "➕ নতুন প্রোডাক্ট যোগ করুন" বাটনে চাপ দিন।</div>'}
        </div>

      </div>
    </section>

    <!-- TAB 2: ORDERS -->
    <section id="tab-orders" class="hidden space-y-6">
      <div class="tab-box bg-[#1C1C1E] rounded-[28px] border border-white/[0.08] p-6 sm:p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] space-y-6">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between border-b border-white/[0.06] pb-5 gap-4">
          <div>
            <h2 class="font-bold text-lg sm:text-xl text-white tracking-tight">📋 কাস্টমার অর্ডারস ও ডেলিভারি পাইপলাইন</h2>
            <div id="filteredOrderCountDisplay" class="text-xs sm:text-sm text-[rgba(235,235,245,0.60)] mt-1 flex items-center gap-2 flex-wrap">
              <span>মোট <strong class="text-white font-bold">${totalOrders}টি</strong> অর্ডার</span>
              <span>•</span>
              <span class="text-emerald-400 font-bold font-mono">মোট বিক্রয়: ৳${formatMoney(totalRevenue)}</span>
              <span>•</span>
              <button type="button" onclick="openSalesHistoryModal()" class="text-[11px] text-emerald-400 underline hover:text-white cursor-pointer font-semibold flex items-center gap-1">
                <span>📊 সেলস অ্যানালিটিক্স</span>
              </button>
            </div>
          </div>

          <!-- Controls: Search, Date Filter, SKU Filter, Export, Print -->
          <div class="flex items-center gap-2.5 flex-wrap">
            <input type="text" id="orderSearch" oninput="applyOrderFilters()" placeholder="🔍 নাম, ফোন, ঠিকানা খুঁজুন..." class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs sm:text-sm px-3.5 py-2 rounded-[14px] focus:outline-none focus:border-white/40 w-full sm:w-56">

            <select id="orderDateFilter" onchange="applyOrderFilters()" class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-semibold px-3 py-2 rounded-[14px] focus:outline-none focus:border-white/40 cursor-pointer">
              <option value="ALL">📅 সর্বকালের হিস্ট্রি</option>
              <option value="TODAY">📅 আজ (Today)</option>
              <option value="YESTERDAY">📅 গতকাল</option>
              <option value="LAST_7_DAYS">📅 বিগত ৭ দিন</option>
              <option value="THIS_MONTH">📅 এই চলতি মাস</option>
              <option value="LAST_30_DAYS">📅 বিগত ৩০ দিন</option>
            </select>

            <select id="orderSkuFilter" onchange="applyOrderFilters()" class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-semibold px-3 py-2 rounded-[14px] focus:outline-none focus:border-white/40 cursor-pointer">
              <option value="ALL">👗 সব SKU / মডেল</option>
              ${allSkus.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>

            <button type="button" onclick="exportOrdersCSV()" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white text-xs font-semibold px-3.5 py-2 rounded-[14px] border border-white/[0.08] transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs" title="ফিল্টারকৃত অর্ডার এক্সেলে এক্সপোর্ট করুন">
              <span>📥 CSV এক্সপোর্ট</span>
            </button>

            <button type="button" onclick="printOrdersManifest()" class="bg-white hover:bg-[#E5E5EA] text-black text-xs font-bold px-3.5 py-2 rounded-[14px] transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs" title="কুরিয়ার রাইডারের ডেলিভারি শিট প্রিন্ট করুন">
              <span>🖨️ ডেলিভারি ম্যানিফেস্ট</span>
            </button>
          </div>
        </div>

        <!-- Status Filter Buttons -->
        <div class="flex items-center gap-2.5 text-xs sm:text-sm font-semibold overflow-x-auto pb-1 no-scrollbar">
          <button type="button" onclick="filterOrderStatus('ALL')" id="filter-order-all" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer">সবগুলো (${totalOrders})</button>
          <button type="button" onclick="filterOrderStatus('Booked')" id="filter-order-booked" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">📦 বুকড (${bookedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Approved')" id="filter-order-approved" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">✅ কনফার্মড (${confirmedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Shipped')" id="filter-order-shipped" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">🚚 শিপড (${shippedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Delivered')" id="filter-order-delivered" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">🎉 ডেলিভার্ড (${deliveredOrders})</button>
          <button type="button" onclick="filterOrderStatus('Cancelled')" id="filter-order-cancelled" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">❌ বাতিল / রিটার্ন (${cancelledOrders + returnedOrders})</button>
        </div>

        <!-- Orders Table -->
        <div class="overflow-x-auto border border-white/[0.06] rounded-[20px]">
          <table class="w-full text-left text-[rgba(235,235,245,0.70)] text-sm">
            <thead class="bg-[#2C2C2E] text-[rgba(235,235,245,0.50)] font-semibold border-b border-white/[0.06] text-xs uppercase tracking-wider">
              <tr>
                <th class="p-4">অর্ডার নং</th>
                <th class="p-4">প্রাপক ও হোয়াটসঅ্যাপ</th>
                <th class="p-4">ডেলিভারি ঠিকানা</th>
                <th class="p-4">মডেল ও সাইজ</th>
                <th class="p-4">কনফার্মকারী</th>
                <th class="p-4">Due COD</th>
                <th class="p-4">স্ট্যাটাস</th>
                <th class="p-4 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody id="ordersTableBody">
              ${orderRowsHtml || '<tr><td colspan="8" class="p-10 text-center text-[rgba(235,235,245,0.35)] font-semibold">এখনও কোনো অর্ডার আসেনি।</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 3: ADVANCED SETTINGS -->
    <section id="tab-settings" class="hidden space-y-6">
      <div class="tab-box bg-[#1C1C1E] rounded-[28px] border border-white/[0.08] p-6 sm:p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-w-3xl mx-auto space-y-6">
        <div class="border-b border-white/[0.06] pb-4">
          <h2 class="font-bold text-lg sm:text-xl text-white tracking-tight">⚙️ অ্যাডভান্সড শপ সেটিংস ও পলিসি ইঞ্জিন</h2>
          <p class="text-xs sm:text-sm text-[rgba(235,235,245,0.60)] mt-1">WhatsApp AI স্বয়ংক্রিয়ভাবে গ্রাহকের সাথে কথা বলার সময় এই নিয়ম, অফার ও চার্জগুলো অনুসরণ করবে।</p>
        </div>

        <form onsubmit="saveMerchantSettingsLive(event)" class="space-y-6">
          
          <!-- Section 1: Delivery Charges & Free Shipping -->
          <div class="space-y-3.5">
            <h3 class="font-bold text-sm sm:text-base text-white flex items-center gap-2">
              <span>🚚</span><span>ডেলিভারি চার্জ ও ফ্রি ডেলিভারি শর্ত</span>
            </h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ঢাকা ভেতরে ডেলিভারি চার্জ (টাকা)</label>
                <input type="number" id="set_inside_fee" value="${curSettings.inside_dhaka_fee}" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-base font-bold p-3 rounded-[14px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ঢাকা বাইরে ডেলিভারি চার্জ (টাকা)</label>
                <input type="number" id="set_outside_fee" value="${curSettings.outside_dhaka_fee}" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-base font-bold p-3 rounded-[14px] focus:border-white/40 outline-none">
              </div>
            </div>

            <div>
              <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">🎉 ফ্রি ডেলিভারি শর্ত (ন্যূনতম অর্ডারের পরিমাণ, ৳)</label>
              <input type="number" id="set_free_delivery_min" value="${curSettings.free_delivery_min_amount || ''}" placeholder="যেমন: 3000 (৩০০০ টাকার বেশি অর্ডারে ডেলিভারি ফ্রি)" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
              <span class="text-xs text-[rgba(235,235,245,0.40)] mt-1 block">গ্রাহকের মোট অর্ডার এই টাকার বেশি হলে AI অটোমেটিক ডেলিভারি চার্জ ০ করে দেবে। খালি রাখলে কোনো শর্ত থাকবে না।</span>
            </div>
          </div>

          <!-- Section 2: Payments & Risk Guard -->
          <div class="space-y-3.5 pt-4 border-t border-white/[0.06]">
            <h3 class="font-bold text-sm sm:text-base text-white flex items-center gap-2">
              <span>🛡️</span><span>পেমেন্ট ও ফেক অর্ডার প্রটেকশন (COD Fraud Guard)</span>
            </h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">📱 বিকাশ নাম্বার</label>
                <input type="text" id="set_bkash" value="${curSettings.bkash_number || ''}" placeholder="যেমন: 017XXXXXXXX" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-mono font-bold p-3 rounded-[14px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">📱 নগদ নাম্বার</label>
                <input type="text" id="set_nagad" value="${curSettings.nagad_number || ''}" placeholder="যেমন: 018XXXXXXXX" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-mono font-bold p-3 rounded-[14px] focus:border-white/40 outline-none">
              </div>
            </div>

            <!-- Advance Fee Toggle for Outside Dhaka -->
            <div class="bg-[#2C2C2E] p-4 rounded-[16px] border border-white/[0.06] flex items-center justify-between gap-4">
              <div>
                <div class="font-bold text-sm text-white">ঢাকার বাইরে ডেলিভারি চার্জ অগ্রিম গ্রহণের নিয়ম</div>
                <div class="text-xs text-[rgba(235,235,245,0.50)] mt-0.5">সক্রিয় থাকলে AI ঢাকার বাইরের গ্রাহকদের বলবে: "অর্ডার নিশ্চিত করতে ডেলিভারি চার্জ অগ্রিম বিকাশ করুন।"</div>
              </div>
              <input type="checkbox" id="set_require_advance" ${extra.require_advance_outside ? 'checked' : ''} class="w-5 h-5 accent-white cursor-pointer">
            </div>
          </div>

          <!-- Section 3: AI Persona & Conversation Tone -->
          <div class="space-y-3.5 pt-4 border-t border-white/[0.06]">
            <h3 class="font-bold text-sm sm:text-base text-white flex items-center gap-2">
              <span>🤖</span><span>WhatsApp AI পার্সোনা ও ওয়েলকাম মেসেজ</span>
            </h3>
            
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">AI এজেন্টের নাম</label>
                <input type="text" id="set_bot_name" value="${curSettings.bot_persona_name || 'AI ইনচার্জ'}" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-bold p-3 rounded-[14px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ডেলিভারি সময়সীমা</label>
                <input type="text" id="set_delivery_time" value="${extra.delivery_timeline || '২-৩ কার্যদিবস'}" placeholder="যেমন: ২-৩ দিন" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
              </div>
            </div>

            <div>
              <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">🎁 বিশেষ অফার / কম্বো প্রমো টেক্সট</label>
              <input type="text" id="set_promo_offer" value="${curSettings.promo_offer || ''}" placeholder="যেমন: ২টি আবায়া নিলে বিশেষ ১০০ টাকা ছাড়!" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
            </div>

            <div>
              <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি (AI গ্রাহককে বলবে)</label>
              <textarea id="set_return_policy" rows="2" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none leading-relaxed">${curSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।'}</textarea>
            </div>
          </div>

          <button type="submit" id="saveSettingsBtn" class="w-full bg-white hover:bg-[#E5E5EA] text-black text-sm font-bold py-3.5 rounded-[16px] shadow-[0_2px_14px_rgba(255,255,255,0.15)] transition cursor-pointer active:scale-98">
            💾 সেটিংস সেভ করুন
          </button>
        </form>
      </div>
    </section>

  </main>

  <!-- ======================================================== -->
  <!-- SOURCE-FULL PRODUCT STUDIO MODAL (WITH 5-8 PHOTO UPLOAD) -->
  <!-- ======================================================== -->
  <div id="productStudioModal" class="hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
    <div class="modal-card bg-[#1C1C1E] border border-white/[0.12] rounded-[30px] max-w-3xl w-full p-6 sm:p-8 shadow-[0_24px_70px_rgba(0,0,0,0.85)] space-y-5 max-h-[92vh] overflow-y-auto">
      
      <div class="flex items-center justify-between border-b border-white/[0.06] pb-4">
        <div>
          <h3 id="modalTitle" class="font-bold text-white text-lg tracking-tight flex items-center gap-2">
            <span>✨</span><span>প্রোডাক্ট ইন্টেলিজেন্স স্টুডিও</span>
          </h3>
          <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">অ্যামাজন স্ট্যান্ডার্ড ইনভেন্টরি ও AI বিক্রয় অ্যাসিস্ট্যান্ট কনফিগারেশন</p>
        </div>
        <button type="button" onclick="closeProductStudioModal()" class="w-9 h-9 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] flex items-center justify-center text-[rgba(235,235,245,0.70)] hover:text-white font-bold cursor-pointer transition">✕</button>
      </div>

      <form id="productStudioForm" onsubmit="handleProductStudioSubmit(event)" class="space-y-6">
        <input type="hidden" id="studio_prod_id" value="">

        <!-- SECTION 1: বেসিক তথ্য ও ক্যাটাগরি -->
        <div class="bg-[#242426] p-4 sm:p-5 rounded-[20px] border border-white/[0.06] space-y-4">
          <div class="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between pb-1 border-b border-white/[0.06]">
            <div class="flex items-center gap-2">
              <span class="text-emerald-400">🏷️</span><span>১. মৌলিক তথ্য ও ক্যাটাগরি</span>
            </div>
            <span class="text-[11px] font-normal text-[rgba(235,235,245,0.50)]">যেকোনো প্রোডাক্টের জন্য প্রযোজ্য</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">মডেল কোড *</label>
              <input type="text" id="studio_code" required placeholder="যেমন: DF-105" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm font-mono font-bold p-3 rounded-[12px] focus:border-white/40 outline-none uppercase">
            </div>
            <div class="sm:col-span-2">
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">প্রোডাক্টের নাম *</label>
              <input type="text" id="studio_name" required placeholder="যেমন: প্রিমিয়াম দুবাই চেরি রানি কাফতান আবায়া" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm font-medium p-3 rounded-[12px] focus:border-white/40 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">প্রোডাক্ট ক্যাটাগরি *</label>
              <select id="studio_category" onchange="onStudioCategoryChange(this.value)" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none cursor-pointer font-medium">
                <option value="fashion">👗 পোশাক, বোরকা ও আবায়া</option>
                <option value="footwear">👞 জুতা ও ফুটওয়্যার</option>
                <option value="electronics">🎧 গ্যাজেট ও ইলেকট্রনিক্স</option>
                <option value="cosmetics">💄 বিউটি ও স্কিনকেয়ার</option>
                <option value="food">🍯 অর্গানিক ফুড ও গ্রোসারি</option>
                <option value="general">📦 অন্যান্য পণ্য (Universal)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SECTION 2: মূল্য ও বান্ডেল/ভলিউম প্রাইসিং ইঞ্জিন -->
        <div class="bg-[#242426] p-4 sm:p-5 rounded-[20px] border border-white/[0.06] space-y-4">
          <div class="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between pb-1 border-b border-white/[0.06]">
            <div class="flex items-center gap-2">
              <span class="text-amber-400">💰</span><span>২. মূল্য ও বান্ডেল/ভলিউম ডিসকাউন্ট ইঞ্জিন</span>
            </div>
            <span class="text-[11px] font-normal text-emerald-400">🔥 একাধিক পিস বিক্রি বাড়ানোর কৌশল</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">বিক্রয় মূল্য (১ পিস) *</label>
              <input type="number" id="studio_price" oninput="updateBundlePreview()" required placeholder="যেমন: 1850" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-emerald-400 text-base font-bold p-3 rounded-[12px] focus:border-white/40 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">রেগুলার মূল্য (MRP)</label>
              <input type="number" id="studio_regular_price" placeholder="যেমন: 2200" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-[rgba(235,235,245,0.70)] text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">স্টক সংখ্যা (পিস)</label>
              <input type="number" id="studio_stock_qty" value="25" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
            </div>
          </div>

          <!-- BUNDLE / VOLUME PRICING ACCORDION -->
          <div class="p-3.5 rounded-[16px] bg-[#1C1C1E] border border-white/[0.08] space-y-3">
            <div class="flex items-center justify-between">
              <label class="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-white cursor-pointer select-none">
                <input type="checkbox" id="studio_bundle_active" onchange="updateBundlePreview()" class="accent-emerald-400 w-4 h-4 rounded">
                <span>🔥 বান্ডেল / মাল্টি-পিস অফার চালু করুন (যেমন: ২টি কিনলে ১০% ছাড়)</span>
              </label>
            </div>

            <div id="bundleConfigBox" class="hidden space-y-3 pt-2 border-t border-white/[0.06]">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="block text-[11px] font-semibold text-[rgba(235,235,245,0.70)] mb-1">অফার পরিমাণ</label>
                  <select id="studio_bundle_qty" onchange="updateBundlePreview()" class="w-full bg-[#242426] border border-white/[0.08] text-white text-xs p-2.5 rounded-[10px] focus:border-white/40 outline-none">
                    <option value="2">২টি কিনলে অফার</option>
                    <option value="3">৩টি কিনলে অফার</option>
                    <option value="4">৪টি কিনলে অফার</option>
                    <option value="5">৫টি কিনলে অফার</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-[rgba(235,235,245,0.70)] mb-1">অফারের ধরন</label>
                  <select id="studio_bundle_type" onchange="updateBundlePreview()" class="w-full bg-[#242426] border border-white/[0.08] text-white text-xs p-2.5 rounded-[10px] focus:border-white/40 outline-none">
                    <option value="percentage">% শতাংশ ছাড় (যেমন: 10%)</option>
                    <option value="fixed_price">ফিক্সড কম্বো মূল্য (যেমন: ৳3200)</option>
                    <option value="free_delivery">সম্পূর্ণ ফ্রি ডেলিভারি অফার</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-[rgba(235,235,245,0.70)] mb-1">ছাড়ের মান (% বা ৳)</label>
                  <input type="number" id="studio_bundle_value" oninput="updateBundlePreview()" value="10" placeholder="যেমন: 10 বা 3200" class="w-full bg-[#242426] border border-white/[0.08] text-white text-xs p-2.5 rounded-[10px] focus:border-white/40 outline-none">
                </div>
              </div>
              <div id="bundlePreviewBox" class="p-2.5 rounded-[10px] bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-medium">
                💡 প্রিভিউ: গ্রাহক ২টি নিলে ১০% ছাড়ে আকর্ষণীয় মূল্যে পেয়ে যাবেন!
              </div>
            </div>
          </div>
        </div>

        <!-- SECTION 3: ক্যাটাগরি-অনুযায়ী ডায়নামিক স্পেসিফিকেশন ও প্যাকেজ -->
        <div class="bg-[#242426] p-4 sm:p-5 rounded-[20px] border border-white/[0.06] space-y-4">
          <div class="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between pb-1 border-b border-white/[0.06]">
            <div class="flex items-center gap-2">
              <span class="text-sky-400">⚙️</span><span id="specSectionHeading">৩. প্যাকেজ, স্পেসিফিকেশন ও সাইজ গাইড</span>
            </div>
            <span id="currentCategoryBadge" class="text-[11px] font-normal text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-[6px]">পোশাক ও ফ্যাশন</span>
          </div>

          <!-- UNIVERSAL PACKAGE TYPE ROW (All Categories) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-semibold text-[rgba(235,235,245,0.70)]">প্যাকেজের ধরন *</label>
                <div id="pkgPresetContainer" class="flex items-center gap-1.5 text-[11px] text-[rgba(235,235,245,0.50)]">
                  <button type="button" onclick="setPresetPackage('১ পিস')" class="text-white hover:underline cursor-pointer">১ পিস</button>
                  <span>•</span>
                  <button type="button" onclick="setPresetPackage('২ পিস সেট')" class="text-white hover:underline cursor-pointer">২ পিস সেট</button>
                  <span>•</span>
                  <button type="button" onclick="setPresetPackage('ফুল কম্বো সেট')" class="text-white hover:underline cursor-pointer">কম্বো</button>
                </div>
              </div>
              <input type="text" id="studio_package_type" placeholder="যেমন: ২ পিস সেট (আবায়া + হিজাব) বা প্রিমিয়াম বক্স" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">প্যাকেজে যা যা অন্তর্ভুক্ত থাকছে *</label>
              <input type="text" id="studio_package_inclusions" placeholder="যেমন: মূল প্রোডাক্ট + প্রিমিয়াম বক্স + গিফট উপহার" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
            </div>
          </div>

          <!-- DYNAMIC SUB-SECTION: FASHION / ABAYA -->
          <div id="cat_fields_fashion" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-xs font-semibold text-[rgba(235,235,245,0.70)]">ফেব্রিক / উপাদান</label>
                  <div class="flex items-center gap-1.5 text-[11px] text-[rgba(235,235,245,0.50)]">
                    <button type="button" onclick="setPresetFabric('দুবাই চেরি')" class="text-white hover:underline cursor-pointer">দুবাই চেরি</button>
                    <span>•</span>
                    <button type="button" onclick="setPresetFabric('সফট জর্জেট')" class="text-white hover:underline cursor-pointer">জর্জেট</button>
                    <span>•</span>
                    <button type="button" onclick="setPresetFabric('নিদা ফেব্রিক')" class="text-white hover:underline cursor-pointer">নিদা</button>
                  </div>
                </div>
                <input type="text" id="studio_fabric" placeholder="যেমন: দুবাই চেরি প্রিমিয়াম" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">কাপড় কি পাতলা / ইনার লাগবে?</label>
                <select id="studio_transparency" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none cursor-pointer">
                  <option value="100% নন-ট্রান্সপারেন্ট (কোনো ইনার প্রয়োজন নেই)">100% নন-ট্রান্সপারেন্ট (কোনো ইনার প্রয়োজন নেই)</option>
                  <option value="হালকা পাতলা (ভেতরে ইনার বা কামিজ পরা ভালো)">হালকা পাতলা (ভেতরে ইনার বা কামিজ পরা ভালো)</option>
                  <option value="মাঝারি ঘনত্ব (ইনার ছাড়াই পরিধানযোগ্য)">মাঝারি ঘনত্ব (ইনার ছাড়াই পরিধানযোগ্য)</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">হিজাব অন্তর্ভুক্ত?</label>
                <select id="studio_hijab_included" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none cursor-pointer">
                  <option value="true">হ্যাঁ, ম্যাচিং হিজাব সাথে ফ্রি</option>
                  <option value="false">না, হিজাব অন্তর্ভুক্ত নয়</option>
                </select>
              </div>
              <div class="sm:col-span-2">
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">হিজাবের বিবরণ ও সাইজ</label>
                <input type="text" id="studio_hijab_details" placeholder="যেমন: ম্যাচিং সফট দুবাই চেরি হিজাব ফ্রি, সাইজ: ৩০×৮০ ইঞ্চি" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">বডি ফিটিং সাইজ গাইড</label>
                <input type="text" id="studio_body_fit" placeholder="যেমন: বডি সাইজ ৩৬ থেকে ৪৬ পর্যন্ত পারফেক্ট" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">নিচের ঘের (Flare Inches)</label>
                <input type="text" id="studio_flare_inches" placeholder="যেমন: ১২০ ইঞ্চি ফ্লেয়ার" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
            </div>
          </div>

          <!-- DYNAMIC SUB-SECTION: FOOTWEAR -->
          <div id="cat_fields_footwear" class="hidden space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="text-xs font-semibold text-[rgba(235,235,245,0.70)]">জুতার মেটেরিয়াল / উপাদান</label>
                  <div class="flex items-center gap-1.5 text-[11px] text-[rgba(235,235,245,0.50)]">
                    <button type="button" onclick="setPresetFabric('জেনুইন কাউ লেদার')" class="text-white hover:underline cursor-pointer">লেদার</button>
                    <span>•</span>
                    <button type="button" onclick="setPresetFabric('ব্রিদেবল মেশ')" class="text-white hover:underline cursor-pointer">মেশ</button>
                  </div>
                </div>
                <input type="text" id="studio_footwear_material" placeholder="যেমন: ১০০% জেনুইন কাউ লেদার / রাবার সোল" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ইনসোল ও কমফোর্ট ফিচার</label>
                <input type="text" id="studio_footwear_comfort" placeholder="যেমন: সফট মেমোরি ফোম কুশন, অ্যান্টি-স্লিপ গ্রিপ সোল" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
            </div>
          </div>

          <!-- DYNAMIC SUB-SECTION: ELECTRONICS & GADGETS -->
          <div id="cat_fields_electronics" class="hidden space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ওয়ারেন্টি পলিসি</label>
                <input type="text" id="studio_warranty" placeholder="যেমন: ৬ মাস রিপ্লেসমেন্ট ওয়ারেন্টি, ১ বছর সার্ভিস" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ব্যাটারি / টেকনিক্যাল স্পেক্স</label>
                <input type="text" id="studio_electronics_specs" placeholder="যেমন: ব্লুটুথ ৫.৩, ব্যাটারি ব্যাকআপ ১০ ঘণ্টা" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
            </div>
          </div>

          <!-- DYNAMIC SUB-SECTION: COSMETICS & BEAUTY -->
          <div id="cat_fields_cosmetics" class="hidden space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">স্কিন টাইপ উপযুক্ততা</label>
                <input type="text" id="studio_skin_type" placeholder="যেমন: সব ধরনের ত্বকে ব্যবহারযোগ্য (অল স্কিন টাইপ)" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
              <div>
                <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">নেট ওজন / ভলিউম</label>
                <input type="text" id="studio_net_volume" placeholder="যেমন: ৫০ গ্রাম / ১০০ মিলি" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
              </div>
            </div>
          </div>

          <!-- UNIVERSAL SIZES & VARIANTS ROW -->
          <div>
            <div class="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <label class="text-xs font-semibold text-[rgba(235,235,245,0.70)]">সাইজ / ভ্যারিয়েন্ট (কমা দিয়ে লিখুন) *</label>
              <div id="sizePresetContainer" class="flex items-center gap-2 text-xs">
                <span class="text-[rgba(235,235,245,0.40)]">প্রিসেট:</span>
                <button type="button" onclick="setPresetSizes('৫০, ৫২, ৫৪, ৫৬')" class="text-white hover:underline cursor-pointer font-medium">আবায়া (৫০-৫৬)</button>
                <span>•</span>
                <button type="button" onclick="setPresetSizes('৩৯, ৪০, ৪১, ৪২, ৪৩, ৪৪')" class="text-white hover:underline cursor-pointer font-medium">জুতা (৩৯-৪৪)</button>
                <span>•</span>
                <button type="button" onclick="setPresetSizes('M, L, XL, XXL')" class="text-white hover:underline cursor-pointer font-medium">শার্ট (M-XXL)</button>
                <span>•</span>
                <button type="button" onclick="setPresetSizes('স্ট্যান্ডার্ড সাইজ')" class="text-white hover:underline cursor-pointer font-medium">ফ্রি সাইজ</button>
              </div>
            </div>
            <input type="text" id="studio_sizes" placeholder="যেমন: ৫০, ৫২, ৫৪, ৫৬ অথবা ৩৯, ৪০, ৪১, ৪২, ৪৩" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm font-medium p-3 rounded-[12px] focus:border-white/40 outline-none">
          </div>

          <!-- QUALITY GUARANTEE BADGES (Checkboxes) -->
          <div>
            <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-2">কোয়ালিটি নিশ্চয়তা ব্যাজ (AI কাস্টমারকে কনভিন্স করতে বলবে):</label>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <label class="flex items-center gap-2 p-2.5 rounded-[12px] bg-[#1C1C1E] border border-white/[0.06] text-xs text-white cursor-pointer hover:border-white/20 transition select-none">
                <input type="checkbox" id="studio_color_guarantee" class="accent-white w-4 h-4 rounded">
                <span id="badge_txt_1">🎨 কালার ১০০% গ্যারান্টি</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-[12px] bg-[#1C1C1E] border border-white/[0.06] text-xs text-white cursor-pointer hover:border-white/20 transition select-none">
                <input type="checkbox" id="studio_wrinkle_free" class="accent-white w-4 h-4 rounded">
                <span id="badge_txt_2">✨ প্রিমিয়াম কোয়ালিটি</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-[12px] bg-[#1C1C1E] border border-white/[0.06] text-xs text-white cursor-pointer hover:border-white/20 transition select-none">
                <input type="checkbox" id="studio_summer_friendly" class="accent-white w-4 h-4 rounded">
                <span id="badge_txt_3">❄️ আরামদায়ক ফিনিশিং</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-[12px] bg-[#1C1C1E] border border-white/[0.06] text-xs text-white cursor-pointer hover:border-white/20 transition select-none">
                <input type="checkbox" id="studio_wash_care" class="accent-white w-4 h-4 rounded">
                <span id="badge_txt_4">🔍 চেক করে নেওয়ার সুযোগ</span>
              </label>
            </div>
          </div>
        </div>

        <!-- SECTION 4: কালার ভ্যারিয়েন্ট ও লাইটিং -->
        <div class="bg-[#242426] p-4 sm:p-5 rounded-[20px] border border-white/[0.06] space-y-4">
          <div class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 pb-1 border-b border-white/[0.06]">
            <span class="text-purple-400">🎨</span><span>৪. কালার ভ্যারিয়েন্ট ও ফটো রিয়ালিজম (Color & Realism)</span>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <label class="text-xs font-semibold text-[rgba(235,235,245,0.70)]">কালার অপশন (কমা দিয়ে লিখুন বা ক্লিক করে যোগ করুন) *</label>
              <div class="flex items-center gap-1 flex-wrap text-[11px]">
                <span class="text-[rgba(235,235,245,0.40)]">যোগ করুন:</span>
                <button type="button" onclick="appendPresetColor('জেট ব্ল্যাক')" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[8px] border border-white/[0.08] cursor-pointer">জেট ব্ল্যাক</button>
                <button type="button" onclick="appendPresetColor('চকোলেট ব্রাউন')" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[8px] border border-white/[0.08] cursor-pointer">চকোলেট ব্রাউন</button>
                <button type="button" onclick="appendPresetColor('কফি')" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[8px] border border-white/[0.08] cursor-pointer">কফি</button>
                <button type="button" onclick="appendPresetColor('সি-গ্রিন')" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[8px] border border-white/[0.08] cursor-pointer">সি-গ্রিন</button>
                <button type="button" onclick="appendPresetColor('নেভি ব্লু')" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[8px] border border-white/[0.08] cursor-pointer">নেভি ব্লু</button>
                <button type="button" onclick="appendPresetColor('মারুন')" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[8px] border border-white/[0.08] cursor-pointer">মারুন</button>
              </div>
            </div>
            <input type="text" id="studio_colors" placeholder="যেমন: জেট ব্ল্যাক, চকোলেট ব্রাউন, কফি" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
          </div>

          <div>
            <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">লাইটিং ও স্ক্রিন ডিসক্লেইমার নোট</label>
            <input type="text" id="studio_lighting_disclaimer" placeholder="যেমন: স্টুডিও লাইটিং ও ক্যামেরার রেজোলিউশনের কারণে ছবির কালার বাস্তবে ৫-১০% সামান্য তারতম্য হতে পারে।" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none">
          </div>
        </div>

        <!-- SECTION 5: AI বিক্রয় সহকারী গাইড -->
        <div class="bg-[#242426] p-4 sm:p-5 rounded-[20px] border border-white/[0.06] space-y-3">
          <div class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 pb-1 border-b border-white/[0.06]">
            <span class="text-pink-400">🤖</span><span>৫. AI বিক্রয় নির্দেশিকা ও ক্লোজিং গাইড (Sales Closing Guidance)</span>
          </div>
          <div>
            <label class="block text-xs font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">গ্রাহককে কনভিন্স করার বিশেষ পয়েন্ট বা ছাড়ের লিমিট:</label>
            <textarea id="studio_ai_notes" rows="2" placeholder="যেমন: কাপড় ধোয়ার পর কালার ফেইড হবে না। কাস্টমার দামাদামি করলে বড়জোর ডেলিভারি চার্জে ৫০ টাকা ছাড় দিতে পারবে, তবে মূল দাম এক টাকাও কমবে না।" class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-sm p-3 rounded-[12px] focus:border-white/40 outline-none leading-relaxed"></textarea>
          </div>
        </div>

        <!-- DIRECT PHOTO UPLOAD STUDIO: MIN 5, MAX 8 PHOTOS -->
        <div class="bg-[#2C2C2E] p-4 sm:p-5 rounded-[22px] border border-white/[0.08] space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div class="font-bold text-white text-sm sm:text-base flex items-center gap-2">
                <span>📸</span><span>প্রোডাক্ট ফটো গ্যালারি</span>
              </div>
              <div class="text-xs text-[rgba(235,235,245,0.70)] mt-0.5">নিয়ম: প্রতিটি প্রোডাক্টে <b>ন্যূনতম ৫টি</b> এবং <b>সর্বোচ্চ ৮টি</b> ছবি আপলোড আবশ্যক।</div>
            </div>
            <div id="photoCountBadge" class="text-xs px-3.5 py-1.5 rounded-full font-bold bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30">
              ০/৮ ছবি (কমপক্ষে আরও ৫টি ছবি দিন)
            </div>
          </div>

          <!-- Compact, Sleek Upload Action Bar (User asked: upload option soto kore daw) -->
          <div onclick="document.getElementById('studio_file_input').click()" class="border-2 border-dashed border-white/[0.15] hover:border-white/40 bg-[#1C1C1E] px-4 py-3 rounded-[16px] flex items-center justify-between gap-3 cursor-pointer transition active:scale-99 shadow-xs group">
            <div class="flex items-center gap-3">
              <span class="w-9 h-9 rounded-full bg-[#2C2C2E] group-hover:scale-105 transition flex items-center justify-center text-lg">📤</span>
              <div>
                <div class="text-xs sm:text-sm font-bold text-white">ছবি আপলোড করতে এখানে ক্লিক করুন (বা ফাইল ড্রপ করুন)</div>
                <div class="text-[11px] text-[rgba(235,235,245,0.60)]">পিসি অথবা মোবাইল গ্যালারি থেকে একসাথে ৫-৮টি ছবি সিলেক্ট করুন</div>
              </div>
            </div>
            <span class="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#2C2C2E] text-white border border-white/[0.08] shrink-0">ফাইল বাছুন</span>
          </div>
          <input type="file" id="studio_file_input" multiple accept="image/*" class="hidden" onchange="handleStudioFilesUpload(this.files)">

          <!-- Large, Clear Photo Gallery Grid (User asked: pic gulo boro kore dekhaw) -->
          <div>
            <div class="text-xs text-[rgba(235,235,245,0.60)] mb-2 flex items-center justify-between">
              <span>আপলোডকৃত ছবিসমূহ (বড় করে দেখতে ছবিতে ক্লিক করুন):</span>
              <span class="font-mono text-[11px]">১ম ছবি = কভার ফটো</span>
            </div>
            <div id="studioPhotosGrid" class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <!-- Dynamic high-res photo cards injected by JS -->
            </div>
          </div>

          <!-- Quick URL fallback if user prefers pasting -->
          <div class="pt-1 border-t border-white/[0.06]">
            <button type="button" onclick="document.getElementById('manualUrlBox').classList.toggle('hidden')" class="text-xs text-[rgba(235,235,245,0.70)] hover:text-white underline font-medium cursor-pointer flex items-center gap-1.5">
              <span>🔗 সরাসরি ছবির লিঙ্ক (URL) পেস্ট করতে চান?</span>
            </button>
            <div id="manualUrlBox" class="hidden mt-2 space-y-2">
              <input type="url" id="studio_img_main" placeholder="মূল ছবির লিঙ্ক https://..." class="w-full bg-[#1C1C1E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] outline-none">
            </div>
          </div>
        </div>

        <button type="submit" id="studioSubmitBtn" class="w-full bg-white hover:bg-[#E5E5EA] text-black font-bold text-sm sm:text-base py-3.5 rounded-[16px] transition cursor-pointer shadow-[0_2px_14px_rgba(255,255,255,0.15)] active:scale-98">
          💾 প্রোডাক্ট সংরক্ষণ করুন
        </button>
      </form>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- HIGH-RES PHOTO LIGHTBOX MODAL (Always Pinned at Top)      -->
  <!-- ======================================================== -->
  <div id="imageLightboxModal" class="hidden fixed inset-0 bg-black/95 backdrop-blur-xl flex flex-col justify-between items-center p-3 sm:p-5 select-none" style="z-index: 999999;" onclick="closeLightboxModal(event)">
    <!-- Top Bar with counter & close (Always visible at the top, never pushed off-screen!) -->
    <div class="w-full max-w-4xl flex items-center justify-between text-white shrink-0 py-2.5 px-4 bg-white/[0.08] backdrop-blur-md rounded-[18px] border border-white/[0.12] shadow-lg z-20" onclick="event.stopPropagation()">
      <div class="flex items-center gap-2.5">
        <span id="lightboxIndexBadge" class="bg-white/20 text-white font-mono text-xs sm:text-sm px-3.5 py-1.5 rounded-full font-bold shadow-xs">ছবি ১ / ৫</span>
        <span id="lightboxCoverBadge" class="text-xs bg-[#30D158]/25 text-[#30D158] border border-[#30D158]/40 px-3 py-1 rounded-full font-bold hidden">⭐ মূল কভার ফটো</span>
      </div>
      <button type="button" onclick="closeLightboxModal()" class="w-9 h-9 rounded-full bg-white/15 hover:bg-[#FF453A] active:scale-95 text-white flex items-center justify-center font-bold text-base cursor-pointer transition shadow-md border border-white/20" title="বন্ধ করুন (Esc)">✕</button>
    </div>

    <!-- Large Image Box (Auto-scaled to fit viewport vertically and horizontally) -->
    <div class="relative flex-1 w-full max-w-4xl flex items-center justify-center my-auto min-h-0 py-3" onclick="event.stopPropagation()">
      <img id="lightboxImg" src="" alt="Enlarged preview" class="max-w-full max-h-[70vh] sm:max-h-[74vh] object-contain rounded-[18px] shadow-[0_20px_70px_rgba(0,0,0,0.9)] border border-white/15 select-none transition duration-150">
      
      <!-- Prev / Next Navigation Arrows -->
      <button type="button" id="lightboxPrevBtn" onclick="navigateLightbox(-1)" class="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/70 hover:bg-black/95 active:scale-95 text-white flex items-center justify-center font-bold text-2xl cursor-pointer transition border border-white/25 shadow-xl select-none" title="পূর্ববর্তী ছবি (‹)">‹</button>
      <button type="button" id="lightboxNextBtn" onclick="navigateLightbox(1)" class="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/70 hover:bg-black/95 active:scale-95 text-white flex items-center justify-center font-bold text-2xl cursor-pointer transition border border-white/25 shadow-xl select-none" title="পরবর্তী ছবি (›)">›</button>
    </div>
    
    <!-- Bottom Hint Bar -->
    <div class="shrink-0 text-center text-xs text-[rgba(235,235,245,0.70)] pb-1 select-none">
      <span>কিবোর্ডের ‹ ও › অ্যারো বাটন দিয়ে পরিবর্তন করুন অথবা বাইরে ক্লিক করে বন্ধ করুন</span>
    </div>
  </div>

  <!-- ======================================================== -->
  <!-- PRINTABLE CASH MEMO / PARCEL SLIP MODAL                   -->
  <!-- ======================================================== -->
  <div id="printableMemoModal" class="hidden fixed inset-0 z-[999999] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto" onclick="closeMemoModal(event)">
    <div class="bg-[#1C1C1E] rounded-[24px] border border-white/[0.12] p-5 sm:p-6 max-w-lg w-full text-white space-y-4 shadow-2xl relative my-auto" onclick="event.stopPropagation()">
      <!-- Modal Header (no-print) -->
      <div class="flex items-center justify-between border-b border-white/[0.08] pb-3 no-print">
        <div class="flex items-center gap-2">
          <span class="text-lg">🖨️</span>
          <span class="font-bold text-sm sm:text-base text-white">কাস্টমার ক্যাশ মেমো / পার্সেল স্লিপ</span>
        </div>
        <button type="button" onclick="closeMemoModal()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-[#FF453A] text-white flex items-center justify-center font-bold text-sm cursor-pointer transition">✕</button>
      </div>

      <!-- Printable Memo Content Box -->
      <div id="memoPrintContent" class="bg-white text-black p-5 sm:p-6 rounded-[16px] shadow-sm font-sans space-y-3">
        <!-- Injected dynamically by printOrderMemo(orderId) -->
      </div>

      <!-- Modal Footer (no-print) -->
      <div class="flex items-center justify-between pt-2 border-t border-white/[0.08] no-print">
        <span class="text-xs text-[rgba(235,235,245,0.60)]">থার্মাল বা সাধারণ যেকোনো প্রিন্টারে প্রিন্টযোগ্য</span>
        <div class="flex items-center gap-2.5">
          <button type="button" onclick="closeMemoModal()" class="px-4 py-2 rounded-[12px] bg-white/10 hover:bg-white/20 text-white font-semibold text-xs sm:text-sm cursor-pointer transition">বন্ধ করুন</button>
          <button type="button" onclick="window.print()" class="px-5 py-2 rounded-[12px] bg-[#30D158] hover:bg-[#34C759] active:scale-95 text-black font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-2 shadow-md">
            <span>🖨️ এখনই প্রিন্ট করুন</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ======================================================== -->
  <!-- 3-STEP SAFE PRODUCT DELETION MODAL                       -->
  <!-- ======================================================== -->
  <div id="safeDeleteModal" class="hidden fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
    <div class="modal-card bg-[#1C1C1E] border border-[#FF453A]/30 rounded-[28px] max-w-md w-full p-6 sm:p-7 shadow-[0_24px_70px_rgba(255,69,58,0.25)] space-y-5 text-center">
      
      <div class="w-14 h-14 mx-auto rounded-full bg-[#FF453A]/15 border border-[#FF453A]/30 flex items-center justify-center text-2xl text-[#FF453A]">
        ⚠️
      </div>

      <div class="space-y-1.5">
        <h3 class="font-extrabold text-white text-lg">পণ্য স্থায়ীভাবে মুছে ফেলার সতর্কতা</h3>
        <p class="text-xs text-[rgba(235,235,245,0.60)] leading-relaxed">
          এই প্রোডাক্টটি মুছে ফেললে ডাটাবেজ থেকে সম্পূর্ণ ডিলিট হবে এবং WhatsApp AI আর এই পণ্যের অর্ডার নিতে পারবে না।
        </p>
      </div>

      <!-- Product Preview Snippet -->
      <div class="bg-[#2C2C2E] p-3.5 rounded-[18px] border border-white/[0.06] flex items-center gap-3.5 text-left">
        <img id="delProdImg" src="" alt="preview" class="w-14 h-16 object-cover rounded-[12px] bg-[#1C1C1E] shrink-0 border border-white/[0.1]">
        <div class="min-w-0 flex-1">
          <span id="delProdCode" class="font-mono font-bold text-xs bg-[#1C1C1E] text-white px-2 py-0.5 rounded border border-white/[0.08]"></span>
          <h4 id="delProdName" class="font-bold text-white text-sm truncate mt-1"></h4>
        </div>
      </div>

      <!-- Safety Confirmation Step -->
      <div class="space-y-3">
        <div class="text-xs text-[rgba(235,235,245,0.70)]">
          নিশ্চিত করার জন্য নিচের বাটনে ক্লিক করুন:
        </div>
        
        <div class="flex items-center gap-3">
          <button type="button" onclick="closeSafeDeleteModal()" class="flex-1 bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold py-3 rounded-[14px] text-xs sm:text-sm transition cursor-pointer">
            ✕ বাতিল
          </button>
          <button type="button" id="delConfirmBtn" onclick="executeSafeDelete()" class="flex-1 bg-[#FF453A] hover:bg-[#D70015] text-white font-bold py-3 rounded-[14px] text-xs sm:text-sm transition cursor-pointer shadow-[0_2px_12px_rgba(255,69,58,0.3)]">
            নিশ্চিত মুছুন (3s)
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- DYNAMIC SALES REVENUE & HISTORY MODAL                     -->
  <!-- ======================================================== -->
  <div id="salesHistoryModal" class="hidden fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
    <div class="modal-card bg-[#1C1C1E] border border-white/[0.12] rounded-[28px] max-w-2xl w-full p-6 sm:p-8 shadow-[0_24px_70px_rgba(0,0,0,0.8)] space-y-6 text-left max-h-[90vh] overflow-y-auto no-scrollbar">
      
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-white/[0.08] pb-4">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-xl text-emerald-400">
            📊
          </div>
          <div>
            <h3 class="font-extrabold text-white text-lg sm:text-xl">বিক্রয় অ্যানালিটিক্স ও সেলস হিস্ট্রি</h3>
            <p class="text-xs text-[rgba(235,235,245,0.60)]">রিয়েল-টাইম কনফার্মড সেলস ট্র্যাকিং ও ট্রেন্ডস</p>
          </div>
        </div>
        <button type="button" onclick="closeSalesHistoryModal()" class="w-9 h-9 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[rgba(235,235,245,0.70)] hover:text-white flex items-center justify-center text-sm transition cursor-pointer">
          ✕
        </button>
      </div>

      <!-- 3 Velocity Cards: Today / 7 Days / Lifetime -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div class="bg-[#2C2C2E]/60 border border-white/[0.08] p-4 rounded-[18px]">
          <div class="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">📅 আজকের বিক্রয়</div>
          <div class="text-xl font-extrabold text-white font-mono mt-1">৳${Number(todayRevenue).toLocaleString('en-IN')}</div>
          <div class="text-[11px] text-[rgba(235,235,245,0.50)] mt-0.5">${todayOrders.length}টি সফল অর্ডার</div>
        </div>

        <div class="bg-[#2C2C2E]/60 border border-white/[0.08] p-4 rounded-[18px]">
          <div class="text-[11px] font-bold text-blue-400 uppercase tracking-wider">📈 গত ৭ দিনের বিক্রয়</div>
          <div class="text-xl font-extrabold text-white font-mono mt-1">৳${Number(last7DaysRevenue).toLocaleString('en-IN')}</div>
          <div class="text-[11px] text-[rgba(235,235,245,0.50)] mt-0.5">${last7DaysOrders.length}টি সফল অর্ডার</div>
        </div>

        <div class="bg-[#2C2C2E]/60 border border-white/[0.08] p-4 rounded-[18px]">
          <div class="text-[11px] font-bold text-amber-400 uppercase tracking-wider">🏆 সর্বমোট লাইফটাইম</div>
          <div class="text-xl font-extrabold text-white font-mono mt-1">৳${Number(totalRevenue).toLocaleString('en-IN')}</div>
          <div class="text-[11px] text-[rgba(235,235,245,0.50)] mt-0.5">${validOrders.length}টি মোট ডেলিভারি</div>
        </div>
      </div>

      <!-- Recent Orders List in this Modal -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-[rgba(235,235,245,0.70)] uppercase tracking-wider">সর্বশেষ সফল অর্ডার তালিকা</span>
          <button type="button" onclick="closeSalesHistoryModal(); switchTab('orders');" class="text-xs text-[#30D158] hover:underline font-semibold cursor-pointer">
            সবগুলো অর্ডার পরিচালনা করুন →
          </button>
        </div>

        <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
          ${validOrders.slice(0, 10).map(o => {
            const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'আজকে';
            return `
              <div class="bg-[#2C2C2E]/40 border border-white/[0.06] p-3 rounded-[14px] flex items-center justify-between gap-3 text-xs">
                <div>
                  <div class="font-bold text-white flex items-center gap-1.5">
                    <span>${o.customer_name || 'গ্রাহক'}</span>
                    <span class="font-mono text-[10px] text-[rgba(235,235,245,0.50)]">${o.customer_phone || ''}</span>
                  </div>
                  <div class="text-[11px] text-[rgba(235,235,245,0.50)] mt-0.5">${o.model_code || 'আইটেম'} • ${dateStr}</div>
                </div>
                <div class="text-right">
                  <div class="font-bold text-white font-mono text-sm">৳${Number(o.total_bdt || 0).toLocaleString('en-IN')}</div>
                  <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${o.status === 'Approved' ? 'bg-[#30D158]/15 text-[#30D158]' : (o.status === 'Shipped' ? 'bg-blue-500/15 text-blue-400' : 'bg-[#FF9F0A]/15 text-[#FF9F0A]')}">${o.status}</span>
                </div>
              </div>
            `;
          }).join('') || '<div class="text-center py-6 text-xs text-[rgba(235,235,245,0.40)]">এখনও কোনো অর্ডার সম্পন্ন হয়নি</div>'}
        </div>
      </div>

      <div class="pt-2 border-t border-white/[0.08] flex justify-end">
        <button type="button" onclick="closeSalesHistoryModal()" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold px-5 py-2.5 rounded-[12px] text-xs transition cursor-pointer">
          বন্ধ করুন
        </button>
      </div>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- ORDER DETAILS INSPECTION MODAL                           -->
  <!-- ======================================================== -->
  <div id="orderDetailsModal" class="hidden fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
    <div class="modal-card bg-[#1C1C1E] border border-white/[0.12] rounded-[28px] max-w-2xl w-full p-6 sm:p-8 shadow-[0_24px_70px_rgba(0,0,0,0.8)] space-y-6 text-left max-h-[90vh] overflow-y-auto no-scrollbar">
      
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-white/[0.08] pb-4">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-xl text-blue-400">
            📦
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="font-extrabold text-white text-lg sm:text-xl font-mono" id="detailOrderNum">#000</h3>
              <span id="detailOrderStatusBadge" class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30">স্ট্যাটাস</span>
            </div>
            <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5" id="detailOrderDate">তারিখ</p>
          </div>
        </div>
        <button type="button" onclick="closeOrderDetailsModal()" class="w-9 h-9 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[rgba(235,235,245,0.70)] hover:text-white flex items-center justify-center text-sm transition cursor-pointer">
          ✕
        </button>
      </div>

      <!-- 2-Column Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        
        <!-- Customer & Delivery Box -->
        <div class="bg-[#2C2C2E]/60 border border-white/[0.08] p-4 rounded-[20px] space-y-3">
          <div class="text-xs font-bold text-[rgba(235,235,245,0.50)] uppercase tracking-wider flex items-center justify-between">
            <span>👤 কাস্টমার ও ডেলিভারি</span>
            <span id="detailSourceBadge" class="text-[10px] text-[#30D158] font-bold">WhatsApp AI</span>
          </div>
          <div>
            <div class="font-bold text-white text-base" id="detailCustName">কাস্টমার নাম</div>
            <div class="text-xs text-[rgba(235,235,245,0.60)] font-mono mt-0.5" id="detailCustPhone">017XXXXXXXX</div>
          </div>
          <div class="text-xs text-[rgba(235,235,245,0.85)] bg-[#1C1C1E] p-3 rounded-[12px] border border-white/[0.06]">
            <span class="text-[rgba(235,235,245,0.45)] block text-[10px] font-semibold mb-1">ডেলিভারি ঠিকানা:</span>
            <span id="detailCustAddress">ঢাকা</span>
          </div>
          <div class="pt-1">
            <a id="detailWaLink" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[12px] bg-[#30D158]/15 border border-[#30D158]/30 text-[#30D158] text-xs font-bold hover:bg-[#30D158]/25 transition">
              <span>💬 সরাসরি WhatsApp-এ কথা বলুন</span>
            </a>
          </div>
        </div>

        <!-- Product & Financials Box -->
        <div class="bg-[#2C2C2E]/60 border border-white/[0.08] p-4 rounded-[20px] space-y-3">
          <div class="text-xs font-bold text-[rgba(235,235,245,0.50)] uppercase tracking-wider">
            💰 প্রোডাক্ট ও পেমেন্ট হিসাব
          </div>
          
          <div class="bg-[#1C1C1E] p-3 rounded-[12px] border border-white/[0.06] space-y-1">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white font-mono text-sm" id="detailModelCode">[PROD-101]</span>
              <span class="text-xs text-white font-bold" id="detailItemPrice">৳০</span>
            </div>
            <div class="text-xs text-[rgba(235,235,245,0.60)]" id="detailSizeDesc">সাইজ: ৫০</div>
          </div>

          <div class="space-y-1.5 text-xs text-[rgba(235,235,245,0.70)]">
            <div class="flex justify-between">
              <span>ডেলিভারি চার্জ:</span>
              <span class="font-mono text-white font-semibold" id="detailDeliveryFee">৳৮০</span>
            </div>
            <div class="flex justify-between text-emerald-400">
              <span>অগ্রিম পেমেন্ট (Advance):</span>
              <span class="font-mono font-semibold" id="detailAdvancePaid">৳০</span>
            </div>
            <div class="border-t border-white/[0.08] pt-1.5 flex justify-between items-baseline">
              <span class="font-bold text-white">ক্যাশ কালেকশন (Due COD):</span>
              <span class="font-mono font-black text-lg text-[#30D158]" id="detailDueCod">৳০</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Courier Partner Info -->
      <div id="detailCourierBox" class="bg-[#2C2C2E]/40 border border-white/[0.06] p-3.5 rounded-[16px] text-xs flex items-center justify-between">
        <div>
          <span class="text-[rgba(235,235,245,0.45)] text-[10px] uppercase font-bold block">কুরিয়ার ট্র্যাকিং</span>
          <span class="text-white font-semibold" id="detailCourierInfo">Steadfast Courier</span>
        </div>
        <button type="button" id="detailCopyCourierBtn" onclick="" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white text-xs px-3 py-1.5 rounded-[8px] border border-white/[0.08] transition cursor-pointer">
          📋 কুরিয়ার টেক্সট কপি
        </button>
      </div>

      <!-- Action Buttons -->
      <div class="pt-2 border-t border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-xs text-[rgba(235,235,245,0.60)] font-semibold">স্ট্যাটাস:</span>
          <select id="detailStatusSelect" onchange="changeDetailModalStatus(this.value)" class="bg-[#2C2C2E] border border-white/[0.1] text-white text-xs font-semibold px-3 py-1.5 rounded-[10px] outline-none cursor-pointer">
            <option value="Booked">📦 Booked</option>
            <option value="Approved">✅ Confirmed</option>
            <option value="Shipped">🚚 Shipped</option>
            <option value="Delivered">🎉 Delivered</option>
            <option value="Returned">↩️ Returned</option>
            <option value="Cancelled">❌ Cancelled</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" id="detailPrintMemoBtn" onclick="" class="bg-white hover:bg-[#E5E5EA] text-black font-bold text-xs px-4 py-2 rounded-[12px] transition cursor-pointer flex items-center gap-1.5 shadow-xs">
            <span>🖨️ মেমো প্রিন্ট</span>
          </button>
          <button type="button" onclick="closeOrderDetailsModal()" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold px-4 py-2 rounded-[12px] text-xs transition cursor-pointer">
            বন্ধ করুন
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- DYNAMIC SIZE & QUANTITY MATRIX MODAL                      -->
  <!-- ======================================================== -->
  <div id="sizeStockModal" class="hidden fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
    <div class="modal-card bg-[#1C1C1E] border border-white/[0.12] rounded-[28px] max-w-lg w-full p-6 sm:p-7 shadow-[0_24px_70px_rgba(0,0,0,0.85)] space-y-5 text-left max-h-[90vh] overflow-y-auto no-scrollbar">
      
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-white/[0.08] pb-4">
        <div>
          <div class="flex items-center gap-2">
            <span id="sizeModalProdCode" class="font-mono font-bold text-xs bg-[#2C2C2E] text-white px-2 py-0.5 rounded-[6px] border border-white/[0.1]">PROD</span>
            <h3 class="font-extrabold text-white text-base sm:text-lg">সাইজ ও ইনভেন্টরি স্টক ম্যাট্রিক্স</h3>
          </div>
          <p id="sizeModalProdName" class="text-xs text-[rgba(235,235,245,0.60)] mt-1 truncate max-w-sm"></p>
        </div>
        <button type="button" onclick="closeSizeStockModal()" class="w-8 h-8 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[rgba(235,235,245,0.70)] hover:text-white flex items-center justify-center text-sm transition cursor-pointer">
          ✕
        </button>
      </div>

      <!-- Quick Preset Add Chips -->
      <div class="space-y-2 bg-[#2C2C2E]/40 p-3.5 rounded-[18px] border border-white/[0.06]">
        <div class="text-[11px] font-semibold text-[rgba(235,235,245,0.50)] uppercase tracking-wider flex items-center justify-between">
          <span>⚡ কুইক সাইজ প্রিসেট (ক্লিক করলেই যুক্ত হবে):</span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <button type="button" onclick="quickAddSizeItem('50')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+50</button>
          <button type="button" onclick="quickAddSizeItem('52')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+52</button>
          <button type="button" onclick="quickAddSizeItem('54')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+54</button>
          <button type="button" onclick="quickAddSizeItem('56')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+56</button>
          <button type="button" onclick="quickAddSizeItem('58')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+58</button>
          <span class="text-[rgba(235,235,245,0.25)]">|</span>
          <button type="button" onclick="quickAddSizeItem('S')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+S</button>
          <button type="button" onclick="quickAddSizeItem('M')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+M</button>
          <button type="button" onclick="quickAddSizeItem('L')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+L</button>
          <button type="button" onclick="quickAddSizeItem('XL')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+XL</button>
          <button type="button" onclick="quickAddSizeItem('XXL')" class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] hover:bg-white hover:text-black text-white border border-white/[0.1] transition cursor-pointer">+XXL</button>
        </div>
      </div>

      <!-- Add Custom Size Row -->
      <div class="flex items-center gap-2">
        <input type="text" id="newCustomSizeName" placeholder="কাস্টম সাইজ (যেমন: 42, 60 বা Free)" class="flex-1 bg-[#2C2C2E] border border-white/[0.08] text-white text-xs px-3.5 py-2.5 rounded-[12px] focus:outline-none focus:border-white/40">
        <input type="number" id="newCustomSizeQty" placeholder="স্টক" min="0" value="5" class="w-20 bg-[#2C2C2E] border border-white/[0.08] text-white text-xs px-3 py-2.5 rounded-[12px] focus:outline-none focus:border-white/40 font-mono">
        <button type="button" onclick="addCustomSizeFromInput()" class="bg-white hover:bg-[#E5E5EA] text-black font-bold text-xs px-4 py-2.5 rounded-[12px] transition cursor-pointer shrink-0">
          + সাইজ যোগ করুন
        </button>
      </div>

      <!-- Size Items Table / List -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-[11px] font-semibold text-[rgba(235,235,245,0.50)] uppercase tracking-wider px-1">
          <span>সাইজ তালিকা</span>
          <span>স্টক সংখ্যা (পিস)</span>
        </div>
        <div id="sizeStockListContainer" class="space-y-2 max-h-64 overflow-y-auto pr-1">
          <!-- Dynamically Rendered by JS -->
        </div>
      </div>

      <!-- Total Computed Stock Banner -->
      <div class="bg-[#2C2C2E] p-3.5 rounded-[16px] border border-white/[0.08] flex items-center justify-between text-xs sm:text-sm">
        <span class="text-[rgba(235,235,245,0.70)]">সবগুলো সাইজ মিলিয়ে মোট স্টক:</span>
        <span class="font-extrabold text-[#30D158] font-mono text-base"><span id="sizeModalTotalStockVal">0</span> পিস</span>
      </div>

      <!-- Save & Action Buttons -->
      <div class="pt-3 border-t border-white/[0.08] flex items-center justify-between gap-3">
        <button type="button" onclick="closeSizeStockModal()" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold px-5 py-2.5 rounded-[14px] text-xs transition cursor-pointer">
          ✕ বাতিল
        </button>
        <button type="button" id="saveSizeStockBtn" onclick="saveSizeStockToServer()" class="bg-[#30D158] hover:bg-[#34C759] text-black font-extrabold px-6 py-2.5 rounded-[14px] text-xs sm:text-sm transition cursor-pointer shadow-[0_2px_12px_rgba(48,209,88,0.3)]">
          💾 সাইজ ও স্টক সেভ করুন
        </button>
      </div>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- Amazon Seller Central Style Floating Bulk Operations Dock -->
  <!-- ======================================================== -->
  <div id="bulkActionBar" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transform translate-y-32 opacity-0 pointer-events-none transition-all duration-300 w-[95%] max-w-3xl">
    <div class="bg-[#1C1C1E]/95 backdrop-blur-2xl border border-white/[0.15] shadow-[0_20px_60px_rgba(0,0,0,0.85)] rounded-[22px] p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap">
      
      <!-- Selection Indicator -->
      <div class="flex items-center gap-3">
        <span id="bulkSelectedCountBadge" class="bg-[#30D158] text-black font-extrabold px-3 py-1 rounded-full text-xs font-mono shadow-xs">0</span>
        <div>
          <div class="font-bold text-white text-sm">টি প্রোডাক্ট সিলেক্টেড</div>
          <div class="text-[11px] text-[rgba(235,235,245,0.50)]">বাল্ক অপারেশনের জন্য প্রস্তুত</div>
        </div>
      </div>

      <!-- Action Buttons Dock -->
      <div class="flex items-center gap-2 flex-wrap">
        <!-- Restock Action -->
        <button type="button" onclick="openBulkRestockPrompt()" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold text-xs px-3.5 py-2 rounded-[12px] border border-white/[0.1] transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95">
          <span>📦</span><span>স্টক যোগ করুন</span>
        </button>

        <!-- Bulk Discount Action -->
        <button type="button" onclick="openBulkDiscountPrompt()" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-semibold text-xs px-3.5 py-2 rounded-[12px] border border-white/[0.1] transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95">
          <span>🏷️</span><span>মূল্য ছাড় (% অফ)</span>
        </button>

        <!-- Bulk Toggle In-Stock / Out -->
        <button type="button" onclick="bulkToggleStock(true)" class="bg-[#30D158]/15 hover:bg-[#30D158]/25 text-[#30D158] font-semibold text-xs px-3 py-2 rounded-[12px] border border-[#30D158]/30 transition flex items-center gap-1 cursor-pointer active:scale-95" title="নির্বাচিত সবগুলো ইন-স্টক করুন">
          <span>✓</span><span>ইন-স্টক</span>
        </button>

        <button type="button" onclick="bulkToggleStock(false)" class="bg-[#FF9F0A]/15 hover:bg-[#FF9F0A]/25 text-[#FF9F0A] font-semibold text-xs px-3 py-2 rounded-[12px] border border-[#FF9F0A]/30 transition flex items-center gap-1 cursor-pointer active:scale-95" title="নির্বাচিত সবগুলো স্টক-আউট করুন">
          <span>✕</span><span>স্টক-আউট</span>
        </button>

        <!-- Bulk Delete -->
        <button type="button" onclick="bulkDeleteSelected()" class="bg-[#FF453A]/15 hover:bg-[#FF453A]/25 text-[#FF453A] font-semibold text-xs px-3 py-2 rounded-[12px] border border-[#FF453A]/30 transition flex items-center gap-1 cursor-pointer active:scale-95" title="নির্বাচিত পণ্য মুছে ফেলুন">
          <span>🗑️</span>
        </button>

        <!-- Cancel Selection -->
        <button type="button" onclick="clearProductSelection()" class="text-[rgba(235,235,245,0.40)] hover:text-white text-xs font-semibold px-2 py-2 transition cursor-pointer" title="বাছাই বাতিল">
          ✕
        </button>
      </div>

    </div>
  </div>

  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 pointer-events-none"></div>

  <script>
    const token = '${token}';
    window.portalOrders = ${JSON.stringify(orders)};
    window.portalProducts = ${JSON.stringify(products)};
    let currentStockFilter = 'ALL';
    let currentOrderFilter = 'ALL';

    // Image Upload State (Min 5, Max 8)
    let studioUploadedImages = [];

    // Safe Deletion State
    let pendingDeleteProdId = null;
    let deleteCountdownTimer = null;
    let deleteSecondsLeft = 3;

    // ==========================================
    // PERSISTENCE & LOGOUT ENGINE
    // ==========================================
    try {
      if (token) localStorage.setItem('autodokan_merchant_token', token);
    } catch(e) {}

    function logoutMerchantPortal() {
      if (confirm('আপনি কি এই মার্চেন্ট সেশন থেকে লগআউট করতে চান?')) {
        try { localStorage.removeItem('autodokan_merchant_token'); } catch(e) {}
        window.location.href = '/portal';
      }
    }

    // ==========================================
    // THEME ENGINE (DARK / LIGHT DUAL MODE)
    // ==========================================
    function initTheme() {
      const savedTheme = localStorage.getItem('autodokan_merchant_theme') || 'dark';
      applyTheme(savedTheme, false);
    }

    function applyTheme(theme, showNotice = false) {
      const icon = document.getElementById('themeToggleIcon');
      const text = document.getElementById('themeToggleText');
      if (theme === 'light') {
        document.body.classList.add('light-mode');
        if (icon) icon.innerText = '🌙';
        if (text) text.innerText = 'ডার্ক মোড';
        if (showNotice) showToast('☀️ লাইট মোড চালু হয়েছে');
      } else {
        document.body.classList.remove('light-mode');
        if (icon) icon.innerText = '☀️';
        if (text) text.innerText = 'লাইট মোড';
        if (showNotice) showToast('🌙 ডার্ক মোড চালু হয়েছে');
      }
    }

    function toggleTheme() {
      const isLight = document.body.classList.contains('light-mode');
      const newTheme = isLight ? 'dark' : 'light';
      localStorage.setItem('autodokan_merchant_theme', newTheme);
      applyTheme(newTheme, true);
    }

    window.addEventListener('DOMContentLoaded', initTheme);

    function showToast(msg, isSuccess = true) {
      const c = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = 'bg-[#1C1C1E] text-white border border-white/[0.12] text-xs sm:text-sm font-semibold px-5 py-3.5 rounded-[18px] shadow-[0_10px_35px_rgba(0,0,0,0.7)] pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2.5';
      t.innerHTML = (isSuccess ? '<span>🟢</span> ' : '<span>⚠️</span> ') + msg;
      c.appendChild(t);
      setTimeout(() => { t.classList.remove('translate-y-2', 'opacity-0'); }, 10);
      setTimeout(() => {
        t.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => t.remove(), 300);
      }, 3500);
    }

    function switchTab(tab) {
      document.querySelectorAll('section[id^="tab-"]').forEach(s => s.classList.add('hidden'));
      document.getElementById('tab-' + tab)?.classList.remove('hidden');

      document.querySelectorAll('.tab-btn').forEach(b => {
        b.className = 'tab-btn px-6 py-2.5 rounded-[16px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white';
      });
      const activeBtn = document.getElementById('tab-btn-' + tab);
      if (activeBtn) activeBtn.className = 'tab-btn px-6 py-2.5 rounded-[16px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]';
    }

    // Switch Card Photo Preview
    function switchCardPhoto(prodId, url) {
      const img = document.getElementById('img-preview-' + prodId);
      if (img && url) img.src = url;
    }

    // Open Catalog Lightbox from Card/Table Image Click
    function openCatalogLightbox(productId) {
      const card = document.querySelector('.prod-card[data-id="' + productId + '"]') || document.querySelector('.prod-table-row[data-id="' + productId + '"]');
      if (!card) return;
      const raw = card.getAttribute('data-gallery');
      if (!raw) return;
      try {
        const list = JSON.parse(decodeURIComponent(raw));
        if (Array.isArray(list) && list.length > 0) {
          studioUploadedImages = [...list];
          openPhotoLightbox(0);
        }
      } catch(e) {
        console.error('Error opening catalog lightbox:', e);
      }
    }

    // Inline Quick-Edit for Price (Syncs both Card and Amazon Table views)
    function startInlineEditPrice(id, currentPrice) {
      const viewEl = document.getElementById('price-view-' + id);
      const editEl = document.getElementById('price-edit-' + id);
      const inputEl = document.getElementById('price-input-' + id);
      if (viewEl && editEl && inputEl) {
        viewEl.classList.add('hidden');
        editEl.classList.remove('hidden');
        inputEl.focus();
        inputEl.select();
      }
      const tblViewEl = document.getElementById('tbl-price-view-' + id);
      const tblEditEl = document.getElementById('tbl-price-edit-' + id);
      const tblInputEl = document.getElementById('tbl-price-input-' + id);
      if (tblViewEl && tblEditEl && tblInputEl) {
        tblViewEl.classList.add('hidden');
        tblEditEl.classList.remove('hidden');
        tblInputEl.focus();
        tblInputEl.select();
      }
    }

    function cancelInlinePrice(id, originalPrice) {
      const viewEl = document.getElementById('price-view-' + id);
      const editEl = document.getElementById('price-edit-' + id);
      const inputEl = document.getElementById('price-input-' + id);
      if (viewEl && editEl) {
        editEl.classList.add('hidden');
        viewEl.classList.remove('hidden');
        if (inputEl) inputEl.value = originalPrice;
      }
      const tblViewEl = document.getElementById('tbl-price-view-' + id);
      const tblEditEl = document.getElementById('tbl-price-edit-' + id);
      const tblInputEl = document.getElementById('tbl-price-input-' + id);
      if (tblViewEl && tblEditEl) {
        tblEditEl.classList.add('hidden');
        tblViewEl.classList.remove('hidden');
        if (tblInputEl) tblInputEl.value = originalPrice;
      }
    }

    async function saveInlinePrice(id) {
      const inputEl = document.getElementById('tbl-price-input-' + id) || document.getElementById('price-input-' + id);
      if (!inputEl) return;
      const newPrice = parseFloat(inputEl.value);
      if (isNaN(newPrice) || newPrice < 0) {
        alert('দয়া করে সঠিক মূল্য লিখুন');
        return;
      }

      try {
        const res = await fetch('/api/portal/quick-edit?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, field: 'price', value: newPrice })
        });
        const data = await res.json();
        if (data.success) {
          const valEl = document.getElementById('price-val-' + id);
          if (valEl) valEl.innerText = '৳' + Number(newPrice).toLocaleString('en-IN');
          const tblValEl = document.getElementById('tbl-price-val-' + id);
          if (tblValEl) tblValEl.innerText = '৳' + Number(newPrice).toLocaleString('en-IN');
          
          const toast = document.getElementById('price-toast-' + id);
          if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2000);
          }
          const tblToast = document.getElementById('tbl-price-toast-' + id);
          if (tblToast) {
            tblToast.classList.remove('hidden');
            setTimeout(() => tblToast.classList.add('hidden'), 2000);
          }
          cancelInlinePrice(id, newPrice);
          showToast('✅ প্রোডাক্ট মূল্য ৳' + Number(newPrice).toLocaleString('en-IN') + ' আপডেট হয়েছে!');
        } else {
          alert('মূল্য আপডেট এরর: ' + (data.error || 'সমস্যা হয়েছে'));
        }
      } catch (e) {
        alert('কানেকশন সমস্যা: ' + e.message);
      }
    }

    // Inline Quick-Edit for Stock Inventory (Syncs both Card and Amazon Table views)
    function startInlineEditStock(id, currentStock) {
      const viewEl = document.getElementById('stock-view-' + id);
      const editEl = document.getElementById('stock-edit-' + id);
      const inputEl = document.getElementById('stock-input-' + id);
      if (viewEl && editEl && inputEl) {
        viewEl.classList.add('hidden');
        editEl.classList.remove('hidden');
        inputEl.focus();
        inputEl.select();
      }
      const tblViewEl = document.getElementById('tbl-stock-view-' + id);
      const tblEditEl = document.getElementById('tbl-stock-edit-' + id);
      const tblInputEl = document.getElementById('tbl-stock-input-' + id);
      if (tblViewEl && tblEditEl && tblInputEl) {
        tblViewEl.classList.add('hidden');
        tblEditEl.classList.remove('hidden');
        tblInputEl.focus();
        tblInputEl.select();
      }
    }

    function cancelInlineStock(id, originalStock) {
      const viewEl = document.getElementById('stock-view-' + id);
      const editEl = document.getElementById('stock-edit-' + id);
      const inputEl = document.getElementById('stock-input-' + id);
      if (viewEl && editEl) {
        editEl.classList.add('hidden');
        viewEl.classList.remove('hidden');
        if (inputEl) inputEl.value = originalStock;
      }
      const tblViewEl = document.getElementById('tbl-stock-view-' + id);
      const tblEditEl = document.getElementById('tbl-stock-edit-' + id);
      const tblInputEl = document.getElementById('tbl-stock-input-' + id);
      if (tblViewEl && tblEditEl) {
        tblEditEl.classList.add('hidden');
        tblViewEl.classList.remove('hidden');
        if (tblInputEl) tblInputEl.value = originalStock;
      }
    }

    async function saveInlineStock(id) {
      const inputEl = document.getElementById('tbl-stock-input-' + id) || document.getElementById('stock-input-' + id);
      if (!inputEl) return;
      const newStock = parseInt(inputEl.value);
      if (isNaN(newStock) || newStock < 0) {
        alert('দয়া করে সঠিক স্টক সংখ্যা লিখুন');
        return;
      }

      try {
        const res = await fetch('/api/portal/quick-edit?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, field: 'stock_quantity', value: newStock })
        });
        const data = await res.json();
        if (data.success) {
          const pLocal = (window.portalProducts || []).find(p => p.id === id);
          if (pLocal) {
            pLocal.stock_quantity = data.value;
            if (data.size_stock) {
              pLocal.custom_attributes = pLocal.custom_attributes || {};
              pLocal.custom_attributes.size_stock = data.size_stock;
            }
          }
          const valEl = document.getElementById('stock-val-' + id);
          if (valEl) valEl.innerText = newStock;
          const tblValEl = document.getElementById('tbl-stock-val-' + id);
          if (tblValEl) tblValEl.innerText = newStock;
          
          const toast = document.getElementById('stock-toast-' + id);
          if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2000);
          }
          const tblToast = document.getElementById('tbl-stock-toast-' + id);
          if (tblToast) {
            tblToast.classList.remove('hidden');
            setTimeout(() => tblToast.classList.add('hidden'), 2000);
          }
          cancelInlineStock(id, newStock);
          showToast('✅ ইনভেন্টরি স্টক ' + newStock + ' পিস আপডেট হয়েছে!');
          if (newStock === 0) {
            setTimeout(() => window.location.reload(), 600);
          }
        } else {
          alert('স্টক আপডেট এরর: ' + (data.error || 'সমস্যা হয়েছে'));
        }
      } catch (e) {
        alert('কানেকশন সমস্যা: ' + e.message);
      }
    }

    // Quick Live Stock Toggle
    async function toggleStockLive(id, nextState) {
      try {
        const res = await fetch('/api/portal/toggle-stock?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, in_stock: nextState })
        });
        const data = await res.json();
        if (data.success) {
          showToast(nextState ? '🟢 প্রোডাক্ট ইন-স্টক করা হয়েছে' : '🔴 প্রোডাক্ট স্টক আউট করা হয়েছে');
          setTimeout(() => window.location.reload(), 800);
        } else {
          showToast('❌ এরর: ' + data.error, false);
        }
      } catch (err) {
        showToast('❌ কানেকশন সমস্যা', false);
      }
    }

    // Quick AI Notes Inline Edit
    async function editAINotesPrompt(id, currentNotes) {
      const newNotes = prompt('🤖 AI বিক্রয় নির্দেশিকা (গ্রাহককে কনভিন্স করার বিশেষ কথা):', currentNotes);
      if (newNotes === null || newNotes === currentNotes) return;

      try {
        const res = await fetch('/api/portal/save-ai-notes?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ai_notes: newNotes })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ AI বিক্রয় নির্দেশিকা আপডেট হয়েছে!');
          const pEl = document.getElementById('ai-notes-' + id);
          if (pEl) pEl.innerText = newNotes || 'কোনো বিশেষ নির্দেশনা দেওয়া নেই।';
        } else {
          showToast('❌ এরর: ' + data.error, false);
        }
      } catch (e) {
        showToast('❌ কানেকশন সমস্যা', false);
      }
    }

    // ==========================================
    // MULTI-PHOTO UPLOAD & LIGHTBOX GALLERY
    // ==========================================
    let currentLightboxIdx = 0;

    function renderStudioPhotos() {
      const grid = document.getElementById('studioPhotosGrid');
      const badge = document.getElementById('photoCountBadge');
      grid.innerHTML = '';

      if (studioUploadedImages.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-8 text-center text-xs text-[rgba(235,235,245,0.60)] border border-dashed border-white/[0.1] rounded-[16px]">' +
          'এখনও কোনো ছবি আপলোড করা হয়নি। উপরে "ছবি আপলোড করতে এখানে ক্লিক করুন" বাটনে চাপ দিয়ে ৫ থেকে ৮টি ছবি সিলেক্ট করুন।' +
          '</div>';
      }

      studioUploadedImages.forEach((url, idx) => {
        const isCover = (idx === 0);
        const slot = document.createElement('div');
        slot.className = 'relative group aspect-[3/4] rounded-[16px] bg-[#1C1C1E] border border-white/[0.12] overflow-hidden shadow-sm hover:border-white/40 transition cursor-pointer';
        
        slot.innerHTML = '<img src="' + url + '" alt="photo ' + (idx + 1) + '" class="w-full h-full object-cover transition duration-200 group-hover:scale-105" onclick="openPhotoLightbox(' + idx + ')">' +
          '<div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center pointer-events-none">' +
            '<span class="bg-black/80 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full border border-white/20 shadow-md">🔍 বড় করে দেখুন</span>' +
          '</div>' +
          '<div class="absolute bottom-2 left-2 bg-black/80 text-white font-mono text-[10px] px-2 py-0.5 rounded-[6px] font-bold shadow pointer-events-none border border-white/10">' +
            (isCover ? '⭐ কভার ফটো (#1)' : '#' + (idx + 1)) +
          '</div>' +
          '<button type="button" onclick="event.stopPropagation(); removeStudioPhoto(' + idx + ')" class="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#FF453A] hover:bg-[#D70015] text-white flex items-center justify-center font-bold text-xs cursor-pointer shadow-md transition active:scale-95" title="এই ছবি মুছে ফেলুন">✕</button>';
        grid.appendChild(slot);
      });

      const count = studioUploadedImages.length;
      if (count < 5) {
        badge.className = 'text-xs px-3.5 py-1.5 rounded-full font-bold bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30';
        badge.innerText = count + '/৮ ছবি (কমপক্ষে আরও ' + (5 - count) + 'টি ছবি দিন)';
      } else {
        badge.className = 'text-xs px-3.5 py-1.5 rounded-full font-bold bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30';
        badge.innerText = '✅ ' + count + '/৮ ছবি প্রস্তুত (অনুমোদিত)';
      }
    }

    function removeStudioPhoto(idx) {
      studioUploadedImages.splice(idx, 1);
      renderStudioPhotos();
    }

    // Photo Lightbox Functions (Click to Enlarge)
    function openPhotoLightbox(idx) {
      if (!studioUploadedImages || studioUploadedImages.length === 0) return;
      currentLightboxIdx = idx;
      updateLightboxDisplay();
      const modal = document.getElementById('imageLightboxModal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.scrollTop = 0;
      }
      document.body.style.overflow = 'hidden';
    }

    function updateLightboxDisplay() {
      const total = studioUploadedImages.length;
      if (total === 0) return;
      const url = studioUploadedImages[currentLightboxIdx];
      const img = document.getElementById('lightboxImg');
      if (img) img.src = url;
      
      const badge = document.getElementById('lightboxIndexBadge');
      if (badge) badge.innerText = 'ছবি ' + (currentLightboxIdx + 1) + ' / ' + total;
      
      const coverBadge = document.getElementById('lightboxCoverBadge');
      if (coverBadge) {
        if (currentLightboxIdx === 0) {
          coverBadge.classList.remove('hidden');
        } else {
          coverBadge.classList.add('hidden');
        }
      }

      const prevBtn = document.getElementById('lightboxPrevBtn');
      const nextBtn = document.getElementById('lightboxNextBtn');
      if (prevBtn) prevBtn.style.display = total > 1 ? 'flex' : 'none';
      if (nextBtn) nextBtn.style.display = total > 1 ? 'flex' : 'none';
    }

    function navigateLightbox(step) {
      const total = studioUploadedImages.length;
      if (total <= 1) return;
      currentLightboxIdx = (currentLightboxIdx + step + total) % total;
      updateLightboxDisplay();
    }

    function closeLightboxModal(e) {
      if (e && e.target && e.target.id !== 'imageLightboxModal' && !e.target.closest('button')) {
        return;
      }
      const modal = document.getElementById('imageLightboxModal');
      if (modal) modal.classList.add('hidden');
      document.body.style.overflow = '';
    }

    // Keyboard navigation for Lightbox
    window.addEventListener('keydown', (e) => {
      const modal = document.getElementById('imageLightboxModal');
      if (modal && !modal.classList.contains('hidden')) {
        if (e.key === 'Escape') closeLightboxModal();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      }
    });

    async function handleStudioFilesUpload(files) {
      if (!files || files.length === 0) return;
      const remainingSlots = 8 - studioUploadedImages.length;
      if (remainingSlots <= 0) {
        alert('সর্বোচ্চ ৮টি ছবি আপলোড করা যাবে। নতুন ছবি যোগ করার আগে কিছু ছবি ডিলিট করুন।');
        return;
      }

      const filesToUpload = Array.from(files).slice(0, remainingSlots);
      showToast('📤 ' + filesToUpload.length + 'টি ছবি আপলোড হচ্ছে...');

      for (const file of filesToUpload) {
        try {
          const base64 = await readFileAsBase64(file);
          const res = await fetch('/api/portal/upload-image?token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64, filename: file.name, contentType: file.type })
          });
          const data = await res.json();
          if (data.success && data.url) {
            studioUploadedImages.push(data.url);
            renderStudioPhotos();
          }
        } catch (e) {
          console.error('Upload failed:', e);
        }
      }
      showToast('✅ ছবি আপলোড সম্পন্ন হয়েছে!');
      document.getElementById('studio_file_input').value = '';
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ==========================================
    // 3-STEP SAFE DELETION PROTOCOL
    // ==========================================
    function openSafeDeleteModal(id, code, name, imgUrl) {
      pendingDeleteProdId = id;
      deleteSecondsLeft = 3;
      document.getElementById('delProdCode').innerText = code;
      document.getElementById('delProdName').innerText = name;
      document.getElementById('delProdImg').src = imgUrl;

      const btn = document.getElementById('delConfirmBtn');
      btn.innerText = 'নিশ্চিত মুছুন (3s)';
      btn.disabled = true;
      btn.className = 'flex-1 bg-stone-700 text-stone-400 font-bold py-3 rounded-[14px] text-xs sm:text-sm cursor-not-allowed';

      document.getElementById('safeDeleteModal').classList.remove('hidden');

      if (deleteCountdownTimer) clearInterval(deleteCountdownTimer);
      deleteCountdownTimer = setInterval(() => {
        deleteSecondsLeft--;
        if (deleteSecondsLeft > 0) {
          btn.innerText = 'নিশ্চিত মুছুন (' + deleteSecondsLeft + 's)';
        } else {
          clearInterval(deleteCountdownTimer);
          btn.innerText = '⚠️ হ্যাঁ, নিশ্চিতভাবে মুছে ফেলুন';
          btn.disabled = false;
          btn.className = 'flex-1 bg-[#FF453A] hover:bg-[#D70015] text-white font-bold py-3 rounded-[14px] text-xs sm:text-sm transition cursor-pointer shadow-[0_2px_12px_rgba(255,69,58,0.3)] active:scale-95';
        }
      }, 1000);
    }

    function closeSafeDeleteModal() {
      if (deleteCountdownTimer) clearInterval(deleteCountdownTimer);
      document.getElementById('safeDeleteModal').classList.add('hidden');
      pendingDeleteProdId = null;
    }

    async function executeSafeDelete() {
      if (!pendingDeleteProdId) return;
      const id = pendingDeleteProdId;
      closeSafeDeleteModal();
      showToast('🗑️ প্রোডাক্ট মুছে ফেলা হচ্ছে...');

      try {
        const res = await fetch('/api/portal/delete-product?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ প্রোডাক্ট সফলভাবে মুছে ফেলা হয়েছে!');
          setTimeout(() => window.location.reload(), 1000);
        } else {
          showToast('❌ এরর: ' + data.error, false);
        }
      } catch (e) {
        showToast('❌ কানেকশন সমস্যা', false);
      }
    }

    function onStudioCategoryChange(cat) {
      const fashionBox = document.getElementById('cat_fields_fashion');
      const footwearBox = document.getElementById('cat_fields_footwear');
      const elecBox = document.getElementById('cat_fields_electronics');
      const cosmeticsBox = document.getElementById('cat_fields_cosmetics');
      const badge = document.getElementById('currentCategoryBadge');
      
      fashionBox.classList.add('hidden');
      footwearBox.classList.add('hidden');
      elecBox.classList.add('hidden');
      cosmeticsBox.classList.add('hidden');

      if (cat === 'footwear') {
        footwearBox.classList.remove('hidden');
        badge.innerText = 'জুতা ও ফুটওয়্যার';
        badge.className = 'text-[11px] font-normal text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-[6px]';
        document.getElementById('badge_txt_1').innerText = '👞 ১০০% পিওর লেদার';
        document.getElementById('badge_txt_2').innerText = '✨ মেমোরি ফোম কমফোর্ট';
        document.getElementById('badge_txt_3').innerText = '🌧️ ওয়াটার রেজিস্ট্যান্ট';
        document.getElementById('badge_txt_4').innerText = '🔍 চেক করে নেওয়ার সুযোগ';
      } else if (cat === 'electronics') {
        elecBox.classList.remove('hidden');
        badge.innerText = 'গ্যাজেট ও ইলেকট্রনিক্স';
        badge.className = 'text-[11px] font-normal text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-[6px]';
        document.getElementById('badge_txt_1').innerText = '⚡ ১০০% অথেনটিক';
        document.getElementById('badge_txt_2').innerText = '🛡️ ওয়ারেন্টি সমর্থিত';
        document.getElementById('badge_txt_3').innerText = '🔋 লং ব্যাটারি লাইফ';
        document.getElementById('badge_txt_4').innerText = '🔍 বক্স খুলে চেক সুবিধা';
      } else if (cat === 'cosmetics') {
        cosmeticsBox.classList.remove('hidden');
        badge.innerText = 'বিউটি ও স্কিনকেয়ার';
        badge.className = 'text-[11px] font-normal text-pink-300 bg-pink-500/10 px-2 py-0.5 rounded-[6px]';
        document.getElementById('badge_txt_1').innerText = '💄 ১০০% অরিজিনাল';
        document.getElementById('badge_txt_2').innerText = '🌿 প্যারাবেন-মুক্ত';
        document.getElementById('badge_txt_3').innerText = '✨ স্কিন-ফ্রেন্ডলি';
        document.getElementById('badge_txt_4').innerText = '🔍 সিলড ইনট্যাক্ট প্যাক';
      } else if (cat === 'food' || cat === 'general') {
        badge.innerText = cat === 'food' ? 'অর্গানিক ফুড' : 'অন্যান্য পণ্য';
        badge.className = 'text-[11px] font-normal text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-[6px]';
        document.getElementById('badge_txt_1').innerText = '🌿 ১০০% খাঁটি উপাদান';
        document.getElementById('badge_txt_2').innerText = '✨ প্রিমিয়াম কোয়ালিটি';
        document.getElementById('badge_txt_3').innerText = '📦 ইনট্যাক্ট প্যাকেজিং';
        document.getElementById('badge_txt_4').innerText = '🔍 চেক করে নেওয়ার সুযোগ';
      } else {
        fashionBox.classList.remove('hidden');
        badge.innerText = 'পোশাক ও ফ্যাশন';
        badge.className = 'text-[11px] font-normal text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-[6px]';
        document.getElementById('badge_txt_1').innerText = '🎨 কালার ১০০% গ্যারান্টি';
        document.getElementById('badge_txt_2').innerText = '✨ কুঁচকে যায় না (Wrinkle-free)';
        document.getElementById('badge_txt_3').innerText = '❄️ গরমে আরামদায়ক';
        document.getElementById('badge_txt_4').innerText = '🧼 সহজে ওয়াশেবল';
      }
    }

    function updateBundlePreview() {
      const isBundle = document.getElementById('studio_bundle_active').checked;
      const box = document.getElementById('bundleConfigBox');
      const preview = document.getElementById('bundlePreviewBox');
      if (!isBundle) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');

      const price = parseFloat(document.getElementById('studio_price').value) || 0;
      const qty = parseInt(document.getElementById('studio_bundle_qty').value) || 2;
      const type = document.getElementById('studio_bundle_type').value;
      const val = parseFloat(document.getElementById('studio_bundle_value').value) || 0;

      let text = '';
      let comboPrice = price * qty;
      let savings = 0;

      if (type === 'percentage') {
        savings = Math.round(comboPrice * (val / 100));
        const finalPrice = comboPrice - savings;
        text = '💡 প্রিভিউ: গ্রাহক ' + qty + 'টি নিলে ' + val + '% ছাড়ে মোট ৳' + finalPrice.toLocaleString() + ' (সাশ্রয় ৳' + savings.toLocaleString() + ')';
      } else if (type === 'fixed_price') {
        savings = comboPrice > val ? comboPrice - val : 0;
        text = '💡 প্রিভিউ: গ্রাহক ' + qty + 'টি নিলে স্পেশাল কম্বো রেট ৳' + val.toLocaleString() + (savings > 0 ? ' (সাশ্রয় ৳' + savings.toLocaleString() + ')' : '');
      } else if (type === 'free_delivery') {
        text = '💡 প্রিভিউ: গ্রাহক ' + qty + 'টি বা তার বেশি নিলে সম্পূর্ণ ফ্রি ডেলিভারি অফার!';
      }
      preview.innerText = text;
    }

    // Open Modal for Add
    function openAddProductModal() {
      document.getElementById('modalTitle').innerText = '➕ নতুন প্রোডাক্ট যোগ করুন';
      document.getElementById('studio_prod_id').value = '';
      document.getElementById('productStudioForm').reset();
      studioUploadedImages = [];
      renderStudioPhotos();

      // Smart Defaults for high conversion & effortless entry
      document.getElementById('studio_category').value = 'fashion';
      onStudioCategoryChange('fashion');

      document.getElementById('studio_bundle_active').checked = false;
      document.getElementById('studio_bundle_qty').value = '2';
      document.getElementById('studio_bundle_type').value = 'percentage';
      document.getElementById('studio_bundle_value').value = '10';
      updateBundlePreview();

      document.getElementById('studio_package_type').value = '২ পিস সেট (আবায়া + ম্যাচিং হিজাব)';
      document.getElementById('studio_package_inclusions').value = 'আবায়া + ম্যাচিং হিজাব + প্রিমিয়াম প্যাকিং';
      document.getElementById('studio_transparency').value = '100% নন-ট্রান্সপারেন্ট (কোনো ইনার প্রয়োজন নেই)';
      document.getElementById('studio_color_guarantee').checked = true;
      document.getElementById('studio_wrinkle_free').checked = true;
      document.getElementById('studio_summer_friendly').checked = true;
      document.getElementById('studio_wash_care').checked = true;
      document.getElementById('studio_hijab_included').value = 'true';
      document.getElementById('studio_hijab_details').value = 'ম্যাচিং সফট দুবাই চেরি হিজাব ফ্রি অন্তর্ভুক্ত';
      document.getElementById('studio_lighting_disclaimer').value = 'স্টুডিও লাইটিং ও মোবাইল ডিসপ্লের কারণে ছবির কালার বাস্তবে ৫-১০% সামান্য উনিশ-বিশ হতে পারে';

      document.getElementById('productStudioModal').classList.remove('hidden');
    }

    // Open Modal for Edit
    async function openEditProductModalById(id) {
      document.getElementById('modalTitle').innerText = '✏️ প্রোডাক্ট এডিট করুন';
      document.getElementById('studio_prod_id').value = id;
      document.getElementById('productStudioForm').reset();
      studioUploadedImages = [];

      try {
        const res = await fetch('/api/portal/get-product?token=' + token + '&id=' + id);
        const data = await res.json();
        if (data.success && data.product) {
          const p = data.product;
          document.getElementById('studio_code').value = p.model_code || '';
          document.getElementById('studio_name').value = p.name || '';
          document.getElementById('studio_price').value = p.price || '';
          document.getElementById('studio_regular_price').value = p.regular_price || '';
          document.getElementById('studio_stock_qty').value = p.stock_quantity || 1;
          document.getElementById('studio_sizes').value = p.sizes || '';
          document.getElementById('studio_colors').value = p.colors || '';
          document.getElementById('studio_fabric').value = p.fabric || '';
          document.getElementById('studio_ai_notes').value = p.short_description || '';

          const c = p.custom_attributes || {};
          const cat = p.category || c.category || 'fashion';
          document.getElementById('studio_category').value = cat;
          onStudioCategoryChange(cat);

          // Bundle Settings
          document.getElementById('studio_bundle_active').checked = !!c.bundle_active;
          document.getElementById('studio_bundle_qty').value = c.bundle_qty || '2';
          document.getElementById('studio_bundle_type').value = c.bundle_type || 'percentage';
          document.getElementById('studio_bundle_value').value = c.bundle_value || '10';
          updateBundlePreview();

          document.getElementById('studio_package_type').value = c.package_type || (p.hijab_included ? '২ পিস সেট (আবায়া + ম্যাচিং হিজাব)' : '১ পিস');
          document.getElementById('studio_package_inclusions').value = c.inclusions || '';
          document.getElementById('studio_transparency').value = c.transparency || '100% নন-ট্রান্সপারেন্ট (কোনো ইনার প্রয়োজন নেই)';
          document.getElementById('studio_hijab_included').value = (p.hijab_included !== false && c.hijab_included !== false) ? 'true' : 'false';
          document.getElementById('studio_hijab_details').value = c.hijab_details || (p.hijab_included ? 'ম্যাচিং হিজাব সাথে অন্তর্ভুক্ত' : '');
          document.getElementById('studio_body_fit').value = c.body_fit || '';
          document.getElementById('studio_flare_inches').value = c.flare_inches || '';
          document.getElementById('studio_footwear_material').value = c.material || '';
          document.getElementById('studio_footwear_comfort').value = c.comfort || '';
          document.getElementById('studio_warranty').value = c.warranty || '';
          document.getElementById('studio_electronics_specs').value = c.tech_specs || '';
          document.getElementById('studio_skin_type').value = c.skin_type || '';
          document.getElementById('studio_net_volume').value = c.net_volume || '';

          document.getElementById('studio_color_guarantee').checked = c.color_guarantee !== false;
          document.getElementById('studio_wrinkle_free').checked = c.wrinkle_free !== false;
          document.getElementById('studio_summer_friendly').checked = c.summer_friendly !== false;
          document.getElementById('studio_wash_care').checked = c.wash_care !== false;
          document.getElementById('studio_lighting_disclaimer').value = c.lighting_disclaimer || 'স্টুডিও লাইটিং ও মোবাইল ডিসপ্লের কারণে ছবির কালার বাস্তবে ৫-১০% সামান্য উনিশ-বিশ হতে পারে';

          // Populate existing photos
          const existingGallery = [
            p.image_url,
            p.detail_image_url,
            p.real_image_url,
            p.hijab_image_url,
            p.flare_image_url,
            ...(c.gallery_images || [])
          ].filter(u => typeof u === 'string' && u.trim());
          studioUploadedImages = Array.from(new Set(existingGallery)).slice(0, 8);
          renderStudioPhotos();
        }
      } catch (e) {}

      document.getElementById('productStudioModal').classList.remove('hidden');
    }

    function closeProductStudioModal() {
      document.getElementById('productStudioModal').classList.add('hidden');
    }

    function setPresetSizes(sizes) {
      document.getElementById('studio_sizes').value = sizes;
    }

    function setPresetFabric(fabric) {
      document.getElementById('studio_fabric').value = fabric;
    }

    function setPresetPackage(pkg) {
      document.getElementById('studio_package_type').value = pkg;
    }

    function appendPresetColor(color) {
      const el = document.getElementById('studio_colors');
      const cur = el.value.trim();
      if (!cur) {
        el.value = color;
      } else {
        const list = cur.split(',').map(s => s.trim()).filter(Boolean);
        if (!list.includes(color)) {
          list.push(color);
          el.value = list.join(', ');
        }
      }
    }

    // Handle Studio Submit (Enforces Min 5, Max 8 Photos)
    async function handleProductStudioSubmit(e) {
      e.preventDefault();

      // Check URL fallback if any
      const manualUrl = document.getElementById('studio_img_main')?.value?.trim();
      if (manualUrl && !studioUploadedImages.includes(manualUrl)) {
        studioUploadedImages.push(manualUrl);
      }

      if (studioUploadedImages.length < 5) {
        alert('⚠️ প্রোডাক্ট সেভ করতে ন্যূনতম ৫টি ছবি আপলোড করা আবশ্যক! বর্তমানে আছে: ' + studioUploadedImages.length + 'টি ছবি। দয়া করে আরও ' + (5 - studioUploadedImages.length) + 'টি ছবি আপলোড করুন।');
        return;
      }

      const btn = document.getElementById('studioSubmitBtn');
      btn.innerText = 'সংরক্ষণ হচ্ছে...'; btn.disabled = true;

      const prodId = document.getElementById('studio_prod_id').value;
      const isEdit = !!prodId;
      const isHijabInc = document.getElementById('studio_hijab_included').value === 'true';
      const category = document.getElementById('studio_category').value;
      const isBundle = document.getElementById('studio_bundle_active').checked;
      const bundleQty = parseInt(document.getElementById('studio_bundle_qty').value) || 2;
      const bundleType = document.getElementById('studio_bundle_type').value;
      const bundleVal = parseFloat(document.getElementById('studio_bundle_value').value) || 0;
      const priceVal = parseFloat(document.getElementById('studio_price').value) || 0;

      let bundleLabel = '';
      if (isBundle) {
        if (bundleType === 'percentage') {
          const combo = priceVal * bundleQty;
          const save = Math.round(combo * (bundleVal / 100));
          bundleLabel = bundleQty + 'টি নিলে ' + bundleVal + '% ছাড়ে মোট ৳' + (combo - save) + ' (৳' + save + ' সাশ্রয়)';
        } else if (bundleType === 'fixed_price') {
          bundleLabel = bundleQty + 'টি নিলে স্পেশাল কম্বো রেট ৳' + bundleVal;
        } else if (bundleType === 'free_delivery') {
          bundleLabel = bundleQty + 'টি বা তার বেশি নিলে সম্পূর্ণ ফ্রি ডেলিভারি';
        }
      }

      const payload = {
        id: prodId || undefined,
        model_code: document.getElementById('studio_code').value.trim(),
        name: document.getElementById('studio_name').value.trim(),
        category: category,
        price: document.getElementById('studio_price').value,
        regular_price: document.getElementById('studio_regular_price').value || document.getElementById('studio_price').value,
        stock_quantity: document.getElementById('studio_stock_qty').value || 1,
        sizes: document.getElementById('studio_sizes').value.trim(),
        colors: document.getElementById('studio_colors').value.trim(),
        fabric: document.getElementById('studio_fabric').value.trim(),
        short_description: document.getElementById('studio_ai_notes').value.trim(),
        gallery_images: studioUploadedImages.slice(0, 8),
        hijab_included: isHijabInc,
        custom_attributes: {
          category: category,
          bundle_active: isBundle,
          bundle_qty: bundleQty,
          bundle_type: bundleType,
          bundle_value: bundleVal,
          bundle_label: bundleLabel,
          package_type: document.getElementById('studio_package_type').value.trim(),
          inclusions: document.getElementById('studio_package_inclusions').value.trim(),
          transparency: document.getElementById('studio_transparency').value,
          hijab_included: isHijabInc,
          hijab_details: document.getElementById('studio_hijab_details').value.trim(),
          body_fit: document.getElementById('studio_body_fit').value.trim(),
          flare_inches: document.getElementById('studio_flare_inches').value.trim(),
          material: document.getElementById('studio_footwear_material').value.trim(),
          comfort: document.getElementById('studio_footwear_comfort').value.trim(),
          warranty: document.getElementById('studio_warranty').value.trim(),
          tech_specs: document.getElementById('studio_electronics_specs').value.trim(),
          skin_type: document.getElementById('studio_skin_type').value.trim(),
          net_volume: document.getElementById('studio_net_volume').value.trim(),
          color_guarantee: document.getElementById('studio_color_guarantee').checked,
          wrinkle_free: document.getElementById('studio_wrinkle_free').checked,
          summer_friendly: document.getElementById('studio_summer_friendly').checked,
          wash_care: document.getElementById('studio_wash_care').checked,
          lighting_disclaimer: document.getElementById('studio_lighting_disclaimer').value.trim(),
          gallery_images: studioUploadedImages.slice(0, 8)
        }
      };

      try {
        const endpoint = isEdit ? '/api/portal/edit-product' : '/api/portal/add-product';
        const res = await fetch(endpoint + '?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast(isEdit ? '✅ প্রোডাক্ট সফলভাবে আপডেট হয়েছে!' : '🎉 নতুন প্রোডাক্ট যুক্ত হয়েছে!');
          closeProductStudioModal();
          setTimeout(() => window.location.reload(), 1200);
        } else {
          alert('সমস্যা: ' + (data.error || 'এরর'));
        }
      } catch (err) {
        alert('কানেকশন সমস্যা: ' + err.message);
      } finally {
        btn.innerText = '💾 প্রোডাক্ট সংরক্ষণ করুন'; btn.disabled = false;
      }
    }

    // Filter Products
    function filterStock(type) {
      currentStockFilter = type;
      document.querySelectorAll('.stock-filter-btn').forEach(b => {
        b.className = 'stock-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer';
      });
      const active = type === 'ALL' ? 'filter-stock-all' : (type === 'IN_STOCK' ? 'filter-stock-instock' : (type === 'LOW_STOCK' ? 'filter-stock-low_stock' : 'filter-stock-out'));
      const el = document.getElementById(active);
      if (el) el.className = 'stock-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer';
      applyProductFilters();
    }

    function filterProducts() { applyProductFilters(); }

    function applyProductFilters() {
      const q = (document.getElementById('prodSearch')?.value || '').toLowerCase().trim();
      document.querySelectorAll('.prod-card, .prod-table-row').forEach(c => {
        const search = c.getAttribute('data-search') || '';
        const stock = c.getAttribute('data-stock') || '';
        let matchStock = false;
        if (currentStockFilter === 'ALL') {
          matchStock = true;
        } else if (currentStockFilter === 'IN_STOCK') {
          matchStock = (stock === 'IN_STOCK' || stock === 'LOW_STOCK');
        } else if (currentStockFilter === 'LOW_STOCK') {
          matchStock = (stock === 'LOW_STOCK');
        } else if (currentStockFilter === 'STOCK_OUT') {
          matchStock = (stock === 'STOCK_OUT');
        }
        const matchSearch = !q || search.includes(q);
        c.style.display = (matchStock && matchSearch) ? '' : 'none';
      });
    }

    // Orders Filter & Management
    function filterOrderStatus(status) {
      currentOrderFilter = status;
      document.querySelectorAll('.order-filter-btn').forEach(b => {
        b.className = 'order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer';
      });
      const idMap = {
        'ALL': 'filter-order-all',
        'Booked': 'filter-order-booked',
        'Pending': 'filter-order-booked',
        'Approved': 'filter-order-approved',
        'Shipped': 'filter-order-shipped',
        'Delivered': 'filter-order-delivered',
        'Cancelled': 'filter-order-cancelled'
      };
      const el = document.getElementById(idMap[status]);
      if (el) el.className = 'order-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer';
      applyOrderFilters();
    }

    function filterOrders() { applyOrderFilters(); }

    function applyOrderFilters() {
      const q = (document.getElementById('orderSearch')?.value || '').toLowerCase().trim();
      const skuFilter = (document.getElementById('orderSkuFilter')?.value || 'ALL');
      const dateFilter = (document.getElementById('orderDateFilter')?.value || 'ALL');

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);
      const sevenDaysAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

      let visibleCount = 0;
      let visibleSum = 0;

      document.querySelectorAll('.order-row').forEach(function(r) {
        const search = r.getAttribute('data-search') || '';
        const status = r.getAttribute('data-status') || '';
        const model = r.getAttribute('data-model') || '';
        const createdAt = r.getAttribute('data-created') || '';
        const createdMs = createdAt ? new Date(createdAt).getTime() : 0;
        const dueCod = parseFloat(r.getAttribute('data-due') || '0');

        // Status Match
        let matchStatus = false;
        if (currentOrderFilter === 'ALL') {
          matchStatus = true;
        } else if (currentOrderFilter === 'Booked' || currentOrderFilter === 'Pending') {
          matchStatus = (status === 'Pending' || status === 'Pending Verification' || status === 'Booked');
        } else if (currentOrderFilter === 'Approved' || currentOrderFilter === 'Confirmed') {
          matchStatus = (status === 'Approved' || status === 'Confirmed');
        } else if (currentOrderFilter === 'Shipped') {
          matchStatus = (status === 'Shipped' || status === 'In Transit' || status === 'Dispatched');
        } else if (currentOrderFilter === 'Delivered') {
          matchStatus = (status === 'Delivered' || status === 'Completed');
        } else if (currentOrderFilter === 'Cancelled') {
          matchStatus = (status === 'Cancelled' || status === 'Returned');
        } else {
          matchStatus = (status === currentOrderFilter);
        }

        // SKU Match
        const matchSku = (skuFilter === 'ALL') || (model.toUpperCase() === skuFilter.toUpperCase());

        // Date Match
        let matchDate = true;
        if (dateFilter === 'TODAY') {
          matchDate = createdMs >= todayStart;
        } else if (dateFilter === 'YESTERDAY') {
          matchDate = createdMs >= yesterdayStart && createdMs < todayStart;
        } else if (dateFilter === 'LAST_7_DAYS') {
          matchDate = createdMs >= sevenDaysAgo;
        } else if (dateFilter === 'THIS_MONTH') {
          matchDate = createdMs >= firstDayOfMonth;
        } else if (dateFilter === 'LAST_30_DAYS') {
          matchDate = createdMs >= thirtyDaysAgo;
        }

        const matchSearch = !q || search.includes(q);
        const isVisible = matchStatus && matchSku && matchDate && matchSearch;
        r.style.display = isVisible ? '' : 'none';

        if (isVisible) {
          visibleCount++;
          visibleSum += dueCod;
        }
      });

      const countEl = document.getElementById('filteredOrderCountDisplay');
      if (countEl) {
        countEl.innerText = visibleCount + 'টি অর্ডার পাওয়া গেছে (মোট COD: ৳' + visibleSum.toLocaleString('en-IN') + ')';
      }
    }

    // ==========================================
    // ORDER DETAILS INSPECTION MODAL ENGINE
    // ==========================================
    let currentInspectingOrderId = null;

    function openOrderDetailsModal(orderId) {
      currentInspectingOrderId = orderId;
      const allOrders = window.portalOrders || [];
      const o = allOrders.find(function(x) { return x.id === orderId; });
      if (!o) return;

      const numEl = document.getElementById('detailOrderNum');
      if (numEl) numEl.innerText = '#' + o.id;

      const badge = document.getElementById('detailOrderStatusBadge');
      if (badge) {
        badge.innerText = o.status || 'Pending';
        if (o.status === 'Approved' || o.status === 'Confirmed') {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30';
        } else if (o.status === 'Shipped' || o.status === 'In Transit') {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30';
        } else if (o.status === 'Delivered' || o.status === 'Completed') {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30';
        } else if (o.status === 'Cancelled' || o.status === 'Returned') {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30';
        } else {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30';
        }
      }

      const dateStr = o.created_at ? new Date(o.created_at).toLocaleString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'তারিখ নেই';
      const dateEl = document.getElementById('detailOrderDate');
      if (dateEl) dateEl.innerText = 'তারিখ: ' + dateStr;

      const custNameEl = document.getElementById('detailCustName');
      if (custNameEl) custNameEl.innerText = o.customer_name || 'কাস্টমার';

      const custPhoneEl = document.getElementById('detailCustPhone');
      if (custPhoneEl) custPhoneEl.innerText = o.customer_phone ? '📞 ' + o.customer_phone : '';

      const custAddrEl = document.getElementById('detailCustAddress');
      if (custAddrEl) custAddrEl.innerText = o.address || 'ঠিকানা দেওয়া হয়নি';

      const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
      const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
      const waLink = document.getElementById('detailWaLink');
      if (waLink) waLink.href = 'https://wa.me/' + waPhone;

      const isManual = (o.order_notes || '').toLowerCase().includes('manual') || o.source_channel === 'MANUAL';
      const sourceBadge = document.getElementById('detailSourceBadge');
      if (sourceBadge) sourceBadge.innerText = isManual ? '👤 মার্চেন্ট নিজে' : '🤖 WhatsApp AI';

      const modelCodeEl = document.getElementById('detailModelCode');
      if (modelCodeEl) modelCodeEl.innerText = '[' + (o.model_code || 'PROD') + ']';

      const totalBdt = Number(o.total_bdt) || 0;
      const dueCod = Number(o.due_cod) || totalBdt;
      const deliveryFee = Number(o.delivery_fee) || 0;
      const advancePaid = Number(o.advance_paid) || 0;
      const itemPrice = totalBdt - deliveryFee + Number(o.discount_applied || 0);

      const itemPriceEl = document.getElementById('detailItemPrice');
      if (itemPriceEl) itemPriceEl.innerText = '৳' + itemPrice.toLocaleString('en-IN');

      const sizeDescEl = document.getElementById('detailSizeDesc');
      if (sizeDescEl) sizeDescEl.innerText = 'সাইজ: ' + (o.length_size || 'স্ট্যান্ডার্ড') + (o.body_size ? ' • ফিট: ' + o.body_size : '');

      const delFeeEl = document.getElementById('detailDeliveryFee');
      if (delFeeEl) delFeeEl.innerText = '৳' + deliveryFee.toLocaleString('en-IN');

      const advEl = document.getElementById('detailAdvancePaid');
      if (advEl) advEl.innerText = '৳' + advancePaid.toLocaleString('en-IN') + (o.trx_id_or_last4 ? ' (' + o.trx_id_or_last4 + ')' : '');

      const dueCodEl = document.getElementById('detailDueCod');
      if (dueCodEl) dueCodEl.innerText = '৳' + dueCod.toLocaleString('en-IN');

      const courierName = o.courier_name || 'Steadfast Courier';
      const trackingId = o.courier_tracking_id || o.unique_tracking_code || 'জেনারেট হচ্ছে';
      const courierEl = document.getElementById('detailCourierInfo');
      if (courierEl) courierEl.innerText = courierName + ' • ট্র্যাকিং: ' + trackingId;

      const copyBtn = document.getElementById('detailCopyCourierBtn');
      if (copyBtn) copyBtn.onclick = function() { copyCourierFormat(orderId); };

      const printBtn = document.getElementById('detailPrintMemoBtn');
      if (printBtn) printBtn.onclick = function() { printOrderMemo(orderId); };

      const sel = document.getElementById('detailStatusSelect');
      if (sel) sel.value = o.status || 'Pending';

      const modal = document.getElementById('orderDetailsModal');
      if (modal) modal.classList.remove('hidden');
    }

    function closeOrderDetailsModal() {
      currentInspectingOrderId = null;
      const modal = document.getElementById('orderDetailsModal');
      if (modal) modal.classList.add('hidden');
    }

    async function changeDetailModalStatus(newStatus) {
      if (!currentInspectingOrderId) return;
      await updateOrderStatusLive(currentInspectingOrderId, newStatus);
      const allOrders = window.portalOrders || [];
      const o = allOrders.find(function(x) { return x.id === currentInspectingOrderId; });
      if (o) o.status = newStatus;
      openOrderDetailsModal(currentInspectingOrderId);
    }

    // ==========================================
    // EXPORT TO CSV (EXCEL UTF-8 BOM SUPPORT)
    // ==========================================
    function exportOrdersCSV() {
      const allOrders = window.portalOrders || [];
      const visibleIds = new Set();
      document.querySelectorAll('.order-row').forEach(function(r) {
        if (r.style.display !== 'none') {
          visibleIds.add(Number(r.getAttribute('data-order-id')));
        }
      });

      const targetOrders = allOrders.filter(function(o) { return visibleIds.has(Number(o.id)); });
      if (targetOrders.length === 0) {
        alert('এক্সপোর্ট করার মতো কোনো অর্ডার পাওয়া যায়নি। ফিল্টার পরিবর্তন করে চেষ্টা করুন।');
        return;
      }

      const headers = [
        'Order ID',
        'Date',
        'Customer Name',
        'Phone',
        'Delivery Address',
        'SKU / Model',
        'Size',
        'Total BDT',
        'Due COD BDT',
        'Advance Paid',
        'Status',
        'Courier Name',
        'Tracking Code',
        'Notes'
      ];

      function escapeCsv(val) {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return '"' + str + '"';
      }

      const rows = targetOrders.map(function(o) {
        const dStr = o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '';
        return [
          o.id,
          dStr,
          escapeCsv(o.customer_name || 'Customer'),
          escapeCsv(o.customer_phone || ''),
          escapeCsv(o.address || ''),
          escapeCsv(o.model_code || 'PROD'),
          escapeCsv(o.length_size || 'Standard'),
          o.total_bdt || 0,
          o.due_cod || o.total_bdt || 0,
          o.advance_paid || 0,
          escapeCsv(o.status || 'Pending'),
          escapeCsv(o.courier_name || 'Steadfast'),
          escapeCsv(o.courier_tracking_id || o.unique_tracking_code || ''),
          escapeCsv(o.order_notes || '')
        ].join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join(String.fromCharCode(13, 10));
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'autodokan_orders_' + dateStr + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('📥 ' + targetOrders.length + 'টি অর্ডারের CSV ফাইল ডাউনলোড হয়েছে!');
    }

    // ==========================================
    // COURIER HANDOVER DISPATCH MANIFEST PRINT
    // ==========================================
    function printOrdersManifest() {
      const allOrders = window.portalOrders || [];
      const visibleIds = new Set();
      document.querySelectorAll('.order-row').forEach(function(r) {
        if (r.style.display !== 'none') {
          visibleIds.add(Number(r.getAttribute('data-order-id')));
        }
      });
      const targetOrders = allOrders.filter(function(o) { return visibleIds.has(Number(o.id)); });
      if (targetOrders.length === 0) {
        alert('প্রিন্ট করার জন্য কোনো অর্ডার পাওয়া যায়নি');
        return;
      }

      let totalCod = 0;
      let rowsHtml = '';
      targetOrders.forEach(function(o, idx) {
        const cod = Number(o.due_cod) || Number(o.total_bdt) || 0;
        totalCod += cod;
        rowsHtml += '<tr>' +
          '<td style="padding:8px;border:1px solid #ddd;text-align:center;">' + (idx + 1) + '</td>' +
          '<td style="padding:8px;border:1px solid #ddd;font-family:monospace;font-weight:bold;">#' + o.id + '</td>' +
          '<td style="padding:8px;border:1px solid #ddd;">' + (o.customer_name || 'কাস্টমার') + '<br><small style="color:#666;">' + (o.customer_phone || '') + '</small></td>' +
          '<td style="padding:8px;border:1px solid #ddd;max-width:200px;">' + (o.address || '') + '</td>' +
          '<td style="padding:8px;border:1px solid #ddd;font-family:monospace;font-weight:bold;">[' + (o.model_code || 'PROD') + '] ' + (o.length_size || '') + '</td>' +
          '<td style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">৳' + cod.toLocaleString('en-IN') + '</td>' +
          '<td style="padding:8px;border:1px solid #ddd;text-align:center;">' + (o.status || 'Pending') + '</td>' +
          '<td style="padding:8px;border:1px solid #ddd;width:80px;"></td>' +
          '</tr>';
      });

      const printWin = window.open('', '_blank');
      printWin.document.write('<!DOCTYPE html><html><head><title>কুরিয়ার ডেলিভারি হ্যান্ডওভার ম্যানিফেস্ট</title>' +
        '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;color:#111;}' +
        'table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px;}' +
        '@media print{@page{margin:15mm;}}</style></head><body>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #222;padding-bottom:12px;">' +
        '<div><h2 style="margin:0;">📦 কুরিয়ার পার্সেল হ্যান্ডওভার ম্যানিফেস্ট</h2><p style="margin:4px 0 0;font-size:13px;color:#555;">তারিখ: ' + new Date().toLocaleDateString('bn-BD', { year:'numeric', month:'long', day:'numeric' }) + '</p></div>' +
        '<div style="text-align:right;"><span style="font-size:16px;font-weight:bold;">মোট পার্সেল: ' + targetOrders.length + 'টি</span><br><span style="font-size:14px;color:#0b8457;font-weight:bold;">মোট COD: ৳' + totalCod.toLocaleString('en-IN') + '</span></div>' +
        '</div>' +
        '<table><thead><tr style="background:#f4f4f4;">' +
        '<th style="padding:8px;border:1px solid #ddd;">ক্রম</th>' +
        '<th style="padding:8px;border:1px solid #ddd;">অর্ডার নং</th>' +
        '<th style="padding:8px;border:1px solid #ddd;">প্রাপক ও ফোন</th>' +
        '<th style="padding:8px;border:1px solid #ddd;">ঠিকানা</th>' +
        '<th style="padding:8px;border:1px solid #ddd;">মডেল ও সাইজ</th>' +
        '<th style="padding:8px;border:1px solid #ddd;text-align:right;">Due COD</th>' +
        '<th style="padding:8px;border:1px solid #ddd;">স্ট্যাটাস</th>' +
        '<th style="padding:8px;border:1px solid #ddd;">রাইডার সাক্ষর</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
        '<div style="margin-top:40px;display:flex;justify-content:space-between;padding:0 20px;font-size:13px;">' +
        '<div>____________________<br>মার্চেন্ট প্রতিনিধি</div>' +
        '<div>____________________<br>কুরিয়ার ডেলিভারি রাইডার</div>' +
        '</div>' +
        '<script>window.onload=function(){window.print();};<\\/script>' +
        '</body></html>');
      printWin.document.close();
    }

    async function updateOrderStatusLive(id, status) {
      try {
        const res = await fetch('/api/portal/update-order-status?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status })
        });
        const data = await res.json();
        if (data.success) {
          const row = document.querySelector('.order-row[data-order-id="' + id + '"]');
          if (row) row.setAttribute('data-status', status);
          showToast('✅ অর্ডার স্ট্যাটাস: ' + status);
        } else {
          showToast('❌ এরর: ' + data.error, false);
        }
      } catch (e) {
        showToast('❌ কানেকশন সমস্যা', false);
      }
    }

    async function copyCourierFormat(id) {
      try {
        const res = await fetch('/api/portal/courier-text?token=' + token + '&id=' + id);
        const data = await res.json();
        if (data.success && data.text) {
          navigator.clipboard.writeText(data.text);
          showToast('📋 কুরিয়ার ফরম্যাট কপি হয়েছে!');
        }
      } catch (e) {
        showToast('❌ কপি করা যায়নি', false);
      }
    }

    // Printable Customer Cash Memo & Packing Slip (User request)
    function printOrderMemo(orderId) {
      const order = (window.portalOrders || []).find(o => o.id === orderId);
      if (!order) {
        alert('অর্ডার তথ্য পাওয়া যায়নি');
        return;
      }

      const prodPrice = Number(order.total_bdt) || 0;
      const dueCod = Number(order.due_cod) || prodPrice;
      const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : 'তারিখ অনুপলব্ধ';
      const cleanPhone = (order.customer_phone || '').replace(/[^0-9]/g, '');
      const waPhone = cleanPhone.startsWith('880') ? '+' + cleanPhone : (cleanPhone.startsWith('0') ? '+88' + cleanPhone : '+880' + cleanPhone);

      const isManual = (order.order_notes || '').toLowerCase().includes('manual') || order.source_channel === 'MANUAL';
      const botPersona = '${(curSettings.bot_persona_name || 'AI ইনচার্জ').replace(/'/g, "\\'")}';
      const confirmedByText = isManual ? '👤 মার্চেন্ট নিজে (ম্যানুয়াল এন্ট্রি)' : '🤖 ' + botPersona + ' (WhatsApp AI)';

      const storeHelpline = '${(liveNum || inv.phone || '').replace(/'/g, "\\'")}';
      const currentShopName = '${shopName.replace(/'/g, "\\'")}';

      let memoHtml = '' +
        '<div class="text-center border-b border-dashed border-gray-400 pb-3 mb-3">' +
          '<h2 class="text-2xl font-black text-gray-900 tracking-wider">' + currentShopName + '</h2>' +
          '<p class="text-xs font-semibold text-gray-600 mt-0.5">অফিসিয়াল ক্যাশ মেমো ও পার্সেল চালান</p>' +
          (storeHelpline ? '<p class="text-xs text-gray-500 font-mono mt-0.5">WhatsApp হেল্পলাইন: ' + storeHelpline + '</p>' : '') +
        '</div>' +

        '<div class="flex justify-between items-center text-xs text-gray-700 py-1 border-b border-gray-200">' +
          '<div><span class="font-bold text-gray-900">ইনভয়েস নং:</span> <span class="font-mono font-bold">#' + currentShopName.substring(0, 2).toUpperCase() + '-INV-' + order.id + '</span></div>' +
          '<div><span class="font-bold text-gray-900">তারিখ:</span> ' + orderDate + '</div>' +
        '</div>' +

        '<!-- Channel Origin & Order Creator -->' +
        '<div class="bg-gray-50 p-2.5 rounded-[10px] border border-gray-200 text-xs space-y-1 my-2.5">' +
          '<div class="flex justify-between items-center">' +
            '<span class="text-gray-600">অর্ডার প্ল্যাটফর্ম:</span>' +
            '<span class="font-bold text-green-700">🟢 ' + (order.source_channel || 'WHATSAPP') + '</span>' +
          '</div>' +
          '<div class="flex justify-between items-center">' +
            '<span class="text-gray-600">যে হোয়াটসঅ্যাপ থেকে অর্ডার কনফার্ম হয়েছে:</span>' +
            '<span class="font-mono font-bold text-gray-900">' + waPhone + '</span>' +
          '</div>' +
          '<div class="flex justify-between items-center">' +
            '<span class="text-gray-600">অর্ডার কনফার্মকারী / প্রসেসর:</span>' +
            '<span class="font-bold text-gray-900">' + confirmedByText + '</span>' +
          '</div>' +
        '</div>' +

        '<!-- Recipient & Delivery Details -->' +
        '<div class="my-2.5 text-xs bg-gray-50 p-3 rounded-[10px] border border-gray-200 space-y-1">' +
          '<div class="font-bold text-gray-900 border-b border-gray-200 pb-1 mb-1 text-[11px] uppercase tracking-wider">ডেলিভারি ও প্রাপকের তথ্য:</div>' +
          '<div class="font-bold text-sm text-gray-900">' + (order.customer_name || 'সম্মানিত গ্রাহক') + '</div>' +
          '<div class="text-gray-800 leading-relaxed"><span class="font-medium text-gray-600">ঠিকানা:</span> ' + (order.address || 'ঠিকানা দেওয়া হয়নি') + '</div>' +
          '<div class="font-mono font-bold text-gray-900"><span class="font-medium text-gray-600 font-sans">ডেলিভারি মোবাইল:</span> ' + (order.customer_phone || '') + '</div>' +
        '</div>' +

        '<!-- Ordered Items Table -->' +
        '<table class="w-full text-xs text-left my-2.5 border-collapse">' +
          '<thead>' +
            '<tr class="border-y border-gray-300 bg-gray-100 font-bold text-gray-800">' +
              '<th class="py-2 px-2">মডেল</th>' +
              '<th class="py-2 px-2">প্রোডাক্ট বিবরণ</th>' +
              '<th class="py-2 px-2">সাইজ</th>' +
              '<th class="py-2 px-2 text-center">পরিমাণ</th>' +
              '<th class="py-2 px-2 text-right">মূল্য</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            '<tr class="border-b border-gray-200">' +
              '<td class="py-2.5 px-2 font-mono font-bold text-gray-900">[' + (order.model_code || 'PROD') + ']</td>' +
              '<td class="py-2.5 px-2 text-gray-800 font-medium">' + (order.product_details || 'পোশাক') + '</td>' +
              '<td class="py-2.5 px-2 font-mono text-gray-700">' + (order.length_size || 'স্ট্যান্ডার্ড') + '</td>' +
              '<td class="py-2.5 px-2 text-center font-mono font-bold">১</td>' +
              '<td class="py-2.5 px-2 text-right font-mono font-bold text-gray-900">৳' + prodPrice.toLocaleString('en-IN') + '</td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +

        '<!-- Financial Summary -->' +
        '<div class="border-t border-dashed border-gray-400 pt-2.5 space-y-1 text-xs">' +
          '<div class="flex justify-between text-gray-700">' +
            '<span>প্রোডাক্ট মোট মূল্য:</span>' +
            '<span class="font-mono">৳' + prodPrice.toLocaleString('en-IN') + '</span>' +
          '</div>' +
          '<div class="flex justify-between text-gray-700">' +
            '<span>ডেলিভারি চার্জ:</span>' +
            '<span class="font-mono">৳' + Number(order.delivery_fee || 0).toLocaleString('en-IN') + '</span>' +
          '</div>' +
          (order.advance_paid > 0 ? (
            '<div class="flex justify-between text-green-700 font-bold">' +
              '<span>অগ্রিম পেমেন্ট সমন্বয়:</span>' +
              '<span class="font-mono">-৳' + Number(order.advance_paid).toLocaleString('en-IN') + '</span>' +
            '</div>'
          ) : '') +
          '<div class="flex justify-between items-center text-sm font-black text-gray-900 pt-2 border-t border-gray-300">' +
            '<span>ক্যাশ কালেকশন (Due COD):</span>' +
            '<span class="text-lg font-black font-mono text-gray-900">৳' + dueCod.toLocaleString('en-IN') + '</span>' +
          '</div>' +
        '</div>' +

        '<!-- Policy & Footer Note -->' +
        '<div class="mt-4 pt-2.5 border-t border-gray-200 text-[10px] text-gray-500 text-center leading-relaxed">' +
          '<p class="font-semibold text-gray-700">কুরিয়ারের সামনে পার্সেল চেক করে বুঝে মূল্য পরিশোধ করুন।</p>' +
          '<p class="text-[9px] text-gray-400 mt-1 font-mono">AutoDokan Intelligent E-Commerce Engine</p>' +
        '</div>';

      document.getElementById('memoPrintContent').innerHTML = memoHtml;
      document.getElementById('printableMemoModal').classList.remove('hidden');
    }

    function closeMemoModal(e) {
      if (e && e.target && e.target.id !== 'printableMemoModal' && !e.target.closest('button')) return;
      document.getElementById('printableMemoModal').classList.add('hidden');
    }

    async function saveMerchantSettingsLive(e) {
      e.preventDefault();
      const btn = document.getElementById('saveSettingsBtn');
      btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true;

      const payload = {
        inside_dhaka_fee: document.getElementById('set_inside_fee').value,
        outside_dhaka_fee: document.getElementById('set_outside_fee').value,
        free_delivery_min_amount: document.getElementById('set_free_delivery_min').value || 0,
        bkash_number: document.getElementById('set_bkash').value.trim(),
        nagad_number: document.getElementById('set_nagad').value.trim(),
        require_advance_outside: document.getElementById('set_require_advance').checked,
        bot_persona_name: document.getElementById('set_bot_name').value.trim(),
        delivery_timeline: document.getElementById('set_delivery_time').value.trim(),
        promo_offer: document.getElementById('set_promo_offer').value.trim(),
        return_policy: document.getElementById('set_return_policy').value.trim()
      };

      try {
        const res = await fetch('/api/portal/save-settings?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('💾 অ্যাডভান্সড সেটিংস সফলভাবে সেভ হয়েছে!');
        } else {
          alert('এরর: ' + (data.error || 'সমস্যা'));
        }
      } catch (err) {
        alert('কানেকশন সমস্যা: ' + err.message);
      } finally {
        btn.innerText = '💾 সেটিংস সেভ করুন'; btn.disabled = false;
      }
    }

    // Product View Switcher (Amazon Spreadsheet Table vs Cards Grid)
    function switchProductView(mode) {
      const tableView = document.getElementById('productsTableView');
      const cardsView = document.getElementById('productsGrid');
      const tableBtn = document.getElementById('view-mode-table-btn');
      const cardsBtn = document.getElementById('view-mode-cards-btn');
      
      if (mode === 'cards') {
        if (tableView) tableView.classList.add('hidden');
        if (cardsView) cardsView.classList.remove('hidden');
        if (cardsBtn) {
          cardsBtn.className = 'px-3 py-1.5 rounded-[10px] text-xs font-bold bg-white text-black shadow-xs transition cursor-pointer flex items-center gap-1.5';
        }
        if (tableBtn) {
          tableBtn.className = 'px-3 py-1.5 rounded-[10px] text-xs font-semibold text-[rgba(235,235,245,0.60)] hover:text-white transition cursor-pointer flex items-center gap-1.5';
        }
        try { localStorage.setItem('autodokan_product_view', 'cards'); } catch(e) {}
      } else {
        // Amazon Table View default
        if (tableView) tableView.classList.remove('hidden');
        if (cardsView) cardsView.classList.add('hidden');
        if (tableBtn) {
          tableBtn.className = 'px-3 py-1.5 rounded-[10px] text-xs font-bold bg-white text-black shadow-xs transition cursor-pointer flex items-center gap-1.5';
        }
        if (cardsBtn) {
          cardsBtn.className = 'px-3 py-1.5 rounded-[10px] text-xs font-semibold text-[rgba(235,235,245,0.60)] hover:text-white transition cursor-pointer flex items-center gap-1.5';
        }
        try { localStorage.setItem('autodokan_product_view', 'table'); } catch(e) {}
      }
    }

    // Step Stock (+ / - 1 click)
    async function stepStock(id, delta) {
      const stockValEl = document.getElementById('tbl-stock-val-' + id) || document.getElementById('stock-val-' + id);
      if (!stockValEl) return;
      const current = parseInt(stockValEl.innerText) || 0;
      const nextVal = Math.max(0, current + delta);

      if (document.getElementById('tbl-stock-val-' + id)) document.getElementById('tbl-stock-val-' + id).innerText = nextVal;
      if (document.getElementById('stock-val-' + id)) document.getElementById('stock-val-' + id).innerText = nextVal;

      try {
        const res = await fetch('/api/portal/quick-edit?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, field: 'stock_quantity', value: nextVal })
        });
        const data = await res.json();
        if (data.success) {
          const pLocal = (window.portalProducts || []).find(p => p.id === id);
          if (pLocal) {
            pLocal.stock_quantity = data.value;
            if (data.size_stock) {
              pLocal.custom_attributes = pLocal.custom_attributes || {};
              pLocal.custom_attributes.size_stock = data.size_stock;
            }
          }
          showToast('✅ ইনভেন্টরি স্টক ' + nextVal + ' পিস আপডেট হয়েছে!');
          if (nextVal === 0) {
            setTimeout(function() { window.location.reload(); }, 600);
          }
        } else {
          if (document.getElementById('tbl-stock-val-' + id)) document.getElementById('tbl-stock-val-' + id).innerText = current;
          if (document.getElementById('stock-val-' + id)) document.getElementById('stock-val-' + id).innerText = current;
          alert('স্টক আপডেট এরর: ' + (data.error || 'সমস্যা হয়েছে'));
        }
      } catch (e) {
        if (document.getElementById('tbl-stock-val-' + id)) document.getElementById('tbl-stock-val-' + id).innerText = current;
        if (document.getElementById('stock-val-' + id)) document.getElementById('stock-val-' + id).innerText = current;
        alert('কানেকশন সমস্যা: ' + e.message);
      }
    }

    // ========================================================
    // Amazon Seller Central: Multi-Select & Bulk Operations
    // ========================================================
    const selectedProductIds = new Set();

    function updateSelectedCount() {
      const cbs = document.querySelectorAll('.prod-select-cb');
      selectedProductIds.clear();
      cbs.forEach(cb => {
        if (cb.checked) {
          selectedProductIds.add(Number(cb.getAttribute('data-id')));
        }
      });

      const count = selectedProductIds.size;
      const dock = document.getElementById('bulkActionBar');
      const badge = document.getElementById('bulkSelectedCountBadge');
      const masterCb = document.getElementById('selectAllProds');

      if (badge) badge.innerText = count;

      if (dock) {
        if (count > 0) {
          dock.classList.remove('translate-y-32', 'opacity-0', 'pointer-events-none');
          dock.classList.add('translate-y-0', 'opacity-100');
        } else {
          dock.classList.add('translate-y-32', 'opacity-0', 'pointer-events-none');
          dock.classList.remove('translate-y-0', 'opacity-100');
        }
      }

      // Sync checkbox state across table and cards
      cbs.forEach(cb => {
        const id = Number(cb.getAttribute('data-id'));
        cb.checked = selectedProductIds.has(id);
      });

      if (masterCb) {
        const visibleRows = Array.from(document.querySelectorAll('.prod-table-row')).filter(r => r.style.display !== 'none');
        masterCb.checked = (visibleRows.length > 0 && visibleRows.every(r => {
          const cb = r.querySelector('.prod-select-cb');
          return cb && cb.checked;
        }));
      }
    }

    function toggleSelectAllProds(checked) {
      document.querySelectorAll('.prod-table-row').forEach(row => {
        if (row.style.display !== 'none') {
          const cb = row.querySelector('.prod-select-cb');
          if (cb) cb.checked = checked;
        }
      });
      document.querySelectorAll('.prod-card').forEach(card => {
        if (card.style.display !== 'none') {
          const cb = card.querySelector('.prod-select-cb');
          if (cb) cb.checked = checked;
        }
      });
      updateSelectedCount();
    }

    function clearProductSelection() {
      document.querySelectorAll('.prod-select-cb').forEach(cb => cb.checked = false);
      const masterCb = document.getElementById('selectAllProds');
      if (masterCb) masterCb.checked = false;
      updateSelectedCount();
    }

    function openBulkRestockPrompt() {
      if (selectedProductIds.size === 0) return;
      const input = prompt(selectedProductIds.size + 'টি নির্বাচিত প্রোডাক্টের স্টকে কত পিস যোগ করতে চান? (যেমন: 10 বা 20)', '10');
      if (!input) return;
      const qty = parseInt(input);
      if (isNaN(qty) || qty <= 0) {
        alert('দয়া করে সঠিক সংখ্যা লিখুন (যেমন: 5, 10)');
        return;
      }
      executeBulkAction('restock', { quantity: qty });
    }

    function openBulkDiscountPrompt() {
      if (selectedProductIds.size === 0) return;
      const input = prompt(selectedProductIds.size + 'টি নির্বাচিত প্রোডাক্টে কত শতাংশ (%) ছাড় দিতে চান? (যেমন: 10 বা 15)', '10');
      if (!input) return;
      const pct = parseFloat(input);
      if (isNaN(pct) || pct <= 0 || pct >= 100) {
        alert('দয়া করে ১ থেকে ৯৯ এর মধ্যে সঠিক পার্সেন্টেজ লিখুন');
        return;
      }
      executeBulkAction('discount', { percent: pct });
    }

    function bulkToggleStock(inStock) {
      if (selectedProductIds.size === 0) return;
      const confirmMsg = inStock 
        ? selectedProductIds.size + 'টি প্রোডাক্ট কি সক্রিয় (ইন-স্টক) করতে চান?' 
        : selectedProductIds.size + 'টি প্রোডাক্ট কি স্টক-আউট করতে চান? কাস্টমার আর কিনতে পারবে না।';
      if (!confirm(confirmMsg)) return;
      executeBulkAction('toggle_stock', { in_stock: inStock });
    }

    function bulkDeleteSelected() {
      if (selectedProductIds.size === 0) return;
      if (!confirm('⚠️ সতর্কতা: ' + selectedProductIds.size + 'টি প্রোডাক্ট ক্যাটালগ থেকে সম্পূর্ণ মুছে ফেলা হবে। আপনি কি নিশ্চিত?')) return;
      executeBulkAction('delete', {});
    }

    async function executeBulkAction(action, payload) {
      try {
        showToast('⏳ বাল্ক অপারেশন চলছে...');
        const res = await fetch('/api/portal/bulk-products-action?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: action,
            ids: Array.from(selectedProductIds),
            payload: payload
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ ' + data.count + 'টি প্রোডাক্ট সফলভাবে আপডেট হয়েছে!');
          setTimeout(function() { window.location.reload(); }, 600);
        } else {
          alert('বাল্ক অপারেশনে সমস্যা: ' + (data.error || 'ব্যর্থ হয়েছে'));
        }
      } catch (e) {
        alert('কানেকশন সমস্যা: ' + e.message);
      }
    }

    // ========================================================
    // SALES REVENUE HISTORY MODAL
    // ========================================================
    function openSalesHistoryModal() {
      const modal = document.getElementById('salesHistoryModal');
      if (modal) modal.classList.remove('hidden');
    }

    function closeSalesHistoryModal() {
      const modal = document.getElementById('salesHistoryModal');
      if (modal) modal.classList.add('hidden');
    }

    // ========================================================
    // INTERACTIVE SIZE & STOCK MATRIX MODAL
    // ========================================================
    let currentEditingSizeProdId = null;
    let currentSizeStockMap = {};

    function openSizeStockModal(prodId) {
      currentEditingSizeProdId = prodId;
      const allProds = window.portalProducts || [];
      const prod = allProds.find(function(p) { return p.id === prodId; });
      if (!prod) return;

      const codeEl = document.getElementById('sizeModalProdCode');
      const nameEl = document.getElementById('sizeModalProdName');
      if (codeEl) codeEl.innerText = prod.model_code || 'PROD';
      if (nameEl) nameEl.innerText = prod.name || '';

      const cAttr = prod.custom_attributes || {};
      currentSizeStockMap = {};

      if (cAttr.size_stock && typeof cAttr.size_stock === 'object' && Object.keys(cAttr.size_stock).length > 0) {
        currentSizeStockMap = JSON.parse(JSON.stringify(cAttr.size_stock));
      } else {
        const sizeList = (prod.sizes || 'স্ট্যান্ডার্ড').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        const totalQ = Number(prod.stock_quantity) || 5;
        const defQty = Math.max(1, Math.floor(totalQ / (sizeList.length || 1)));
        sizeList.forEach(function(s) {
          currentSizeStockMap[s] = defQty;
        });
      }

      renderSizeStockList();
      const modal = document.getElementById('sizeStockModal');
      if (modal) modal.classList.remove('hidden');
    }

    function closeSizeStockModal() {
      currentEditingSizeProdId = null;
      currentSizeStockMap = {};
      const modal = document.getElementById('sizeStockModal');
      if (modal) modal.classList.add('hidden');
    }

    function renderSizeStockList() {
      const container = document.getElementById('sizeStockListContainer');
      if (!container) return;

      const keys = Object.keys(currentSizeStockMap);
      if (keys.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-xs text-[rgba(235,235,245,0.40)]">কোনো সাইজ যুক্ত নেই। উপরের প্রিসেট থেকে সাইজ যোগ করুন।</div>';
        const totalEl = document.getElementById('sizeModalTotalStockVal');
        if (totalEl) totalEl.innerText = '0';
        return;
      }

      let totalStock = 0;
      let html = '';
      keys.forEach(function(sz) {
        const qty = parseInt(currentSizeStockMap[sz]) || 0;
        totalStock += qty;
        const isOut = qty === 0;

        html += '<div class="bg-[#2C2C2E] border border-white/[0.06] p-3 rounded-[14px] flex items-center justify-between gap-3 text-xs">';
        html += '  <div class="flex items-center gap-2">';
        html += '    <span class="font-mono font-bold text-sm text-white px-2.5 py-1 bg-[#1C1C1E] rounded-[8px] border border-white/[0.08]">' + sz + '</span>';
        if (isOut) {
          html += '    <span class="text-[10px] font-bold text-[#FF453A] bg-[#FF453A]/15 border border-[#FF453A]/30 px-2 py-0.5 rounded-[6px]">স্টক-আউট</span>';
        } else {
          html += '    <span class="text-[10px] font-bold text-[#30D158] bg-[#30D158]/15 border border-[#30D158]/30 px-2 py-0.5 rounded-[6px]">ইন-স্টক (' + qty + ')</span>';
        }
        html += '  </div>';
        html += '  <div class="flex items-center gap-1.5">';
        html += '    <button type="button" data-sz="' + sz + '" onclick="stepSizeQty(this.dataset.sz, -1)" class="w-7 h-7 rounded-[8px] bg-[#1C1C1E] hover:bg-[#3A3A3C] text-white font-bold flex items-center justify-center border border-white/[0.08] cursor-pointer">-</button>';
        html += '    <input type="number" min="0" value="' + qty + '" data-sz="' + sz + '" onchange="changeSizeQtyDirect(this.dataset.sz, this.value)" class="w-14 text-center font-mono font-bold bg-[#1C1C1E] text-white px-1.5 py-1 rounded-[8px] border border-white/[0.08] focus:outline-hidden focus:border-[#30D158] text-xs">';
        html += '    <button type="button" data-sz="' + sz + '" onclick="stepSizeQty(this.dataset.sz, 1)" class="w-7 h-7 rounded-[8px] bg-[#1C1C1E] hover:bg-[#3A3A3C] text-white font-bold flex items-center justify-center border border-white/[0.08] cursor-pointer">+</button>';
        html += '    <button type="button" data-sz="' + sz + '" onclick="removeSizeItem(this.dataset.sz)" class="w-7 h-7 rounded-[8px] bg-[#FF453A]/15 hover:bg-[#FF453A]/25 text-[#FF453A] font-bold flex items-center justify-center border border-[#FF453A]/30 cursor-pointer ml-1" title="মুছে ফেলুন">🗑️</button>';
        html += '  </div>';
        html += '</div>';
      });

      container.innerHTML = html;
      const totalEl = document.getElementById('sizeModalTotalStockVal');
      if (totalEl) totalEl.innerText = totalStock;
    }

    function stepSizeQty(sz, delta) {
      const cur = parseInt(currentSizeStockMap[sz]) || 0;
      currentSizeStockMap[sz] = Math.max(0, cur + delta);
      renderSizeStockList();
    }

    function changeSizeQtyDirect(sz, val) {
      const parsed = Math.max(0, parseInt(val) || 0);
      currentSizeStockMap[sz] = parsed;
      renderSizeStockList();
    }

    function quickAddSizeItem(sz) {
      if (currentSizeStockMap[sz] === undefined) {
        currentSizeStockMap[sz] = 5;
      } else {
        currentSizeStockMap[sz] = (parseInt(currentSizeStockMap[sz]) || 0) + 1;
      }
      renderSizeStockList();
    }

    function addCustomSizeFromInput() {
      const inputName = document.getElementById('newCustomSizeName');
      const inputQty = document.getElementById('newCustomSizeQty');
      const name = (inputName?.value || '').trim();
      const qty = parseInt(inputQty?.value) || 5;

      if (!name) {
        alert('দয়া করে সাইজের নাম লিখুন (যেমন: 42 বা XL)');
        return;
      }

      currentSizeStockMap[name] = Math.max(0, qty);
      if (inputName) inputName.value = '';
      renderSizeStockList();
    }

    function removeSizeItem(sz) {
      delete currentSizeStockMap[sz];
      renderSizeStockList();
    }

    async function saveSizeStockToServer() {
      if (!currentEditingSizeProdId) return;
      const btn = document.getElementById('saveSizeStockBtn');
      if (btn) { btn.innerText = 'সংরক্ষণ হচ্ছে...'; btn.disabled = true; }

      try {
        const res = await fetch('/api/portal/save-size-stock?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentEditingSizeProdId,
            size_stock: currentSizeStockMap
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✅ সাইজ ও স্টক ম্যাট্রিক্স সফলভাবে সংরক্ষিত হয়েছে!');
          setTimeout(function() { window.location.reload(); }, 600);
        } else {
          alert('সেভ করতে সমস্যা: ' + (data.error || 'ব্যর্থ হয়েছে'));
          if (btn) { btn.innerText = '💾 সাইজ ও স্টক সেভ করুন'; btn.disabled = false; }
        }
      } catch (e) {
        alert('কানেকশন সমস্যা: ' + e.message);
        if (btn) { btn.innerText = '💾 সাইজ ও স্টক সেভ করুন'; btn.disabled = false; }
      }
    }

    // Initialize saved product view mode on page load
    (function initProductView() {
      try {
        const saved = localStorage.getItem('autodokan_product_view') || 'table';
        switchProductView(saved);
      } catch(e) {}
    })();
  </script>
</body>
</html>`);
  });

  // ========================================================
  // PORTAL APIS (Strictly Authenticated and Scoped by Token)
  // ========================================================

  // Upload Direct Image API (Base64 -> Supabase / Local Fallback)
  router.post('/api/portal/upload-image', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    try {
      const { imageBase64, filename, contentType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ success: false, error: 'No image data provided' });
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      const ext = filename ? path.extname(filename) : '.jpg';
      const cleanExt = ext && ext.length <= 5 ? ext : '.jpg';
      const cloudFilename = `merchant_${inv.seller_id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${cleanExt}`;

      // 1. Supabase Storage
      try {
        const { data, error } = await supabase.storage
          .from('product-images')
          .upload(cloudFilename, buffer, {
            contentType: contentType || 'image/jpeg',
            upsert: true
          });

        if (!error && data) {
          const publicUrl = `${process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co'}/storage/v1/object/public/product-images/${cloudFilename}`;
          return res.json({ success: true, url: publicUrl });
        }
      } catch (sbErr) {
        console.warn('[Portal Upload] Supabase fallback to local:', sbErr.message);
      }

      // 2. Local Fallback in /public/uploads/
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const localFilePath = path.join(uploadsDir, cloudFilename);
      fs.writeFileSync(localFilePath, buffer);
      const localUrl = `/uploads/${cloudFilename}`;
      return res.json({ success: true, url: localUrl });
    } catch (err) {
      console.error('[Portal Upload Exception]:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET single product data for Studio Edit Modal
  router.get('/api/portal/get-product', async (req, res) => {
    const token = req.query.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const id = req.query.id;
    const { data: prod, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('seller_id', inv.seller_id)
      .single();

    if (error || !prod) return res.status(404).json({ error: 'Product not found' });
    return res.json({ success: true, product: prod });
  });

  // Toggle In-Stock
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

  // Instant Inline Quick-Edit (Price, Regular Price, Stock Quantity)
  router.post('/api/portal/quick-edit', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, field, value } = req.body;
    if (!id || !field) return res.status(400).json({ error: 'Missing id or field' });

    const allowedFields = ['price', 'regular_price', 'stock_quantity'];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: 'Field not allowed for quick-edit' });
    }

    const numVal = field === 'stock_quantity' ? (parseInt(value) || 0) : (parseFloat(value) || 0);
    const updateObj = { [field]: numVal };
    let updatedSizeStock = null;

    if (field === 'stock_quantity') {
      updateObj.in_stock = numVal > 0;
      try {
        const { data: curProd } = await supabase
          .from('products')
          .select('sizes, custom_attributes')
          .eq('id', id)
          .eq('seller_id', inv.seller_id)
          .maybeSingle();

        if (curProd && curProd.sizes) {
          const rawSizes = curProd.sizes
            .split(',')
            .map(s => s.replace(/\([^)]+\)/g, '').trim())
            .filter(Boolean);

          if (rawSizes.length > 0) {
            const perSize = Math.floor(numVal / rawSizes.length);
            const remainder = numVal % rawSizes.length;
            updatedSizeStock = {};
            rawSizes.forEach((sz, idx) => {
              updatedSizeStock[sz] = perSize + (idx < remainder ? 1 : 0);
            });
            const existingAttr = (curProd.custom_attributes && typeof curProd.custom_attributes === 'object')
              ? curProd.custom_attributes
              : {};
            updateObj.custom_attributes = { ...existingAttr, size_stock: updatedSizeStock };
          }
        }
      } catch (syncErr) {
        console.warn('[QuickEdit Stock Sync Warning]', syncErr.message);
      }
    }

    const { error } = await supabase
      .from('products')
      .update(updateObj)
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id, field, value: numVal, size_stock: updatedSizeStock });
  });

  // Quick Save AI Notes
  router.post('/api/portal/save-ai-notes', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, ai_notes } = req.body;
    const { error } = await supabase
      .from('products')
      .update({ short_description: ai_notes ? ai_notes.trim() : null })
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id, ai_notes });
  });

  // ========================================================
  // Amazon Seller Central: Bulk Products Action API
  // ========================================================
  router.post('/api/portal/bulk-products-action', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { action, ids, payload } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Missing action or ids array' });
    }

    try {
      if (action === 'toggle_stock') {
        const isStock = Boolean(payload?.in_stock);
        const { error } = await supabase
          .from('products')
          .update({ in_stock: isStock })
          .in('id', ids)
          .eq('seller_id', inv.seller_id);
        if (error) throw error;
      } else if (action === 'restock') {
        const addQty = parseInt(payload?.quantity) || 0;
        if (addQty <= 0) return res.status(400).json({ error: 'Invalid quantity' });

        const { data: curProds, error: fetchErr } = await supabase
          .from('products')
          .select('id, stock_quantity')
          .in('id', ids)
          .eq('seller_id', inv.seller_id);
        if (fetchErr) throw fetchErr;

        for (const p of (curProds || [])) {
          const nextStock = (Number(p.stock_quantity) || 0) + addQty;
          await supabase
            .from('products')
            .update({ stock_quantity: nextStock, in_stock: true })
            .eq('id', p.id)
            .eq('seller_id', inv.seller_id);
        }
      } else if (action === 'discount') {
        const pct = parseFloat(payload?.percent) || 0;
        if (pct <= 0 || pct >= 100) return res.status(400).json({ error: 'Invalid discount percent' });

        const { data: curProds, error: fetchErr } = await supabase
          .from('products')
          .select('id, price, regular_price')
          .in('id', ids)
          .eq('seller_id', inv.seller_id);
        if (fetchErr) throw fetchErr;

        for (const p of (curProds || [])) {
          const curPrice = Number(p.price) || 0;
          if (curPrice > 0) {
            const originalPrice = p.regular_price ? Number(p.regular_price) : curPrice;
            const discountedPrice = Math.round(curPrice * (1 - (pct / 100)));
            await supabase
              .from('products')
              .update({ price: discountedPrice, regular_price: originalPrice })
              .eq('id', p.id)
              .eq('seller_id', inv.seller_id);
          }
        }
      } else if (action === 'delete') {
        const { error } = await supabase
          .from('products')
          .delete()
          .in('id', ids)
          .eq('seller_id', inv.seller_id);
        if (error) throw error;
      } else {
        return res.status(400).json({ error: 'Unknown bulk action: ' + action });
      }

      await refreshProductsFromDB(inv.seller_id);
      return res.json({ success: true, count: ids.length, action });
    } catch (err) {
      console.error('[Bulk Action Error]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ========================================================
  // Amazon Seller Central: Save Size & Stock Matrix API
  // ========================================================
  router.post('/api/portal/save-size-stock', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, size_stock } = req.body;
    if (!id || typeof size_stock !== 'object') {
      return res.status(400).json({ error: 'Missing product id or size_stock map' });
    }

    try {
      // Fetch product to merge custom_attributes safely
      const { data: curProd, error: fetchErr } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('seller_id', inv.seller_id)
        .single();
      if (fetchErr || !curProd) return res.status(404).json({ error: 'Product not found' });

      const curAttr = curProd.custom_attributes || {};
      const updatedAttr = { ...curAttr, size_stock: size_stock };

      const sizeKeys = Object.keys(size_stock);
      const totalStock = sizeKeys.reduce((sum, k) => sum + (parseInt(size_stock[k]) || 0), 0);
      const sizesStr = sizeKeys.join(', ');

      const { error: updateErr } = await supabase
        .from('products')
        .update({
          custom_attributes: updatedAttr,
          sizes: sizesStr || 'স্ট্যান্ডার্ড',
          stock_quantity: totalStock,
          in_stock: totalStock > 0
        })
        .eq('id', id)
        .eq('seller_id', inv.seller_id);

      if (updateErr) throw updateErr;

      await refreshProductsFromDB(inv.seller_id);
      return res.json({ success: true, id, stock_quantity: totalStock, sizes: sizesStr });
    } catch (err) {
      console.error('[Save Size Stock Error]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Add Product (With Multi-Photo Support 5 to 8 images & Structured Intelligence)
  router.post('/api/portal/add-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const {
      model_code,
      name,
      category,
      fabric,
      price,
      regular_price,
      stock_quantity,
      sizes,
      colors,
      short_description,
      gallery_images,
      hijab_included,
      custom_attributes
    } = req.body;

    if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });

    const gallery = Array.isArray(gallery_images) ? gallery_images.filter(Boolean).slice(0, 8) : [];
    if (gallery.length < 5) {
      return res.status(400).json({ error: 'ন্যূনতম ৫টি ছবি আপলোড করা আবশ্যক!' });
    }

    const parsedPrice = parseFloat(price);
    const regPrice = regular_price ? parseFloat(regular_price) : parsedPrice;
    const cleanCode = model_code ? model_code.toUpperCase().trim() : 'PROD-' + Math.floor(Math.random() * 899 + 100);

    const mergedCustomAttributes = {
      ...(typeof custom_attributes === 'object' && custom_attributes !== null ? custom_attributes : {}),
      gallery_images: gallery
    };

    const isHijabIncluded = hijab_included === true || hijab_included === 'true' || mergedCustomAttributes.hijab_included === true;

    const { data, error } = await supabase.from('products').insert({
      seller_id: inv.seller_id,
      model_code: cleanCode,
      name: name.trim(),
      category: category ? category.trim() : (mergedCustomAttributes.category || 'fashion'),
      fabric: fabric ? fabric.trim() : null,
      price: parsedPrice,
      regular_price: regPrice,
      stock_quantity: parseInt(stock_quantity) || 1,
      sizes: sizes ? sizes.trim() : null,
      colors: colors ? colors.trim() : null,
      short_description: short_description ? short_description.trim() : null,
      image_url: gallery[0] || null,
      detail_image_url: gallery[1] || null,
      real_image_url: gallery[2] || null,
      hijab_image_url: gallery[3] || null,
      flare_image_url: gallery[4] || null,
      hijab_included: isHijabIncluded,
      custom_attributes: mergedCustomAttributes,
      in_stock: true
    }).select();

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, product: data?.[0] });
  });

  // Edit Product (With Multi-Photo Support 5 to 8 images & Structured Intelligence)
  router.post('/api/portal/edit-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const {
      id,
      model_code,
      name,
      category,
      fabric,
      price,
      regular_price,
      stock_quantity,
      sizes,
      colors,
      short_description,
      gallery_images,
      hijab_included,
      custom_attributes
    } = req.body;

    if (!id) return res.status(400).json({ error: 'ID is required' });

    // Fetch existing product to cleanly merge custom_attributes
    let existingAttrs = {};
    try {
      const { data: curProd } = await supabase
        .from('products')
        .select('custom_attributes')
        .eq('id', id)
        .eq('seller_id', inv.seller_id)
        .single();
      if (curProd && curProd.custom_attributes) {
        existingAttrs = curProd.custom_attributes;
      }
    } catch (e) {}

    const updateFields = {};
    if (model_code !== undefined) updateFields.model_code = model_code.toUpperCase().trim();
    if (name !== undefined) updateFields.name = name.trim();
    if (category !== undefined) updateFields.category = category.trim();
    if (fabric !== undefined) updateFields.fabric = fabric.trim();
    if (price !== undefined) updateFields.price = parseFloat(price);
    if (regular_price !== undefined) updateFields.regular_price = parseFloat(regular_price);
    if (stock_quantity !== undefined) updateFields.stock_quantity = parseInt(stock_quantity) || 1;
    if (sizes !== undefined) updateFields.sizes = sizes.trim();
    if (colors !== undefined) updateFields.colors = colors.trim();
    if (short_description !== undefined) updateFields.short_description = short_description.trim();
    if (hijab_included !== undefined) updateFields.hijab_included = (hijab_included === true || hijab_included === 'true');

    const mergedAttrs = {
      ...existingAttrs,
      ...(typeof custom_attributes === 'object' && custom_attributes !== null ? custom_attributes : {})
    };

    if (Array.isArray(gallery_images) && gallery_images.length >= 5) {
      const gallery = gallery_images.filter(Boolean).slice(0, 8);
      updateFields.image_url = gallery[0] || null;
      updateFields.detail_image_url = gallery[1] || null;
      updateFields.real_image_url = gallery[2] || null;
      updateFields.hijab_image_url = gallery[3] || null;
      updateFields.flare_image_url = gallery[4] || null;
      mergedAttrs.gallery_images = gallery;
    }

    updateFields.custom_attributes = mergedAttrs;

    const { error } = await supabase
      .from('products')
      .update(updateFields)
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id });
  });

  // Delete Product
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

  // Update Order Status
  router.post('/api/portal/update-order-status', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { id, status } = req.body;
    const { error } = await supabase
      .from('orders')
      .update({ status: status })
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, id, status });
  });

  // Courier Text Copy Endpoint
  router.get('/api/portal/courier-text', async (req, res) => {
    const token = req.query.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const id = req.query.id;
    const { data: ord, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('seller_id', inv.seller_id)
      .single();

    if (error || !ord) return res.status(404).json({ error: 'Order not found' });
    return res.json({ success: true, text: formatCourierText(ord) });
  });

  // Save Advanced Settings
  router.post('/api/portal/save-settings', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const {
      inside_dhaka_fee,
      outside_dhaka_fee,
      free_delivery_min_amount,
      bkash_number,
      nagad_number,
      require_advance_outside,
      bot_persona_name,
      delivery_timeline,
      promo_offer,
      return_policy
    } = req.body;

    const extra = {
      require_advance_outside: !!require_advance_outside,
      delivery_timeline: delivery_timeline ? delivery_timeline.trim() : '২-৩ দিন'
    };

    const settingPayload = {
      seller_id: inv.seller_id,
      inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
      outside_dhaka_fee: Number(outside_dhaka_fee) || 150,
      free_delivery_min_amount: free_delivery_min_amount ? Number(free_delivery_min_amount) : null,
      bkash_number: bkash_number ? bkash_number.trim() : null,
      nagad_number: nagad_number ? nagad_number.trim() : null,
      bot_persona_name: bot_persona_name ? bot_persona_name.trim() : 'AI ইনচার্জ',
      promo_offer: promo_offer ? promo_offer.trim() : null,
      return_policy: return_policy ? return_policy.trim() : null,
      extra_config: extra
    };

    const { data: existSetting } = await supabase
      .from('store_settings')
      .select('id')
      .eq('seller_id', inv.seller_id)
      .maybeSingle();

    let saveErr = null;
    if (existSetting && existSetting.id) {
      const { error } = await supabase
        .from('store_settings')
        .update(settingPayload)
        .eq('id', existSetting.id);
      saveErr = error;
    } else {
      const { error } = await supabase
        .from('store_settings')
        .upsert(settingPayload, { onConflict: 'seller_id' });
      saveErr = error;
    }

    if (saveErr) return res.status(500).json({ error: saveErr.message });
    await refreshSettingsFromDB(inv.seller_id);
    return res.json({ success: true });
  });

  return router;
}

module.exports = { createMerchantPortalRouter };
