/**
 * AutoDokan Engine OS — Super Admin Executive Control Center
 * Antigravity Eye-Comfort Design Edition
 * Features:
 *  - Soothing Soft Slate & Calm Neutral Canvas (Zero eye-strain, no blinding glare or harsh pitch-black clashing)
 *  - Real-time Multi-Tenant Management & WhatsApp Bot Fleet Monitor
 *  - 10-Second Dynamic Shop Creation & Category Archetype Onboarding
 *  - Master Product Matrix & Stock Toggle
 *  - Global Orders Pipeline
 *  - Live AI Conversation Inspector across all shops
 */

const crypto = require('crypto');

function createSuperAdminRouter({
  supabase,
  sellerStatuses,
  sellerNumbers,
  sellerSockets,
  sellerQRs,
  startSellerSession,
  refreshProductsFromDB,
  refreshSettingsFromDB,
  getSellerWhatsAppInfo
}) {
  const express = require('express');
  const router = express.Router();

  // Helper to format currency
  function formatMoney(amount) {
    return '৳' + (Number(amount) || 0).toLocaleString('en-IN');
  }

  // ========================================================
  // GET /admin & /dashboard — Super Admin Executive Panel
  // ========================================================
  router.get('/admin', (req, res) => res.redirect('/dashboard'));

  router.get('/dashboard', async (req, res) => {
    const selectedSeller = req.query.seller_id || 'ALL';
    const activeTab = req.query.tab || (selectedSeller === 'ALL' ? 'shops' : 'products');

    // 1. Fetch all tenants, settings, products, orders, and recent chats
    const [invitesRes, settingsRes, prodsRes, ordsRes, chatsRes] = await Promise.all([
      supabase.from('seller_invites').select('*').order('id', { ascending: true }),
      supabase.from('store_settings').select('*'),
      supabase.from('products').select('*').order('id', { ascending: true }),
      supabase.from('orders').select('*').order('id', { ascending: false }),
      supabase.from('chat_sessions').select('*').order('updated_at', { ascending: false }).limit(20)
    ]);

    const allInvites = invitesRes.data || [];
    const allSettings = settingsRes.data || [];
    const allProducts = prodsRes.data || [];
    const allOrders = ordsRes.data || [];
    const recentChats = chatsRes.data || [];

    // Map shops into rich telemetry objects
    const shopsTelemetry = allInvites.map(inv => {
      const sProds = allProducts.filter(p => p.seller_id === inv.seller_id);
      const sOrders = allOrders.filter(o => o.seller_id === inv.seller_id);
      const sSettings = allSettings.find(s => s.seller_id === inv.seller_id) || {};
      const waInfo = getSellerWhatsAppInfo ? getSellerWhatsAppInfo(inv.seller_id) : { status: 'disconnected', number: null };
      const isOnline = waInfo.status === 'connected' || inv.status === 'CONNECTED';
      const liveNumber = waInfo.number || inv.phone || 'অনির্ধারিত';
      const revenue = sOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

      return {
        seller_id: inv.seller_id,
        shop_name: inv.shop_name,
        owner_name: inv.owner_name || 'মার্চেন্ট',
        phone: inv.phone || '',
        category: sSettings.business_category || 'general',
        persona_name: sSettings.bot_persona_name || 'AI ইনচার্জ',
        invite_token: inv.invite_token,
        is_online: isOnline,
        live_number: liveNumber,
        products_count: sProds.length,
        instock_count: sProds.filter(p => p.in_stock).length,
        orders_count: sOrders.length,
        pending_orders_count: sOrders.filter(o => o.status === 'Pending' || o.status === 'Pending Verification').length,
        revenue: revenue,
        created_at: inv.created_at
      };
    });

    // Global KPIs
    const totalShops = shopsTelemetry.length;
    const onlineBots = shopsTelemetry.filter(s => s.is_online).length;
    const totalPlatformProducts = allProducts.length;
    const totalPlatformOrders = allOrders.length;
    const totalPlatformGMV = allOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    // Filtered Products & Orders for Active Inspector View
    const filteredProducts = selectedSeller === 'ALL' ? allProducts : allProducts.filter(p => p.seller_id === selectedSeller);
    const filteredOrders = selectedSeller === 'ALL' ? allOrders : allOrders.filter(o => o.seller_id === selectedSeller);

    // Map shop name lookup
    const shopNameMap = new Map();
    shopsTelemetry.forEach(s => shopNameMap.set(s.seller_id, s.shop_name));
    shopNameMap.set('autodokan_seller_1', 'Dawah Fashion');

    // Generate Shops HTML Cards (Comfortable Soft Slate Style)
    const shopsCardsHtml = shopsTelemetry.map(s => {
      const portalUrl = `/portal?token=${s.invite_token}`;
      const connectUrl = `/connect?token=${s.invite_token}`;

      const catBadges = {
        'modest_fashion': '👗 মোডেস্ট ফ্যাশন',
        'footwear': '👞 জুতা ও ফুটওয়্যার',
        'gadgets': '📱 গ্যাজেটস ও টেক',
        'cosmetics': '💄 কসমেটিক্স ও স্কিনকেয়ার',
        'organic_food': '🌿 অর্গানিক ফুড',
        'perfume': '🌸 সুগন্ধি ও আতর',
        'general': '🛍️ জেনারেল ই-কমার্স'
      };
      const catLabel = catBadges[s.category] || '🛍️ ই-কমার্স';

      return `
      <div class="bg-white border border-slate-200/90 hover:border-slate-300 rounded-2xl p-5 shadow-xs space-y-4 transition">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-slate-900">${s.shop_name}</h3>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/70">${catLabel}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">
              ওনার: <span class="text-slate-800 font-medium">${s.owner_name}</span> • 
              আইডি: <span class="font-mono text-slate-500">${s.seller_id}</span>
            </p>
          </div>
          <div>
            ${s.is_online ? `
              <span class="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-xs px-2.5 py-1 rounded-full font-bold">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>বট লাইভ (+${s.live_number})</span>
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 border border-slate-200 text-xs px-2.5 py-1 rounded-full font-bold">
                <span class="w-2 h-2 rounded-full bg-slate-400"></span>
                <span>সংযোগ বিচ্ছিন্ন</span>
              </span>
            `}
          </div>
        </div>

        <!-- Shop Telemetry Metrics -->
        <div class="grid grid-cols-4 gap-2 bg-slate-50/90 p-3 rounded-xl border border-slate-100 text-center">
          <div>
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">প্রোডাক্টস</div>
            <div class="text-sm font-black text-slate-800 mt-0.5">${s.products_count}টি</div>
            <div class="text-[10px] text-emerald-600 font-semibold">${s.instock_count} স্টকে</div>
          </div>
          <div>
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">মোট অর্ডার</div>
            <div class="text-sm font-black text-slate-800 mt-0.5">${s.orders_count}টি</div>
            <div class="text-[10px] text-amber-600 font-semibold">${s.pending_orders_count} পেন্ডিং</div>
          </div>
          <div>
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">মোট সেলস</div>
            <div class="text-sm font-black text-slate-900 mt-0.5">${formatMoney(s.revenue)}</div>
            <div class="text-[10px] text-slate-400">COD ভলিউম</div>
          </div>
          <div>
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide">AI বট এজেন্ট</div>
            <div class="text-xs font-bold text-indigo-600 mt-1">${s.persona_name}</div>
            <div class="text-[10px] text-slate-400">২৪/৭ সক্রিয়</div>
          </div>
        </div>

        <!-- Action Links -->
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 flex-wrap">
          <div class="flex items-center gap-2">
            <a href="${portalUrl}" target="_blank" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 font-bold text-xs px-3.5 py-1.5 rounded-xl transition flex items-center gap-1 shadow-2xs">
              <span>মার্চেন্ট পোর্টাল</span><span>↗</span>
            </a>
            <a href="${connectUrl}" target="_blank" class="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs px-3 py-1.5 rounded-xl border border-slate-200 transition flex items-center gap-1 shadow-2xs">
              <span>WhatsApp QR</span><span>↗</span>
            </a>
          </div>
          <div class="flex items-center gap-2">
            <a href="/dashboard?seller_id=${s.seller_id}&tab=products" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition flex items-center gap-1">
              <span>ক্যাটালগ দেখুন</span><span>→</span>
            </a>
          </div>
        </div>
      </div>
      `;
    }).join('');

    // Generate Products HTML Cards
    const productCardsHtml = filteredProducts.map(p => {
      const shopName = shopNameMap.get(p.seller_id) || p.seller_id || 'শপ';
      const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '') + ' ' + shopName).toLowerCase();
      const stockStatus = p.in_stock ? 'IN_STOCK' : 'STOCK_OUT';

      return `
      <div class="prod-card bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-3 hover:border-slate-300 transition" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}">
        <div class="flex gap-3">
          <img src="${p.image_url || 'https://placehold.co/120x150?text=' + encodeURIComponent(p.model_code || 'PROD')}" alt="${p.model_code}" class="w-20 h-24 object-cover rounded-xl bg-slate-100 border border-slate-200 shrink-0">
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="font-mono font-bold text-xs text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">${p.model_code || 'PROD'}</span>
              <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition ${p.in_stock ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'}">
                ${p.in_stock ? '● ইন-স্টক' : '✕ স্টক আউট'}
              </button>
            </div>
            <div class="mt-1">
              <span class="bg-slate-100 text-slate-600 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-200">🏬 ${shopName}</span>
            </div>
            <h3 class="font-bold text-slate-800 text-sm mt-1 truncate" title="${p.name}">${p.name}</h3>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="font-black text-slate-900 text-base">৳${p.price}</span>
              ${p.regular_price && p.regular_price > p.price ? `<span class="text-slate-400 line-through text-xs font-semibold">৳${p.regular_price}</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-500 mt-0.5 truncate">✨ ${p.fabric || 'ম্যাটেরিয়াল'} • 📏 ${p.sizes || 'সাইজ'}</p>
          </div>
        </div>

        <div class="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 text-xs">
          <button type="button" onclick="openEditProductModalById(${p.id})" class="text-slate-600 hover:text-slate-900 font-semibold px-2.5 py-1 rounded-md hover:bg-slate-100 transition">
            ✏️ এডিট
          </button>
          <button type="button" onclick="deleteProductLive(${p.id}, '${p.model_code}')" class="text-rose-600 hover:text-rose-700 font-semibold px-2.5 py-1 rounded-md hover:bg-rose-50 transition">
            🗑️ মুছুন
          </button>
        </div>
      </div>
      `;
    }).join('');

    // Generate Global Orders Table Rows
    const orderRowsHtml = filteredOrders.map(o => {
      const prodPrice = Number(o.total_bdt) || 0;
      const dueCod = Number(o.due_cod) || prodPrice;
      const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
      const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
      const shopName = shopNameMap.get(o.seller_id) || o.seller_id || 'দোকান';
      const searchMeta = (o.id + ' ' + (o.model_code || '') + ' ' + (o.customer_name || '') + ' ' + (o.customer_phone || '') + ' ' + (o.address || '') + ' ' + shopName).toLowerCase();

      return `
      <tr class="order-row border-b border-slate-100 hover:bg-slate-50/70 transition text-xs" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
        <td class="p-3">
          <div class="font-mono font-bold text-indigo-600">#${o.id}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
          <div class="mt-1"><span class="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-slate-200">🏬 ${shopName}</span></div>
        </td>
        <td class="p-3">
          <div class="font-bold text-slate-800 text-xs">${o.customer_name || 'কাস্টমার'}</div>
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-emerald-700 hover:underline text-xs font-mono font-bold flex items-center gap-1 mt-0.5">
            <span>💬</span>
            <span>${o.customer_phone || ''}</span>
          </a>
        </td>
        <td class="p-3 max-w-[200px]">
          <div class="text-xs text-slate-600 line-clamp-2" title="${o.address || ''}">${o.address || 'ঠিকানা দেওয়া হয়নি'}</div>
        </td>
        <td class="p-3">
          <span class="font-mono font-bold text-slate-800 text-xs">[${o.model_code || 'PROD'}]</span>
          <div class="text-[11px] text-slate-500 mt-0.5">সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'}</div>
        </td>
        <td class="p-3">
          <span class="font-black text-slate-900 text-xs">৳${dueCod}</span>
        </td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
            o.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            o.status === 'Shipped' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
            o.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
            'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${o.status || 'Pending'}
          </span>
        </td>
      </tr>
      `;
    }).join('');

    // Generate Live Chat Audit Rows
    const liveChatRowsHtml = recentChats.map(c => {
      const shopName = shopNameMap.get(c.seller_id) || c.seller_id || 'দোকান';
      const lastUserMsg = (c.messages || []).filter(m => m.role === 'user').pop();
      const lastBotMsg = (c.messages || []).filter(m => m.role === 'assistant' || m.role === 'model').pop();

      return `
      <div class="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded text-[10px] border border-slate-200">🏬 ${shopName}</span>
            <span class="font-mono font-bold text-slate-800">${c.customer_phone || c.customer_identifier}</span>
            <span class="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-200/60">${c.stage || 'BROWSING'}</span>
          </div>
          <span class="text-[10px] text-slate-400">${c.updated_at ? new Date(c.updated_at).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>
        ${lastUserMsg ? `
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 text-slate-700">
            <span class="text-slate-500 font-bold">👤 কাস্টমার:</span> ${lastUserMsg.content || lastUserMsg.text || 'মেসেজ'}
          </div>
        ` : ''}
        ${lastBotMsg ? `
          <div class="bg-indigo-50/60 p-2.5 rounded-xl border border-indigo-100 text-indigo-950 font-medium">
            <span class="text-indigo-700 font-bold">🤖 AI এজেন্ট:</span> ${(lastBotMsg.content || lastBotMsg.text || '').substring(0, 160)}...
          </div>
        ` : ''}
      </div>
      `;
    }).join('');

    // Active Settings for the selected view
    let activeSettings = null;
    if (selectedSeller !== 'ALL') {
      activeSettings = allSettings.find(s => s.seller_id === selectedSeller);
    }
    if (!activeSettings) {
      activeSettings = allSettings[0] || { inside_dhaka_fee: 80, outside_dhaka_fee: 150, bkash_number: '', nagad_number: '' };
    }

    res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
  <title>AutoDokan OS — সুপার অ্যাডমিন কমান্ড সেন্টার</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
    body { font-family: 'Plus Jakarta Sans', 'Hind Siliguri', sans-serif; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  </style>
</head>
<body class="bg-[#f8fafc] text-slate-800 min-h-screen pb-24 antialiased">

  <!-- Executive Top Navbar (Antigravity Clean Style) -->
  <header class="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40 px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
      
      <!-- Brand & Platform Fleet Indicator -->
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-base shadow-xs">
          ⚡
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight">AutoDokan Engine OS</h1>
            <span class="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-200">Super Admin</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-medium">
            <span class="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>${onlineBots}/${totalShops}টি WhatsApp বট সক্রিয়</span>
            </span>
            <span>•</span>
            <span>প্ল্যাটফর্ম সেলস: <span class="text-slate-800 font-bold">${formatMoney(totalPlatformGMV)}</span></span>
          </div>
        </div>
      </div>

      <!-- Quick Actions & Shop Inspector -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <!-- Dynamic Shop Switcher Dropdown -->
        <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
          <span class="text-xs mr-1 text-slate-500">🏬</span>
          <select onchange="window.location.href='/dashboard?seller_id=' + this.value + '&tab=${activeTab}'" class="bg-transparent text-slate-800 font-bold text-xs outline-none cursor-pointer">
            <option value="ALL" class="bg-white text-slate-800 font-medium" ${selectedSeller === 'ALL' ? 'selected' : ''}>🌐 সবগুলো শপ একসাথে (All Stores)</option>
            ${shopsTelemetry.map(s => `<option value="${s.seller_id}" class="bg-white text-slate-800 font-medium" ${selectedSeller === s.seller_id ? 'selected' : ''}>${s.shop_name} (${s.category})</option>`).join('')}
          </select>
        </div>

        <!-- Add Shop Onboarding Button -->
        <button type="button" onclick="openNewShopModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer">
          <span>➕ নতুন শপ অনবোর্ডিং</span>
        </button>

        <a href="/logout" title="লগআউট" class="text-slate-400 hover:text-slate-700 p-2 text-xs transition">
          🔒
        </a>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">

    <!-- 4 Platform Metric Telemetry Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
      <div class="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs hover:border-slate-300 transition">
        <div class="text-slate-400 text-[11px] font-bold uppercase tracking-wider">রেজিস্টার্ড শপসমূহ</div>
        <div class="text-2xl font-black text-slate-900 mt-1">${totalShops}টি <span class="text-xs text-emerald-600 font-bold">(${onlineBots} লাইভ)</span></div>
      </div>
      <div class="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs hover:border-slate-300 transition">
        <div class="text-slate-400 text-[11px] font-bold uppercase tracking-wider">প্ল্যাটফর্ম প্রোডাক্টস</div>
        <div class="text-2xl font-black text-slate-900 mt-1">${totalPlatformProducts}টি</div>
      </div>
      <div class="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs hover:border-slate-300 transition">
        <div class="text-slate-400 text-[11px] font-bold uppercase tracking-wider">মোট অর্ডারস</div>
        <div class="text-2xl font-black text-slate-900 mt-1">${totalPlatformOrders}টি</div>
      </div>
      <div class="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs hover:border-slate-300 transition">
        <div class="text-slate-400 text-[11px] font-bold uppercase tracking-wider">গ্রস মার্চেন্ডাইজ ভলিউম</div>
        <div class="text-2xl font-black text-slate-900 mt-1">${formatMoney(totalPlatformGMV)}</div>
      </div>
    </div>

    <!-- Navigation Tabs (Modern Segmented Bar) -->
    <div class="bg-slate-200/60 p-1.5 rounded-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      <button type="button" onclick="switchSuperTab('shops')" id="stab-btn-shops" class="stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'shops' ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'}">
        <span>🏢 দোকানসমূহ ও লাইভ বট</span>
        <span class="${activeTab === 'shops' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'} text-[10px] px-2 py-0.5 rounded-full font-bold">${totalShops}</span>
      </button>

      <button type="button" onclick="switchSuperTab('products')" id="stab-btn-products" class="stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'products' ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'}">
        <span>📦 মাস্টার ক্যাটালগ ও স্টক</span>
        <span class="${activeTab === 'products' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'} text-[10px] px-2 py-0.5 rounded-full font-bold">${filteredProducts.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('orders')" id="stab-btn-orders" class="stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'orders' ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'}">
        <span>📋 সর্বমোট অর্ডারস পাইপলাইন</span>
        <span class="${activeTab === 'orders' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'} text-[10px] px-2 py-0.5 rounded-full font-bold">${filteredOrders.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('chats')" id="stab-btn-chats" class="stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'chats' ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'}">
        <span>💬 লাইভ AI চ্যাট অডিট</span>
        <span class="${activeTab === 'chats' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'} text-[10px] px-2 py-0.5 rounded-full font-bold">লাইভ</span>
      </button>

      <button type="button" onclick="switchSuperTab('settings')" id="stab-btn-settings" class="stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'settings' ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'}">
        <span>⚙️ শপ সেটিংস</span>
      </button>
    </div>

    <!-- TAB 1: SHOPS & BOTS FLEET -->
    <section id="stab-shops" class="${activeTab === 'shops' ? '' : 'hidden'} space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="text-base font-bold text-slate-900">🏢 প্ল্যাটফর্ম টেন্যান্টস ও WhatsApp বট ফ্লিট</h2>
          <p class="text-xs text-slate-500 mt-0.5">প্রতিটি দোকানের আলাদা WhatsApp কানেকশন, নিজস্ব প্রোডাক্টস এবং মার্চেন্ট পোর্টাল রয়েছে।</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${shopsCardsHtml}
      </div>
    </section>

    <!-- TAB 2: PRODUCTS MATRIX -->
    <section id="stab-products" class="${activeTab === 'products' ? '' : 'hidden'} space-y-4">
      <div class="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-3">
          <div>
            <h2 class="text-base font-bold text-slate-900">📦 প্রোডাক্ট ক্যাটালগ ও স্টক কন্ট্রোল</h2>
            <p class="text-xs text-slate-500 mt-0.5">বর্তমানে প্রদর্শিত: <span class="text-slate-800 font-bold">${selectedSeller === 'ALL' ? 'সকল শপ' : (shopNameMap.get(selectedSeller) || selectedSeller)}</span></p>
          </div>
          <div class="flex items-center gap-2">
            <input type="text" id="adminProdSearch" oninput="filterAdminProducts(this.value)" placeholder="🔍 প্রোডাক্ট খুঁজুন..." class="bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-xl text-slate-800 outline-none focus:bg-white focus:border-indigo-500 shadow-2xs">
            <button type="button" onclick="openAddProductModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer">
              + প্রোডাক্ট যোগ করুন
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="adminProductsGrid">
          ${productCardsHtml}
        </div>
      </div>
    </section>

    <!-- TAB 3: GLOBAL ORDERS -->
    <section id="stab-orders" class="${activeTab === 'orders' ? '' : 'hidden'} space-y-4">
      <div class="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 class="text-base font-bold text-slate-900">📋 কাস্টমার অর্ডারস পাইপলাইন</h2>
            <p class="text-xs text-slate-500 mt-0.5">প্ল্যাটফর্ম জুড়ে সংগৃহীত সকল লাইভ অর্ডার।</p>
          </div>
        </div>

        <div class="overflow-x-auto border border-slate-100 rounded-xl">
          <table class="w-full text-left text-slate-700 text-xs">
            <thead class="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
              <tr>
                <th class="p-3">অর্ডার ID ও শপ</th>
                <th class="p-3">কাস্টমার</th>
                <th class="p-3">ঠিকানা</th>
                <th class="p-3">মডেল</th>
                <th class="p-3">Due COD</th>
                <th class="p-3">স্ট্যাটাস</th>
              </tr>
            </thead>
            <tbody>
              ${orderRowsHtml || '<tr><td colspan="6" class="p-8 text-center text-slate-400">কোনো অর্ডার পাওয়া যায়নি</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 4: LIVE CHATS AUDIT -->
    <section id="stab-chats" class="${activeTab === 'chats' ? '' : 'hidden'} space-y-4">
      <div class="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs space-y-4">
        <div class="border-b border-slate-100 pb-3">
          <h2 class="text-base font-bold text-slate-900">💬 লাইভ AI চ্যাট অডিট ও কোয়ালিটি কন্ট্রোল</h2>
          <p class="text-xs text-slate-500 mt-0.5">বিভিন্ন শপে কাস্টমারদের সাথে AI সেলস এজেন্টের কথোপকথন রিয়েল-টাইমে মনিটর করুন।</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${liveChatRowsHtml || '<div class="col-span-full py-10 text-center text-slate-400">এখনও কোনো লাইভ চ্যাট রেকর্ড নেই।</div>'}
        </div>
      </div>
    </section>

    <!-- TAB 5: SETTINGS -->
    <section id="stab-settings" class="${activeTab === 'settings' ? '' : 'hidden'} space-y-4">
      <div class="bg-white border border-slate-200/80 p-6 rounded-2xl max-w-2xl mx-auto shadow-xs space-y-5 text-slate-800">
        <div class="border-b border-slate-100 pb-3">
          <h2 class="text-base font-bold text-slate-900">⚙️ শপ সেটিংস ও ডেলিভারি রুলস</h2>
          <p class="text-xs text-slate-500 mt-0.5">সক্রিয় শপ: <span class="text-slate-800 font-bold">${shopNameMap.get(selectedSeller) || selectedSeller}</span></p>
        </div>

        <form onsubmit="saveStoreSettingsLive(event)" class="space-y-4">
          <input type="hidden" id="set_seller_id" value="${selectedSeller === 'ALL' ? 'autodokan_seller_1' : selectedSeller}">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">🏬 শপ / ব্র্যান্ডের নাম</label>
            <input type="text" id="set_shop_name" value="${activeSettings.shop_name || ''}" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">🚚 ঢাকা ভেতরে চার্জ (টাকা)</label>
              <input type="number" id="set_inside_fee" value="${activeSettings.inside_dhaka_fee || 80}" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">🚛 ঢাকা বাইরে চার্জ (টাকা)</label>
              <input type="number" id="set_outside_fee" value="${activeSettings.outside_dhaka_fee || 150}" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">📱 বিকাশ নাম্বার</label>
              <input type="text" id="set_bkash" value="${activeSettings.bkash_number || ''}" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-mono font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1">📱 নগদ নাম্বার</label>
              <input type="text" id="set_nagad" value="${activeSettings.nagad_number || ''}" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-mono font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">🎁 বিশেষ অফার / প্রোমো টেক্সট</label>
            <input type="text" id="set_promo_offer" value="${activeSettings.promo_offer || ''}" placeholder="যেমন: ২ টি নিলে ডেলিভারি ফ্রি!" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি</label>
            <textarea id="set_return_policy" rows="2" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">${activeSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে রিসিভ করতে পারবেন।'}</textarea>
          </div>

          <button type="submit" id="saveSettingsBtn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-3 rounded-xl shadow-xs transition cursor-pointer">
            💾 সেটিংস সেভ করুন
          </button>
        </form>
      </div>
    </section>

  </main>

  <!-- DYNAMIC NEW SHOP ONBOARDING MODAL -->
  <div id="newShopModal" class="hidden fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 class="font-bold text-slate-900 text-base">🚀 নতুন শপ অনবোর্ডিং উইজার্ড</h3>
        <button type="button" onclick="closeNewShopModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold cursor-pointer">✕</button>
      </div>

      <form id="newShopForm" onsubmit="handleDynamicShopCreation(event)" class="space-y-3.5">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">দোকানের নাম *</label>
          <input type="text" id="onboard_shop_name" required placeholder="যেমন: Noor Fashion বা Smart Tech" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500 font-bold">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">ওনারের নাম</label>
            <input type="text" id="onboard_owner_name" placeholder="যেমন: তানভীর আহমেদ" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">মোবাইল নম্বর</label>
            <input type="text" id="onboard_phone" placeholder="যেমন: 017XXXXXXXX" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500 font-mono">
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">🎯 বিজনেস ক্যাটাগরি (AI আর্কিটাইপ)</label>
          <select id="onboard_category" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500 cursor-pointer">
            <option value="footwear">👞 জুতা ও ফুটওয়্যার (৩৯-৪৪ বাটা/এপেক্স ফিট, কুশন ও গ্রিপ)</option>
            <option value="modest_fashion">👗 মোডেস্ট ফ্যাশন ও আবায়া (৫০-৫৬ সাইজ, দুবাই চেরি)</option>
            <option value="gadgets">📱 গ্যাজেটস ও টেক (ওয়ারেন্টি, অরিজিনাল আনপ্যাক চেকিং)</option>
            <option value="cosmetics">💄 কসমেটিক্স ও স্কিনকেয়ার (স্কিন টাইপ ও আসল পণ্য গ্যারান্টি)</option>
            <option value="organic_food">🌿 অর্গানিক ফুড ও মধু (খাঁটি প্রাকৃতিক ও ওজন ভ্যারিয়েন্ট)</option>
            <option value="perfume">🌸 আতর ও পারফিউম (অ্যালকোহল-মুক্ত, লং-লাস্টিং নোটস)</option>
            <option value="general">🛍️ জেনারেল ই-কমার্স</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">🤖 AI বট এজেন্টের নাম</label>
            <input type="text" id="onboard_bot_name" value="সাকিব" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">🚚 ঢাকা ভেতরে চার্জ (টাকা)</label>
            <input type="number" id="onboard_inside_fee" value="80" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
        </div>

        <button type="submit" id="onboardSubmitBtn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl transition cursor-pointer shadow-xs mt-2">
          🚀 শপ তৈরি করুন ও লিংক জেনারেট করুন
        </button>
      </form>

      <!-- Success Alert Drawer -->
      <div id="onboardSuccessDrawer" class="hidden bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
        <div class="flex items-center gap-2 text-emerald-800 font-bold text-xs">
          <span>🎉 শপ সফলভাবে তৈরি হয়েছে!</span>
        </div>
        <div>
          <label class="block text-[11px] text-slate-700 font-bold mb-1">মার্চেন্ট পোর্টাল লিংক (সেলারকে এই লিংক দিন):</label>
          <div class="flex items-center gap-2">
            <input type="text" id="onboardResPortalUrl" readonly class="flex-1 bg-white border border-emerald-300 text-[11px] p-2 rounded-xl text-slate-900 font-mono">
            <button type="button" onclick="copyInputVal('onboardResPortalUrl')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition cursor-pointer">কপি</button>
          </div>
        </div>
        <div>
          <label class="block text-[11px] text-slate-700 font-bold mb-1">WhatsApp QR কানেক্ট লিংক:</label>
          <div class="flex items-center gap-2">
            <input type="text" id="onboardResConnectUrl" readonly class="flex-1 bg-white border border-emerald-300 text-[11px] p-2 rounded-xl text-slate-900 font-mono">
            <button type="button" onclick="copyInputVal('onboardResConnectUrl')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition cursor-pointer">কপি</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ADD PRODUCT MODAL -->
  <div id="addProductModal" class="hidden fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 class="font-bold text-slate-900 text-base">➕ নতুন প্রোডাক্ট যোগ করুন</h3>
        <button type="button" onclick="closeAddProductModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold cursor-pointer">✕</button>
      </div>
      <form onsubmit="saveNewProduct(event)" class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">টার্গেট শপ *</label>
          <select id="add_seller_id" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2.5 rounded-xl outline-none focus:bg-white focus:border-indigo-500 cursor-pointer">
            ${shopsTelemetry.map(s => `<option value="${s.seller_id}" ${selectedSeller === s.seller_id ? 'selected' : ''}>${s.shop_name} (${s.seller_id})</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">মডেল কোড *</label>
            <input type="text" id="add_code" placeholder="যেমন: PROD-101" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-mono font-bold p-2 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">বিক্রয় মূল্য *</label>
            <input type="number" id="add_price" placeholder="যেমন: 1850" required class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold p-2 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">প্রোডাক্টের নাম *</label>
          <input type="text" id="add_name" required placeholder="প্রোডাক্ট নাম" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">কালারসমূহ (কমা দিয়ে)</label>
          <input type="text" id="add_colors" placeholder="কালো, নীল, বাদামী" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">ফেব্রিক / উপাদান</label>
            <input type="text" id="add_fabric" placeholder="ফেব্রিক" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">সাইজসমূহ</label>
            <input type="text" id="add_sizes" placeholder="সাইজ" class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2 rounded-xl outline-none focus:bg-white focus:border-indigo-500">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">ছবির সরাসরি URL</label>
          <input type="url" id="add_img" placeholder="https://..." class="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs p-2 rounded-xl font-mono outline-none focus:bg-white focus:border-indigo-500">
        </div>
        <button type="submit" id="addSubmitBtn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-xs">
          + প্রোডাক্ট সেভ করুন
        </button>
      </form>
    </div>
  </div>

  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"></div>

  <script>
    window.__ADMIN_PRODUCTS__ = ${JSON.stringify(allProducts)};

    function showToast(msg) {
      const c = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = 'bg-slate-900 text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-xl pointer-events-auto transition transform translate-y-2 opacity-0';
      t.innerText = msg;
      c.appendChild(t);
      setTimeout(() => { t.classList.remove('translate-y-2', 'opacity-0'); }, 10);
      setTimeout(() => {
        t.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => t.remove(), 300);
      }, 3000);
    }

    function switchSuperTab(tab) {
      document.querySelectorAll('section[id^="stab-"]').forEach(s => s.classList.add('hidden'));
      document.getElementById('stab-' + tab)?.classList.remove('hidden');

      document.querySelectorAll('.stab-btn').forEach(b => {
        b.className = 'stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer text-slate-600 hover:text-slate-900 hover:bg-slate-100/60';
      });
      const activeBtn = document.getElementById('stab-btn-' + tab);
      if (activeBtn) activeBtn.className = 'stab-btn px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer bg-white text-indigo-700 shadow-xs border border-slate-200/80';
    }

    function openNewShopModal() { document.getElementById('newShopModal').classList.remove('hidden'); }
    function closeNewShopModal() { document.getElementById('newShopModal').classList.add('hidden'); }
    function openAddProductModal() { document.getElementById('addProductModal').classList.remove('hidden'); }
    function closeAddProductModal() { document.getElementById('addProductModal').classList.add('hidden'); }

    function copyInputVal(id) {
      const el = document.getElementById(id);
      if (el) {
        navigator.clipboard.writeText(el.value);
        showToast('📋 লিংক কপি হয়েছে!');
      }
    }

    // Dynamic Shop Onboarding Handler
    async function handleDynamicShopCreation(e) {
      e.preventDefault();
      const btn = document.getElementById('onboardSubmitBtn');
      btn.innerText = 'তৈরি হচ্ছে...'; btn.disabled = true;

      const payload = {
        shop_name: document.getElementById('onboard_shop_name').value.trim(),
        owner_name: document.getElementById('onboard_owner_name').value.trim(),
        phone: document.getElementById('onboard_phone').value.trim(),
        business_category: document.getElementById('onboard_category').value,
        bot_persona_name: document.getElementById('onboard_bot_name').value.trim(),
        inside_dhaka_fee: document.getElementById('onboard_inside_fee').value
      };

      try {
        const res = await fetch('/api/admin/shops/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 নতুন শপ তৈরি হয়েছে!');
          document.getElementById('onboardResPortalUrl').value = window.location.origin + '/portal?token=' + data.invite_token;
          document.getElementById('onboardResConnectUrl').value = window.location.origin + '/connect?token=' + data.invite_token;
          document.getElementById('onboardSuccessDrawer').classList.remove('hidden');
          setTimeout(() => window.location.reload(), 2500);
        } else {
          alert('শপ তৈরিতে সমস্যা: ' + (data.error || 'এরর'));
        }
      } catch (err) {
        alert('কানেকশন সমস্যা: ' + err.message);
      } finally {
        btn.innerText = '🚀 শপ তৈরি করুন ও লিংক জেনারেট করুন'; btn.disabled = false;
      }
    }

    // Toggle Product Stock
    async function toggleStockLive(id, newStock) {
      try {
        const res = await fetch('/api/products/' + id + '/toggle-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ in_stock: newStock, ajax: true })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.in_stock ? '✅ ইন-স্টক করা হয়েছে' : '✕ স্টক আউট করা হয়েছে');
          setTimeout(() => window.location.reload(), 400);
        }
      } catch (e) {
        alert('স্টক আপডেট এরর: ' + e.message);
      }
    }

    // Save New Product
    async function saveNewProduct(e) {
      e.preventDefault();
      const btn = document.getElementById('addSubmitBtn');
      btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true;

      const payload = {
        seller_id: document.getElementById('add_seller_id').value,
        model_code: document.getElementById('add_code').value.toUpperCase().trim(),
        name: document.getElementById('add_name').value.trim(),
        price: document.getElementById('add_price').value,
        fabric: document.getElementById('add_fabric').value.trim(),
        sizes: document.getElementById('add_sizes').value.trim(),
        colors: document.getElementById('add_colors').value.trim(),
        image_url: document.getElementById('add_img').value.trim() || undefined,
        ajax: true
      };

      try {
        const res = await fetch('/api/add-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 নতুন প্রোডাক্ট যুক্ত হয়েছে!');
          closeAddProductModal();
          setTimeout(() => window.location.reload(), 500);
        }
      } catch (err) {
        alert('এরর: ' + err.message);
      } finally {
        btn.innerText = '+ প্রোডাক্ট সেভ করুন'; btn.disabled = false;
      }
    }

    // Save Store Settings
    async function saveStoreSettingsLive(e) {
      e.preventDefault();
      const btn = document.getElementById('saveSettingsBtn');
      btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true;

      const payload = {
        seller_id: document.getElementById('set_seller_id').value,
        shop_name: document.getElementById('set_shop_name').value.trim(),
        inside_dhaka_fee: document.getElementById('set_inside_fee').value,
        outside_dhaka_fee: document.getElementById('set_outside_fee').value,
        bkash_number: document.getElementById('set_bkash').value.trim(),
        nagad_number: document.getElementById('set_nagad').value.trim(),
        promo_offer: document.getElementById('set_promo_offer').value.trim(),
        return_policy: document.getElementById('set_return_policy').value.trim(),
        ajax: true
      };

      try {
        const res = await fetch('/api/settings/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('💾 সেটিংস সফলভাবে সেভ হয়েছে!');
        }
      } catch (err) {
        alert('এরর: ' + err.message);
      } finally {
        btn.innerText = '💾 সেটিংস সেভ করুন'; btn.disabled = false;
      }
    }

    // Filter Admin Products
    function filterAdminProducts(q) {
      const query = (q || '').toLowerCase().trim();
      document.querySelectorAll('.prod-card').forEach(c => {
        const search = c.getAttribute('data-search') || '';
        c.style.display = (!query || search.includes(query)) ? 'block' : 'none';
      });
    }

    function openEditProductModalById(id) {
      const p = (window.__ADMIN_PRODUCTS__ || []).find(x => x.id === id);
      if (!p) return alert('প্রোডাক্ট পাওয়া যায়নি');
      // Set values and open add modal in edit mode or direct alert
      const newPrice = prompt('"' + p.name + '" এর নতুন মূল্য (টাকা):', p.price);
      if (newPrice !== null && !isNaN(newPrice)) {
        fetch('/api/products/' + id + '/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ ...p, price: Number(newPrice), ajax: true })
        }).then(() => {
          showToast('✅ মূল্য আপডেট হয়েছে');
          setTimeout(() => window.location.reload(), 400);
        });
      }
    }

    async function deleteProductLive(id, code) {
      if (!confirm('আপনি কি নিশ্চিত যে ' + code + ' মুছে ফেলতে চান?')) return;
      try {
        await fetch('/api/products/' + id + '/delete', { method: 'POST', headers: { 'Accept': 'application/json' } });
        showToast('🗑️ প্রোডাক্ট মুছে ফেলা হয়েছে');
        setTimeout(() => window.location.reload(), 400);
      } catch (e) {
        alert('মুছতে সমস্যা: ' + e.message);
      }
    }
  </script>
