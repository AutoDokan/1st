/**
 * AutoDokan Engine OS — Super Admin Executive Control Center
 * 100% Pure Apple Human Interface Guidelines (HIG) Edition
 * 
 * Strict Apple Design System Fidelity:
 *  - Colors:
 *      * systemGroupedBackground: #000000 (OLED pure black)
 *      * secondarySystemGroupedBackground: #1C1C1E (Apple graphite card surface)
 *      * tertiarySystemGroupedBackground: #2C2C2E (Nested group & input background)
 *      * systemGray4: #3A3A3C (Hover & active surfaces)
 *      * separator: rgba(255, 255, 255, 0.08)
 *  - Semantic Text Opacities:
 *      * label (Primary): #FFFFFF (100% white — headers, titles, metrics)
 *      * secondaryLabel: rgba(235, 235, 245, 0.60) (60% white — subtitles, body, table data)
 *      * tertiaryLabel: rgba(235, 235, 245, 0.30) (30% white — timestamps, captions, units)
 *  - Interactive System Accents:
 *      * systemBlue: #0A84FF (Exclusively for interactive controls, links, and buttons — NEVER on static numbers)
 *      * systemGreen: #30D158 (Online live bot indicator & approved status)
 *      * systemOrange: #FF9F0A (Pending status)
 *      * systemRed: #FF453A (Disconnected & cancelled status)
 *  - iMessage Chat Aesthetic:
 *      * Inbound Customer Bubble: #2C2C2E
 *      * Outbound Assistant Bubble: #0A84FF with pure white text
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

  // Helper to format currency in Apple's clean numeral format
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

    // 1. Fetch tenants, products count, orders, and recent chats
    const [invitesRes, settingsRes, prodsRes, ordsRes, chatsRes] = await Promise.all([
      supabase.from('seller_invites').select('*').order('id', { ascending: true }),
      supabase.from('store_settings').select('seller_id, business_category, bot_persona_name'),
      supabase.from('products').select('id, seller_id, in_stock'),
      supabase.from('orders').select('*').order('id', { ascending: false }),
      supabase.from('chat_sessions').select('*').order('updated_at', { ascending: false }).limit(30)
    ]);

    const allInvites = invitesRes.data || [];
    const allSettings = settingsRes.data || [];
    const allProducts = prodsRes.data || [];
    const allOrders = ordsRes.data || [];
    const recentChats = chatsRes.data || [];

    // Map shops into platform telemetry objects
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

    // Filtered Orders & Chats for active selection
    const filteredOrders = selectedSeller === 'ALL' ? allOrders : allOrders.filter(o => o.seller_id === selectedSeller);
    const filteredChats = selectedSeller === 'ALL' ? recentChats : recentChats.filter(c => c.seller_id === selectedSeller);

    // Map shop name lookup
    const shopNameMap = new Map();
    shopsTelemetry.forEach(s => shopNameMap.set(s.seller_id, s.shop_name));
    shopNameMap.set('autodokan_seller_1', 'Dawah Fashion');

    // Generate Shops HTML Cards (Apple secondarySystemGroupedBackground #1C1C1E)
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
      <div class="bg-[#1C1C1E] border border-white/[0.08] hover:border-white/[0.14] rounded-[22px] p-5.5 shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-4.5 transition-all duration-200">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-semibold text-white tracking-tight">${s.shop_name}</h3>
              <span class="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] border border-white/[0.06]">${catLabel}</span>
            </div>
            <p class="text-xs text-[rgba(235,235,245,0.60)] mt-1">
              মালিক: <span class="text-white font-medium">${s.owner_name}</span> • 
              আইডি: <span class="font-mono text-[rgba(235,235,245,0.30)]">${s.seller_id}</span>
            </p>
          </div>
          <div>
            ${s.is_online ? `
              <span class="inline-flex items-center gap-1.5 bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 text-xs px-2.5 py-1 rounded-full font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span>
                <span>বট লাইভ (+${s.live_number})</span>
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] border border-white/[0.06] text-xs px-2.5 py-1 rounded-full font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-[rgba(235,235,245,0.30)]"></span>
                <span>অপেক্ষমাণ</span>
              </span>
            `}
          </div>
        </div>

        <!-- Shop Telemetry Metrics (Apple tertiarySystemGroupedBackground #2C2C2E with Neutral Numbers) -->
        <div class="grid grid-cols-4 gap-2 bg-[#2C2C2E] p-3.5 rounded-[16px] border border-white/[0.04] text-center">
          <div>
            <div class="text-[10px] font-medium text-[rgba(235,235,245,0.30)] uppercase tracking-wider">ইনভেন্টরি</div>
            <div class="text-sm font-semibold text-white mt-0.5">${s.products_count}টি</div>
            <div class="text-[10px] text-[rgba(235,235,245,0.60)] font-medium">${s.instock_count} স্টকে</div>
          </div>
          <div>
            <div class="text-[10px] font-medium text-[rgba(235,235,245,0.30)] uppercase tracking-wider">মোট অর্ডার</div>
            <div class="text-sm font-semibold text-white mt-0.5">${s.orders_count}টি</div>
            <div class="text-[10px] text-[#FF9F0A] font-medium">${s.pending_orders_count} পেন্ডিং</div>
          </div>
          <div>
            <div class="text-[10px] font-medium text-[rgba(235,235,245,0.30)] uppercase tracking-wider">প্ল্যাটফর্ম সেলস</div>
            <div class="text-sm font-semibold text-white mt-0.5">${formatMoney(s.revenue)}</div>
            <div class="text-[10px] text-[rgba(235,235,245,0.30)]">COD ভলিউম</div>
          </div>
          <div>
            <div class="text-[10px] font-medium text-[rgba(235,235,245,0.30)] uppercase tracking-wider">AI বট এজেন্ট</div>
            <div class="text-xs font-semibold text-white mt-1">${s.persona_name}</div>
            <div class="text-[10px] text-[rgba(235,235,245,0.30)]">স্বয়ংক্রিয় সেলস</div>
          </div>
        </div>

        <!-- Action Links (Apple HIG Interactive Styling) -->
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06] flex-wrap">
          <div class="flex items-center gap-2">
            <a href="${portalUrl}" target="_blank" class="bg-[#0A84FF] hover:bg-[#0071E3] text-white text-xs px-3.5 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1 shadow-[0_2px_8px_rgba(10,132,255,0.25)]">
              <span>মার্চেন্ট পোর্টাল (ইনভেন্টরি ও সেলস)</span><span>↗</span>
            </a>
            <a href="${connectUrl}" target="_blank" class="bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white/90 border border-white/[0.08] text-xs px-3 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1">
              <span>WhatsApp QR</span><span>↗</span>
            </a>
          </div>
          <div>
            <a href="/dashboard?seller_id=${s.seller_id}&tab=orders" class="text-[#0A84FF] hover:underline text-xs font-medium px-2 py-1 transition flex items-center gap-1">
              <span>অর্ডারস দেখুন</span><span>→</span>
            </a>
          </div>
        </div>
      </div>
      `;
    }).join('');

    // Generate Global Orders Table Rows (Pure Apple HIG Typography)
    const orderRowsHtml = filteredOrders.map(o => {
      const prodPrice = Number(o.total_bdt) || 0;
      const dueCod = Number(o.due_cod) || prodPrice;
      const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
      const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
      const shopName = shopNameMap.get(o.seller_id) || o.seller_id || 'দোকান';
      const searchMeta = (o.id + ' ' + (o.model_code || '') + ' ' + (o.customer_name || '') + ' ' + (o.customer_phone || '') + ' ' + (o.address || '') + ' ' + shopName).toLowerCase();

      return `
      <tr class="order-row border-b border-white/[0.04] hover:bg-[#2C2C2E]/40 transition text-xs" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
        <td class="p-3.5">
          <div class="font-mono font-medium text-white">#${o.id}</div>
          <div class="text-[10px] text-[rgba(235,235,245,0.30)] mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
          <div class="mt-1"><span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] text-[9px] font-medium px-2 py-0.5 rounded-full border border-white/[0.06]">🏬 ${shopName}</span></div>
        </td>
        <td class="p-3.5">
          <div class="font-medium text-white text-xs">${o.customer_name || 'কাস্টমার'}</div>
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-[#0A84FF] hover:underline text-xs font-mono font-medium flex items-center gap-1 mt-0.5">
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
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-medium ${
            o.status === 'Approved' ? 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30' :
            o.status === 'Shipped' ? 'bg-[#0A84FF]/15 text-[#0A84FF] border border-[#0A84FF]/30' :
            o.status === 'Cancelled' ? 'bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30' :
            'bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30'
          }">
            ${o.status || 'Pending'}
          </span>
        </td>
      </tr>
      `;
    }).join('');

    // Generate Live Chat Audit Rows (Apple iMessage Native Bubble Aesthetic)
    const liveChatRowsHtml = filteredChats.map(c => {
      const shopName = shopNameMap.get(c.seller_id) || c.seller_id || 'দোকান';
      const lastUserMsg = (c.messages || []).filter(m => m.role === 'user').pop();
      const lastBotMsg = (c.messages || []).filter(m => m.role === 'assistant' || m.role === 'model').pop();

      return `
      <div class="bg-[#1C1C1E] border border-white/[0.08] rounded-[22px] p-4.5 shadow-[0_2px_16px_rgba(0,0,0,0.4)] space-y-3 text-xs">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] font-medium px-2.5 py-0.5 rounded-full text-[10px] border border-white/[0.06]">🏬 ${shopName}</span>
            <span class="font-mono font-medium text-white">${c.customer_phone || c.customer_identifier}</span>
            <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] text-[10px] font-medium px-2.5 py-0.5 rounded-full border border-white/[0.06]">${c.stage || 'BROWSING'}</span>
          </div>
          <span class="text-[10px] text-[rgba(235,235,245,0.30)]">${c.updated_at ? new Date(c.updated_at).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>

        <!-- Inbound Customer Message (Apple Incoming Bubble #2C2C2E) -->
        ${lastUserMsg ? `
          <div class="flex justify-start">
            <div class="max-w-[85%] bg-[#2C2C2E] text-[rgba(235,235,245,0.85)] p-3 rounded-[16px] rounded-tl-xs border border-white/[0.04]">
              <div class="text-[10px] text-[rgba(235,235,245,0.30)] font-medium mb-0.5">👤 ক্রেতা</div>
              <div class="leading-relaxed">${lastUserMsg.content || lastUserMsg.text || 'মেসেজ'}</div>
            </div>
          </div>
        ` : ''}

        <!-- Outbound AI Bot Message (Apple Outgoing iMessage Bubble #0A84FF) -->
        ${lastBotMsg ? `
          <div class="flex justify-end">
            <div class="max-w-[85%] bg-[#0A84FF] text-white p-3 rounded-[16px] rounded-tr-xs shadow-[0_2px_8px_rgba(10,132,255,0.25)]">
              <div class="text-[10px] text-white/70 font-medium mb-0.5 text-right">🤖 AutoDokan AI</div>
              <div class="leading-relaxed">${(lastBotMsg.content || lastBotMsg.text || '').substring(0, 180)}...</div>
            </div>
          </div>
        ` : ''}
      </div>
      `;
    }).join('');

    res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
  <title>AutoDokan Engine OS — Apple Dark Mode</title>
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
<body class="bg-[#000000] text-[rgba(235,235,245,0.60)] min-h-screen pb-24 selection:bg-[#0A84FF]/30 selection:text-white">

  <!-- Apple Frosted Glass Top Navbar -->
  <header class="apple-glass border-b border-white/[0.08] sticky top-0 z-40 px-5 py-3.5">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
      
      <!-- Brand & Platform Fleet Indicator -->
      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-[14px] bg-[#1C1C1E] border border-white/[0.12] text-[#0A84FF] flex items-center justify-center font-bold text-lg shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
          ⚡
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="font-semibold text-sm sm:text-base text-white tracking-tight">AutoDokan Engine OS</h1>
            <span class="bg-[#2C2C2E] text-[rgba(235,235,245,0.60)] text-[10px] font-medium px-2 py-0.5 rounded-full border border-white/[0.06]">Apple HIG Platform</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-xs text-[rgba(235,235,245,0.30)]">
            <span class="inline-flex items-center gap-1.5 text-[#30D158] font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span>
              <span>${onlineBots}/${totalShops}টি WhatsApp বট সক্রিয়</span>
            </span>
            <span>•</span>
            <span>প্ল্যাটফর্ম GMV: <span class="text-white font-medium">${formatMoney(totalPlatformGMV)}</span></span>
          </div>
        </div>
      </div>

      <!-- Quick Actions & Shop Inspector -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <!-- Dynamic Shop Switcher Dropdown (Apple #1C1C1E Style) -->
        <div class="flex items-center bg-[#1C1C1E] border border-white/[0.08] rounded-[14px] px-3 py-1.5">
          <span class="text-xs mr-1.5 text-[rgba(235,235,245,0.30)]">🏬</span>
          <select onchange="window.location.href='/dashboard?seller_id=' + this.value + '&tab=${activeTab}'" class="bg-transparent text-white font-medium text-xs outline-none cursor-pointer">
            <option value="ALL" class="bg-[#1C1C1E] text-white" ${selectedSeller === 'ALL' ? 'selected' : ''}>🌐 সবগুলো শপ একসাথে (All Stores)</option>
            ${shopsTelemetry.map(s => `<option value="${s.seller_id}" class="bg-[#1C1C1E] text-white" ${selectedSeller === s.seller_id ? 'selected' : ''}>${s.shop_name} (${s.category})</option>`).join('')}
          </select>
        </div>

        <!-- Add Shop Onboarding Button (Apple System Blue #0A84FF) -->
        <button type="button" onclick="openNewShopModal()" class="bg-[#0A84FF] hover:bg-[#0071E3] active:scale-[0.98] text-white font-medium text-xs px-4 py-2 rounded-[14px] shadow-[0_2px_12px_rgba(10,132,255,0.3)] transition flex items-center gap-1.5 cursor-pointer">
          <span>➕ নতুন শপ অনবোর্ডিং</span>
        </button>

        <a href="/logout" title="লগআউট" class="text-[rgba(235,235,245,0.30)] hover:text-white p-2 text-xs transition">
          🔒
        </a>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-5 py-6 space-y-6">

    <!-- 4 Platform Metric Telemetry Cards (Pure White Metrics as in Apple App Store Connect) -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">রেজিস্টার্ড টেন্যান্ট শপ</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalShops}টি <span class="text-xs text-[#30D158] font-medium">(${onlineBots} লাইভ)</span></div>
      </div>
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">মার্চেন্ট ইনভেন্টরি ভলিউম</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalPlatformProducts}টি পণ্য</div>
      </div>
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">প্ল্যাটফর্ম মোট অর্ডারস</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalPlatformOrders}টি</div>
      </div>
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        <div class="text-[rgba(235,235,245,0.30)] text-[11px] font-medium uppercase tracking-wider">গ্রস মার্চেন্ডাইজ ভলিউম</div>
        <div class="text-2xl font-bold text-white mt-1.5 tracking-tight">${formatMoney(totalPlatformGMV)}</div>
      </div>
    </div>

    <!-- Navigation Tabs (Apple Segmented Control Style) -->
    <div class="bg-[#1C1C1E] border border-white/[0.08] p-1.5 rounded-[18px] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      <button type="button" onclick="switchSuperTab('shops')" id="stab-btn-shops" class="stab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'shops' ? 'bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.60)] hover:text-white'}">
        <span>🏢 মার্চেন্ট শপসমূহ ও বট ফ্লিট</span>
        <span class="${activeTab === 'shops' ? 'bg-[#3A3A3C] text-white' : 'bg-[#2C2C2E] text-[rgba(235,235,245,0.30)]'} text-[10px] px-2 py-0.5 rounded-full font-bold">${totalShops}</span>
      </button>

      <button type="button" onclick="switchSuperTab('orders')" id="stab-btn-orders" class="stab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'orders' ? 'bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.60)] hover:text-white'}">
        <span>📋 প্ল্যাটফর্ম অর্ডারস পাইপলাইন</span>
        <span class="${activeTab === 'orders' ? 'bg-[#3A3A3C] text-white' : 'bg-[#2C2C2E] text-[rgba(235,235,245,0.30)]'} text-[10px] px-2 py-0.5 rounded-full font-bold">${filteredOrders.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('chats')" id="stab-btn-chats" class="stab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'chats' ? 'bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.60)] hover:text-white'}">
        <span>💬 লাইভ AI চ্যাট অডিট</span>
        <span class="${activeTab === 'chats' ? 'bg-[#3A3A3C] text-[#30D158]' : 'bg-[#2C2C2E] text-[rgba(235,235,245,0.30)]'} text-[10px] px-2 py-0.5 rounded-full font-bold">লাইভ</span>
      </button>
    </div>

    <!-- TAB 1: SHOPS & BOTS FLEET -->
    <section id="stab-shops" class="${activeTab === 'shops' ? '' : 'hidden'} space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="text-base font-semibold text-white tracking-tight">🏢 প্ল্যাটফর্ম টেন্যান্টস ও WhatsApp বট ফ্লিট</h2>
          <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">অ্যাডমিন প্ল্যাটফর্মের সেন্ট্রাল মনিটর। প্রতিটি মার্চেন্ট তাদের নিজস্ব ডেডিকেটেড পোর্টালে ইনভেন্টরি, ডেলিভারি রুলস ও পেমেন্ট স্বাধীনভাবে পরিচালনা করে।</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4.5">
        ${shopsCardsHtml}
      </div>
    </section>

    <!-- TAB 2: GLOBAL ORDERS PIPELINE -->
    <section id="stab-orders" class="${activeTab === 'orders' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5.5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] space-y-4">
        <div class="flex items-center justify-between border-b border-white/[0.06] pb-3.5 flex-wrap gap-2">
          <div>
            <h2 class="text-base font-semibold text-white tracking-tight">📋 প্ল্যাটফর্ম অর্ডারস ও ট্রানজেকশন পাইপলাইন</h2>
            <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">সকল মার্চেন্টের গ্রাহকদের থেকে তৈরি হওয়া রিয়েল-টাইম অর্ডার স্ট্রিম।</p>
          </div>
          <div class="text-xs text-[rgba(235,235,245,0.30)]">
            ফিল্টার: <span class="text-white font-medium">${selectedSeller === 'ALL' ? 'সকল শপ' : (shopNameMap.get(selectedSeller) || selectedSeller)}</span>
          </div>
        </div>

        <div class="overflow-x-auto border border-white/[0.06] rounded-[16px]">
          <table class="w-full text-left text-[rgba(235,235,245,0.60)] text-xs">
            <thead class="bg-[#2C2C2E] text-[rgba(235,235,245,0.30)] font-medium border-b border-white/[0.06]">
              <tr>
                <th class="p-3.5">অর্ডার ID ও শপ</th>
                <th class="p-3.5">কাস্টমার</th>
                <th class="p-3.5">ঠিকানা</th>
                <th class="p-3.5">পণ্য / মডেল</th>
                <th class="p-3.5">Due COD</th>
                <th class="p-3.5">স্ট্যাটাস</th>
              </tr>
            </thead>
            <tbody>
              ${orderRowsHtml || '<tr><td colspan="6" class="p-8 text-center text-[rgba(235,235,245,0.30)]">কোনো অর্ডার পাওয়া যায়নি</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 3: LIVE CHATS AUDIT -->
    <section id="stab-chats" class="${activeTab === 'chats' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#1C1C1E] border border-white/[0.08] p-5.5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] space-y-4">
        <div class="border-b border-white/[0.06] pb-3.5">
          <h2 class="text-base font-semibold text-white tracking-tight">💬 লাইভ AI চ্যাট অডিট ও কোয়ালিটি কন্ট্রোল</h2>
          <p class="text-xs text-[rgba(235,235,245,0.60)] mt-0.5">বিভিন্ন মার্চেন্ট শপে কাস্টমারদের সাথে AI সেলস এজেন্টের কথোপকথন রিয়েল-টাইমে পর্যবেক্ষণ করুন।</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          ${liveChatRowsHtml || '<div class="col-span-full py-10 text-center text-[rgba(235,235,245,0.30)]">এখনও কোনো লাইভ চ্যাট রেকর্ড নেই।</div>'}
        </div>
      </div>
    </section>

  </main>

  <!-- DYNAMIC NEW SHOP ONBOARDING MODAL (Apple Sheet Style) -->
  <div id="newShopModal" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
    <div class="bg-[#1C1C1E] border border-white/[0.12] rounded-[28px] max-w-lg w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.7)] space-y-4.5 max-h-[92vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-white/[0.06] pb-3.5">
        <h3 class="font-semibold text-white text-base tracking-tight">🚀 নতুন শপ অনবোর্ডিং উইজার্ড</h3>
        <button type="button" onclick="closeNewShopModal()" class="w-8 h-8 rounded-full bg-[#2C2C2E] hover:bg-[#3A3A3C] flex items-center justify-center text-[rgba(235,235,245,0.60)] hover:text-white font-bold cursor-pointer transition">✕</button>
      </div>

      <form id="newShopForm" onsubmit="handleDynamicShopCreation(event)" class="space-y-3.5">
        <div>
          <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">দোকানের নাম *</label>
          <input type="text" id="onboard_shop_name" required placeholder="যেমন: Noor Fashion বা Smart Tech" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] outline-none focus:border-[#0A84FF] transition">
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">ওনারের নাম</label>
            <input type="text" id="onboard_owner_name" placeholder="যেমন: তানভীর আহমেদ" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] outline-none focus:border-[#0A84FF] transition">
          </div>
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">মোবাইল নম্বর</label>
            <input type="text" id="onboard_phone" placeholder="যেমন: 017XXXXXXXX" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs p-2.5 rounded-[12px] outline-none focus:border-[#0A84FF] font-mono transition">
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🎯 বিজনেস ক্যাটাগরি (AI আর্কিটাইপ)</label>
          <select id="onboard_category" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] outline-none focus:border-[#0A84FF] cursor-pointer transition">
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
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🤖 AI বট এজেন্টের নাম</label>
            <input type="text" id="onboard_bot_name" value="সাকিব" required class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] outline-none focus:border-[#0A84FF] transition">
          </div>
          <div>
            <label class="block text-xs font-medium text-[rgba(235,235,245,0.60)] mb-1">🚚 ঢাকা ভেতরে চার্জ (টাকা)</label>
            <input type="number" id="onboard_inside_fee" value="80" class="w-full bg-[#2C2C2E] border border-white/[0.08] text-white text-xs font-medium p-2.5 rounded-[12px] outline-none focus:border-[#0A84FF] transition">
          </div>
        </div>

        <button type="submit" id="onboardSubmitBtn" class="w-full bg-[#0A84FF] hover:bg-[#0071E3] active:scale-[0.98] text-white font-medium text-xs py-3 rounded-[14px] transition cursor-pointer shadow-[0_2px_12px_rgba(10,132,255,0.3)] mt-2">
          🚀 শপ তৈরি করুন ও লিংক জেনারেট করুন
        </button>
      </form>

      <!-- Success Alert Drawer -->
      <div id="onboardSuccessDrawer" class="hidden bg-[#30D158]/10 border border-[#30D158]/25 rounded-[18px] p-4 space-y-3">
        <div class="flex items-center gap-2 text-[#30D158] font-medium text-xs">
          <span>🎉 শপ সফলভাবে তৈরি হয়েছে!</span>
        </div>
        <div>
          <label class="block text-[11px] text-[rgba(235,235,245,0.60)] font-medium mb-1">মার্চেন্ট পোর্টাল লিংক (সেলারকে এই লিংক দিন):</label>
          <div class="flex items-center gap-2">
            <input type="text" id="onboardResPortalUrl" readonly class="flex-1 bg-[#2C2C2E] border border-white/[0.08] text-[11px] p-2 rounded-[10px] text-white font-mono">
            <button type="button" onclick="copyInputVal('onboardResPortalUrl')" class="bg-[#0A84FF] hover:bg-[#0071E3] text-white font-medium text-xs px-3.5 py-2 rounded-[10px] transition cursor-pointer">কপি</button>
          </div>
        </div>
        <div>
          <label class="block text-[11px] text-[rgba(235,235,245,0.60)] font-medium mb-1">WhatsApp QR কানেক্ট লিংক:</label>
          <div class="flex items-center gap-2">
            <input type="text" id="onboardResConnectUrl" readonly class="flex-1 bg-[#2C2C2E] border border-white/[0.08] text-[11px] p-2 rounded-[10px] text-white font-mono">
            <button type="button" onclick="copyInputVal('onboardResConnectUrl')" class="bg-[#0A84FF] hover:bg-[#0071E3] text-white font-medium text-xs px-3.5 py-2 rounded-[10px] transition cursor-pointer">কপি</button>
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
      t.className = 'bg-[#1C1C1E] text-white border border-white/[0.12] text-xs font-medium px-4 py-3 rounded-[16px] shadow-[0_10px_30px_rgba(0,0,0,0.6)] pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2';
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
        b.className = 'stab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.60)] hover:text-white';
      });
      const activeBtn = document.getElementById('stab-btn-' + tab);
      if (activeBtn) activeBtn.className = 'stab-btn px-4.5 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer bg-[#2C2C2E] text-white shadow-xs border border-white/[0.08]';
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
