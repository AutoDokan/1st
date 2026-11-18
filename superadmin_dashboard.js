/**
 * AutoDokan Engine OS — Super Admin Executive Control Center
 * Antigravity Deep-Comfort Palette (Zero Eye-Strain Dark Edition)
 * Platform Management Architecture:
 *  - Super Admin is purely for Platform & Tenant Administration (Zero product selling)
 *  - Merchants manage their own inventory & pricing inside their isolated /portal
 *  - Deep Calming Slate Theme (#0d1117 / #161b22 / #30363d) — scientifically optimized for eye comfort
 *  - Real-time Multi-Tenant Management & WhatsApp Bot Fleet Monitor
 *  - 10-Second Dynamic Shop Creation & Category Archetype Onboarding
 *  - Platform Global Orders Pipeline
 *  - Live AI Conversation Inspector & System Telemetry
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
    const activeTab = req.query.tab || 'shops';

    // 1. Fetch all tenants, settings, products count, orders, and recent chats
    const [invitesRes, settingsRes, prodsRes, ordsRes, chatsRes] = await Promise.all([
      supabase.from('seller_invites').select('*').order('id', { ascending: true }),
      supabase.from('store_settings').select('*'),
      supabase.from('products').select('id, seller_id, in_stock'),
      supabase.from('orders').select('*').order('id', { ascending: false }),
      supabase.from('chat_sessions').select('*').order('updated_at', { ascending: false }).limit(25)
    ]);

    const allInvites = invitesRes.data || [];
    const allSettings = settingsRes.data || [];
    const allProducts = prodsRes.data || [];
    const allOrders = ordsRes.data || [];
    const recentChats = chatsRes.data || [];

    // Map shops into rich platform telemetry objects
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

    // Global Platform Metrics
    const totalShops = shopsTelemetry.length;
    const onlineBots = shopsTelemetry.filter(s => s.is_online).length;
    const totalPlatformProducts = allProducts.length;
    const totalPlatformOrders = allOrders.length;
    const totalPlatformGMV = allOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

    // Filtered Orders for Active Inspector View
    const filteredOrders = selectedSeller === 'ALL' ? allOrders : allOrders.filter(o => o.seller_id === selectedSeller);
    const filteredChats = selectedSeller === 'ALL' ? recentChats : recentChats.filter(c => c.seller_id === selectedSeller);

    // Map shop name lookup
    const shopNameMap = new Map();
    shopsTelemetry.forEach(s => shopNameMap.set(s.seller_id, s.shop_name));
    shopNameMap.set('autodokan_seller_1', 'Dawah Fashion');

    // Generate Shops HTML Cards (Deep Eye-Comfort Antigravity Theme)
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
      <div class="bg-[#161b22] border border-[#30363d] hover:border-[#484f58] rounded-2xl p-5 shadow-sm space-y-4 transition">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-[#e6edf3]">${s.shop_name}</h3>
              <span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#21262d] text-[#8b949e] border border-[#30363d]">${catLabel}</span>
            </div>
            <p class="text-xs text-[#8b949e] mt-1">
              মালিক: <span class="text-[#c9d1d9] font-medium">${s.owner_name}</span> • 
              আইডি: <span class="font-mono text-[#8b949e]">${s.seller_id}</span>
            </p>
          </div>
          <div>
            ${s.is_online ? `
              <span class="inline-flex items-center gap-1.5 bg-[#1f3724] text-[#3fb950] border border-[#238636] text-xs px-2.5 py-1 rounded-full font-semibold">
                <span class="w-2 h-2 rounded-full bg-[#3fb950]"></span>
                <span>বট লাইভ (+${s.live_number})</span>
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 bg-[#21262d] text-[#8b949e] border border-[#30363d] text-xs px-2.5 py-1 rounded-full font-semibold">
                <span class="w-2 h-2 rounded-full bg-[#484f58]"></span>
                <span>সংযোগ অপেক্ষমাণ</span>
              </span>
            `}
          </div>
        </div>

        <!-- Shop Telemetry Metrics (Inventory managed by seller) -->
        <div class="grid grid-cols-4 gap-2 bg-[#0d1117] p-3 rounded-xl border border-[#21262d] text-center">
          <div>
            <div class="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider">ইনভেন্টরি</div>
            <div class="text-sm font-bold text-[#e6edf3] mt-0.5">${s.products_count}টি</div>
            <div class="text-[10px] text-[#3fb950]">${s.instock_count} স্টকে</div>
          </div>
          <div>
            <div class="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider">মোট অর্ডার</div>
            <div class="text-sm font-bold text-[#e6edf3] mt-0.5">${s.orders_count}টি</div>
            <div class="text-[10px] text-[#d29922]">${s.pending_orders_count} পেন্ডিং</div>
          </div>
          <div>
            <div class="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider">প্ল্যাটফর্ম সেলস</div>
            <div class="text-sm font-bold text-[#58a6ff] mt-0.5">${formatMoney(s.revenue)}</div>
            <div class="text-[10px] text-[#8b949e]">COD ভলিউম</div>
          </div>
          <div>
            <div class="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider">AI বট এজেন্ট</div>
            <div class="text-xs font-bold text-[#a371f7] mt-1">${s.persona_name}</div>
            <div class="text-[10px] text-[#8b949e]">স্বয়ংক্রিয় সেলস</div>
          </div>
        </div>

        <!-- Action Links (Merchant manages own stock in portal) -->
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#21262d] flex-wrap">
          <div class="flex items-center gap-2">
            <a href="${portalUrl}" target="_blank" class="bg-[#1f2937] hover:bg-[#374151] text-[#e6edf3] border border-[#374151] font-semibold text-xs px-3.5 py-1.5 rounded-xl transition flex items-center gap-1 shadow-sm">
              <span>মার্চেন্ট পোর্টাল (ইনভেন্টরি ও সেলস)</span><span>↗</span>
            </a>
            <a href="${connectUrl}" target="_blank" class="bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] font-medium text-xs px-3 py-1.5 rounded-xl border border-[#30363d] transition flex items-center gap-1">
              <span>WhatsApp QR লিংক</span><span>↗</span>
            </a>
          </div>
          <div class="flex items-center gap-2">
            <a href="/dashboard?seller_id=${s.seller_id}&tab=orders" class="text-[#58a6ff] hover:underline text-xs font-semibold px-2 py-1 transition flex items-center gap-1">
              <span>অর্ডারস দেখুন</span><span>→</span>
            </a>
          </div>
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
      <tr class="order-row border-b border-[#21262d] hover:bg-[#1f242c] transition text-xs" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
        <td class="p-3">
          <div class="font-mono font-bold text-[#58a6ff]">#${o.id}</div>
          <div class="text-[10px] text-[#8b949e] mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
          <div class="mt-1"><span class="bg-[#21262d] text-[#8b949e] text-[9px] font-medium px-1.5 py-0.5 rounded border border-[#30363d]">🏬 ${shopName}</span></div>
        </td>
        <td class="p-3">
          <div class="font-semibold text-[#e6edf3] text-xs">${o.customer_name || 'কাস্টমার'}</div>
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-[#3fb950] hover:underline text-xs font-mono font-medium flex items-center gap-1 mt-0.5">
            <span>💬</span>
            <span>${o.customer_phone || ''}</span>
          </a>
        </td>
        <td class="p-3 max-w-[200px]">
          <div class="text-xs text-[#8b949e] line-clamp-2" title="${o.address || ''}">${o.address || 'ঠিকানা দেওয়া হয়নি'}</div>
        </td>
        <td class="p-3">
          <span class="font-mono font-medium text-[#c9d1d9] text-xs">[${o.model_code || 'PROD'}]</span>
          <div class="text-[11px] text-[#8b949e] mt-0.5">সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'}</div>
        </td>
        <td class="p-3">
          <span class="font-bold text-[#e6edf3] text-xs">৳${dueCod}</span>
        </td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            o.status === 'Approved' ? 'bg-[#1f3724] text-[#3fb950] border border-[#238636]' :
            o.status === 'Shipped' ? 'bg-[#1c2d42] text-[#58a6ff] border border-[#1f6feb]' :
            o.status === 'Cancelled' ? 'bg-[#3d1f24] text-[#f85149] border border-[#da3633]' :
            'bg-[#342718] text-[#d29922] border border-[#9e6a03]'
          }">
            ${o.status || 'Pending'}
          </span>
        </td>
      </tr>
      `;
    }).join('');

    // Generate Live Chat Audit Rows
    const liveChatRowsHtml = filteredChats.map(c => {
      const shopName = shopNameMap.get(c.seller_id) || c.seller_id || 'দোকান';
      const lastUserMsg = (c.messages || []).filter(m => m.role === 'user').pop();
      const lastBotMsg = (c.messages || []).filter(m => m.role === 'assistant' || m.role === 'model').pop();

      return `
      <div class="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 shadow-sm space-y-2.5 text-xs">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="bg-[#21262d] text-[#c9d1d9] font-medium px-2 py-0.5 rounded text-[10px] border border-[#30363d]">🏬 ${shopName}</span>
            <span class="font-mono font-semibold text-[#e6edf3]">${c.customer_phone || c.customer_identifier}</span>
            <span class="bg-[#1c2d42] text-[#58a6ff] text-[10px] font-medium px-2 py-0.5 rounded border border-[#1f6feb]/40">${c.stage || 'BROWSING'}</span>
          </div>
          <span class="text-[10px] text-[#8b949e]">${c.updated_at ? new Date(c.updated_at).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>
        ${lastUserMsg ? `
          <div class="bg-[#0d1117] p-2.5 rounded-xl border border-[#21262d] text-[#c9d1d9]">
            <span class="text-[#8b949e] font-semibold">👤 ক্রেতা:</span> ${lastUserMsg.content || lastUserMsg.text || 'মেসেজ'}
          </div>
        ` : ''}
        ${lastBotMsg ? `
          <div class="bg-[#1a2332] p-2.5 rounded-xl border border-[#234165] text-[#e6edf3] font-medium">
            <span class="text-[#58a6ff] font-semibold">🤖 AI এজেন্ট:</span> ${(lastBotMsg.content || lastBotMsg.text || '').substring(0, 160)}...
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
  <title>AutoDokan Engine OS — সুপার অ্যাডমিন প্ল্যাটফর্ম কন্ট্রোল</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
    body { font-family: 'Plus Jakarta Sans', 'Hind Siliguri', sans-serif; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  </style>
</head>
<body class="bg-[#0d1117] text-[#c9d1d9] min-h-screen pb-24 antialiased selection:bg-[#1f6feb] selection:text-white">

  <!-- Executive Top Navbar (Antigravity Deep Calm Style) -->
  <header class="bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40 px-4 py-3 shadow-sm">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
      
      <!-- Brand & Platform Fleet Indicator -->
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-[#21262d] border border-[#30363d] text-[#58a6ff] flex items-center justify-center font-bold text-base shadow-sm">
          ⚡
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="font-bold text-sm sm:text-base text-[#e6edf3] tracking-tight">AutoDokan Engine OS</h1>
            <span class="bg-[#21262d] text-[#58a6ff] text-[10px] font-semibold px-2 py-0.5 rounded-md border border-[#30363d]">SaaS Platform Admin</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-xs text-[#8b949e]">
            <span class="inline-flex items-center gap-1.5 text-[#3fb950] font-medium">
              <span class="w-2 h-2 rounded-full bg-[#3fb950]"></span>
              <span>${onlineBots}/${totalShops}টি WhatsApp বট সক্রিয়</span>
            </span>
            <span>•</span>
            <span>প্ল্যাটফর্ম GMV: <span class="text-[#e6edf3] font-semibold">${formatMoney(totalPlatformGMV)}</span></span>
          </div>
        </div>
      </div>

      <!-- Quick Actions & Shop Inspector -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <!-- Dynamic Shop Switcher Dropdown -->
        <div class="flex items-center bg-[#0d1117] border border-[#30363d] rounded-xl px-2.5 py-1.5">
          <span class="text-xs mr-1 text-[#8b949e]">🏬</span>
          <select onchange="window.location.href='/dashboard?seller_id=' + this.value + '&tab=${activeTab}'" class="bg-transparent text-[#e6edf3] font-medium text-xs outline-none cursor-pointer">
            <option value="ALL" class="bg-[#161b22] text-[#e6edf3]" ${selectedSeller === 'ALL' ? 'selected' : ''}>🌐 সবগুলো শপ একসাথে (All Stores)</option>
            ${shopsTelemetry.map(s => `<option value="${s.seller_id}" class="bg-[#161b22] text-[#e6edf3]" ${selectedSeller === s.seller_id ? 'selected' : ''}>${s.shop_name} (${s.category})</option>`).join('')}
          </select>
        </div>

        <!-- Add Shop Onboarding Button -->
        <button type="button" onclick="openNewShopModal()" class="bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-xs px-3.5 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer">
          <span>➕ নতুন শপ অনবোর্ডিং</span>
        </button>

        <a href="/logout" title="লগআউট" class="text-[#8b949e] hover:text-[#e6edf3] p-2 text-xs transition">
          🔒
        </a>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">

    <!-- 4 Platform Metric Telemetry Cards (Comfort Slate) -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-2xl shadow-sm">
        <div class="text-[#8b949e] text-[11px] font-semibold uppercase tracking-wider">রেজিস্টার্ড টেন্যান্ট শপ</div>
        <div class="text-2xl font-bold text-[#e6edf3] mt-1">${totalShops}টি <span class="text-xs text-[#3fb950] font-medium">(${onlineBots} লাইভ)</span></div>
      </div>
      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-2xl shadow-sm">
        <div class="text-[#8b949e] text-[11px] font-semibold uppercase tracking-wider">মার্চেন্ট ইনভেন্টরি ভলিউম</div>
        <div class="text-2xl font-bold text-[#e6edf3] mt-1">${totalPlatformProducts}টি পণ্য</div>
      </div>
      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-2xl shadow-sm">
        <div class="text-[#8b949e] text-[11px] font-semibold uppercase tracking-wider">প্ল্যাটফর্ম মোট অর্ডারস</div>
        <div class="text-2xl font-bold text-[#e6edf3] mt-1">${totalPlatformOrders}টি</div>
      </div>
      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-2xl shadow-sm">
        <div class="text-[#8b949e] text-[11px] font-semibold uppercase tracking-wider">গ্রস মার্চেন্ডাইজ ভলিউম</div>
        <div class="text-2xl font-bold text-[#58a6ff] mt-1">${formatMoney(totalPlatformGMV)}</div>
      </div>
    </div>

    <!-- Navigation Tabs (SaaS Admin Focused: No Product Selling in Admin) -->
    <div class="bg-[#161b22] border border-[#30363d] p-1.5 rounded-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      <button type="button" onclick="switchSuperTab('shops')" id="stab-btn-shops" class="stab-btn px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'shops' ? 'bg-[#21262d] text-[#e6edf3] border border-[#30363d] shadow-sm' : 'text-[#8b949e] hover:text-[#e6edf3]'}">
        <span>🏢 মার্চেন্ট শপসমূহ ও বট ফ্লিট</span>
        <span class="${activeTab === 'shops' ? 'bg-[#30363d] text-[#58a6ff]' : 'bg-[#21262d] text-[#8b949e]'} text-[10px] px-2 py-0.5 rounded-full font-bold">${totalShops}</span>
      </button>

      <button type="button" onclick="switchSuperTab('orders')" id="stab-btn-orders" class="stab-btn px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'orders' ? 'bg-[#21262d] text-[#e6edf3] border border-[#30363d] shadow-sm' : 'text-[#8b949e] hover:text-[#e6edf3]'}">
        <span>📋 প্ল্যাটফর্ম অর্ডারস পাইপলাইন</span>
        <span class="${activeTab === 'orders' ? 'bg-[#30363d] text-[#58a6ff]' : 'bg-[#21262d] text-[#8b949e]'} text-[10px] px-2 py-0.5 rounded-full font-bold">${filteredOrders.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('chats')" id="stab-btn-chats" class="stab-btn px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'chats' ? 'bg-[#21262d] text-[#e6edf3] border border-[#30363d] shadow-sm' : 'text-[#8b949e] hover:text-[#e6edf3]'}">
        <span>💬 লাইভ AI চ্যাট অডিট</span>
        <span class="${activeTab === 'chats' ? 'bg-[#30363d] text-[#3fb950]' : 'bg-[#21262d] text-[#8b949e]'} text-[10px] px-2 py-0.5 rounded-full font-bold">লাইভ</span>
      </button>

      <button type="button" onclick="switchSuperTab('settings')" id="stab-btn-settings" class="stab-btn px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'settings' ? 'bg-[#21262d] text-[#e6edf3] border border-[#30363d] shadow-sm' : 'text-[#8b949e] hover:text-[#e6edf3]'}">
        <span>⚙️ স্টোর কনফিগারেশন</span>
      </button>
    </div>

    <!-- TAB 1: SHOPS & BOTS FLEET -->
    <section id="stab-shops" class="${activeTab === 'shops' ? '' : 'hidden'} space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="text-base font-bold text-[#e6edf3]">🏢 প্ল্যাটফর্ম টেন্যান্টস ও WhatsApp বট ফ্লিট</h2>
          <p class="text-xs text-[#8b949e] mt-0.5">অ্যাডমিন প্ল্যাটফর্মের সেন্ট্রাল হাব। প্রতিটি মার্চেন্ট তাদের নিজস্ব ডেডিকেটেড পোর্টালে তাদের পণ্য ও অর্ডার স্বাধীনভাবে পরিচালনা করে।</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${shopsCardsHtml}
      </div>
    </section>

    <!-- TAB 2: GLOBAL ORDERS PIPELINE -->
    <section id="stab-orders" class="${activeTab === 'orders' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#161b22] border border-[#30363d] p-5 rounded-2xl shadow-sm space-y-4">
        <div class="flex items-center justify-between border-b border-[#21262d] pb-3 flex-wrap gap-2">
          <div>
            <h2 class="text-base font-bold text-[#e6edf3]">📋 প্ল্যাটফর্ম অর্ডারস ও ট্রানজেকশন পাইপলাইন</h2>
            <p class="text-xs text-[#8b949e] mt-0.5">সকল মার্চেন্টের গ্রাহকদের থেকে তৈরি হওয়া রিয়েল-টাইম অর্ডার স্ট্রিম।</p>
          </div>
          <div class="text-xs text-[#8b949e]">
            ফিল্টার: <span class="text-[#58a6ff] font-medium">${selectedSeller === 'ALL' ? 'সকল শপ' : (shopNameMap.get(selectedSeller) || selectedSeller)}</span>
          </div>
        </div>

        <div class="overflow-x-auto border border-[#30363d] rounded-xl">
          <table class="w-full text-left text-[#c9d1d9] text-xs">
            <thead class="bg-[#0d1117] text-[#8b949e] font-semibold border-b border-[#30363d]">
              <tr>
                <th class="p-3">অর্ডার ID ও শপ</th>
                <th class="p-3">কাস্টমার</th>
                <th class="p-3">ঠিকানা</th>
                <th class="p-3">পণ্য / মডেল</th>
                <th class="p-3">Due COD</th>
                <th class="p-3">স্ট্যাটাস</th>
              </tr>
            </thead>
            <tbody>
              ${orderRowsHtml || '<tr><td colspan="6" class="p-8 text-center text-[#8b949e]">কোনো অর্ডার পাওয়া যায়নি</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 3: LIVE CHATS AUDIT -->
    <section id="stab-chats" class="${activeTab === 'chats' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#161b22] border border-[#30363d] p-5 rounded-2xl shadow-sm space-y-4">
        <div class="border-b border-[#21262d] pb-3">
          <h2 class="text-base font-bold text-[#e6edf3]">💬 লাইভ AI চ্যাট অডিট ও কোয়ালিটি কন্ট্রোল</h2>
          <p class="text-xs text-[#8b949e] mt-0.5">বিভিন্ন মার্চেন্ট শপে কাস্টমারদের সাথে AI সেলস এজেন্টের কথোপকথন রিয়েল-টাইমে পর্যবেক্ষণ করুন।</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${liveChatRowsHtml || '<div class="col-span-full py-10 text-center text-[#8b949e]">এখনও কোনো লাইভ চ্যাট রেকর্ড নেই।</div>'}
        </div>
      </div>
    </section>

    <!-- TAB 4: SETTINGS -->
    <section id="stab-settings" class="${activeTab === 'settings' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#161b22] border border-[#30363d] p-6 rounded-2xl max-w-2xl mx-auto shadow-sm space-y-5 text-[#c9d1d9]">
        <div class="border-b border-[#21262d] pb-3">
          <h2 class="text-base font-bold text-[#e6edf3]">⚙️ শপ পলিসি ও ডেলিভারি রুলস</h2>
          <p class="text-xs text-[#8b949e] mt-0.5">সক্রিয় শপ: <span class="text-[#58a6ff] font-medium">${shopNameMap.get(selectedSeller) || selectedSeller}</span></p>
        </div>

        <form onsubmit="saveStoreSettingsLive(event)" class="space-y-4">
          <input type="hidden" id="set_seller_id" value="${selectedSeller === 'ALL' ? 'autodokan_seller_1' : selectedSeller}">
          <div>
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">🏬 শপ / ব্র্যান্ডের নাম</label>
            <input type="text" id="set_shop_name" value="${activeSettings.shop_name || ''}" required class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#8b949e] mb-1">🚚 ঢাকা ভেতরে চার্জ (টাকা)</label>
              <input type="number" id="set_inside_fee" value="${activeSettings.inside_dhaka_fee || 80}" required class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#8b949e] mb-1">🚛 ঢাকা বাইরে চার্জ (টাকা)</label>
              <input type="number" id="set_outside_fee" value="${activeSettings.outside_dhaka_fee || 150}" required class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-[#8b949e] mb-1">📱 বিকাশ নাম্বার</label>
              <input type="text" id="set_bkash" value="${activeSettings.bkash_number || ''}" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-mono font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
            </div>
            <div>
              <label class="block text-xs font-semibold text-[#8b949e] mb-1">📱 নগদ নাম্বার</label>
              <input type="text" id="set_nagad" value="${activeSettings.nagad_number || ''}" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-mono font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">🎁 বিশেষ অফার / প্রোমো টেক্সট</label>
            <input type="text" id="set_promo_offer" value="${activeSettings.promo_offer || ''}" placeholder="যেমন: ২ টি নিলে ডেলিভারি ফ্রি!" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
          </div>

          <div>
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি</label>
            <textarea id="set_return_policy" rows="2" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">${activeSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে রিসিভ করতে পারবেন।'}</textarea>
          </div>

          <button type="submit" id="saveSettingsBtn" class="w-full bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold py-3 rounded-xl shadow-sm transition cursor-pointer">
            💾 সেটিংস সেভ করুন
          </button>
        </form>
      </div>
    </section>

  </main>

  <!-- DYNAMIC NEW SHOP ONBOARDING MODAL -->
  <div id="newShopModal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-[#161b22] border border-[#30363d] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-[#21262d] pb-3">
        <h3 class="font-bold text-[#e6edf3] text-base">🚀 নতুন শপ অনবোর্ডিং উইজার্ড</h3>
        <button type="button" onclick="closeNewShopModal()" class="w-8 h-8 rounded-full bg-[#21262d] hover:bg-[#30363d] flex items-center justify-center text-[#8b949e] hover:text-[#e6edf3] font-bold cursor-pointer">✕</button>
      </div>

      <form id="newShopForm" onsubmit="handleDynamicShopCreation(event)" class="space-y-3.5">
        <div>
          <label class="block text-xs font-semibold text-[#8b949e] mb-1">দোকানের নাম *</label>
          <input type="text" id="onboard_shop_name" required placeholder="যেমন: Noor Fashion বা Smart Tech" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs p-2.5 rounded-xl outline-none focus:border-[#58a6ff] font-medium">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">ওনারের নাম</label>
            <input type="text" id="onboard_owner_name" placeholder="যেমন: তানভীর আহমেদ" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">মোবাইল নম্বর</label>
            <input type="text" id="onboard_phone" placeholder="যেমন: 017XXXXXXXX" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs p-2.5 rounded-xl outline-none focus:border-[#58a6ff] font-mono">
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#8b949e] mb-1">🎯 বিজনেস ক্যাটাগরি (AI আর্কিটাইপ)</label>
          <select id="onboard_category" required class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff] cursor-pointer">
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
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">🤖 AI বট এজেন্টের নাম</label>
            <input type="text" id="onboard_bot_name" value="সাকিব" required class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
          </div>
          <div>
            <label class="block text-xs font-semibold text-[#8b949e] mb-1">🚚 ঢাকা ভেতরে চার্জ (টাকা)</label>
            <input type="number" id="onboard_inside_fee" value="80" class="w-full bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-xs font-medium p-2.5 rounded-xl outline-none focus:border-[#58a6ff]">
          </div>
        </div>

        <button type="submit" id="onboardSubmitBtn" class="w-full bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-xs py-3 rounded-xl transition cursor-pointer shadow-sm mt-2">
          🚀 শপ তৈরি করুন ও লিংক জেনারেট করুন
        </button>
      </form>

      <!-- Success Alert Drawer -->
      <div id="onboardSuccessDrawer" class="hidden bg-[#1f3724] border border-[#238636] rounded-2xl p-4 space-y-3">
        <div class="flex items-center gap-2 text-[#3fb950] font-bold text-xs">
          <span>🎉 শপ সফলভাবে তৈরি হয়েছে!</span>
        </div>
        <div>
          <label class="block text-[11px] text-[#8b949e] font-medium mb-1">মার্চেন্ট পোর্টাল লিংক (সেলারকে এই লিংক দিন):</label>
          <div class="flex items-center gap-2">
            <input type="text" id="onboardResPortalUrl" readonly class="flex-1 bg-[#0d1117] border border-[#238636]/50 text-[11px] p-2 rounded-xl text-[#e6edf3] font-mono">
            <button type="button" onclick="copyInputVal('onboardResPortalUrl')" class="bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-xs px-3 py-2 rounded-xl transition cursor-pointer">কপি</button>
          </div>
        </div>
        <div>
          <label class="block text-[11px] text-[#8b949e] font-medium mb-1">WhatsApp QR কানেক্ট লিংক:</label>
          <div class="flex items-center gap-2">
            <input type="text" id="onboardResConnectUrl" readonly class="flex-1 bg-[#0d1117] border border-[#238636]/50 text-[11px] p-2 rounded-xl text-[#e6edf3] font-mono">
            <button type="button" onclick="copyInputVal('onboardResConnectUrl')" class="bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-xs px-3 py-2 rounded-xl transition cursor-pointer">কপি</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toastContainer" class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"></div>

  <script>
    function showToast(msg) {
      const c = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = 'bg-[#1f242c] text-[#e6edf3] border border-[#30363d] text-xs font-semibold px-4 py-3 rounded-2xl shadow-xl pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2';
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
        b.className = 'stab-btn px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 transition cursor-pointer text-[#8b949e] hover:text-[#e6edf3]';
      });
      const activeBtn = document.getElementById('stab-btn-' + tab);
      if (activeBtn) activeBtn.className = 'stab-btn px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 transition cursor-pointer bg-[#21262d] text-[#e6edf3] border border-[#30363d] shadow-sm';
    }

    function openNewShopModal() { document.getElementById('newShopModal').classList.remove('hidden'); }
    function closeNewShopModal() { document.getElementById('newShopModal').classList.add('hidden'); }

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
