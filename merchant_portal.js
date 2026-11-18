/**
 * AutoDokan Dedicated Multi-Tenant Merchant Portal
 * Isolated, secure, token-authenticated mobile-first portal for invited merchants.
 * 100% Apple HIG Pro Dark Mode Edition — High eye-comfort, zero harsh blue glare.
 * Comprehensive Product Studio & Real-Time Inventory Control Suite.
 */

const express = require('express');

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
      return_policy: 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।'
    };

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
    // Render Advanced Product Cards (Apple HIG Pro Dark Theme)
    // ========================================================
    const productCardsHtml = products.map(p => {
      const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '') + ' ' + (p.sizes || '')).toLowerCase();
      const stockStatus = p.in_stock ? 'IN_STOCK' : 'STOCK_OUT';
      const mainImg = p.image_url || 'https://placehold.co/240x300/1c1c1e/ffffff?text=' + encodeURIComponent(p.model_code || 'PROD');
      const hasDiscount = p.regular_price && Number(p.regular_price) > Number(p.price);

      // Sizes chips
      const sizeChips = (p.sizes || 'স্ট্যান্ডার্ড').split(',').map(s => s.trim()).filter(Boolean);
      // Colors chips
      const colorChips = (p.colors || '').split(',').map(c => c.trim()).filter(Boolean);

      return `
      <div class="prod-card bg-[#1C1C1E] rounded-[22px] border border-white/[0.08] hover:border-white/[0.14] p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] space-y-4 transition flex flex-col justify-between" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}">
        
        <div class="space-y-3.5">
          <!-- Card Header: Model Badge & Instant Stock Toggle Switch -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-mono font-bold text-xs bg-[#2C2C2E] text-white px-2.5 py-1 rounded-[10px] border border-white/[0.08]">${p.model_code || 'PROD'}</span>
              <span class="text-[10px] text-[rgba(235,235,245,0.60)] bg-[#2C2C2E]/60 px-2 py-0.5 rounded-[8px] border border-white/[0.04]">📦 ${p.stock_quantity || 1} পিস স্টক</span>
            </div>

            <!-- 1-Click Instant Stock Toggle -->
            <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-[11px] font-medium px-2.5 py-1 rounded-full cursor-pointer transition flex items-center gap-1.5 ${p.in_stock ? 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 hover:bg-[#30D158]/25' : 'bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30 hover:bg-[#FF453A]/25'}">
              <span class="w-1.5 h-1.5 rounded-full ${p.in_stock ? 'bg-[#30D158] animate-pulse' : 'bg-[#FF453A]'}"></span>
              <span>${p.in_stock ? 'ইন-স্টক' : 'স্টক আউট'}</span>
            </button>
          </div>

          <!-- Product Media & Details Layout -->
          <div class="flex gap-3.5 items-start">
            <!-- Product Photo with Multiple Thumbnail Switcher -->
            <div class="shrink-0 space-y-1.5">
              <img id="img-preview-${p.id}" src="${mainImg}" alt="${p.model_code}" class="w-24 h-28 object-cover rounded-[14px] bg-[#2C2C2E] border border-white/[0.08] shadow-sm">
              <div class="flex items-center gap-1 justify-center">
                <button type="button" onclick="switchCardPhoto(${p.id}, '${mainImg}')" class="w-2 h-2 rounded-full bg-white/70 hover:bg-white" title="মূল ছবি"></button>
                ${p.detail_image_url ? `<button type="button" onclick="switchCardPhoto(${p.id}, '${p.detail_image_url}')" class="w-2 h-2 rounded-full bg-white/30 hover:bg-white" title="ডিটেইল ছবি"></button>` : ''}
                ${p.real_image_url ? `<button type="button" onclick="switchCardPhoto(${p.id}, '${p.real_image_url}')" class="w-2 h-2 rounded-full bg-white/30 hover:bg-white" title="রিয়েল ছবি"></button>` : ''}
              </div>
            </div>

            <!-- Product Specs & Title -->
            <div class="flex-1 min-w-0 space-y-1">
              <h3 class="font-semibold text-white text-sm leading-snug line-clamp-2" title="${p.name}">${p.name}</h3>
              
              <!-- Pricing Engine -->
              <div class="flex items-baseline gap-2 pt-0.5">
                <span class="font-bold text-white text-base">৳${p.price}</span>
                ${hasDiscount ? `<span class="text-[rgba(235,235,245,0.30)] line-through text-xs font-mono">৳${p.regular_price}</span>` : ''}
                ${hasDiscount ? `<span class="text-[10px] text-[#30D158] font-medium bg-[#30D158]/10 px-1.5 py-0.2 rounded">ছাড়</span>` : ''}
              </div>

              <!-- Material / Fabric -->
              <div class="text-[11px] text-[rgba(235,235,245,0.60)] flex items-center gap-1 pt-0.5">
                <span>✨</span>
                <span class="truncate">${p.fabric || 'স্ট্যান্ডার্ড কোয়ালিটি'}</span>
              </div>

              <!-- Available Sizes Chips -->
              <div class="flex items-center gap-1 flex-wrap pt-1">
                ${sizeChips.map(sz => `<span class="text-[10px] font-mono px-2 py-0.5 rounded-[6px] bg-[#2C2C2E] text-[rgba(235,235,245,0.85)] border border-white/[0.06]">${sz}</span>`).join('')}
              </div>
            </div>
          </div>

          <!-- Color Swatches (if any) -->
          ${colorChips.length > 0 ? `
            <div class="bg-[#2C2C2E] p-2.5 rounded-[14px] border border-white/[0.04] flex items-center gap-1.5 flex-wrap text-xs">
              <span class="text-[10px] text-[rgba(235,235,245,0.30)] font-medium">রং:</span>
              ${colorChips.map(col => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-[#1C1C1E] text-white border border-white/[0.06] font-medium">${col}</span>`).join('')}
            </div>
          ` : ''}

          <!-- AI Sales Intelligence Note (AI বট কাস্টমারকে যা বলবে) -->
          <div class="bg-[#2C2C2E] p-3 rounded-[14px] border border-white/[0.06] space-y-1.5">
            <div class="flex items-center justify-between text-[11px]">
              <span class="font-medium text-[rgba(235,235,245,0.60)] flex items-center gap-1">
                <span>🤖</span><span>AI বিক্রয় নোট:</span>
              </span>
              <button type="button" onclick="editAINotesPrompt(${p.id}, '${(p.short_description || '').replace(/'/g, "\\'")}')" class="text-white hover:text-white/80 text-[10px] underline font-medium cursor-pointer">
                ✏️ এডিট
              </button>
            </div>
            <p id="ai-notes-${p.id}" class="text-xs text-[rgba(235,235,245,0.85)] leading-relaxed italic line-clamp-2">
              ${p.short_description || 'কোনো বিশেষ নির্দেশনা দেওয়া নেই। AI স্ট্যান্ডার্ড ক্যাটালগ দেখে রিপ্লাই দেবে।'}
            </p>
          </div>
        </div>

        <!-- Action Buttons (Apple Monochromatic Minimalist Style) -->
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-white/[0.06] text-xs mt-2">
          <button type="button" onclick="openEditProductModalById(${p.id})" class="flex-1 bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white font-medium py-2 rounded-[12px] border border-white/[0.08] transition flex items-center justify-center gap-1.5 cursor-pointer">
            <span>✏️ প্রোডাক্ট এডিট</span>
          </button>
          <button type="button" onclick="deleteProductLive(${p.id}, '${p.model_code}')" class="bg-[#2C2C2E] hover:bg-[#FF453A]/20 text-[#FF453A] font-medium px-3.5 py-2 rounded-[12px] border border-[#FF453A]/20 transition flex items-center justify-center gap-1 cursor-pointer" title="মুছে ফেলুন">
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

      return `
      <tr class="order-row border-b border-white/[0.04] hover:bg-[#2C2C2E]/40 transition text-xs" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
        <td class="p-3.5">
          <div class="font-mono font-medium text-white">#${o.id}</div>
          <div class="text-[10px] text-[rgba(235,235,245,0.30)] mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
        </td>
        <td class="p-3.5">
          <div class="font-medium text-white text-xs">${o.customer_name || 'কাস্টমার'}</div>
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-[rgba(235,235,245,0.85)] hover:text-white underline text-xs font-mono font-medium flex items-center gap-1 mt-0.5">
            <span>💬</span>
            <span>${o.customer_phone || ''}</span>
          </a>
        </td>
        <td class="p-3.5 max-w-[200px]">
          <div class="text-xs text-[rgba(235,235,245,0.60)] line-clamp-2" title="${o.address || ''}">${o.address || 'ঠিকানা দেওয়া হয়নি'}</div>
        </td>
        <td class="p-3.5">
          <span class="font-mono font-medium text-white text-xs">[${o.model_code || 'PROD'}]</span>
          <div class="text-[11px] text-[rgba(235,235,245,0.30)] mt-0.5">সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'}</div>
        </td>
        <td class="p-3.5">
          <span class="font-semibold text-white text-xs">৳${dueCod}</span>
        </td>
        <td class="p-3.5">
          <select onchange="updateOrderStatusLive(${o.id}, this.value)" class="text-xs font-medium rounded-[10px] px-2.5 py-1 border outline-none cursor-pointer ${
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
        <td class="p-3.5 text-right">
          <button type="button" onclick="copyCourierFormat(${o.id})" title="কুরিয়ার ফরম্যাট কপি" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white text-[11px] font-medium px-3 py-1.5 rounded-[10px] border border-white/[0.08] transition cursor-pointer">
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
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
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
  </style>
</head>
<body class="bg-[#000000] text-[rgba(235,235,245,0.60)] min-h-screen pb-24 selection:bg-white/20 selection:text-white">
  
  <!-- Apple Frosted Glass Top Navbar -->
  <header class="apple-glass border-b border-white/[0.08] sticky top-0 z-40 px-5 py-3.5">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
      
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-[14px] bg-[#1C1C1E] border border-white/[0.12] text-white flex items-center justify-center font-bold text-lg shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
          🏪
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="font-semibold text-sm sm:text-base text-white tracking-tight">${shopName}</h1>
            <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] text-[10px] font-medium px-2 py-0.5 rounded-full border border-white/[0.06]">মার্চেন্ট পোর্টাল</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-xs text-[rgba(235,235,245,0.30)]">
            <span class="inline-flex items-center gap-1.5 ${isConnected ? 'text-[#30D158]' : 'text-[rgba(235,235,245,0.60)]'} font-medium">
              <span class="w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#30D158] animate-pulse' : 'bg-[rgba(235,235,245,0.30)]'}"></span>
              <span>${isConnected ? 'WhatsApp বট সক্রিয় (+' + liveNum + ')' : 'বট অপেক্ষমাণ'}</span>
            </span>
            <span>•</span>
            <span>মোট সেলস: <span class="text-white font-medium">${formatMoney(totalRevenue)}</span></span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a href="/connect?token=${token}" target="_blank" class="bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white/90 border border-white/[0.08] text-xs px-3 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1">
          <span>📲 WhatsApp QR</span>
        </a>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-5 py-6 space-y-6">

    <!-- 4 Platform Metric Telemetry Cards (Pure White Metrics) -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">মোট প্রোডাক্ট ক্যাটালগ</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalProducts}টি <span class="text-xs text-[#30D158] font-medium">(${inStockProducts} স্টকে)</span></div>
      </div>
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">স্টক আউট আইটেম</div>
        <div class="text-2xl font-bold ${stockOutProducts > 0 ? 'text-[#FF453A]' : 'text-white'} mt-1.5 tracking-tight">${stockOutProducts}টি</div>
      </div>
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">মোট গ্রাহক অর্ডারস</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalOrders}টি <span class="text-xs text-[#FF9F0A] font-medium">(${pendingOrders} পেন্ডিং)</span></div>
      </div>
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">মোট ইনভেন্টরি মূল্য</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${formatMoney(totalInventoryValue)}</div>
      </div>
    </div>

    <!-- Navigation Tabs (Apple Segmented Control Style) -->
    <div class="bg-[#1C1C1E] border border-white/[0.08] p-1.5 rounded-[18px] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]">
        <span>📦 প্রোডাক্টস স্টুডিও</span>
        <span class="bg-[#3A3A3C] text-white text-[10px] px-2 py-0.5 rounded-full font-bold">${totalProducts}</span>
      </button>

      <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white">
        <span>📋 কাস্টমার অর্ডারস</span>
        <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.30)] text-[10px] px-2 py-0.5 rounded-full font-bold">${totalOrders}</span>
      </button>

      <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white">
        <span>⚙️ শপ পলিসি ও চার্জ</span>
      </button>
    </div>

    <!-- TAB 1: PRODUCTS STUDIO -->
    <section id="tab-products" class="space-y-4">
      <div class="bg-[#1C1C1E] rounded-[24px] border border-white/[0.08] p-5.5 shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
        
        <!-- Search, Stock Filters & Add Product Action Bar -->
        <div class="flex items-center justify-between border-b border-white/[0.06] pb-4 flex-wrap gap-3">
          <div>
            <h2 class="font-semibold text-base text-white tracking-tight flex items-center gap-2">
              <span>📦 প্রোডাক্ট ক্যাটালগ ও AI ইনভেন্টরি ম্যানেজমেন্ট</span>
            </h2>
            <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">এখানে কোনো প্রোডাক্ট যোগ, এডিট বা স্টক পরিবর্তন করামাত্র WhatsApp AI স্বয়ংক্রিয়ভাবে আপডেট পাবে।</p>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <input type="text" id="prodSearch" oninput="filterProducts(this.value)" placeholder="🔍 কোড, নাম, কালার খুঁজুন..." class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs px-3.5 py-2 rounded-[12px] focus:outline-none focus:border-white/30 transition w-full sm:w-64">
            
            <button type="button" onclick="openAddProductModal()" class="bg-white hover:bg-[#E5E5EA] text-black font-semibold text-xs px-4 py-2 rounded-[12px] shadow-[0_2px_10px_rgba(255,255,255,0.12)] transition cursor-pointer flex items-center gap-1.5 active:scale-95">
              <span>➕ নতুন প্রোডাক্ট যোগ করুন</span>
            </button>
          </div>
        </div>

        <!-- Stock Filter Buttons -->
        <div class="flex items-center gap-2 text-xs font-medium">
          <button type="button" onclick="filterStock('ALL')" id="filter-stock-all" class="stock-filter-btn px-3 py-1 rounded-[10px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer">সবগুলো (${totalProducts})</button>
          <button type="button" onclick="filterStock('IN_STOCK')" id="filter-stock-instock" class="stock-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">স্টকে আছে (${inStockProducts})</button>
          <button type="button" onclick="filterStock('STOCK_OUT')" id="filter-stock-out" class="stock-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">স্টক আউট (${stockOutProducts})</button>
        </div>

        <!-- Products Grid (Apple 3-Column Responsive Grid) -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5" id="productsGrid">
          ${productCardsHtml || '<div class="col-span-full py-16 text-center text-[rgba(235,235,245,0.30)] font-medium border border-dashed border-white/[0.08] rounded-[20px]">এখনও কোনো প্রোডাক্ট যোগ করা হয়নি। উপরে "➕ নতুন প্রোডাক্ট যোগ করুন" বাটনে চাপ দিন।</div>'}
        </div>

      </div>
    </section>

    <!-- TAB 2: ORDERS -->
    <section id="tab-orders" class="hidden space-y-4">
      <div class="bg-[#1C1C1E] rounded-[24px] border border-white/[0.08] p-5.5 shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
        <div class="flex items-center justify-between border-b border-white/[0.06] pb-4 flex-wrap gap-3">
          <div>
            <h2 class="font-semibold text-base text-white tracking-tight">📋 কাস্টমার অর্ডারস ও ডেলিভারি পাইপলাইন</h2>
            <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">WhatsApp AI থেকে স্বয়ংক্রিয়ভাবে সংগৃহীত কাস্টমারদের অর্ডার তালিকা।</p>
          </div>
          <input type="text" id="orderSearch" oninput="filterOrders(this.value)" placeholder="🔍 নাম, ফোন, ঠিকানা খুঁজুন..." class="bg-[#2C2C2E] border border-white/[0.08] text-white text-xs px-3.5 py-2 rounded-[12px] focus:outline-none focus:border-white/30 w-full sm:w-72">
        </div>

        <!-- Status Filter Buttons -->
        <div class="flex items-center gap-2 text-xs font-medium overflow-x-auto pb-1 no-scrollbar">
          <button type="button" onclick="filterOrderStatus('ALL')" id="filter-order-all" class="order-filter-btn px-3 py-1 rounded-[10px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer">সবগুলো (${totalOrders})</button>
          <button type="button" onclick="filterOrderStatus('Pending')" id="filter-order-pending" class="order-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">পেন্ডিং (${pendingOrders})</button>
          <button type="button" onclick="filterOrderStatus('Approved')" id="filter-order-approved" class="order-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">অ্যাপ্রুভড (${approvedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Shipped')" id="filter-order-shipped" class="order-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">শিপড (${shippedOrders})</button>
          <button type="button" onclick="filterOrderStatus('Cancelled')" id="filter-order-cancelled" class="order-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer">বাতিল (${cancelledOrders})</button>
        </div>

        <!-- Orders Table -->
        <div class="overflow-x-auto border border-white/[0.06] rounded-[16px]">
          <table class="w-full text-left text-[rgba(235,235,245,0.60)] text-xs">
            <thead class="bg-[#2C2C2E] text-[rgba(235,235,245,0.30)] font-medium border-b border-white/[0.06]">
              <tr>
                <th class="p-3.5">অর্ডার ID</th>
                <th class="p-3.5">কাস্টমার</th>
                <th class="p-3.5">ঠিকানা</th>
                <th class="p-3.5">মডেল ও সাইজ</th>
                <th class="p-3.5">Due COD</th>
                <th class="p-3.5">স্ট্যাটাস</th>
                <th class="p-3.5 text-right">কুরিয়ার টেক্সট</th>
              </tr>
            </thead>
            <tbody id="ordersTableBody">
              ${orderRowsHtml || '<tr><td colspan="7" class="p-8 text-center text-[rgba(235,235,245,0.30)] font-medium">এখনও কোনো অর্ডার আসেনি।</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 3: SETTINGS -->
    <section id="tab-settings" class="hidden space-y-4">
      <div class="bg-[#1C1C1E] rounded-[24px] border border-white/[0.08] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)] max-w-2xl mx-auto space-y-5">
        <div class="border-b border-white/[0.06] pb-3.5">
          <h2 class="font-semibold text-base text-white tracking-tight">⚙️ শপ সেটিংস ও ডেলিভারি পলিসি</h2>
          <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">WhatsApp AI স্বয়ংক্রিয়ভাবে কাস্টমারকে এই ডেলিভারি চার্জ ও পেমেন্ট নম্বর জানাবে।</p>
        </div>

        <form onsubmit="saveMerchantSettingsLive(event)" class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🚚 ঢাকা ভেতরে ডেলিভারি চার্জ (টাকা)</label>
              <input type="number" id="set_inside_fee" value="${curSettings.inside_dhaka_fee}" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-semibold p-2.5 rounded-[12px] focus:border-white/30 outline-none">
            </div>
            <div>
              <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🚛 ঢাকা বাইরে ডেলিভারি চার্জ (টাকা)</label>
              <input type="number" id="set_outside_fee" value="${curSettings.outside_dhaka_fee}" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-sm font-semibold p-2.5 rounded-[12px] focus:border-white/30 outline-none">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">📱 বিকাশ নাম্বার</label>
              <input type="text" id="set_bkash" value="${curSettings.bkash_number || ''}" placeholder="যেমন: 017XXXXXXXX" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-mono font-medium p-2.5 rounded-[12px] focus:border-white/30 outline-none">
            </div>
            <div>
              <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">📱 নগদ নাম্বার</label>
              <input type="text" id="set_nagad" value="${curSettings.nagad_number || ''}" placeholder="যেমন: 018XXXXXXXX" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-mono font-medium p-2.5 rounded-[12px] focus:border-white/30 outline-none">
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🎁 বিশেষ অফার / কম্বো ছাড়</label>
            <input type="text" id="set_promo_offer" value="${curSettings.promo_offer || ''}" placeholder="যেমন: ২টি নিলে ডেলিভারি চার্জ ফ্রি!" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>

          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি (AI গ্রাহককে বলবে)</label>
            <textarea id="set_return_policy" rows="2" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] focus:border-white/30 outline-none">${curSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে নেওয়ার সুযোগ আছে।'}</textarea>
          </div>

          <button type="submit" id="saveSettingsBtn" class="w-full bg-white hover:bg-[#E5E5EA] text-black text-xs font-semibold py-3 rounded-[14px] shadow-[0_2px_12px_rgba(255,255,255,0.12)] transition cursor-pointer active:scale-98">
            💾 সেটিংস সেভ করুন
          </button>
        </form>
      </div>
    </section>

  </main>

  <!-- ======================================================== -->
  <!-- SOURCE-FULL PRODUCT STUDIO MODAL (ADD & EDIT)           -->
  <!-- ======================================================== -->
  <div id="productStudioModal" class="hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
    <div class="bg-[#1C1C1E] border border-white/[0.12] rounded-[28px] max-w-xl w-full p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)] space-y-4 max-h-[92vh] overflow-y-auto">
      
      <div class="flex items-center justify-between border-b border-white/[0.06] pb-3.5">
        <h3 id="modalTitle" class="font-semibold text-white text-base tracking-tight">✨ প্রোডাক্ট স্টুডিও</h3>
        <button type="button" onclick="closeProductStudioModal()" class="w-8 h-8 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] flex items-center justify-center text-[rgba(235,235,245,0.60)] hover:text-white font-bold cursor-pointer transition">✕</button>
      </div>

      <form id="productStudioForm" onsubmit="handleProductStudioSubmit(event)" class="space-y-3.5">
        <input type="hidden" id="studio_prod_id" value="">

        <!-- Basic Code & Title -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">মডেল কোড *</label>
            <input type="text" id="studio_code" required placeholder="যেমন: DF-105" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-mono font-bold p-2.5 rounded-[12px] focus:border-white/30 outline-none uppercase">
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">প্রোডাক্টের নাম *</label>
            <input type="text" id="studio_name" required placeholder="যেমন: প্রিমিয়াম দুবাই চেরি রানি আবায়া" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>
        </div>

        <!-- Pricing Engine: Regular Price & Offer Price -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">বিক্রয় মূল্য (টাকা) *</label>
            <input type="number" id="studio_price" required placeholder="যেমন: 1850" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-bold p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">রেগুলার মূল্য (MRP)</label>
            <input type="number" id="studio_regular_price" placeholder="যেমন: 2200" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">স্টক সংখ্যা (পিস)</label>
            <input type="number" id="studio_stock_qty" value="25" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>
        </div>

        <!-- Sizes & Quick Presets -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-xs font-medium text-[rgba(235,235,245,0.60)]">সাইজসমূহ (কমা দিয়ে লিখুন)</label>
            <div class="flex items-center gap-1.5 text-[10px]">
              <span class="text-[rgba(235,235,245,0.30)]">প্রিসেট:</span>
              <button type="button" onclick="setPresetSizes('৫০, ৫২, ৫৪, ৫৬')" class="text-white hover:underline cursor-pointer">আবায়া (৫০-৫৬)</button>
              <span>•</span>
              <button type="button" onclick="setPresetSizes('৩৯, ৪০, ৪১, ৪২, ৪৩, ৪৪')" class="text-white hover:underline cursor-pointer">জুতা (৩৯-৪৪)</button>
              <span>•</span>
              <button type="button" onclick="setPresetSizes('স্ট্যান্ডার্ড সাইজ')" class="text-white hover:underline cursor-pointer">ফ্রি সাইজ</button>
            </div>
          </div>
          <input type="text" id="studio_sizes" placeholder="যেমন: ৫০, ৫২, ৫৪, ৫৬" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] focus:border-white/30 outline-none">
        </div>

        <!-- Colors & Fabric -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">কালার ভ্যারিয়েন্ট (কমা দিয়ে)</label>
            <input type="text" id="studio_colors" placeholder="যেমন: জেট ব্ল্যাক, চকোলেট ব্রাউন, কফি" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">ফেব্রিক / উপাদান</label>
            <input type="text" id="studio_fabric" placeholder="যেমন: অরিজিনাল দুবাই চেরি / জেনুইন লেদার" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>
        </div>

        <!-- AI Sales Intelligence Guideline -->
        <div>
          <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🤖 AI বিক্রয় নির্দেশিকা (গ্রাহককে কনভিন্স করার বিশেষ পয়েন্ট)</label>
          <textarea id="studio_ai_notes" rows="2" placeholder="যেমন: কাপড়ে কুঁচকে যায় না, ধোয়ার পর কালার ফেইড হবে না। কাস্টমার দামাদামি করলে ১০০ টাকা ছাড় দিতে পারবে।" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] focus:border-white/30 outline-none leading-relaxed"></textarea>
        </div>

        <!-- Image URLs with Live Preview -->
        <div class="space-y-2">
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🖼️ মূল ছবির সরাসরি URL *</label>
            <input type="url" id="studio_img_main" oninput="previewStudioPhoto(this.value)" placeholder="https://..." required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-mono p-2.5 rounded-[12px] focus:border-white/30 outline-none">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-medium text-[rgba(235,235,245,0.60)] mb-1">🔎 ক্লোজ-আপ / ডিটেইল ছবি URL</label>
              <input type="url" id="studio_img_detail" placeholder="https://..." class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-mono p-2 rounded-[10px] focus:border-white/30 outline-none">
            </div>
            <div>
              <label class="block text-[11px] font-medium text-[rgba(235,235,245,0.60)] mb-1">📸 রিয়েল লাইট ছবি URL</label>
              <input type="url" id="studio_img_real" placeholder="https://..." class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-mono p-2 rounded-[10px] focus:border-white/30 outline-none">
            </div>
          </div>

          <!-- Photo Live Preview Box -->
          <div id="studioPhotoPreviewContainer" class="hidden bg-[#2C2C2E] p-2 rounded-[14px] border border-white/[0.06] flex items-center gap-3">
            <img id="studioPhotoPreviewImg" src="" alt="preview" class="w-14 h-16 object-cover rounded-[10px] border border-white/[0.1]">
            <div class="text-[11px] text-[rgba(235,235,245,0.60)]">
              <span>✅ ছবির প্রিভিউ পাওয়া গেছে।</span>
            </div>
          </div>
        </div>

        <button type="submit" id="studioSubmitBtn" class="w-full bg-white hover:bg-[#E5E5EA] text-black font-semibold text-xs py-3 rounded-[14px] transition cursor-pointer shadow-[0_2px_12px_rgba(255,255,255,0.12)] active:scale-98 mt-2">
          💾 প্রোডাক্ট সংরক্ষণ করুন
        </button>
      </form>

    </div>
  </div>

  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"></div>

  <script>
    const token = '${token}';
    let currentStockFilter = 'ALL';
    let currentOrderFilter = 'ALL';

    function showToast(msg, isSuccess = true) {
      const c = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = 'bg-[#1C1C1E] text-white border border-white/[0.12] text-xs font-medium px-4 py-3 rounded-[16px] shadow-[0_10px_30px_rgba(0,0,0,0.6)] pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2';
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
        b.className = 'tab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white';
      });
      const activeBtn = document.getElementById('tab-btn-' + tab);
      if (activeBtn) activeBtn.className = 'tab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]';
    }

    // Switch Card Photo
    function switchCardPhoto(prodId, url) {
      const img = document.getElementById('img-preview-' + prodId);
      if (img && url) img.src = url;
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

    // Open Modal for Add
    function openAddProductModal() {
      document.getElementById('modalTitle').innerText = '➕ নতুন প্রোডাক্ট যোগ করুন';
      document.getElementById('studio_prod_id').value = '';
      document.getElementById('productStudioForm').reset();
      document.getElementById('studioPhotoPreviewContainer').classList.add('hidden');
      document.getElementById('productStudioModal').classList.remove('hidden');
    }

    // Open Modal for Edit
    async function openEditProductModalById(id) {
      const card = document.querySelector('.prod-card[data-id="' + id + '"]');
      if (!card) return;

      document.getElementById('modalTitle').innerText = '✏️ প্রোডাক্ট এডিট করুন';
      document.getElementById('studio_prod_id').value = id;

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
          document.getElementById('studio_img_main').value = p.image_url || '';
          document.getElementById('studio_img_detail').value = p.detail_image_url || '';
          document.getElementById('studio_img_real').value = p.real_image_url || '';
          previewStudioPhoto(p.image_url);
        }
      } catch (e) {}

      document.getElementById('productStudioModal').classList.remove('hidden');
    }

    function closeProductStudioModal() {
      document.getElementById('productStudioModal').classList.add('hidden');
    }

    function previewStudioPhoto(url) {
      const c = document.getElementById('studioPhotoPreviewContainer');
      const img = document.getElementById('studioPhotoPreviewImg');
      if (url && url.startsWith('http')) {
        img.src = url;
        c.classList.remove('hidden');
      } else {
        c.classList.add('hidden');
      }
    }

    function setPresetSizes(sizes) {
      document.getElementById('studio_sizes').value = sizes;
    }

    // Handle Studio Submit (Add or Edit)
    async function handleProductStudioSubmit(e) {
      e.preventDefault();
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
        image_url: document.getElementById('studio_img_main').value.trim(),
        detail_image_url: document.getElementById('studio_img_detail').value.trim(),
        real_image_url: document.getElementById('studio_img_real').value.trim()
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

    // Delete Product
    async function deleteProductLive(id, code) {
      if (!confirm('আপনি কি নিশ্চিতভাবে [' + code + '] প্রোডাক্টটি মুছে ফেলতে চান?')) return;
      try {
        const res = await fetch('/api/portal/delete-product?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🗑️ প্রোডাক্ট মুছে ফেলা হয়েছে');
          setTimeout(() => window.location.reload(), 800);
        } else {
          showToast('❌ এরর: ' + data.error, false);
        }
      } catch (e) {
        showToast('❌ কানেকশন সমস্যা', false);
      }
    }

    // Filter Products
    function filterStock(type) {
      currentStockFilter = type;
      document.querySelectorAll('.stock-filter-btn').forEach(b => {
        b.className = 'stock-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer';
      });
      const active = type === 'ALL' ? 'filter-stock-all' : (type === 'IN_STOCK' ? 'filter-stock-instock' : 'filter-stock-out');
      const el = document.getElementById(active);
      if (el) el.className = 'stock-filter-btn px-3 py-1 rounded-[10px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer';
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
        b.className = 'order-filter-btn px-3 py-1 rounded-[10px] bg-transparent text-[rgba(235,235,245,0.60)] hover:text-white border border-transparent cursor-pointer';
      });
      const idMap = { 'ALL': 'filter-order-all', 'Pending': 'filter-order-pending', 'Approved': 'filter-order-approved', 'Shipped': 'filter-order-shipped', 'Cancelled': 'filter-order-cancelled' };
      const el = document.getElementById(idMap[status]);
      if (el) el.className = 'order-filter-btn px-3 py-1 rounded-[10px] bg-[#2C2C2E] text-white border border-white/[0.08] cursor-pointer';
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
        const res = await fetch('/api/portal/save-settings?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('💾 সেটিংস সফলভাবে সেভ হয়েছে!');
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

  // Add Product (Comprehensive Studio Engine)
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
      image_url,
      detail_image_url,
      real_image_url
    } = req.body;

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
      stock_quantity: parseInt(stock_quantity) || 1,
      sizes: sizes ? sizes.trim() : null,
      colors: colors ? colors.trim() : null,
      short_description: short_description ? short_description.trim() : null,
      image_url: image_url ? image_url.trim() : null,
      detail_image_url: detail_image_url ? detail_image_url.trim() : null,
      real_image_url: real_image_url ? real_image_url.trim() : null,
      in_stock: true
    }).select();

    if (error) return res.status(500).json({ error: error.message });
    await refreshProductsFromDB(inv.seller_id);
    return res.json({ success: true, product: data?.[0] });
  });

  // Edit Product (Comprehensive Studio Engine)
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
      image_url,
      detail_image_url,
      real_image_url
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
    if (image_url !== undefined) updateFields.image_url = image_url.trim();
    if (detail_image_url !== undefined) updateFields.detail_image_url = detail_image_url.trim();
    if (real_image_url !== undefined) updateFields.real_image_url = real_image_url.trim();

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

  // Save Settings
  router.post('/api/portal/save-settings', async (req, res) => {
    const token = req.query.token || req.body.token;
    const inv = await authenticateMerchantToken(token);
    if (!inv) return res.status(401).json({ error: 'Unauthorized token' });

    const { inside_dhaka_fee, outside_dhaka_fee, bkash_number, nagad_number, promo_offer, return_policy } = req.body;

    const { error } = await supabase
      .from('store_settings')
      .upsert({
        seller_id: inv.seller_id,
        inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(outside_dhaka_fee) || 150,
        bkash_number: bkash_number ? bkash_number.trim() : null,
        nagad_number: nagad_number ? nagad_number.trim() : null,
        promo_offer: promo_offer ? promo_offer.trim() : null,
        return_policy: return_policy ? return_policy.trim() : null
      });

    if (error) return res.status(500).json({ error: error.message });
    await refreshSettingsFromDB(inv.seller_id);
    return res.json({ success: true });
  });

  return router;
}

module.exports = { createMerchantPortalRouter };
