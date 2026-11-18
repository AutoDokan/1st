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
  router.get('/portal', async (req, res) => {
    const token = req.query.token;
    if (!token) {
      return res.status(401).send(`<!DOCTYPE html>
<html lang="bn">
<head><meta charset="utf-8"><title>অ্যাক্সেস ডিনাইড</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-[#000000] text-white flex items-center justify-center min-h-screen p-4 text-center font-sans">
  <div class="bg-[#1C1C1E] p-8 rounded-[24px] border border-white/[0.08] shadow-2xl max-w-md w-full space-y-3">
    <div class="text-4xl">🔒</div>
    <h1 class="text-lg font-bold text-white">মার্চেন্ট অ্যাক্সেস টোকেন পাওয়া যায়নি</h1>
    <p class="text-xs text-[rgba(235,235,245,0.60)]">দয়া করে আপনাকে দেওয়া সঠিক মার্চেন্ট পোর্টাল লিঙ্ক ব্যবহার করুন।</p>
  </div>
</body>
</html>`);
    }

    const inv = await authenticateMerchantToken(token);
    if (!inv) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="bn">
<head><meta charset="utf-8"><title>ইনভাইটেশন পাওয়া যায়নি</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-[#000000] text-white flex items-center justify-center min-h-screen p-4 text-center font-sans">
  <div class="bg-[#1C1C1E] p-8 rounded-[24px] border border-white/[0.08] shadow-2xl max-w-md w-full space-y-3">
    <div class="text-4xl">⚠️</div>
    <h1 class="text-lg font-bold text-white">ইনভাইটেশন লিঙ্কটি সঠিক নয় বা মেয়াদোত্তীর্ণ</h1>
    <p class="text-xs text-[rgba(235,235,245,0.60)]">দয়া করে অ্যাডমিনের সাথে যোগাযোগ করে নতুন লিঙ্ক সংগ্রহ করুন।</p>
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
    const inStockProducts = products.filter(p => p.in_stock).length;
    const stockOutProducts = totalProducts - inStockProducts;
    const totalInventoryValue = products.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock_quantity) || 1)), 0);

    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'Pending' || o.status === 'Pending Verification').length;
    const approvedOrders = orders.filter(o => o.status === 'Approved').length;
    const shippedOrders = orders.filter(o => o.status === 'Shipped').length;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled').length;
    const totalRevenue = orders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    // ========================================================
    // Render Advanced Product Cards (Apple HIG Pro Dark Theme - Spacious & Large Font)
    // ========================================================
    const productCardsHtml = products.map(p => {
      const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '') + ' ' + (p.sizes || '')).toLowerCase();
      const stockStatus = p.in_stock ? 'IN_STOCK' : 'STOCK_OUT';
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

      // Sizes chips
      const sizeChips = (p.sizes || 'স্ট্যান্ডার্ড').split(',').map(s => s.trim()).filter(Boolean);
      // Colors chips
      const colorChips = (p.colors || '').split(',').map(c => c.trim()).filter(Boolean);

      return `
      <div class="prod-card bg-[#1C1C1E] rounded-[26px] border border-white/[0.08] hover:border-white/[0.18] p-6 sm:p-7 shadow-[0_8px_32px_rgba(0,0,0,0.6)] space-y-5 transition-all flex flex-col justify-between" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}" data-gallery="${encodeURIComponent(JSON.stringify(uniqueGallery))}">
        
        <div class="space-y-4">
          <!-- Card Header: Model Badge & Instant Stock Toggle Switch -->
          <div class="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-sm bg-[#2C2C2E] text-white px-3 py-1 rounded-[10px] border border-white/[0.1]">${p.model_code || 'PROD'}</span>
              
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
            <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition flex items-center gap-2 ${p.in_stock ? 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 hover:bg-[#30D158]/25' : 'bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30 hover:bg-[#FF453A]/25'}">
              <span class="w-2 h-2 rounded-full ${p.in_stock ? 'bg-[#30D158] animate-pulse' : 'bg-[#FF453A]'}"></span>
              <span>${p.in_stock ? 'ইন-স্টক' : 'স্টক আউট'}</span>
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
              <div class="flex items-center gap-1.5 flex-wrap pt-1.5">
                ${sizeChips.map(sz => `<span class="text-xs font-mono font-semibold px-2.5 py-1 rounded-[8px] bg-[#2C2C2E] text-[rgba(235,235,245,0.85)] border border-white/[0.08]">${sz}</span>`).join('')}
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
      <tr class="order-row border-b border-white/[0.04] hover:bg-[#2C2C2E]/40 transition text-sm" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
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
            o.status === 'Approved' ? 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30' :
            o.status === 'Shipped' ? 'bg-white/10 text-white border-white/20' :
            o.status === 'Cancelled' ? 'bg-[#FF453A]/15 text-[#FF453A] border-[#FF453A]/30' :
            'bg-[#FF9F0A]/15 text-[#FF9F0A] border-[#FF9F0A]/30'
          }">
            <option value="Pending" class="bg-[#1C1C1E] text-white" ${o.status === 'Pending' || o.status === 'Pending Verification' ? 'selected' : ''}>⏳ Pending</option>
            <option value="Approved" class="bg-[#1C1C1E] text-white" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
            <option value="Shipped" class="bg-[#1C1C1E] text-white" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
            <option value="Cancelled" class="bg-[#1C1C1E] text-white" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
          </select>
        </td>
        <td class="p-4 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
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
            <span>•</span>
            <span>মোট সেলস: <span class="text-white font-bold">${formatMoney(totalRevenue)}</span></span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <!-- Dual Mode Toggle Button (Light / Dark) -->
        <button type="button" onclick="toggleTheme()" id="themeToggleBtn" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-[14px] border border-white/[0.08] transition flex items-center gap-2 shadow-xs cursor-pointer active:scale-95" title="থিম পরিবর্তন করুন (লাইট / ডার্ক)">
          <span id="themeToggleIcon" class="text-sm">☀️</span>
          <span id="themeToggleText" class="hidden sm:inline">লাইট মোড</span>
        </button>

        <a href="/connect?token=${token}" target="_blank" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-[14px] border border-white/[0.08] transition flex items-center gap-1.5 shadow-xs">
          <span>📲 WhatsApp QR লিঙ্ক</span>
        </a>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-5 sm:px-8 py-8 space-y-8">

    <!-- 4 Platform Metric Telemetry Cards (Large PC-friendly numbers) -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-5">
      <div class="metric-card bg-[#1C1C1E] border border-white/[0.08] p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div class="text-[rgba(235,235,245,0.45)] text-xs sm:text-sm font-semibold uppercase tracking-wider">মোট প্রোডাক্ট ক্যাটালগ</div>
        <div class="text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">${totalProducts}টি <span class="text-xs sm:text-sm text-[#30D158] font-semibold">(${inStockProducts} স্টকে)</span></div>
      </div>
      <div class="metric-card bg-[#1C1C1E] border border-white/[0.08] p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div class="text-[rgba(235,235,245,0.45)] text-xs sm:text-sm font-semibold uppercase tracking-wider">স্টক আউট আইটেম</div>
        <div class="text-2xl sm:text-3xl font-extrabold ${stockOutProducts > 0 ? 'text-[#FF453A]' : 'text-white'} mt-2 tracking-tight">${stockOutProducts}টি</div>
      </div>
      <div class="metric-card bg-[#1C1C1E] border border-white/[0.08] p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div class="text-[rgba(235,235,245,0.45)] text-xs sm:text-sm font-semibold uppercase tracking-wider">মোট গ্রাহক অর্ডারস</div>
        <div class="text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">${totalOrders}টি <span class="text-xs sm:text-sm text-[#FF9F0A] font-semibold">(${pendingOrders} পেন্ডিং)</span></div>
      </div>
      <div class="metric-card bg-[#1C1C1E] border border-white/[0.08] p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div class="text-[rgba(235,235,245,0.45)] text-xs sm:text-sm font-semibold uppercase tracking-wider">মোট ইনভেন্টরি মূল্য</div>
        <div class="text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">${formatMoney(totalInventoryValue)}</div>
      </div>
    </div>

    <!-- Navigation Tabs (Apple Segmented Control Style - Larger Font) -->
    <div class="tabs-bar bg-[#1C1C1E] border border-white/[0.08] p-1.5 rounded-[20px] flex items-center gap-2 overflow-x-auto no-scrollbar">
      <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-6 py-2.5 rounded-[16px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]">
        <span>📦 প্রোডাক্টস স্টুডিও</span>
        <span class="bg-[#3A3A3C] text-white text-xs px-2.5 py-0.5 rounded-full font-bold">${totalProducts}</span>
      </button>

      <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-6 py-2.5 rounded-[16px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white">
        <span>📋 কাস্টমার অর্ডারস</span>
        <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.40)] text-xs px-2.5 py-0.5 rounded-full font-bold">${totalOrders}</span>
      </button>

      <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-6 py-2.5 rounded-[16px] font-semibold text-xs sm:text-sm flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white">
        <span>⚙️ অ্যাডভান্সড শপ সেটিংস ও পলিসি</span>
      </button>
    </div>

    <!-- TAB 1: PRODUCTS STUDIO -->
    <section id="tab-products" class="space-y-6">
      <div class="tab-box bg-[#1C1C1E] rounded-[28px] border border-white/[0.08] p-6 sm:p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] space-y-6">
        
        <!-- Search, Stock Filters & Add Product Action Bar -->
        <div class="flex items-center justify-between border-b border-white/[0.06] pb-5 flex-wrap gap-4">
          <div>
            <h2 class="font-bold text-lg sm:text-xl text-white tracking-tight flex items-center gap-2">
              <span>📦 প্রোডাক্ট ক্যাটালগ ও AI ইনভেন্টরি ম্যানেজমেন্ট</span>
            </h2>
            <p class="text-xs sm:text-sm text-[rgba(235,235,245,0.60)] mt-1">এখানে যেকোনো প্রোডাক্ট যোগ, এডিট বা স্টক পরিবর্তন করামাত্র WhatsApp AI তাৎক্ষণিক আপডেট পাবে।</p>
          </div>

          <div class="flex items-center gap-3 flex-wrap w-full sm:w-auto">
            <input type="text" id="prodSearch" oninput="filterProducts(this.value)" placeholder="🔍 কোড, নাম, ফেব্রিক, কালার খুঁজুন..." class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs sm:text-sm px-4 py-2.5 rounded-[14px] focus:outline-none focus:border-white/40 transition w-full sm:w-72">
            
            <button type="button" onclick="openAddProductModal()" class="bg-white hover:bg-[#E5E5EA] text-black font-semibold text-xs sm:text-sm px-5 py-2.5 rounded-[14px] shadow-[0_2px_12px_rgba(255,255,255,0.15)] transition cursor-pointer flex items-center gap-2 active:scale-95 shrink-0">
              <span>➕ নতুন প্রোডাক্ট যোগ করুন</span>
            </button>
          </div>
        </div>

        <!-- Stock Filter Buttons -->
        <div class="flex items-center gap-2.5 text-xs sm:text-sm font-semibold">
          <button type="button" onclick="filterStock('ALL')" id="filter-stock-all" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer">সবগুলো (${totalProducts})</button>
          <button type="button" onclick="filterStock('IN_STOCK')" id="filter-stock-instock" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">স্টকে আছে (${inStockProducts})</button>
          <button type="button" onclick="filterStock('STOCK_OUT')" id="filter-stock-out" class="stock-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">স্টক আউট (${stockOutProducts})</button>
        </div>

        <!-- Products Grid (Spacious 2-column Desktop Grid: Cards do NOT stick together) -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-7 lg:gap-8" id="productsGrid">
          ${productCardsHtml || '<div class="col-span-full py-20 text-center text-[rgba(235,235,245,0.35)] font-semibold border border-dashed border-white/[0.08] rounded-[24px]">এখনও কোনো প্রোডাক্ট যোগ করা হয়নি। উপরে "➕ নতুন প্রোডাক্ট যোগ করুন" বাটনে চাপ দিন।</div>'}
        </div>

      </div>
    </section>

    <!-- TAB 2: ORDERS -->
    <section id="tab-orders" class="hidden space-y-6">
      <div class="tab-box bg-[#1C1C1E] rounded-[28px] border border-white/[0.08] p-6 sm:p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] space-y-6">
        <div class="flex items-center justify-between border-b border-white/[0.06] pb-5 flex-wrap gap-4">
          <div>
            <h2 class="font-bold text-lg sm:text-xl text-white tracking-tight">📋 কাস্টমার অর্ডারস ও ডেলিভারি পাইপলাইন</h2>
            <p class="text-xs sm:text-sm text-[rgba(235,235,245,0.60)] mt-1">WhatsApp AI থেকে স্বয়ংক্রিয়ভাবে সংগৃহীত কাস্টমারদের অর্ডার তালিকা।</p>
          </div>
          <input type="text" id="orderSearch" oninput="filterOrders(this.value)" placeholder="🔍 নাম, ফোন, ঠিকানা খুঁজুন..." class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs sm:text-sm px-4 py-2.5 rounded-[14px] focus:outline-none focus:border-white/40 w-full sm:w-80">
        </div>

        <!-- Status Filter Buttons -->
        <div class="flex items-center gap-2.5 text-xs sm:text-sm font-semibold overflow-x-auto pb-1 no-scrollbar">
          <button type="button" onclick="filterOrderStatus('ALL')" id="filter-order-all" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer">সবগুলো (${totalOrders})</button>
          <button type="button" onclick="filterOrderStatus('Pending')" id="filter-order-pending" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">পেন্ডিং (${pendingOrders})</button>
          <button type="button" onclick="filterOrderStatus('Approved')" id="filter-order-approved" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">অ্যাপ্রুভড (${approvedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Shipped')" id="filter-order-shipped" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">শিপড (${shippedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Cancelled')" id="filter-order-cancelled" class="order-filter-btn px-4 py-1.5 rounded-[12px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">বাতিল (${cancelledOrders})</button>
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
    <div class="modal-card bg-[#1C1C1E] border border-white/[0.12] rounded-[30px] max-w-2xl w-full p-6 sm:p-8 shadow-[0_24px_70px_rgba(0,0,0,0.85)] space-y-5 max-h-[92vh] overflow-y-auto">
      
      <div class="flex items-center justify-between border-b border-white/[0.06] pb-4">
        <h3 id="modalTitle" class="font-bold text-white text-lg tracking-tight">✨ প্রোডাক্ট স্টুডিও</h3>
        <button type="button" onclick="closeProductStudioModal()" class="w-9 h-9 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] flex items-center justify-center text-[rgba(235,235,245,0.70)] hover:text-white font-bold cursor-pointer transition">✕</button>
      </div>

      <form id="productStudioForm" onsubmit="handleProductStudioSubmit(event)" class="space-y-5">
        <input type="hidden" id="studio_prod_id" value="">

        <!-- Basic Code & Title -->
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">মডেল কোড *</label>
            <input type="text" id="studio_code" required placeholder="যেমন: DF-105" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-mono font-bold p-3 rounded-[14px] focus:border-white/40 outline-none uppercase">
          </div>
          <div class="col-span-2">
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">প্রোডাক্টের নাম *</label>
            <input type="text" id="studio_name" required placeholder="যেমন: প্রিমিয়াম দুবাই চেরি রানি আবায়া" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-medium p-3 rounded-[14px] focus:border-white/40 outline-none">
          </div>
        </div>

        <!-- Pricing Engine: Regular Price & Offer Price -->
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">বিক্রয় মূল্য (টাকা) *</label>
            <input type="number" id="studio_price" required placeholder="যেমন: 1850" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-base font-bold p-3 rounded-[14px] focus:border-white/40 outline-none">
          </div>
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">রেগুলার মূল্য (MRP)</label>
            <input type="number" id="studio_regular_price" placeholder="যেমন: 2200" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
          </div>
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">স্টক সংখ্যা (পিস)</label>
            <input type="number" id="studio_stock_qty" value="25" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
          </div>
        </div>

        <!-- Sizes & Quick Presets -->
        <div>
          <div class="flex items-center justify-between mb-1.5 flex-wrap gap-2">
            <label class="text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)]">সাইজসমূহ (কমা দিয়ে লিখুন)</label>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-[rgba(235,235,245,0.40)]">প্রিসেট:</span>
              <button type="button" onclick="setPresetSizes('৫০, ৫২, ৫৪, ৫৬')" class="text-white hover:underline cursor-pointer font-medium">আবায়া (৫০-৫৬)</button>
              <span>•</span>
              <button type="button" onclick="setPresetSizes('৩৯, ৪০, ৪১, ৪২, ৪৩, ৪৪')" class="text-white hover:underline cursor-pointer font-medium">জুতা (৩৯-৪৪)</button>
              <span>•</span>
              <button type="button" onclick="setPresetSizes('স্ট্যান্ডার্ড সাইজ')" class="text-white hover:underline cursor-pointer font-medium">ফ্রি সাইজ</button>
            </div>
          </div>
          <input type="text" id="studio_sizes" placeholder="যেমন: ৫০, ৫২, ৫৪, ৫৬" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-medium p-3 rounded-[14px] focus:border-white/40 outline-none">
        </div>

        <!-- Colors & Fabric -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">কালার ভ্যারিয়েন্ট (কমা দিয়ে)</label>
            <input type="text" id="studio_colors" placeholder="যেমন: জেট ব্ল্যাক, চকোলেট ব্রাউন" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
          </div>
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">ফেব্রিক / উপাদান</label>
            <input type="text" id="studio_fabric" placeholder="যেমন: দুবাই চেরি / কাউ লেদার" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none">
          </div>
        </div>

        <!-- AI Sales Intelligence Guideline -->
        <div>
          <label class="block text-xs sm:text-sm font-semibold text-[rgba(235,235,245,0.70)] mb-1.5">🤖 AI বিক্রয় নির্দেশিকা (গ্রাহককে কনভিন্স করার বিশেষ পয়েন্ট)</label>
          <textarea id="studio_ai_notes" rows="2" placeholder="যেমন: কাপড়ে কুঁচকে যায় না, ধোয়ার পর কালার ফেইড হবে না। কাস্টমার দামাদামি করলে ১০০ টাকা ছাড় দিতে পারবে।" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm p-3 rounded-[14px] focus:border-white/40 outline-none leading-relaxed"></textarea>
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

  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 pointer-events-none"></div>

  <script>
    const token = '${token}';
    window.portalOrders = ${JSON.stringify(orders)};
    let currentStockFilter = 'ALL';
    let currentOrderFilter = 'ALL';

    // Image Upload State (Min 5, Max 8)
    let studioUploadedImages = [];

    // Safe Deletion State
    let pendingDeleteProdId = null;
    let deleteCountdownTimer = null;
    let deleteSecondsLeft = 3;

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

    // Open Catalog Lightbox from Card Image Click
    function openCatalogLightbox(productId) {
      const card = document.querySelector('.prod-card[data-id="' + productId + '"]');
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

    // Inline Quick-Edit for Price
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
    }

    async function saveInlinePrice(id) {
      const inputEl = document.getElementById('price-input-' + id);
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
          const toast = document.getElementById('price-toast-' + id);
          if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2000);
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

    // Inline Quick-Edit for Stock Inventory
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
    }

    async function saveInlineStock(id) {
      const inputEl = document.getElementById('stock-input-' + id);
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
          const valEl = document.getElementById('stock-val-' + id);
          if (valEl) valEl.innerText = newStock;
          const toast = document.getElementById('stock-toast-' + id);
          if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2000);
          }
          cancelInlineStock(id, newStock);
          showToast('✅ ইনভেন্টরি স্টক ' + newStock + ' পিস আপডেট হয়েছে!');
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

    // Open Modal for Add
    function openAddProductModal() {
      document.getElementById('modalTitle').innerText = '➕ নতুন প্রোডাক্ট যোগ করুন';
      document.getElementById('studio_prod_id').value = '';
      document.getElementById('productStudioForm').reset();
      studioUploadedImages = [];
      renderStudioPhotos();
      document.getElementById('productStudioModal').classList.remove('hidden');
    }

    // Open Modal for Edit
    async function openEditProductModalById(id) {
      document.getElementById('modalTitle').innerText = '✏️ প্রোডাক্ট এডিট করুন';
      document.getElementById('studio_prod_id').value = id;
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

          // Populate existing photos
          const existingGallery = [
            p.image_url,
            p.detail_image_url,
            p.real_image_url,
            p.hijab_image_url,
            p.flare_image_url,
            ...(p.custom_attributes?.gallery_images || [])
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

      const payload = {
        id: prodId || undefined,
        model_code: document.getElementById('studio_code').value.trim(),
        name: document.getElementById('studio_name').value.trim(),
        price: document.getElementById('studio_price').value,
        regular_price: document.getElementById('studio_regular_price').value || document.getElementById('studio_price').value,
        stock_quantity: document.getElementById('studio_stock_qty').value || 1,
        sizes: document.getElementById('studio_sizes').value.trim(),
        colors: document.getElementById('studio_colors').value.trim(),
        fabric: document.getElementById('studio_fabric').value.trim(),
        short_description: document.getElementById('studio_ai_notes').value.trim(),
        gallery_images: studioUploadedImages.slice(0, 8)
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
      const active = type === 'ALL' ? 'filter-stock-all' : (type === 'IN_STOCK' ? 'filter-stock-instock' : 'filter-stock-out');
      const el = document.getElementById(active);
      if (el) el.className = 'stock-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer';
      applyProductFilters();
    }

    function filterProducts() { applyProductFilters(); }

    function applyProductFilters() {
      const q = (document.getElementById('prodSearch')?.value || '').toLowerCase().trim();
      document.querySelectorAll('.prod-card').forEach(c => {
        const search = c.getAttribute('data-search') || '';
        const stock = c.getAttribute('data-stock') || '';
        const matchStock = (currentStockFilter === 'ALL') || (stock === currentStockFilter);
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
      const idMap = { 'ALL': 'filter-order-all', 'Pending': 'filter-order-pending', 'Approved': 'filter-order-approved', 'Shipped': 'filter-order-shipped', 'Cancelled': 'filter-order-cancelled' };
      const el = document.getElementById(idMap[status]);
      if (el) el.className = 'order-filter-btn px-4 py-1.5 rounded-[12px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer';
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

    async function updateOrderStatusLive(id, status) {
      try {
        const res = await fetch('/api/portal/update-order-status?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status })
        });
        const data = await res.json();
        if (data.success) {
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

    const { error } = await supabase
      .from('products')
      .update(updateObj)
      .eq('id', id)
      .eq('seller_id', inv.seller_id);

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, id, field, value: numVal });
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

  // Add Product (With Multi-Photo Support 5 to 8 images)
  router.post('/api/portal/add-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const {
      model_code,
      name,
      fabric,
      price,
      regular_price,
      stock_quantity,
      sizes,
      colors,
      short_description,
      gallery_images
    } = req.body;

    if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });

    const gallery = Array.isArray(gallery_images) ? gallery_images.filter(Boolean).slice(0, 8) : [];
    if (gallery.length < 5) {
      return res.status(400).json({ error: 'ন্যূনতম ৫টি ছবি আপলোড করা আবশ্যক!' });
    }

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
      stock_quantity: parseInt(stock_quantity) || 1,
      sizes: sizes ? sizes.trim() : null,
      colors: colors ? colors.trim() : null,
      short_description: short_description ? short_description.trim() : null,
      image_url: gallery[0] || null,
      detail_image_url: gallery[1] || null,
      real_image_url: gallery[2] || null,
      hijab_image_url: gallery[3] || null,
      flare_image_url: gallery[4] || null,
      custom_attributes: { gallery_images: gallery },
      in_stock: true
    }).select();

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, product: data?.[0] });
  });

  // Edit Product (With Multi-Photo Support 5 to 8 images)
  router.post('/api/portal/edit-product', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const {
      id,
      model_code,
      name,
      fabric,
      price,
      regular_price,
      stock_quantity,
      sizes,
      colors,
      short_description,
      gallery_images
    } = req.body;

    if (!id) return res.status(400).json({ error: 'ID is required' });

    const updateFields = {};
    if (model_code !== undefined) updateFields.model_code = model_code.toUpperCase().trim();
    if (name !== undefined) updateFields.name = name.trim();
    if (fabric !== undefined) updateFields.fabric = fabric.trim();
    if (price !== undefined) updateFields.price = parseFloat(price);
    if (regular_price !== undefined) updateFields.regular_price = parseFloat(regular_price);
    if (stock_quantity !== undefined) updateFields.stock_quantity = parseInt(stock_quantity) || 1;
    if (sizes !== undefined) updateFields.sizes = sizes.trim();
    if (colors !== undefined) updateFields.colors = colors.trim();
    if (short_description !== undefined) updateFields.short_description = short_description.trim();

    if (Array.isArray(gallery_images) && gallery_images.length >= 5) {
      const gallery = gallery_images.filter(Boolean).slice(0, 8);
      updateFields.image_url = gallery[0] || null;
      updateFields.detail_image_url = gallery[1] || null;
      updateFields.real_image_url = gallery[2] || null;
      updateFields.hijab_image_url = gallery[3] || null;
      updateFields.flare_image_url = gallery[4] || null;
      updateFields.custom_attributes = { gallery_images: gallery };
    }

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
