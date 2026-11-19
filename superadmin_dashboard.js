/**
 * AutoDokan Engine OS — Super Admin / Founder & CEO Executive Control Center
 * 100% Pure Apple Human Interface Guidelines (HIG) Luxury Dark Edition
 * Complete Omniscient Sovereign Controls: Bot Fleet, Master Orders, Live Chat Takeover,
 * Central Fraud Blacklist, Global Merchant Broadcast, Telemetry & Multi-Tenant Onboarding
 */

const crypto = require('crypto');
const qrcode = require('qrcode');

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
    try {
      const selectedSeller = req.query.seller_id || 'ALL';
      const activeTab = req.query.tab || 'shops';

      // 1. Fetch tenants, store settings, products, orders, recent chats & platform config
      const [invitesRes, settingsRes, prodsRes, ordsRes, chatsRes] = await Promise.all([
        supabase.from('seller_invites').select('*').order('id', { ascending: true }),
        supabase.from('store_settings').select('*'),
        supabase.from('products').select('id, seller_id, in_stock, price, model_code, name'),
        supabase.from('orders').select('*').order('id', { ascending: false }),
        supabase.from('chat_sessions').select('*').order('updated_at', { ascending: false }).limit(50)
      ]);

      const allInvites = invitesRes.data || [];
      const allSettings = settingsRes.data || [];
      const allProducts = prodsRes.data || [];
      const allOrders = ordsRes.data || [];
      const recentChats = chatsRes.data || [];

      // Extract CEO extra config from primary store (autodokan_seller_1)
      const primarySetting = allSettings.find(s => s.seller_id === 'autodokan_seller_1') || allSettings[0] || {};
      const primaryExtra = primarySetting.extra_config || {};
      const centralBlacklist = primaryExtra.central_blacklist || [
        { phone: '01899999999', reason: 'কুরিয়ার পার্সেল রিফিউজ ও রিটার্ন', added_at: '2026-11-15' },
        { phone: '01700000000', reason: 'ভুয়া ঠিকানা দিয়ে অর্ডার প্লেস', added_at: '2026-11-16' }
      ];
      const platformBroadcasts = primaryExtra.platform_broadcasts || [
        { id: 1, title: 'স্বাগতম অটো দোকান ইঞ্জিনে', message: 'সকল মার্চেন্টকে জানানো যাচ্ছে যে এআই অটোমেশন ২.০ সক্রিয় রয়েছে।', created_at: '2026-11-18', active: true }
      ];

      // Map shops into platform telemetry objects
      const shopsTelemetry = allInvites.map(inv => {
        const sProds = allProducts.filter(p => p.seller_id === inv.seller_id);
        const sOrders = allOrders.filter(o => o.seller_id === inv.seller_id);
        const sChats = recentChats.filter(c => c.seller_id === inv.seller_id);
        const sSettings = allSettings.find(s => s.seller_id === inv.seller_id) || {};
        
        let liveStatus = 'disconnected';
        let liveNumber = inv.phone || 'অনির্ধারিত';

        if (getSellerWhatsAppInfo) {
          const info = getSellerWhatsAppInfo(inv.seller_id);
          liveStatus = info.status;
          if (info.number) liveNumber = info.number;
        } else if (sellerStatuses && sellerStatuses.has(inv.seller_id)) {
          liveStatus = sellerStatuses.get(inv.seller_id);
          if (sellerNumbers && sellerNumbers.has(inv.seller_id)) {
            liveNumber = sellerNumbers.get(inv.seller_id);
          }
        }

        const isOnline = liveStatus === 'connected' || inv.status === 'CONNECTED';
        const hasQR = sellerQRs ? !!sellerQRs.get(inv.seller_id) : false;
        const revenue = sOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);
        const convRate = sChats.length > 0 ? Math.round((sOrders.length / sChats.length) * 100) : (sOrders.length > 0 ? 100 : 0);

        // Determine SaaS Plan
        const planName = inv.role === 'admin' ? 'Enterprise' : (inv.status === 'SUSPENDED' ? 'Suspended' : 'Pro Growth');

        return {
          seller_id: inv.seller_id,
          shop_name: inv.shop_name,
          owner_name: inv.owner_name || 'মার্চেন্ট',
          phone: inv.phone || '',
          category: sSettings.business_category || 'general',
          persona_name: sSettings.bot_persona_name || 'AI ইনচার্জ',
          invite_token: inv.invite_token,
          is_online: isOnline,
          live_status: isOnline ? 'connected' : (hasQR ? 'waiting_for_qr' : liveStatus),
          live_number: liveNumber,
          products_count: sProds.length,
          instock_count: sProds.filter(p => p.in_stock).length,
          orders_count: sOrders.length,
          pending_orders_count: sOrders.filter(o => o.status === 'Pending' || o.status === 'Pending Verification').length,
          revenue: revenue,
          conversion_rate: convRate,
          plan: planName,
          status: inv.status || 'ACTIVE',
          created_at: inv.created_at,
          inside_dhaka_fee: sSettings.inside_dhaka_fee || 80,
          outside_dhaka_fee: sSettings.outside_dhaka_fee || 150,
          return_policy: sSettings.return_policy || '',
          auto_reply_enabled: sSettings.auto_reply_enabled !== false
        };
      });

      // Global Platform Metrics
      const totalShops = shopsTelemetry.length;
      const onlineBots = shopsTelemetry.filter(s => s.is_online).length;
      const offlineBots = totalShops - onlineBots;
      const totalPlatformProducts = allProducts.length;
      const totalPlatformOrders = allOrders.length;
      const pendingOrdersCount = allOrders.filter(o => o.status === 'Pending' || o.status === 'Pending Verification').length;
      const approvedOrdersCount = allOrders.filter(o => o.status === 'Approved').length;
      const totalPlatformGMV = allOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);
      const avgOrderValue = totalPlatformOrders > 0 ? Math.round(totalPlatformGMV / totalPlatformOrders) : 0;

      // Filtered Orders & Chats for active selection
      const filteredOrders = selectedSeller === 'ALL' ? allOrders : allOrders.filter(o => o.seller_id === selectedSeller);
      const filteredChats = selectedSeller === 'ALL' ? recentChats : recentChats.filter(c => c.seller_id === selectedSeller);

      // Map shop name lookup
      const shopNameMap = new Map();
      shopsTelemetry.forEach(s => shopNameMap.set(s.seller_id, s.shop_name));
      shopNameMap.set('autodokan_seller_1', 'Dawah Fashion');

      // Top shops by revenue
      const topShops = [...shopsTelemetry].sort((a, b) => b.revenue - a.revenue);

      // System Health Telemetry
      const uptimeSec = Math.floor(process.uptime());
      const uptimeFormatted = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;
      const memUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

      // Category Badges & Emojis
      const catConfig = {
        'modest_fashion': { label: 'পোশাক ও বোরকা', emoji: '👗' },
        'fashion': { label: 'পোশাক ও ফ্যাশন', emoji: '👗' },
        'footwear': { label: 'জুতা ও ফুটওয়্যার', emoji: '👞' },
        'gadgets': { label: 'গ্যাজেটস ও টেক', emoji: '📱' },
        'electronics': { label: 'ইলেকট্রনিক্স', emoji: '⚡' },
        'cosmetics': { label: 'কসমেটিক্স ও স্কিনকেয়ার', emoji: '💄' },
        'organic_food': { label: 'অর্গানিক ফুড ও মধু', emoji: '🌿' },
        'food': { label: 'ফুড ও অর্গানিক', emoji: '🍯' },
        'perfume': { label: 'সুগন্ধি ও আতর', emoji: '🌸' },
        'general': { label: 'জেনারেল ই-কমার্স', emoji: '📦' }
      };

      // HTML Render for Shop Cards
      const shopsCardsHtml = shopsTelemetry.map(s => {
        const portalUrl = '/portal?token=' + s.invite_token;
        const cat = catConfig[s.category] || { label: 'ই-কমার্স', emoji: '🛍️' };

        return `
        <div id="shop-card-${s.seller_id}" class="bg-[#15171F] border border-white/[0.08] hover:border-white/[0.16] rounded-[22px] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.4)] space-y-4 transition-all duration-200">
          
          <!-- Shop Header & Badges -->
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base">${cat.emoji}</span>
                <h3 class="text-base font-semibold text-white tracking-tight">${s.shop_name}</h3>
                <span class="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#1F222B] text-[rgba(235,235,245,0.7)] border border-white/[0.06]">${cat.label}</span>
                <span id="plan-badge-${s.seller_id}" class="text-[10px] font-medium px-2 py-0.5 rounded-full ${s.plan === 'Enterprise' ? 'bg-[#0A84FF]/15 text-[#0A84FF] border border-[#0A84FF]/30' : (s.plan === 'Suspended' ? 'bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30' : 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30')}">
                  ${s.plan === 'Enterprise' ? '💎 Enterprise' : (s.plan === 'Suspended' ? '⏸️ স্থগিত' : '⚡ Pro Growth')}
                </span>
              </div>
              <p class="text-xs text-[rgba(235,235,245,0.55)]">
                মালিক: <span class="text-white font-medium">${s.owner_name}</span> • 
                আইডি: <span class="font-mono text-[rgba(235,235,245,0.4)]">${s.seller_id}</span>
              </p>
            </div>

            <!-- Bot Live Status Pill -->
            <div id="bot-status-container-${s.seller_id}">
              ${s.is_online ? `
                <span class="inline-flex items-center gap-1.5 bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 text-xs px-2.5 py-1 rounded-full font-medium shadow-xs">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#30D158] animate-pulse"></span>
                  <span>বট লাইভ (+${s.live_number})</span>
                </span>
              ` : (s.live_status === 'waiting_for_qr' ? `
                <span class="inline-flex items-center gap-1.5 bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30 text-xs px-2.5 py-1 rounded-full font-medium">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#FF9F0A] animate-ping"></span>
                  <span>QR স্ক্যানের অপেক্ষায়</span>
                </span>
              ` : `
                <span class="inline-flex items-center gap-1.5 bg-[#1F222B] text-[rgba(235,235,245,0.5)] border border-white/[0.06] text-xs px-2.5 py-1 rounded-full font-medium">
                  <span class="w-1.5 h-1.5 rounded-full bg-[rgba(235,235,245,0.3)]"></span>
                  <span>অফলাইন</span>
                </span>
              `)}
            </div>
          </div>

          <!-- Shop Telemetry 4-Metric Grid -->
          <div class="grid grid-cols-4 gap-2 bg-[#1C1E26] p-3.5 rounded-[16px] border border-white/[0.04] text-center">
            <div>
              <div class="text-[10px] font-medium text-[rgba(235,235,245,0.4)] uppercase tracking-wider">ইনভেন্টরি</div>
              <div class="text-sm font-semibold text-white mt-0.5">${s.products_count}টি</div>
              <div class="text-[10px] text-[#30D158] font-medium">${s.instock_count} স্টকে</div>
            </div>
            <div>
              <div class="text-[10px] font-medium text-[rgba(235,235,245,0.4)] uppercase tracking-wider">মোট অর্ডার</div>
              <div class="text-sm font-semibold text-white mt-0.5">${s.orders_count}টি</div>
              <div class="text-[10px] text-[#FF9F0A] font-medium">${s.pending_orders_count} পেন্ডিং</div>
            </div>
            <div>
              <div class="text-[10px] font-medium text-[rgba(235,235,245,0.4)] uppercase tracking-wider">মোট সেলস</div>
              <div class="text-sm font-semibold text-white mt-0.5">${formatMoney(s.revenue)}</div>
              <div class="text-[10px] text-[rgba(235,235,245,0.4)]">গ্রস সেলস</div>
            </div>
            <div>
              <div class="text-[10px] font-medium text-[rgba(235,235,245,0.4)] uppercase tracking-wider">AI কনভার্সন</div>
              <div class="text-xs font-semibold text-[#30D158] mt-1">${s.conversion_rate}%</div>
              <div class="text-[10px] text-[rgba(235,235,245,0.4)] truncate px-1">${s.persona_name}</div>
            </div>
          </div>

          <!-- Master Super Admin Actions Toolbar -->
          <div class="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06] flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">
              <!-- Merchant Portal Direct Link -->
              <a href="${portalUrl}" target="_blank" class="bg-[#1F222B] hover:bg-[#2C2F3B] text-white border border-white/[0.12] text-xs px-3 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1.5 shadow-xs" title="মার্চেন্ট পোর্টাল ওপেন করুন">
                <span>🚀 মার্চেন্ট পোর্টাল</span>
                <span class="text-[10px] opacity-60">↗</span>
              </a>

              <!-- Live WhatsApp QR Code Modal Viewer -->
              <button type="button" onclick="openQrModal('${s.seller_id}', '${s.shop_name}')" class="bg-[#1F222B] hover:bg-[#2C2F3B] active:scale-95 text-[rgba(235,235,245,0.85)] border border-white/[0.08] text-xs px-2.5 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1 cursor-pointer" title="হোয়াটসঅ্যাপ QR কোড দেখুন">
                <span>📱 QR কোড</span>
              </button>

              <!-- Remote WhatsApp Bot Restart -->
              <button type="button" onclick="restartTenantBot('${s.seller_id}', '${s.shop_name}')" class="bg-[#1F222B] hover:bg-[#2C2F3B] active:scale-95 text-[rgba(235,235,245,0.85)] border border-white/[0.08] text-xs px-2.5 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1 cursor-pointer" title="হোয়াটসঅ্যাপ সকেট রিস্টার্ট করুন">
                <span>🔄 রিস্টার্ট</span>
              </button>

              <!-- Store Config Fast-Editor Modal -->
              <button type="button" onclick="openStoreSettingsModal('${s.seller_id}')" class="bg-[#1F222B] hover:bg-[#2C2F3B] active:scale-95 text-[rgba(235,235,245,0.85)] border border-white/[0.08] text-xs px-2.5 py-1.5 rounded-[12px] font-medium transition flex items-center gap-1 cursor-pointer" title="স্টোর কনফিগারেশন এডিট করুন">
                <span>⚙️ সেটিংস</span>
              </button>

              <!-- SaaS Plan Switcher -->
              <button type="button" onclick="toggleTenantPlan('${s.seller_id}', '${s.plan}')" class="bg-[#1F222B] hover:bg-[#2C2F3B] text-[rgba(235,235,245,0.6)] hover:text-white border border-white/[0.08] text-xs px-2.5 py-1.5 rounded-[12px] font-medium transition cursor-pointer" title="SaaS প্ল্যান পরিবর্তন">
                <span>💎 প্ল্যান</span>
              </button>

              <!-- Copy Invite Token Link -->
              <button type="button" onclick="copyText('${portalUrl}')" class="bg-[#1F222B] hover:bg-[#2C2F3B] text-[rgba(235,235,245,0.6)] hover:text-white border border-white/[0.08] text-xs px-2 py-1.5 rounded-[12px] font-medium transition cursor-pointer" title="ইনভাইট লিংক কপি করুন">
                <span>📋 লিংক</span>
              </button>
            </div>

            <div>
              <button type="button" onclick="switchSuperTab('orders')" class="text-[#0A84FF] hover:underline text-xs font-medium px-2 py-1 transition flex items-center gap-1 cursor-pointer">
                <span>অর্ডারস (${s.orders_count})</span>
                <span>→</span>
              </button>
            </div>
          </div>

        </div>
        `;
      }).join('');

      // HTML Render for Master Orders Table
      const ordersRowsHtml = filteredOrders.map(o => {
        const storeName = shopNameMap.get(o.seller_id) || o.seller_id;
        const total = Number(o.total_bdt) || 0;
        const dueCod = Number(o.due_cod) || total;
        const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
        const waLink = cleanPhone ? `https://wa.me/88${cleanPhone.startsWith('88') ? cleanPhone.substring(2) : cleanPhone}` : '#';

        const statusBadges = {
          'Pending': 'bg-[#FF9F0A]/15 text-[#FF9F0A] border-[#FF9F0A]/30',
          'Pending Verification': 'bg-[#FF9F0A]/15 text-[#FF9F0A] border-[#FF9F0A]/30',
          'Approved': 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30',
          'Shipped': 'bg-[#0A84FF]/15 text-[#0A84FF] border-[#0A84FF]/30',
          'Delivered': 'bg-[#BF5AF2]/15 text-[#BF5AF2] border-[#BF5AF2]/30',
          'Cancelled': 'bg-[#FF453A]/15 text-[#FF453A] border-[#FF453A]/30'
        };
        const badgeClass = statusBadges[o.status] || 'bg-white/10 text-white border-white/20';

        return `
        <tr id="order-row-${o.id}" class="order-row border-b border-white/[0.04] hover:bg-[#1C1E26] transition text-xs">
          <!-- Order ID & Timestamp -->
          <td class="p-3.5">
            <div class="font-mono font-medium text-white">#${o.id}</div>
            <div class="text-[10px] text-[rgba(235,235,245,0.4)] mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
            <div class="mt-1">
              <span class="bg-[#1F222B] text-[rgba(235,235,245,0.7)] text-[9px] font-medium px-2 py-0.5 rounded-full border border-white/[0.06]">${storeName}</span>
            </div>
          </td>

          <!-- Customer Info & 1-Click WhatsApp Link -->
          <td class="p-3.5">
            <div class="font-medium text-white text-xs">${o.customer_name || 'কাস্টমার'}</div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-xs text-[rgba(235,235,245,0.7)] font-mono">${o.customer_phone || ''}</span>
              ${cleanPhone ? `
                <a href="${waLink}" target="_blank" class="text-[10px] bg-[#30D158]/20 hover:bg-[#30D158]/30 text-[#30D158] px-1.5 py-0.5 rounded-md font-medium transition" title="হোয়াটসঅ্যাপে চ্যাট করুন">
                  💬 চ্যাট
                </a>
              ` : ''}
            </div>
          </td>

          <!-- Delivery Address -->
          <td class="p-3.5 max-w-[200px]">
            <div class="text-xs text-[rgba(235,235,245,0.7)] truncate" title="${o.address || ''}">
              ${o.address || 'ঠিকানা দেওয়া হয়নি'}
            </div>
            <div class="text-[10px] text-[rgba(235,235,245,0.4)] mt-0.5">
              ${(o.address || '').toLowerCase().includes('dhaka') || (o.address || '').includes('ঢাকা') ? '📍 ঢাকা সিটি' : '📍 ঢাকার বাইরে'}
            </div>
          </td>

          <!-- Product / Model / Size -->
          <td class="p-3.5">
            <div class="font-mono text-white text-xs font-medium">[${o.model_code || 'PROD'}]</div>
            <div class="text-[10px] text-[rgba(235,235,245,0.5)] mt-0.5">
              সাইজ: ${o.length_size || o.body_size || 'স্ট্যান্ডার্ড'}
            </div>
          </td>

          <!-- Price & COD -->
          <td class="p-3.5">
            <div class="font-semibold text-white text-xs">৳${dueCod}</div>
            <div class="text-[10px] text-[rgba(235,235,245,0.4)]">
              মোট: ৳${total}
            </div>
          </td>

          <!-- Live Status Dropdown Switcher -->
          <td class="p-3.5">
            <select onchange="updateOrderStatus(${o.id}, this.value)" class="text-[11px] font-medium px-2 py-1 rounded-full border outline-none cursor-pointer ${badgeClass} bg-[#15171F]">
              <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
              <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
              <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
              <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>📦 Delivered</option>
              <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
            </select>
          </td>
        </tr>
        `;
      }).join('');

      // HTML Render for Omniscient WhatsApp Live Chat Feed
      const chatsFeedHtml = filteredChats.map(c => {
        const msgs = Array.isArray(c.messages) ? c.messages : [];
        const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
        const lastBotMsg = [...msgs].reverse().find(m => m.role === 'assistant' || m.role === 'bot');
        const storeName = shopNameMap.get(c.seller_id) || c.seller_id;
        const cleanPhone = (c.customer_phone || '').replace(/[^0-9]/g, '');

        return `
        <div id="chat-session-${c.id}" class="bg-[#15171F] border border-white/[0.08] p-4.5 rounded-[20px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] space-y-3.5">
          <!-- Chat Header -->
          <div class="flex items-center justify-between text-xs pb-2 border-b border-white/[0.06] flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-[#30D158]"></span>
              <span class="font-medium text-white">${c.customer_name || 'কাস্টমার'}</span>
              <span class="font-mono text-[rgba(235,235,245,0.6)]">${c.customer_phone || ''}</span>
              <span class="text-[10px] bg-[#1F222B] text-[rgba(235,235,245,0.7)] px-2 py-0.5 rounded-full border border-white/[0.06]">${storeName}</span>
              <span class="text-[10px] font-mono bg-[#0A84FF]/15 text-[#0A84FF] px-2 py-0.5 rounded-full border border-[#0A84FF]/30">${c.stage || 'BROWSING'}</span>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[10px] text-[rgba(235,235,245,0.4)]">${c.updated_at ? new Date(c.updated_at).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <!-- Direct Message Intervention Trigger -->
              <button type="button" onclick="openDirectMessageModal('${c.seller_id}', '${c.customer_phone || ''}', '${storeName}')" class="text-[10px] bg-[#0A84FF]/20 hover:bg-[#0A84FF]/30 text-[#0A84FF] px-2 py-0.5 rounded-md font-medium transition cursor-pointer">
                ⚡ মেসেজ পাঠান
              </button>
            </div>
          </div>

          <!-- Inbound Customer Message Bubble -->
          ${lastUserMsg ? `
            <div class="flex justify-start">
              <div class="max-w-[85%] bg-[#1F222B] text-[rgba(235,235,245,0.9)] p-3 rounded-[16px] rounded-tl-xs border border-white/[0.06]">
                <div class="text-[10px] text-[rgba(235,235,245,0.4)] font-medium mb-1">👤 ক্রেতার বার্তা:</div>
                <div class="leading-relaxed text-xs">${lastUserMsg.content || lastUserMsg.text || 'মেসেজ'}</div>
              </div>
            </div>
          ` : ''}

          <!-- Outbound AI Bot Reply Bubble -->
          ${lastBotMsg ? `
            <div class="flex justify-end">
              <div class="max-w-[85%] bg-[#1F222B] text-white p-3 rounded-[16px] rounded-tr-xs border border-white/[0.12] shadow-xs">
                <div class="text-[10px] text-[#30D158] font-medium mb-1 text-right">🤖 AutoDokan AI ইনচার্জ:</div>
                <div class="leading-relaxed text-xs">${(lastBotMsg.content || lastBotMsg.text || '').substring(0, 220)}...</div>
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
  <title>AutoDokan Engine OS — Super Admin & CEO Executive Control Center</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Hind+Siliguri:wght@400;500;600;700&display=swap');
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Plus Jakarta Sans", "Hind Siliguri", sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background-color: #0B0C10;
    }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .apple-glass {
      background-color: rgba(21, 23, 31, 0.88);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
    }
  </style>
</head>
<body class="bg-[#0B0C10] text-[rgba(235,235,245,0.7)] min-h-screen pb-24 selection:bg-white/20 selection:text-white">

  <!-- Apple Frosted Glass Top Navbar -->
  <header class="apple-glass border-b border-white/[0.08] sticky top-0 z-40 px-5 py-3.5">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
      
      <!-- Brand & Platform Fleet Indicator -->
      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-[14px] bg-[#15171F] border border-white/[0.12] text-white flex items-center justify-center font-bold text-lg shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
          ⚡
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="font-semibold text-sm sm:text-base text-white tracking-tight">AutoDokan Engine OS</h1>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#0A84FF]/20 text-[#0A84FF] border border-[#0A84FF]/30">CEO & Founder Sovereign</span>
            <!-- Real-Time Pulse Indicator -->
            <div class="flex items-center gap-1.5 bg-[#1C1E26] border border-white/[0.08] px-2 py-0.5 rounded-full">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#30D158] opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-[#30D158]"></span>
              </span>
              <span class="text-[10px] font-mono font-medium text-white tracking-wide">LIVE</span>
              <span id="pulseCountdown" class="text-[9px] text-[rgba(235,235,245,0.4)]">5s</span>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-xs text-[rgba(235,235,245,0.5)]">
            <span id="headerBotsCount" class="inline-flex items-center gap-1.5 text-[#30D158] font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span>
              <span>${onlineBots}/${totalShops}টি WhatsApp বট সক্রিয়</span>
            </span>
            <span>•</span>
            <span>প্ল্যাটফর্ম GMV: <span id="headerGMV" class="text-white font-medium">${formatMoney(totalPlatformGMV)}</span></span>
          </div>
        </div>
      </div>

      <!-- Quick Actions & Shop Inspector -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <!-- Manual Sync Button -->
        <button type="button" onclick="triggerManualPulse()" id="syncBtn" class="bg-[#15171F] hover:bg-[#1F222B] active:scale-95 text-white/90 border border-white/[0.08] text-xs px-3 py-1.5 rounded-[14px] font-medium transition flex items-center gap-1.5 cursor-pointer">
          <span id="syncSpinner">🔄</span>
          <span>লাইভ সিঙ্ক</span>
        </button>

        <!-- Global Shop Switcher Dropdown -->
        <div class="flex items-center bg-[#15171F] border border-white/[0.08] rounded-[14px] px-3 py-1.5">
          <span class="text-xs mr-1.5 text-[rgba(235,235,245,0.4)]">🏬</span>
          <select id="shopFilterSelect" onchange="window.location.href='/dashboard?seller_id=' + this.value + '&tab=${activeTab}'" class="bg-transparent text-white font-medium text-xs outline-none cursor-pointer">
            <option value="ALL" class="bg-[#15171F] text-white" ${selectedSeller === 'ALL' ? 'selected' : ''}>🌐 সবগুলো শপ একসাথে (All Stores)</option>
            ${shopsTelemetry.map(s => `<option value="${s.seller_id}" class="bg-[#15171F] text-white" ${selectedSeller === s.seller_id ? 'selected' : ''}>${s.shop_name} (${s.category})</option>`).join('')}
          </select>
        </div>

        <!-- Add Shop Onboarding Button -->
        <button type="button" onclick="openNewShopModal()" class="bg-white hover:bg-[#E5E5EA] active:scale-[0.98] text-black font-semibold text-xs px-4 py-2 rounded-[14px] shadow-[0_2px_12px_rgba(255,255,255,0.15)] transition flex items-center gap-1.5 cursor-pointer">
          <span>➕ নতুন মার্চেন্ট অনবোর্ডিং</span>
        </button>

        <!-- Cache Force Refresh -->
        <button type="button" onclick="forceCacheRefresh()" class="bg-[#15171F] hover:bg-[#1F222B] text-white/80 p-2 rounded-[14px] border border-white/[0.08] text-xs transition cursor-pointer" title="সব স্টোর ক্যাশ রিফ্রেশ করুন">
          ⚡
        </button>

        <a href="/logout" title="লগআউট" class="text-[rgba(235,235,245,0.4)] hover:text-white p-2 text-xs transition">
          🔒
        </a>
      </div>

    </div>
  </header>

  <main class="max-w-7xl mx-auto px-5 py-6 space-y-6">

    <!-- 4 Platform Metric Telemetry Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-[#15171F] border border-white/[0.08] hover:border-white/[0.14] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition">
        <div class="text-[rgba(235,235,245,0.4)] text-[11px] font-medium uppercase tracking-wider flex items-center justify-between">
          <span>রেজিস্টার্ড শপ ফ্লিট</span>
          <span>🏬</span>
        </div>
        <div id="metricTotalShops" class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalShops}টি <span class="text-xs text-[#30D158] font-medium">(${onlineBots} লাইভ)</span></div>
        <div class="text-[11px] text-[rgba(235,235,245,0.4)] mt-1">${offlineBots}টি অফলাইন বা পেন্ডিং</div>
      </div>

      <div class="bg-[#15171F] border border-white/[0.08] hover:border-white/[0.14] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition">
        <div class="text-[rgba(235,235,245,0.4)] text-[11px] font-medium uppercase tracking-wider flex items-center justify-between">
          <span>মার্চেন্ট ইনভেন্টরি</span>
          <span>📦</span>
        </div>
        <div id="metricTotalProducts" class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalPlatformProducts}টি পণ্য</div>
        <div class="text-[11px] text-[#30D158] mt-1">${allProducts.filter(p => p.in_stock).length}টি স্টকে সক্রিয়</div>
      </div>

      <div class="bg-[#15171F] border border-white/[0.08] hover:border-white/[0.14] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition">
        <div class="text-[rgba(235,235,245,0.4)] text-[11px] font-medium uppercase tracking-wider flex items-center justify-between">
          <span>মোট অর্ডারস</span>
          <span>🛒</span>
        </div>
        <div id="metricTotalOrders" class="text-2xl font-bold text-white mt-1.5 tracking-tight">${totalPlatformOrders}টি</div>
        <div class="text-[11px] text-[#FF9F0A] mt-1">${pendingOrdersCount}টি পেন্ডিং ভেরিফিকেশন</div>
      </div>

      <div class="bg-[#15171F] border border-white/[0.08] hover:border-white/[0.14] p-5 rounded-[22px] shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition">
        <div class="text-[rgba(235,235,245,0.4)] text-[11px] font-medium uppercase tracking-wider flex items-center justify-between">
          <span>গ্রস মার্চেন্ডাইজ ভলিউম</span>
          <span>💰</span>
        </div>
        <div id="metricTotalGMV" class="text-2xl font-bold text-white mt-1.5 tracking-tight">${formatMoney(totalPlatformGMV)}</div>
        <div class="text-[11px] text-[rgba(235,235,245,0.4)] mt-1">গড় অর্ডার মূল্য ৳${avgOrderValue}</div>
      </div>
    </div>

    <!-- Navigation Tabs (Apple Segmented Control Style) -->
    <div class="bg-[#15171F] border border-white/[0.08] p-1.5 rounded-[18px] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      <button type="button" onclick="switchSuperTab('shops')" id="stab-btn-shops" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'shops' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>🏬 দোকান ও বট ফ্লিট</span>
        <span id="tabBadgeShops" class="bg-white/10 px-2 py-0.5 rounded-full text-[10px] font-mono">${totalShops}</span>
      </button>

      <button type="button" onclick="switchSuperTab('orders')" id="stab-btn-orders" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'orders' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>📦 মাস্টার অর্ডার হাব</span>
        <span id="tabBadgeOrders" class="bg-white/10 px-2 py-0.5 rounded-full text-[10px] font-mono">${filteredOrders.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('chats')" id="stab-btn-chats" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'chats' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>💬 লাইভ চ্যাট ও এআই</span>
        <span class="bg-[#30D158]/20 text-[#30D158] px-2 py-0.5 rounded-full text-[10px] font-mono">${filteredChats.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('metrics')" id="stab-btn-metrics" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'metrics' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>📊 সিস্টেম মেট্রিক্স</span>
      </button>

      <button type="button" onclick="switchSuperTab('fraud')" id="stab-btn-fraud" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'fraud' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>🛡️ ফ্রড ও ব্ল্যাকলিস্ট</span>
        <span class="bg-[#FF453A]/20 text-[#FF453A] px-2 py-0.5 rounded-full text-[10px] font-mono">${centralBlacklist.length}</span>
      </button>

      <button type="button" onclick="switchSuperTab('broadcast')" id="stab-btn-broadcast" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'broadcast' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>📢 গ্লোবাল ব্রডকাস্ট</span>
      </button>

      <button type="button" onclick="switchSuperTab('onboarding')" id="stab-btn-onboarding" class="stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer ${activeTab === 'onboarding' ? 'bg-[#1F222B] text-white shadow-xs border border-white/[0.08]' : 'text-[rgba(235,235,245,0.6)] hover:text-white'}">
        <span>➕ অনবোর্ডিং হাব</span>
      </button>
    </div>

    <!-- TAB 1: দোকান ও বট ফ্লিট -->
    <section id="stab-shops" class="${activeTab === 'shops' ? '' : 'hidden'} space-y-4">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-sm font-semibold text-white tracking-tight">সবগুলো সক্রিয় মার্চেন্ট ও হোয়াটসঅ্যাপ বট ফ্লিট</h2>
          <p class="text-xs text-[rgba(235,235,245,0.5)]">রিয়েল-টাইম বট স্ট্যাটাস মনিটর করুন এবং ১-ক্লিকে অ্যাকশন নিন</p>
        </div>
        <div class="flex items-center gap-2">
          <input type="text" id="shopSearchInput" onkeyup="filterShopsRealtime(this.value)" placeholder="দোকান বা ফোন নম্বর খুঁজুন..." class="bg-[#15171F] border border-white/[0.08] text-xs text-white px-3 py-1.5 rounded-[12px] outline-none focus:border-white/20 w-56">
        </div>
      </div>

      <div id="shopsGridContainer" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${shopsCardsHtml}
      </div>
    </section>

    <!-- TAB 2: মাস্টার অর্ডার হাব -->
    <section id="stab-orders" class="${activeTab === 'orders' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#15171F] border border-white/[0.08] rounded-[22px] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
        
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-sm font-semibold text-white tracking-tight">অল-মার্কেটপ্লেস অর্ডার ট্র্যাকিং ও ডিসপ্যাচ</h2>
            <p class="text-xs text-[rgba(235,235,245,0.5)]">সকল স্টোরের সাম্প্রতিক অর্ডারসমূহ এবং ১-ক্লিকে স্ট্যাটাস আপডেট</p>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <!-- Filter Chips -->
            <div class="flex items-center bg-[#1C1E26] p-1 rounded-[12px] border border-white/[0.06]">
              <button type="button" onclick="filterOrdersByStatus('ALL')" class="order-status-btn px-2.5 py-1 rounded-[8px] text-[11px] font-medium bg-[#15171F] text-white">সব (${filteredOrders.length})</button>
              <button type="button" onclick="filterOrdersByStatus('Pending')" class="order-status-btn px-2.5 py-1 rounded-[8px] text-[11px] font-medium text-[rgba(235,235,245,0.6)]">পেন্ডিং</button>
              <button type="button" onclick="filterOrdersByStatus('Approved')" class="order-status-btn px-2.5 py-1 rounded-[8px] text-[11px] font-medium text-[rgba(235,235,245,0.6)]">অ্যাপ্রুভড</button>
              <button type="button" onclick="filterOrdersByStatus('Shipped')" class="order-status-btn px-2.5 py-1 rounded-[8px] text-[11px] font-medium text-[rgba(235,235,245,0.6)]">শিপড</button>
            </div>

            <!-- Instant Search Input -->
            <input type="text" id="orderSearchInput" onkeyup="filterOrdersRealtime(this.value)" placeholder="ফোন, নাম বা অর্ডার আইডি..." class="bg-[#1C1E26] border border-white/[0.08] text-xs text-white px-3 py-1.5 rounded-[12px] outline-none focus:border-white/20 w-48">
          </div>
        </div>

        <!-- Orders Table -->
        <div class="overflow-x-auto no-scrollbar">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-white/[0.08] text-[11px] font-medium text-[rgba(235,235,245,0.4)] uppercase tracking-wider">
                <th class="p-3.5">অর্ডার / দোকান</th>
                <th class="p-3.5">কাস্টমার তথ্য</th>
                <th class="p-3.5">ডেলিভারি ঠিকানা</th>
                <th class="p-3.5">প্রোডাক্ট ও সাইজ</th>
                <th class="p-3.5">টাকা ও COD</th>
                <th class="p-3.5">স্ট্যাটাস চেঞ্জার</th>
              </tr>
            </thead>
            <tbody id="ordersTableBody">
              ${ordersRowsHtml}
            </tbody>
          </table>
        </div>

      </div>
    </section>

    <!-- TAB 3: লাইভ চ্যাট ও এআই -->
    <section id="stab-chats" class="${activeTab === 'chats' ? '' : 'hidden'} space-y-4">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-sm font-semibold text-white tracking-tight">লাইভ কাস্টমার চ্যাট ও AI রেসপন্স স্ট্রিম</h2>
          <p class="text-xs text-[rgba(235,235,245,0.5)]">সকল স্টোরের সাম্প্রতিক ইনকামিং বার্তা ও বট পারসোনার স্বয়ংক্রিয় রিপ্লাই</p>
        </div>
      </div>

      <div id="chatsFeedContainer" class="space-y-3">
        ${chatsFeedHtml}
      </div>
    </section>

    <!-- TAB 4: সিস্টেম মেট্রিক্স ও পারফরম্যান্স -->
    <section id="stab-metrics" class="${activeTab === 'metrics' ? '' : 'hidden'} space-y-4">
      
      <!-- Leaderboard & Health Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        <!-- Top Selling Stores Leaderboard -->
        <div class="bg-[#15171F] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-white tracking-tight">🏆 শীর্ষ পারফর্মিং মার্চেন্ট শপসমূহ</h3>
            <span class="text-[10px] text-[rgba(235,235,245,0.4)]">GMV অনুযায়ী</span>
          </div>

          <div class="space-y-2.5">
            ${topShops.map((s, idx) => `
              <div class="flex items-center justify-between p-3 rounded-[14px] bg-[#1C1E26] border border-white/[0.04]">
                <div class="flex items-center gap-3">
                  <span class="w-6 h-6 rounded-full bg-white/10 text-white font-mono text-xs flex items-center justify-center font-bold">${idx + 1}</span>
                  <div>
                    <div class="text-xs font-semibold text-white">${s.shop_name}</div>
                    <div class="text-[10px] text-[rgba(235,235,245,0.5)]">${s.orders_count}টি অর্ডার • ${s.conversion_rate}% কনভার্সন</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-xs font-bold text-[#30D158]">${formatMoney(s.revenue)}</div>
                  <div class="text-[10px] text-[rgba(235,235,245,0.4)]">${s.plan}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Engine System Health & Uptime -->
        <div class="bg-[#15171F] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-white tracking-tight">⚙️ ইঞ্জিন কোর ও আর্কিটেকচার হেলথ</h3>
            <span class="text-[10px] text-[#30D158] font-mono">HEALTHY</span>
          </div>

          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="bg-[#1C1E26] p-3 rounded-[14px] border border-white/[0.04]">
              <div class="text-[10px] text-[rgba(235,235,245,0.4)]">প্ল্যাটফর্ম আপটাইম</div>
              <div class="font-mono text-white font-bold mt-1">${uptimeFormatted}</div>
            </div>
            <div class="bg-[#1C1E26] p-3 rounded-[14px] border border-white/[0.04]">
              <div class="text-[10px] text-[rgba(235,235,245,0.4)]">RAM / Memory RSS</div>
              <div class="font-mono text-white font-bold mt-1">${memUsageMB} MB</div>
            </div>
            <div class="bg-[#1C1E26] p-3 rounded-[14px] border border-white/[0.04]">
              <div class="text-[10px] text-[rgba(235,235,245,0.4)]">ডেটাবেজ স্ট্যাটাস</div>
              <div class="text-[#30D158] font-bold mt-1">Supabase Live</div>
            </div>
            <div class="bg-[#1C1E26] p-3 rounded-[14px] border border-white/[0.04]">
              <div class="text-[10px] text-[rgba(235,235,245,0.4)]">Node রানটাইম</div>
              <div class="font-mono text-white font-bold mt-1">${process.version}</div>
            </div>
          </div>

          <!-- Quick Flush Action -->
          <div class="pt-3 border-t border-white/[0.06] flex items-center justify-between">
            <span class="text-xs text-[rgba(235,235,245,0.5)]">গ্লোবাল এআই ও প্রোডাক্ট ক্যাশ</span>
            <button type="button" onclick="forceCacheRefresh()" class="bg-[#1F222B] hover:bg-[#2C2F3B] text-white border border-white/[0.08] text-xs px-3 py-1.5 rounded-[10px] font-medium transition cursor-pointer">
              ⚡ ক্যাশ রিলোড
            </button>
          </div>
        </div>

      </div>

    </section>

    <!-- TAB 5: ফ্রড ও ব্ল্যাকলিস্ট শিল্ড -->
    <section id="stab-fraud" class="${activeTab === 'fraud' ? '' : 'hidden'} space-y-4">
      <div class="bg-[#15171F] border border-white/[0.08] rounded-[22px] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
        
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-lg">🛡️</span>
              <h2 class="text-sm font-semibold text-white tracking-tight">সেন্ট্রাল ফ্রড প্রিভেনশন ও কুরিয়ার রিটার্ন ব্ল্যাকলিস্ট</h2>
            </div>
            <p class="text-xs text-[rgba(235,235,245,0.5)]">এখানে থাকা নম্বরগুলো কোনো দোকানে অর্ডার করতে গেলে এআই স্বয়ংক্রিয়ভাবে ১০০% অগ্রিম পেমেন্ট দাবি করবে</p>
          </div>

          <!-- Add Blacklist Trigger -->
          <button type="button" onclick="openAddBlacklistModal()" class="bg-[#FF453A]/20 hover:bg-[#FF453A]/30 text-[#FF453A] border border-[#FF453A]/30 px-3.5 py-1.5 rounded-[12px] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5">
            <span>➕ নতুন নম্বর ব্ল্যাকলিস্ট করুন</span>
          </button>
        </div>

        <!-- Blacklist Table -->
        <div class="overflow-x-auto no-scrollbar">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-white/[0.08] text-[11px] font-medium text-[rgba(235,235,245,0.4)] uppercase">
                <th class="p-3">মোবাইল নম্বর</th>
                <th class="p-3">ব্ল্যাকলিস্টের কারণ</th>
                <th class="p-3">তারিখ</th>
                <th class="p-3 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody id="blacklistTableBody">
              ${centralBlacklist.map(b => `
                <tr class="border-b border-white/[0.04] hover:bg-[#1C1E26] transition">
                  <td class="p-3 font-mono font-medium text-white">${b.phone}</td>
                  <td class="p-3 text-[rgba(235,235,245,0.8)]">${b.reason || 'কুরিয়ার রিটার্ন ও ভুয়া অর্ডার'}</td>
                  <td class="p-3 text-[rgba(235,235,245,0.4)] font-mono text-[10px]">${b.added_at || ''}</td>
                  <td class="p-3 text-right">
                    <button type="button" onclick="removeBlacklist('${b.phone}')" class="text-[10px] text-[#FF453A] hover:underline cursor-pointer">রিমুভ</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

      </div>
    </section>

    <!-- TAB 6: গ্লোবাল ব্রডকাস্ট ইঞ্জিন -->
    <section id="stab-broadcast" class="${activeTab === 'broadcast' ? '' : 'hidden'} space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        <!-- Broadcast Publisher Card -->
        <div class="bg-[#15171F] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
          <div class="flex items-center gap-2">
            <span class="text-lg">📢</span>
            <h3 class="text-sm font-semibold text-white tracking-tight">সব মার্চেন্টকে সেন্ট্রাল ব্রডকাস্ট পাঠান</h3>
          </div>
          <p class="text-xs text-[rgba(235,235,245,0.5)]">এই নোটিশটি সকল মার্চেন্টের ড্যাশবোর্ড পোর্টালে টপ ব্যানার হিসেবে প্রদর্শিত হবে।</p>

          <form onsubmit="handleBroadcastSubmit(event)" class="space-y-3">
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">নোটিশের শিরোনাম *</label>
              <input type="text" id="bcTitle" required placeholder="যেমন: ঈদুল ফিতরের কুরিয়ার বুকিং লাস্ট ডেট" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>

            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">বিস্তারিত বার্তা *</label>
              <textarea id="bcMessage" rows="3" required placeholder="মার্চেন্টদের জন্য জরুরি বার্তা বাংলায় লিখুন..." class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none resize-none"></textarea>
            </div>

            <div class="flex items-center gap-2">
              <input type="checkbox" id="bcSendWhatsApp" class="rounded">
              <label for="bcSendWhatsApp" class="text-xs text-[rgba(235,235,245,0.8)]">সকল মার্চেন্টের হোয়াটসঅ্যাপে পুশ নোটিফিকেশন পাঠান</label>
            </div>

            <button type="submit" id="bcSubmitBtn" class="w-full bg-[#0A84FF] hover:bg-[#0071E3] text-white text-xs font-semibold py-2.5 rounded-[12px] transition cursor-pointer">
              🚀 নোটিশ পাবলিশ করুন
            </button>
          </form>
        </div>

        <!-- Active Broadcasts History -->
        <div class="bg-[#15171F] border border-white/[0.08] p-5 rounded-[22px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
          <h3 class="text-sm font-semibold text-white tracking-tight">📋 সাম্প্রতিক ব্রডকাস্ট অ্যানাউন্সমেন্ট</h3>
          
          <div id="broadcastHistoryContainer" class="space-y-2.5">
            ${platformBroadcasts.map(bc => `
              <div class="p-3.5 rounded-[16px] bg-[#1C1E26] border border-white/[0.04] space-y-1">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-semibold text-white">${bc.title}</h4>
                  <span class="text-[9px] font-mono text-[rgba(235,235,245,0.4)]">${bc.created_at || ''}</span>
                </div>
                <p class="text-xs text-[rgba(235,235,245,0.7)]">${bc.message}</p>
                <div class="pt-1 flex items-center justify-between text-[10px]">
                  <span class="text-[#30D158]">সক্রিয় ব্যানার</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

      </div>
    </section>

    <!-- TAB 7: অনবোর্ডিং হাব -->
    <section id="stab-onboarding" class="${activeTab === 'onboarding' ? '' : 'hidden'} space-y-4">
      <div class="max-w-2xl mx-auto bg-[#15171F] border border-white/[0.08] p-6 rounded-[24px] shadow-[0_10px_40px_rgba(0,0,0,0.5)] space-y-5">
        
        <div class="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <div>
            <h2 class="text-base font-semibold text-white tracking-tight">নতুন মার্চেন্ট শপ তৈরি ও অনবোর্ডিং</h2>
            <p class="text-xs text-[rgba(235,235,245,0.5)]">১-ক্লিকে নতুন স্টোরের ডেটাবেজ, এআই পারসোনা ও ইনভাইট লিংক তৈরি করুন</p>
          </div>
          <span class="text-2xl">✨</span>
        </div>

        <form id="fullOnboardForm" onsubmit="handleNewShopSubmit(event, 'fullOnboardForm')" class="space-y-4">
          
          <!-- ১. মৌলিক তথ্য -->
          <div class="space-y-2">
            <div class="text-xs font-semibold text-[#FF9F0A] flex items-center gap-1.5">
              <span>◆</span>
              <span>১. মৌলিক তথ্য ও মালিকের বিবরণ</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">দোকানের নাম *</label>
                <input type="text" name="shop_name" required placeholder="যেমন: Noor Modest Wear" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none focus:border-white/20">
              </div>
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">মালিকের নাম</label>
                <input type="text" name="owner_name" placeholder="যেমন: আরিফ আহমেদ" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none focus:border-white/20">
              </div>
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">মোবাইল নম্বর (১১ ডিজিট) *</label>
                <input type="text" name="phone" required placeholder="01XXXXXXXXX" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none focus:border-white/20">
              </div>
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">SaaS প্ল্যান</label>
                <select name="plan" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
                  <option value="Pro Growth">Pro Growth (স্ট্যান্ডার্ড)</option>
                  <option value="Enterprise">Enterprise (ভিআইপি)</option>
                </select>
              </div>
            </div>
          </div>

          <!-- ২. ক্যাটাগরি ও এআই পারসোনা -->
          <div class="space-y-2 pt-2 border-t border-white/[0.06]">
            <div class="text-xs font-semibold text-[#FF9F0A] flex items-center gap-1.5">
              <span>◆</span>
              <span>২. ক্যাটাগরি ও AI সেলস ইনচার্জ</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">প্রোডাক্ট ক্যাটাগরি *</label>
                <select name="business_category" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
                  <option value="modest_fashion">👗 পোশাক, বোরকা ও ফ্যাশন</option>
                  <option value="footwear">👞 জুতা ও ফুটওয়্যার</option>
                  <option value="gadgets">📱 গ্যাজেটস ও টেক</option>
                  <option value="cosmetics">💄 কসমেটিক্স ও স্কিনকেয়ার</option>
                  <option value="organic_food">🌿 অর্গানিক ফুড ও মধু</option>
                  <option value="general">📦 জেনারেল ই-কমার্স</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">AI বট পারসোনা নাম</label>
                <input type="text" name="bot_persona_name" placeholder="যেমন: Zara, Sakib, AI ইনচার্জ" value="AI ইনচার্জ" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none focus:border-white/20">
              </div>
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ঢাকা সিটি ডেলিভারি ফি (৳)</label>
                <input type="number" name="inside_dhaka_fee" value="80" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
              </div>
              <div>
                <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ঢাকার বাইরে ডেলিভারি ফি (৳)</label>
                <input type="number" name="outside_dhaka_fee" value="150" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
              </div>
            </div>
          </div>

          <button type="submit" class="w-full bg-white hover:bg-[#E5E5EA] text-black font-semibold text-xs py-3 rounded-[14px] shadow-[0_4px_16px_rgba(255,255,255,0.15)] transition cursor-pointer flex items-center justify-center gap-2">
            <span>🚀 শপ তৈরি করুন ও ইনভাইট লিংক জেনারেট করুন</span>
          </button>
        </form>

      </div>
    </section>

  </main>

  <!-- ========================================================
       MODAL 1: নতুন মার্চেন্ট অনবোর্ডিং পপআপ
       ======================================================== -->
  <div id="newShopModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md hidden flex items-center justify-center p-4">
    <div class="bg-[#15171F] border border-white/[0.12] rounded-[24px] max-w-lg w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <h3 class="text-sm font-semibold text-white tracking-tight">➕ নতুন মার্চেন্ট শপ অনবোর্ডিং</h3>
        <button type="button" onclick="closeNewShopModal()" class="text-[rgba(235,235,245,0.4)] hover:text-white text-base">✕</button>
      </div>

      <form id="popupOnboardForm" onsubmit="handleNewShopSubmit(event, 'popupOnboardForm')" class="space-y-3.5">
        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">দোকানের নাম *</label>
            <input type="text" name="shop_name" required placeholder="যেমন: Royal Leather" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none focus:border-white/20">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">মালিকের নাম</label>
              <input type="text" name="owner_name" placeholder="যেমন: তানভীর হাসান" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">মোবাইল নম্বর *</label>
              <input type="text" name="phone" required placeholder="01XXXXXXXXX" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ক্যাটাগরি</label>
              <select name="business_category" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
                <option value="modest_fashion">👗 পোশাক ও ফ্যাশন</option>
                <option value="footwear">👞 জুতা ও ফুটওয়্যার</option>
                <option value="gadgets">📱 গ্যাজেটস ও টেক</option>
                <option value="cosmetics">💄 কসমেটিক্স</option>
                <option value="organic_food">🌿 অর্গানিক ফুড</option>
                <option value="general">📦 সাধারণ ই-কমার্স</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">বট পারসোনা নাম</label>
              <input type="text" name="bot_persona_name" value="AI ইনচার্জ" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
          <button type="button" onclick="closeNewShopModal()" class="px-3.5 py-1.5 rounded-[12px] text-xs font-medium bg-[#1F222B] text-white/80 hover:text-white">বাতিল</button>
          <button type="submit" class="px-4 py-1.5 rounded-[12px] text-xs font-semibold bg-white text-black hover:bg-[#E5E5EA] transition cursor-pointer">তৈরি করুন</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL 2: স্টোর সেটিংস ফাস্ট-এডিটর
       ======================================================== -->
  <div id="storeSettingsModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md hidden flex items-center justify-center p-4">
    <div class="bg-[#15171F] border border-white/[0.12] rounded-[24px] max-w-lg w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <div>
          <h3 class="text-sm font-semibold text-white tracking-tight">⚙️ স্টোর কনফিগারেশন এডিটর</h3>
          <p id="settingsModalShopName" class="text-xs text-[rgba(235,235,245,0.5)]">দোকানের সেটিংস সরাসরি পরিবর্তন করুন</p>
        </div>
        <button type="button" onclick="closeStoreSettingsModal()" class="text-[rgba(235,235,245,0.4)] hover:text-white text-base">✕</button>
      </div>

      <form id="storeSettingsForm" onsubmit="saveStoreSettings(event)" class="space-y-3.5">
        <input type="hidden" id="editSettingsSellerId" name="seller_id">

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">দোকানের নাম</label>
            <input type="text" id="editShopName" name="shop_name" required class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ক্যাটাগরি</label>
              <select id="editCategory" name="business_category" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
                <option value="modest_fashion">👗 পোশাক ও ফ্যাশন</option>
                <option value="footwear">👞 জুতা ও ফুটওয়্যার</option>
                <option value="gadgets">📱 গ্যাজেটস ও টেক</option>
                <option value="cosmetics">💄 কসমেটিক্স</option>
                <option value="organic_food">🌿 অর্গানিক ফুড</option>
                <option value="general">📦 সাধারণ ই-কমার্স</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">বট পারসোনা নাম</label>
              <input type="text" id="editPersonaName" name="bot_persona_name" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ঢাকা সিটি ডেলিভারি ফি (৳)</label>
              <input type="number" id="editInsideFee" name="inside_dhaka_fee" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>
            <div>
              <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ঢাকার বাইরে ডেলিভারি ফি (৳)</label>
              <input type="number" id="editOutsideFee" name="outside_dhaka_fee" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">রিটার্ন ও ট্রায়াল পলিসি</label>
            <input type="text" id="editReturnPolicy" name="return_policy" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
          <button type="button" onclick="closeStoreSettingsModal()" class="px-3.5 py-1.5 rounded-[12px] text-xs font-medium bg-[#1F222B] text-white/80 hover:text-white">বাতিল</button>
          <button type="submit" class="px-4 py-1.5 rounded-[12px] text-xs font-semibold bg-[#30D158] text-black hover:bg-[#28B84D] transition cursor-pointer">সংরক্ষণ করুন</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL 3: হোয়াটসঅ্যাপ QR কোড লাইভ ভিউয়ার
       ======================================================== -->
  <div id="qrModal" class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md hidden flex items-center justify-center p-4">
    <div class="bg-[#15171F] border border-white/[0.12] rounded-[24px] max-w-sm w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-center space-y-4">
      <div class="flex items-center justify-between pb-2 border-b border-white/[0.08]">
        <h3 id="qrModalTitle" class="text-sm font-semibold text-white tracking-tight">WhatsApp QR কোড</h3>
        <button type="button" onclick="closeQrModal()" class="text-[rgba(235,235,245,0.4)] hover:text-white text-base">✕</button>
      </div>

      <div id="qrModalContent" class="py-2 flex flex-col items-center justify-center min-h-[260px]">
        <div class="animate-spin text-2xl text-[rgba(235,235,245,0.4)]">🔄</div>
        <p class="text-xs text-[rgba(235,235,245,0.5)] mt-2">QR কোড লোড হচ্ছে...</p>
      </div>

      <div class="flex items-center justify-center gap-2 pt-2 border-t border-white/[0.06]">
        <button type="button" id="qrRestartBtn" onclick="restartFromQrModal()" class="bg-[#1F222B] hover:bg-[#2C2F3B] text-white text-xs px-3 py-1.5 rounded-[12px] font-medium transition cursor-pointer">
          🔄 নতুন কিউআর চান
        </button>
        <button type="button" onclick="closeQrModal()" class="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded-[12px] font-medium transition cursor-pointer">
          বন্ধ করুন
        </button>
      </div>
    </div>
  </div>

  <!-- ========================================================
       MODAL 4: সরাসরি কাস্টমারকে WhatsApp মেসেজ পাঠান
       ======================================================== -->
  <div id="directMessageModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md hidden flex items-center justify-center p-4">
    <div class="bg-[#15171F] border border-white/[0.12] rounded-[24px] max-w-md w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <div>
          <h3 class="text-sm font-semibold text-white tracking-tight">⚡ সরাসরি WhatsApp মেসেজ পাঠান</h3>
          <p id="dmModalSubtitle" class="text-xs text-[rgba(235,235,245,0.5)]">সংশ্লিষ্ট স্টোরের বট থেকে বার্তাটি প্রেরিত হবে</p>
        </div>
        <button type="button" onclick="closeDirectMessageModal()" class="text-[rgba(235,235,245,0.4)] hover:text-white text-base">✕</button>
      </div>

      <form onsubmit="handleDirectMessageSubmit(event)" class="space-y-3.5">
        <input type="hidden" id="dmSellerId">
        
        <div>
          <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">কাস্টমারের ফোন নম্বর</label>
          <input type="text" id="dmCustomerPhone" required placeholder="01XXXXXXXXX" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
        </div>

        <div>
          <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">মেসেজের বিবরণ *</label>
          <textarea id="dmMessageText" rows="4" required placeholder="আপনার বার্তাটি বাংলায় লিখুন..." class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none resize-none"></textarea>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <button type="button" onclick="closeDirectMessageModal()" class="px-3.5 py-1.5 rounded-[12px] text-xs font-medium bg-[#1F222B] text-white/80 hover:text-white">বাতিল</button>
          <button type="submit" id="dmSendBtn" class="px-4 py-1.5 rounded-[12px] text-xs font-semibold bg-[#0A84FF] text-white hover:bg-[#0071E3] transition cursor-pointer flex items-center gap-1.5">
            <span>প্রেরণ করুন</span>
            <span>➤</span>
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL 5: সেন্ট্রাল ফ্রড ব্ল্যাকলিস্ট অ্যাড মোডাল
       ======================================================== -->
  <div id="addBlacklistModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md hidden flex items-center justify-center p-4">
    <div class="bg-[#15171F] border border-white/[0.12] rounded-[24px] max-w-sm w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <h3 class="text-sm font-semibold text-white tracking-tight">🛡️ নতুন নম্বর ব্ল্যাকলিস্ট করুন</h3>
        <button type="button" onclick="closeAddBlacklistModal()" class="text-[rgba(235,235,245,0.4)] hover:text-white text-base">✕</button>
      </div>

      <form onsubmit="handleAddBlacklistSubmit(event)" class="space-y-3.5">
        <div>
          <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">গ্রাহকের ফোন নম্বর *</label>
          <input type="text" id="blPhoneInput" required placeholder="01XXXXXXXXX" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
        </div>

        <div>
          <label class="block text-[11px] text-[rgba(235,235,245,0.6)] mb-1">ব্ল্যাকলিস্টের কারণ *</label>
          <input type="text" id="blReasonInput" required placeholder="যেমন: পার্সেল রিফিউজ ও কুরিয়ার রিটার্ন" class="w-full bg-[#1C1E26] border border-white/[0.08] rounded-[12px] px-3 py-2 text-xs text-white outline-none">
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <button type="button" onclick="closeAddBlacklistModal()" class="px-3.5 py-1.5 rounded-[12px] text-xs font-medium bg-[#1F222B] text-white/80 hover:text-white">বাতিল</button>
          <button type="submit" class="px-4 py-1.5 rounded-[12px] text-xs font-semibold bg-[#FF453A] text-white hover:bg-[#D70015] transition cursor-pointer">
            ব্ল্যাকলিস্ট করুন
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div id="toastContainer" class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none"></div>

  <!-- Dynamic Client-Side Controller Engine -->
  <script>
    var knownOrderIds = new Set([${allOrders.map(o => o.id).join(',')}]);
    var countdownSec = 5;
    var activeQrSellerId = null;
    var qrPollInterval = null;

    // Apple Tone Generator via Native Web Audio API
    function playAppleChime() {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        var ctx = new AudioCtx();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch(e) {}
    }

    function showToast(msg, isSuccess) {
      if (isSuccess === undefined) isSuccess = true;
      var c = document.getElementById('toastContainer');
      var t = document.createElement('div');
      t.className = 'bg-[#15171F] text-white border border-white/[0.12] text-xs font-medium px-4 py-3 rounded-[16px] shadow-[0_10px_30px_rgba(0,0,0,0.7)] pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2';
      t.innerHTML = (isSuccess ? '<span>🟢</span> ' : '<span>⚠️</span> ') + msg;
      c.appendChild(t);
      setTimeout(function() { t.classList.remove('translate-y-2', 'opacity-0'); }, 10);
      setTimeout(function() {
        t.classList.add('opacity-0', 'translate-y-2');
        setTimeout(function() { t.remove(); }, 300);
      }, 3500);
    }

    function copyText(text) {
      navigator.clipboard.writeText(window.location.origin + text);
      showToast('📋 লিংক ক্লিপবোর্ডে কপি হয়েছে!');
    }

    // 100% Infallible Tab Switcher
    function switchSuperTab(tab) {
      try {
        var allSections = document.querySelectorAll('section[id^="stab-"]');
        for (var i = 0; i < allSections.length; i++) {
          allSections[i].classList.add('hidden');
        }
        var targetSection = document.getElementById('stab-' + tab);
        if (targetSection) {
          targetSection.classList.remove('hidden');
        }

        var allButtons = document.querySelectorAll('.stab-btn');
        for (var j = 0; j < allButtons.length; j++) {
          allButtons[j].className = 'stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer text-[rgba(235,235,245,0.6)] hover:text-white';
        }
        var activeBtn = document.getElementById('stab-btn-' + tab);
        if (activeBtn) {
          activeBtn.className = 'stab-btn px-4 py-2 rounded-[14px] font-medium text-xs flex items-center gap-2 transition cursor-pointer bg-[#1F222B] text-white shadow-xs border border-white/[0.08]';
        }

        if (window.history && window.history.replaceState) {
          var curUrl = new URL(window.location);
          curUrl.searchParams.set('tab', tab);
          window.history.replaceState(null, '', curUrl.toString());
        }
      } catch (err) {
        console.error('Tab switch error:', err);
      }
    }

    // Modal Controls
    function openNewShopModal() { document.getElementById('newShopModal').classList.remove('hidden'); }
    function closeNewShopModal() { document.getElementById('newShopModal').classList.add('hidden'); }

    function openAddBlacklistModal() { document.getElementById('addBlacklistModal').classList.remove('hidden'); }
    function closeAddBlacklistModal() { document.getElementById('addBlacklistModal').classList.add('hidden'); }

    // Remote Bot Restart
    async function restartTenantBot(sellerId, shopName) {
      if (!confirm(shopName + '-এর WhatsApp বট রিস্টার্ট করতে চান?')) return;
      showToast('🔄 ' + shopName + '-এর বট সেশন রিস্টার্ট হচ্ছে...');
      try {
        var res = await fetch('/api/admin/shops/' + sellerId + '/bot-restart', { method: 'POST' });
        var data = await res.json();
        if (data.success) {
          showToast('✅ ' + shopName + '-এর বট রিস্টার্ট ট্রিগার হয়েছে!');
          fetchLivePulse();
        } else {
          showToast('❌ ' + (data.error || 'এরর হয়েছে'), false);
        }
      } catch (err) {
        showToast('❌ সংযোগ সমস্যা: ' + err.message, false);
      }
    }

    // SaaS Plan Switcher
    async function toggleTenantPlan(sellerId, currentPlan) {
      var newPlan = prompt('প্ল্যান নির্বাচন করুন (Pro Growth / Enterprise / Suspended):', currentPlan);
      if (!newPlan || newPlan === currentPlan) return;
      try {
        var res = await fetch('/api/admin/shops/' + sellerId + '/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: newPlan, status: newPlan === 'Suspended' ? 'SUSPENDED' : 'ACTIVE' })
        });
        var data = await res.json();
        if (data.success) {
          showToast('💎 ' + data.message);
          var badge = document.getElementById('plan-badge-' + sellerId);
          if (badge) {
            badge.innerText = newPlan === 'Enterprise' ? '💎 Enterprise' : (newPlan === 'Suspended' ? '⏸️ স্থগিত' : '⚡ Pro Growth');
          }
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message, false);
      }
    }

    // Store Settings Fast-Editor Modal
    async function openStoreSettingsModal(sellerId) {
      try {
        var res = await fetch('/api/admin/shops/' + sellerId + '/settings');
        var data = await res.json();
        if (!data.success) throw new Error(data.error);

        var s = data.settings;
        document.getElementById('editSettingsSellerId').value = sellerId;
        document.getElementById('settingsModalShopName').innerText = data.shop_name + ' (আইডি: ' + sellerId + ')';
        document.getElementById('editShopName').value = data.shop_name || '';
        document.getElementById('editCategory').value = s.business_category || 'general';
        document.getElementById('editPersonaName').value = s.bot_persona_name || 'AI ইনচার্জ';
        document.getElementById('editInsideFee').value = s.inside_dhaka_fee || 80;
        document.getElementById('editOutsideFee').value = s.outside_dhaka_fee || 150;
        document.getElementById('editReturnPolicy').value = s.return_policy || '';

        document.getElementById('storeSettingsModal').classList.remove('hidden');
      } catch (err) {
        showToast('❌ সেটিংস লোড করা যায়নি: ' + err.message, false);
      }
    }

    function closeStoreSettingsModal() {
      document.getElementById('storeSettingsModal').classList.add('hidden');
    }

    async function saveStoreSettings(e) {
      e.preventDefault();
      var form = e.target;
      var sellerId = document.getElementById('editSettingsSellerId').value;
      var payload = {
        shop_name: form.shop_name.value,
        business_category: form.business_category.value,
        bot_persona_name: form.bot_persona_name.value,
        inside_dhaka_fee: Number(form.inside_dhaka_fee.value) || 80,
        outside_dhaka_fee: Number(form.outside_dhaka_fee.value) || 150,
        return_policy: form.return_policy.value
      };

      try {
        var res = await fetch('/api/admin/shops/' + sellerId + '/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ স্টোর সেটিংস সফলভাবে সংরক্ষিত হয়েছে!');
          closeStoreSettingsModal();
          setTimeout(function() { window.location.reload(); }, 1000);
        } else {
          showToast('❌ ' + (data.error || 'এরর হয়েছে'), false);
        }
      } catch (err) {
        showToast('❌ সেভ হয়নি: ' + err.message, false);
      }
    }

    // QR Code Live Viewer Modal
    function openQrModal(sellerId, shopName) {
      activeQrSellerId = sellerId;
      document.getElementById('qrModalTitle').innerText = shopName + ' — WhatsApp QR';
      document.getElementById('qrModal').classList.remove('hidden');
      fetchQrStatus(sellerId);

      if (qrPollInterval) clearInterval(qrPollInterval);
      qrPollInterval = setInterval(function() {
        if (activeQrSellerId) fetchQrStatus(activeQrSellerId);
      }, 4000);
    }

    function closeQrModal() {
      activeQrSellerId = null;
      if (qrPollInterval) clearInterval(qrPollInterval);
      document.getElementById('qrModal').classList.add('hidden');
    }

    async function fetchQrStatus(sellerId) {
      var box = document.getElementById('qrModalContent');
      try {
        var res = await fetch('/api/admin/shops/' + sellerId + '/qr');
        var data = await res.json();

        if (data.status === 'connected') {
          box.innerHTML = '<div class="space-y-3 py-4">' +
            '<div class="w-16 h-16 rounded-full bg-[#30D158]/20 text-[#30D158] flex items-center justify-center text-3xl mx-auto">✓</div>' +
            '<div class="text-sm font-semibold text-white">বট ইতোমধ্যে সক্রিয়!</div>' +
            '<div class="text-xs text-[rgba(235,235,245,0.6)]">সংযুক্ত নম্বর: <span class="font-mono text-white">+' + (data.number || '') + '</span></div>' +
            '</div>';
        } else if (data.status === 'qr_ready' && data.qr_image) {
          box.innerHTML = '<div class="space-y-3">' +
            '<div class="bg-white p-3 rounded-[16px] inline-block shadow-lg">' +
            '<img src="' + data.qr_image + '" alt="QR Code" class="w-56 h-56 mx-auto rounded-lg">' +
            '</div>' +
            '<p class="text-xs text-[rgba(235,235,245,0.6)]">আপনার WhatsApp অ্যাপ থেকে স্ক্যান করুন</p>' +
            '</div>';
        } else {
          box.innerHTML = '<div class="space-y-3 py-6">' +
            '<div class="text-3xl text-[#FF9F0A]">📱</div>' +
            '<div class="text-xs text-[rgba(235,235,245,0.7)]">QR কোড তৈরির জন্য অপেক্ষা করছে...</div>' +
            '<button type="button" onclick="restartFromQrModal()" class="bg-[#1F222B] text-white text-xs px-3 py-1.5 rounded-[10px] border border-white/[0.08] hover:bg-[#2C2F3B] cursor-pointer">সেশন চালু করুন</button>' +
            '</div>';
        }
      } catch (err) {
        box.innerHTML = '<div class="text-xs text-[#FF453A]">QR লোড এরর: ' + err.message + '</div>';
      }
    }

    async function restartFromQrModal() {
      if (!activeQrSellerId) return;
      showToast('🔄 নতুন কিউআর রিকোয়েস্ট করা হয়েছে...');
      await fetch('/api/admin/shops/' + activeQrSellerId + '/bot-restart', { method: 'POST' });
      setTimeout(function() { fetchQrStatus(activeQrSellerId); }, 1500);
    }

    // Direct WhatsApp Message Modal
    function openDirectMessageModal(sellerId, phone, shopName) {
      document.getElementById('dmSellerId').value = sellerId;
      document.getElementById('dmCustomerPhone').value = phone;
      document.getElementById('dmModalSubtitle').innerText = shopName + '-এর বট থেকে সরাসরি গ্রাহককে বার্তা পাঠান';
      document.getElementById('dmMessageText').value = '';
      document.getElementById('directMessageModal').classList.remove('hidden');
    }

    function closeDirectMessageModal() {
      document.getElementById('directMessageModal').classList.add('hidden');
    }

    async function handleDirectMessageSubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('dmSendBtn');
      var sellerId = document.getElementById('dmSellerId').value;
      var phone = document.getElementById('dmCustomerPhone').value;
      var text = document.getElementById('dmMessageText').value;

      btn.disabled = true;
      btn.innerHTML = 'প্রেরণ হচ্ছে...';

      try {
        var res = await fetch('/api/admin/messages/send-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seller_id: sellerId, phone: phone, text: text })
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ WhatsApp বার্তা সফলভাবে পাঠানো হয়েছে!');
          closeDirectMessageModal();
        } else {
          showToast('❌ ' + (data.error || 'পাঠানো যায়নি'), false);
        }
      } catch (err) {
        showToast('❌ সমস্যা: ' + err.message, false);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>প্রেরণ করুন</span><span>➤</span>';
      }
    }

    // Central Fraud Blacklist Handlers
    async function handleAddBlacklistSubmit(e) {
      e.preventDefault();
      var phone = document.getElementById('blPhoneInput').value.trim();
      var reason = document.getElementById('blReasonInput').value.trim();

      try {
        var res = await fetch('/api/admin/blacklist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone, reason: reason })
        });
        var data = await res.json();
        if (data.success) {
          showToast('🛡️ ' + phone + ' ব্ল্যাকলিস্টে যুক্ত হয়েছে!');
          closeAddBlacklistModal();
          setTimeout(function() { window.location.reload(); }, 1000);
        } else {
          showToast('❌ ' + (data.error || 'ব্ল্যাকলিস্ট করা যায়নি'), false);
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message, false);
      }
    }

    async function removeBlacklist(phone) {
      if (!confirm(phone + ' কে ব্ল্যাকলিস্ট থেকে রিমুভ করতে চান?')) return;
      try {
        var res = await fetch('/api/admin/blacklist/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone })
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ নম্বরটি ব্ল্যাকলিস্ট থেকে অপসারিত হয়েছে!');
          setTimeout(function() { window.location.reload(); }, 1000);
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message, false);
      }
    }

    // Global Platform Broadcast Publisher
    async function handleBroadcastSubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('bcSubmitBtn');
      var title = document.getElementById('bcTitle').value.trim();
      var message = document.getElementById('bcMessage').value.trim();
      var sendWhatsApp = document.getElementById('bcSendWhatsApp').checked;

      btn.disabled = true;
      btn.innerHTML = 'পাবলিশ হচ্ছে...';

      try {
        var res = await fetch('/api/admin/broadcasts/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title, message: message, send_whatsapp: sendWhatsApp })
        });
        var data = await res.json();
        if (data.success) {
          showToast('📢 গ্লোবাল ব্রডকাস্ট সফলভাবে পাবলিশ হয়েছে!');
          setTimeout(function() { window.location.reload(); }, 1500);
        } else {
          showToast('❌ ' + (data.error || 'পাবলিশ করা যায়নি'), false);
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message, false);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 নোটিশ পাবলিশ করুন';
      }
    }

    // 1-Click Order Status Updater
    async function updateOrderStatus(orderId, newStatus) {
      showToast('⏳ অর্ডার #' + orderId + ' আপডেট হচ্ছে...');
      try {
        var res = await fetch('/api/admin/orders/' + orderId + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        var data = await res.json();
        if (data.success) {
          showToast('✅ অর্ডার #' + orderId + ' স্ট্যাটাস: ' + newStatus);
        } else {
          showToast('❌ ' + (data.error || 'আপডেট করা যায়নি'), false);
        }
      } catch (err) {
        showToast('❌ সংযোগ সমস্যা: ' + err.message, false);
      }
    }

    // Global Cache Flush
    async function forceCacheRefresh() {
      showToast('⚡ ইঞ্জিন ক্যাশ রিফ্রেশ হচ্ছে...');
      try {
        var res = await fetch('/api/admin/engine/cache-refresh', { method: 'POST' });
        var data = await res.json();
        if (data.success) {
          showToast('✅ সকল স্টোরের ডেটা ও এআই ক্যাশ রিফ্রেশ সম্পন্ন!');
        } else {
          showToast('❌ ক্যাশ রিফ্রেশ ব্যর্থ: ' + data.error, false);
        }
      } catch (err) {
        showToast('❌ এরর: ' + err.message, false);
      }
    }

    // Realtime Client-Side Filtering
    function filterShopsRealtime(query) {
      var q = (query || '').toLowerCase().trim();
      var cards = document.querySelectorAll('#shopsGridContainer > div');
      for (var i = 0; i < cards.length; i++) {
        var text = cards[i].innerText.toLowerCase();
        cards[i].style.display = text.includes(q) ? '' : 'none';
      }
    }

    function filterOrdersRealtime(query) {
      var q = (query || '').toLowerCase().trim();
      var rows = document.querySelectorAll('.order-row');
      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].innerText.toLowerCase();
        rows[i].style.display = text.includes(q) ? '' : 'none';
      }
    }

    function filterOrdersByStatus(status) {
      var btns = document.querySelectorAll('.order-status-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].className = 'order-status-btn px-2.5 py-1 rounded-[8px] text-[11px] font-medium text-[rgba(235,235,245,0.6)]';
      }
      if (window.event && window.event.target) {
        window.event.target.className = 'order-status-btn px-2.5 py-1 rounded-[8px] text-[11px] font-medium bg-[#15171F] text-white';
      }

      var rows = document.querySelectorAll('.order-row');
      for (var j = 0; j < rows.length; j++) {
        if (status === 'ALL') {
          rows[j].style.display = '';
        } else {
          var rowText = rows[j].innerText;
          rows[j].style.display = rowText.includes(status) ? '' : 'none';
        }
      }
    }

    // Real-Time Live Pulse Engine (Zero-Refresh Background Polling)
    async function fetchLivePulse() {
      try {
        var curSeller = document.getElementById('shopFilterSelect') ? document.getElementById('shopFilterSelect').value : 'ALL';
        var res = await fetch('/api/admin/live-pulse?seller_id=' + curSeller);
        if (!res.ok) return;
        var data = await res.json();
        if (!data.success) return;

        // 1. Update Metrics Cards
        var m = data.metrics;
        document.getElementById('metricTotalShops').innerHTML = m.totalShops + 'টি <span class="text-xs text-[#30D158] font-medium">(' + m.onlineBots + ' লাইভ)</span>';
        document.getElementById('metricTotalProducts').innerText = m.totalPlatformProducts + 'টি পণ্য';
        document.getElementById('metricTotalOrders').innerText = m.totalPlatformOrders + 'টি';
        document.getElementById('metricTotalGMV').innerText = m.totalPlatformGMVFormatted;
        document.getElementById('headerGMV').innerText = m.totalPlatformGMVFormatted;
        document.getElementById('headerBotsCount').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span><span>' + m.onlineBots + '/' + m.totalShops + 'টি WhatsApp বট সক্রিয়</span>';
        document.getElementById('tabBadgeShops').innerText = m.totalShops;
        document.getElementById('tabBadgeOrders').innerText = data.latestOrders.length;

        // 2. Check for New Incoming Orders
        var hasNewOrder = false;
        var newestOrder = null;
        for (var i = 0; i < data.latestOrders.length; i++) {
          var ord = data.latestOrders[i];
          if (!knownOrderIds.has(ord.id)) {
            knownOrderIds.add(ord.id);
            hasNewOrder = true;
            newestOrder = ord;
          }
        }

        if (hasNewOrder && newestOrder) {
          playAppleChime();
          showToast('🎉 নতুন অর্ডার! #' + newestOrder.id + ' — ' + newestOrder.shop_name + ' (৳' + newestOrder.due_cod + ')');
        }

      } catch (err) {
        console.error('Pulse poll error:', err);
      }
    }

    function triggerManualPulse() {
      var sp = document.getElementById('syncSpinner');
      sp.classList.add('animate-spin');
      fetchLivePulse().finally(function() {
        setTimeout(function() { sp.classList.remove('animate-spin'); }, 600);
      });
    }

    // Heartbeat Interval
    setInterval(function() {
      countdownSec--;
      if (countdownSec <= 0) {
        countdownSec = 5;
        fetchLivePulse();
      }
      var el = document.getElementById('pulseCountdown');
      if (el) el.innerText = countdownSec + 's';
    }, 1000);

    // Onboarding Form Submission Handler
    async function handleNewShopSubmit(e, formId) {
      e.preventDefault();
      var form = document.getElementById(formId);
      var fd = new FormData(form);
      var payload = Object.fromEntries(fd.entries());

      try {
        var res = await fetch('/api/admin/shops/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          showToast('🎉 নতুন শপ তৈরি হয়েছে!');
          alert('শপ তৈরি সম্পন্ন! লিঙ্ক: ' + window.location.origin + '/portal?token=' + data.invite_token);
          setTimeout(function() { window.location.reload(); }, 1500);
        } else {
          alert('শপ তৈরিতে সমস্যা: ' + (data.error || 'এরর'));
        }
      } catch (err) {
        alert('কানেকশন সমস্যা: ' + err.message);
      }
    }

    // Auto-check URL for tab on load
    window.addEventListener('DOMContentLoaded', function() {
      var urlParams = new URLSearchParams(window.location.search);
      var reqTab = urlParams.get('tab');
      if (reqTab) {
        switchSuperTab(reqTab);
      }
    });
  </script>
</body>
</html>
      `);
    } catch (err) {
      res.status(500).send('Superadmin Error: ' + err.message);
    }
  });

  // ========================================================
  // GET /api/admin/live-pulse — Real-Time Engine Polling Endpoint
  // ========================================================
  router.get('/api/admin/live-pulse', async (req, res) => {
    try {
      const selectedSeller = req.query.seller_id || 'ALL';
      const [invitesRes, settingsRes, prodsRes, ordsRes, chatsRes] = await Promise.all([
        supabase.from('seller_invites').select('*').order('id', { ascending: true }),
        supabase.from('store_settings').select('seller_id, business_category, bot_persona_name'),
        supabase.from('products').select('id, seller_id, in_stock'),
        supabase.from('orders').select('*').order('id', { ascending: false }).limit(40),
        supabase.from('chat_sessions').select('*').order('updated_at', { ascending: false }).limit(20)
      ]);

      const allInvites = invitesRes.data || [];
      const allSettings = settingsRes.data || [];
      const allProducts = prodsRes.data || [];
      const allOrders = ordsRes.data || [];
      const recentChats = chatsRes.data || [];

      // Map shop names
      const shopNameMap = new Map();
      allInvites.forEach(inv => shopNameMap.set(inv.seller_id, inv.shop_name));
      shopNameMap.set('autodokan_seller_1', 'Dawah Fashion');

      const shops = allInvites.map(inv => {
        const sProds = allProducts.filter(p => p.seller_id === inv.seller_id);
        const sOrders = allOrders.filter(o => o.seller_id === inv.seller_id);
        const sChats = recentChats.filter(c => c.seller_id === inv.seller_id);
        const waInfo = getSellerWhatsAppInfo ? getSellerWhatsAppInfo(inv.seller_id) : { status: 'disconnected', number: null };
        const isOnline = waInfo.status === 'connected' || inv.status === 'CONNECTED';
        const revenue = sOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);
        const convRate = sChats.length > 0 ? Math.round((sOrders.length / sChats.length) * 100) : (sOrders.length > 0 ? 100 : 0);

        return {
          seller_id: inv.seller_id,
          shop_name: inv.shop_name,
          is_online: isOnline,
          live_number: waInfo.number || inv.phone || 'অনির্ধারিত',
          products_count: sProds.length,
          orders_count: sOrders.length,
          revenue: revenue,
          conversion_rate: convRate,
          plan: inv.role === 'admin' ? 'Enterprise' : (inv.status === 'SUSPENDED' ? 'Suspended' : 'Pro Growth'),
          status: inv.status || 'ACTIVE'
        };
      });

      const totalShops = shops.length;
      const onlineBots = shops.filter(s => s.is_online).length;
      const totalPlatformProducts = allProducts.length;
      const totalPlatformOrders = allOrders.length;
      const totalPlatformGMV = allOrders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 0), 0);

      const filteredOrders = selectedSeller === 'ALL' ? allOrders : allOrders.filter(o => o.seller_id === selectedSeller);
      const filteredChats = selectedSeller === 'ALL' ? recentChats : recentChats.filter(c => c.seller_id === selectedSeller);

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        metrics: {
          totalShops,
          onlineBots,
          totalPlatformProducts,
          totalPlatformOrders,
          totalPlatformGMV,
          totalPlatformGMVFormatted: formatMoney(totalPlatformGMV)
        },
        shops,
        latestOrders: filteredOrders.slice(0, 15).map(o => ({
          id: o.id,
          customer_name: o.customer_name || 'কাস্টমার',
          customer_phone: o.customer_phone || '',
          address: o.address || '',
          model_code: o.model_code || 'PROD',
          length_size: o.length_size || 'স্ট্যান্ডার্ড',
          due_cod: Number(o.due_cod) || Number(o.total_bdt) || 0,
          status: o.status || 'Pending',
          seller_id: o.seller_id,
          shop_name: shopNameMap.get(o.seller_id) || o.seller_id,
          created_at: o.created_at
        })),
        latestChats: filteredChats.slice(0, 10)
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // GET /api/admin/shops/:seller_id/qr — Live QR Code Endpoint
  // ========================================================
  router.get('/api/admin/shops/:seller_id/qr', async (req, res) => {
    try {
      const sellerId = req.params.seller_id;
      const waInfo = getSellerWhatsAppInfo ? getSellerWhatsAppInfo(sellerId) : null;
      if (waInfo && waInfo.status === 'connected') {
        return res.json({ status: 'connected', number: waInfo.number });
      }

      const qrString = sellerQRs ? sellerQRs.get(sellerId) : null;
      if (qrString) {
        const qrImage = await qrcode.toDataURL(qrString, { width: 300, margin: 2 });
        return res.json({ status: 'qr_ready', qr_image: qrImage });
      }

      return res.json({ status: 'waiting_for_qr' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ========================================================
  // GET & POST /api/admin/shops/:seller_id/settings — Store Config Fast Editor
  // ========================================================
  router.get('/api/admin/shops/:seller_id/settings', async (req, res) => {
    try {
      const sellerId = req.params.seller_id;
      const [invRes, setRes] = await Promise.all([
        supabase.from('seller_invites').select('shop_name, owner_name, phone').eq('seller_id', sellerId).single(),
        supabase.from('store_settings').select('*').eq('seller_id', sellerId).single()
      ]);

      const shopName = invRes.data?.shop_name || setRes.data?.shop_name || 'দোকান';
      return res.json({
        success: true,
        shop_name: shopName,
        settings: setRes.data || {}
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/admin/shops/:seller_id/settings', async (req, res) => {
    try {
      const sellerId = req.params.seller_id;
      const { shop_name, business_category, bot_persona_name, inside_dhaka_fee, outside_dhaka_fee, return_policy } = req.body;

      // Update store_settings
      const updatePayload = {
        inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
        outside_dhaka_fee: Number(outside_dhaka_fee) || 150
      };
      if (shop_name) updatePayload.shop_name = shop_name.trim();
      if (business_category) updatePayload.business_category = business_category.trim();
      if (bot_persona_name) updatePayload.bot_persona_name = bot_persona_name.trim();
      if (return_policy !== undefined) updatePayload.return_policy = return_policy.trim();

      await supabase.from('store_settings').update(updatePayload).eq('seller_id', sellerId);

      // Also update seller_invites shop_name if provided
      if (shop_name) {
        await supabase.from('seller_invites').update({ shop_name: shop_name.trim() }).eq('seller_id', sellerId);
      }

      // Refresh caches
      if (refreshSettingsFromDB) await refreshSettingsFromDB(sellerId);

      return res.json({ success: true, message: 'স্টোর সেটিংস সফলভাবে সংরক্ষিত ও সিঙ্ক করা হয়েছে!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/orders/:order_id/status — 1-Click Status Update
  // ========================================================
  router.post('/api/admin/orders/:order_id/status', async (req, res) => {
    try {
      const orderId = req.params.order_id;
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: 'Status is required' });

      const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
      if (error) throw error;

      return res.json({ success: true, message: `অর্ডার #${orderId} সফলভাবে ${status} করা হয়েছে!` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/messages/send-direct — WhatsApp Direct Intervention
  // ========================================================
  router.post('/api/admin/messages/send-direct', async (req, res) => {
    try {
      const { seller_id, phone, text } = req.body;
      if (!seller_id || !phone || !text) {
        return res.status(400).json({ error: 'seller_id, phone and text are required' });
      }

      const targetSock = sellerSockets ? sellerSockets.get(seller_id) : null;
      if (!targetSock) {
        return res.status(400).json({ error: 'এই শপের WhatsApp বট বর্তমানে সক্রিয় নেই।' });
      }

      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const num = cleanPhone.startsWith('88') ? cleanPhone : '88' + cleanPhone;
      const remoteJid = num + '@s.whatsapp.net';

      await targetSock.sendMessage(remoteJid, { text });

      return res.json({ success: true, message: 'বার্তা সফলভাবে পাঠানো হয়েছে!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/blacklist/add & remove — Central Scam Defense
  // ========================================================
  router.post('/api/admin/blacklist/add', async (req, res) => {
    try {
      const { phone, reason } = req.body;
      if (!phone) return res.status(400).json({ error: 'Phone is required' });

      const cleanPhone = phone.replace(/[^0-9]/g, '');

      // Load primary store settings extra_config
      const { data: primarySetting } = await supabase.from('store_settings').select('*').eq('seller_id', 'autodokan_seller_1').single();
      const currentConfig = (primarySetting && primarySetting.extra_config) || {};
      const list = currentConfig.central_blacklist || [];

      // Avoid duplicates
      const filtered = list.filter(item => item.phone !== cleanPhone);
      filtered.unshift({
        phone: cleanPhone,
        reason: reason || 'কুরিয়ার রিটার্ন ও ভুয়া অর্ডার',
        added_at: new Date().toISOString().split('T')[0]
      });

      currentConfig.central_blacklist = filtered;
      await supabase.from('store_settings').update({ extra_config: currentConfig }).eq('seller_id', 'autodokan_seller_1');

      if (refreshSettingsFromDB) await refreshSettingsFromDB('autodokan_seller_1');
      return res.json({ success: true, message: `${cleanPhone} ব্ল্যাকলিস্টে যুক্ত হয়েছে!` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/admin/blacklist/remove', async (req, res) => {
    try {
      const { phone } = req.body;
      const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

      const { data: primarySetting } = await supabase.from('store_settings').select('*').eq('seller_id', 'autodokan_seller_1').single();
      const currentConfig = (primarySetting && primarySetting.extra_config) || {};
      const list = currentConfig.central_blacklist || [];

      currentConfig.central_blacklist = list.filter(item => item.phone !== cleanPhone);
      await supabase.from('store_settings').update({ extra_config: currentConfig }).eq('seller_id', 'autodokan_seller_1');

      if (refreshSettingsFromDB) await refreshSettingsFromDB('autodokan_seller_1');
      return res.json({ success: true, message: 'নম্বর ব্ল্যাকলিস্ট থেকে অপসারিত হয়েছে!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/broadcasts/publish — Global Platform Announcement
  // ========================================================
  router.post('/api/admin/broadcasts/publish', async (req, res) => {
    try {
      const { title, message, send_whatsapp } = req.body;
      if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });

      const { data: primarySetting } = await supabase.from('store_settings').select('*').eq('seller_id', 'autodokan_seller_1').single();
      const currentConfig = (primarySetting && primarySetting.extra_config) || {};
      const list = currentConfig.platform_broadcasts || [];

      list.unshift({
        id: Date.now(),
        title: title.trim(),
        message: message.trim(),
        created_at: new Date().toISOString().split('T')[0],
        active: true
      });

      currentConfig.platform_broadcasts = list.slice(0, 10);
      await supabase.from('store_settings').update({ extra_config: currentConfig }).eq('seller_id', 'autodokan_seller_1');

      // If send_whatsapp requested, send to all registered merchants via active bot
      if (send_whatsapp && sellerSockets) {
        const { data: allInvites } = await supabase.from('seller_invites').select('phone, seller_id');
        const activeSock = sellerSockets.get('autodokan_seller_1') || [...sellerSockets.values()][0];
        if (activeSock && allInvites) {
          const broadcastText = `📢 [AutoDokan নোটিশ: ${title.trim()}]\n\n${message.trim()}`;
          for (const inv of allInvites) {
            if (inv.phone) {
              const cleanP = inv.phone.replace(/[^0-9]/g, '');
              const num = cleanP.startsWith('88') ? cleanP : '88' + cleanP;
              try {
                await activeSock.sendMessage(num + '@s.whatsapp.net', { text: broadcastText });
              } catch (e) {
                console.error(`Broadcast to ${inv.phone} failed:`, e.message);
              }
            }
          }
        }
      }

      if (refreshSettingsFromDB) await refreshSettingsFromDB('autodokan_seller_1');
      return res.json({ success: true, message: 'ব্রডকাস্ট সফলভাবে পাবলিশ করা হয়েছে!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/engine/cache-refresh — Global AI & Catalog Flush
  // ========================================================
  router.post('/api/admin/engine/cache-refresh', async (req, res) => {
    try {
      if (refreshSettingsFromDB) await refreshSettingsFromDB();
      if (refreshProductsFromDB) await refreshProductsFromDB();
      return res.json({ success: true, message: 'সকল স্টোরের এআই ও প্রোডাক্ট ক্যাশ রিফ্রেশ সম্পন্ন!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/shops/:seller_id/bot-restart — Remote Bot Session Control
  // ========================================================
  router.post('/api/admin/shops/:seller_id/bot-restart', async (req, res) => {
    try {
      const sellerId = req.params.seller_id;
      if (startSellerSession) {
        startSellerSession(sellerId);
        return res.json({ success: true, message: 'WhatsApp বট রিস্টার্ট ট্রিগার করা হয়েছে।' });
      }
      return res.status(400).json({ success: false, error: 'বট কন্ট্রোলার পাওয়া যায়নি।' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/shops/:seller_id/plan — SaaS Subscription Control
  // ========================================================
  router.post('/api/admin/shops/:seller_id/plan', async (req, res) => {
    try {
      const sellerId = req.params.seller_id;
      const { plan, status } = req.body;
      const updateData = {};
      if (status) updateData.status = status;
      if (plan) updateData.role = plan === 'Enterprise' ? 'admin' : 'merchant';

      const { error } = await supabase.from('seller_invites').update(updateData).eq('seller_id', sellerId);
      if (error) throw error;
      return res.json({ success: true, message: 'টেন্যান্ট সাবস্ক্রিপশন প্ল্যান আপডেট করা হয়েছে।' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // POST /api/admin/shops/create — Dynamic Shop Creation API
  // ========================================================
  router.post('/api/admin/shops/create', async (req, res) => {
    try {
      const { shop_name, owner_name, phone, business_category, bot_persona_name, inside_dhaka_fee, outside_dhaka_fee, plan } = req.body;
      if (!shop_name || !shop_name.trim()) {
        return res.status(400).json({ error: 'Shop name is required' });
      }

      const cleanShop = shop_name.trim();
      const cleanOwner = (owner_name || '').trim();
      const cleanPhone = (phone || '').trim();
      const cleanCategory = (business_category || 'general').trim();
      const cleanPersona = (bot_persona_name || 'AI ইনচার্জ').trim();
      const role = plan === 'Enterprise' ? 'admin' : 'merchant';

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
          role: role
        })
        .select('*')
        .single();

      if (invError) {
        return res.status(500).json({ error: invError.message });
      }

      // 2. Insert into store_settings with specified Category and Persona
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