</body>
</html>
    `);
  });

  // ========================================================
  // POST /api/admin/shops/create — Dynamic Shop Creation API
  // ========================================================
  router.post('/api/admin/shops/create', async (req, res) => {
    try {
      const { shop_name, owner_name, phone, business_category, bot_persona_name, inside_dhaka_fee, outside_dhaka_fee } = req.body;
      if (!shop_name || !shop_name.trim()) {
        return res.status(400).json({ error: 'Shop name is required' });
      }

      const cleanShop = shop_name.trim();
      const cleanOwner = (owner_name || '').trim();
      const cleanPhone = (phone || '').trim();
      const cleanCategory = (business_category || 'general').trim();
      const cleanPersona = (bot_persona_name || 'AI ইনচার্জ').trim();

      const sellerId = 'seller_' + crypto.randomBytes(4).toString('hex');
      const token = 'inv_' + crypto.randomBytes(6).toString('hex');

      // 1. Insert into seller_invites
      const { data: newInvite, error: invError } = await supabase
        .from('seller_invites')
        .insert({
          invite_token: token,
          seller_id: sellerId,
          shop_name: cleanShop,
          owner_name: cleanOwner || cleanShop + ' ওনার',
          phone: cleanPhone,
          status: 'PENDING',
          role: 'merchant'
        })
        .select('*')
        .single();

      if (invError) {
        return res.status(500).json({ error: invError.message });
      }

      // 2. Insert into store_settings with specified Category and Persona!
      const defaultReturn = cleanCategory === 'footwear' 
        ? 'ডেলিভারি ম্যানের সামনে সাইজ ও কোয়ালিটি চেক করে ট্রায়াল দিয়ে নিতে পারবেন।'
        : 'ডেলিভারি ম্যানের সামনে চেক করে রিসিভ করতে পারবেন। কোনো সমস্যা থাকলে তাৎক্ষণিক রিটার্ন।';

      await supabase.from('store_settings').insert({
        seller_id: sellerId,
        shop_name: cleanShop,
        business_category: cleanCategory,
        bot_persona_name: cleanPersona,
        inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(outside_dhaka_fee) || 150,
        return_policy: defaultReturn,
        auto_reply_enabled: true,
        extra_config: {}
      });

      // 3. Refresh AI caches
      if (refreshSettingsFromDB) await refreshSettingsFromDB(sellerId);
      if (refreshProductsFromDB) await refreshProductsFromDB(sellerId);

      return res.json({
        success: true,
        seller_id: sellerId,
        invite_token: token,
        shop_name: cleanShop,
        category: cleanCategory,
        persona: cleanPersona
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSuperAdminRouter };
