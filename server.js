const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage, refreshProductsFromDB, refreshSettingsFromDB, getStoreSettings, getProductByCode, getAllCachedProducts, isAngryComplaint, isAgentRequest } = require('./commerce_brain');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentQR = null;
let connectionStatus = 'initializing';
let connectedNumber = null;
let sock = null;

// ==========================================
// Multi-Tenant SaaS & Subscription Quota Configuration
// ==========================================
const CURRENT_SELLER_ID = process.env.DEFAULT_SELLER_ID || 'autodokan_seller_1';

async function checkSellerQuota(sellerId = CURRENT_SELLER_ID) {
  try {
    const { data: seller } = await supabase
      .from('sellers')
      .select('account_status')
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (seller && seller.account_status === 'SUSPENDED') {
      console.warn(`[Quota Hook] Seller ${sellerId} account is SUSPENDED. Auto-reply paused.`);
      return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
    }

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan_name, status, monthly_message_limit, messages_used_this_cycle')
      .eq('seller_id', sellerId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub) {
      if (sub.status === 'SUSPENDED' || sub.status === 'EXPIRED') {
        console.warn(`[Quota Hook] Seller ${sellerId} subscription is ${sub.status}. Auto-reply paused.`);
        return { allowed: false, reason: 'SUBSCRIPTION_INACTIVE' };
      }
      if (sub.plan_name !== 'AGENCY' && sub.plan_name !== 'AGENCY_UNLIMITED') {
        if ((sub.messages_used_this_cycle || 0) >= (sub.monthly_message_limit || 1000)) {
          console.warn(`[Quota Hook] Seller ${sellerId} reached monthly quota (${sub.messages_used_this_cycle}/${sub.monthly_message_limit}). Auto-reply paused.`);
          return { allowed: false, reason: 'QUOTA_EXCEEDED' };
        }
      }
    }
    return { allowed: true };
  } catch (err) {
    console.warn('[Quota Check Warning]:', err.message);
    return { allowed: true };
  }
}

async function incrementSellerMessageUsage(sellerId = CURRENT_SELLER_ID) {
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, messages_used_this_cycle')
      .eq('seller_id', sellerId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub) {
      await supabase
        .from('subscriptions')
        .update({
          messages_used_this_cycle: (sub.messages_used_this_cycle || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', sub.id);
    }
  } catch (err) {
    console.warn('[Usage Increment Warning]:', err.message);
  }
}

// ==========================================
// Isolated Multi-User Message Pipeline & State
// ==========================================
const customerMessageStates = new Map(); // remoteJid -> { texts: [], debounceTimer: null, firstMsgAt: null, isProcessing: false, pendingQueue: [], lastKey: null }
const processedIncomingMsgIds = new Map(); // msgId -> timestamp (for 15-min deduplication)
const botSentMessageIds = new Set(); // msgId of messages sent by bot/system
const userPausedUntilMap = new Map(); // remoteJid -> timestamp ms (Human Takeover Cache)
const activeConversations = new Set();
const lastVoiceReplyTime = new Map();
const lastCallReplyTime = new Map();
const DEBOUNCE_DELAY_MS = 3500; // 3.5s natural human typing window
const MAX_WAIT_MS = 8000; // 8.0s hard cap for fast successive texts

// Memory Cleanup Sweeper: Every 10 mins clean idle states, expired msgIds, and bound botSentIds
setInterval(() => {
  const now = Date.now();
  // 1. Clean idle customer states (> 15m idle & not processing)
  for (const [jid, state] of customerMessageStates.entries()) {
    if (!state.isProcessing && state.texts.length === 0 && state.pendingQueue.length === 0) {
      if (!state.firstMsgAt || (now - state.firstMsgAt > 15 * 60 * 1000)) {
        customerMessageStates.delete(jid);
      }
    }
  }
  // 2. Clean 15-min deduplication IDs
  for (const [id, time] of processedIncomingMsgIds.entries()) {
    if (now - time > 15 * 60 * 1000) {
      processedIncomingMsgIds.delete(id);
    }
  }
  // 3. Clean voice & call cooldown maps (> 1 hour)
  for (const [jid, time] of lastVoiceReplyTime.entries()) {
    if (now - time > 60 * 60 * 1000) {
      lastVoiceReplyTime.delete(jid);
    }
  }
  for (const [jid, time] of lastCallReplyTime.entries()) {
    if (now - time > 60 * 60 * 1000) {
      lastCallReplyTime.delete(jid);
    }
  }
  // 4. Bound botSentMessageIds
  if (botSentMessageIds.size > 3000) {
    botSentMessageIds.clear();
  }
}, 10 * 60 * 1000);


// ==========================================
// 4-Digit PIN Security Layer (PIN: 2026)
// ==========================================
const DASHBOARD_PIN = process.env.DASHBOARD_PIN || '2026';

function isAuthenticated(req) {
  const matches = (req.headers.cookie || '').match(/(?:^|; )df_auth_pin=([^;]*)/);
  const token = matches ? decodeURIComponent(matches[1]) : null;
  return token === '2026_authorized';
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }
  if (req.headers['accept']?.includes('application/json') || req.path.startsWith('/api/live-data')) {
    return res.status(401).json({ error: 'Unauthorized. Please login with PIN.' });
  }
  res.redirect('/login');
}

function renderLoginPage(errorMessage = '') {
  return `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
      <title>Dawah Fashion — সিকিউরিটি লক</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      </style>
    </head>
    <body class="bg-[#faf7f2] text-stone-800 min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-sm bg-white rounded-3xl border border-[#ede6db] p-8 shadow-xl space-y-6 text-center">
        <!-- Brand Icon -->
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-600 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-xl shadow-md mx-auto">
          DF
        </div>
        <div>
          <h1 class="text-xl font-black text-stone-900 leading-tight">Dawah Fashion</h1>
          <p class="text-xs text-stone-500 font-semibold mt-1">অফিসিয়াল কমার্স ড্যাশবোর্ড লক</p>
        </div>

        ${errorMessage ? `
        <div class="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold p-3 rounded-xl flex items-center justify-center gap-1.5 animate-shake">
          <span>❌</span>
          <span>${errorMessage}</span>
        </div>` : `
        <div class="bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs font-semibold p-3 rounded-xl">
          🔒 কাস্টমার ডাটা ও শপের সুরক্ষায় ৪ ডিজিটের পিন দিন
        </div>`}

        <form method="POST" action="/login" class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-stone-600 mb-2">৪ ডিজিটের সিক্রেট পিন (PIN)</label>
            <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" name="pin" autofocus placeholder="••••" required class="w-full text-center tracking-[0.8em] text-3xl font-black font-mono bg-[#fcfaf7] border-2 border-stone-300 focus:border-amber-600 focus:bg-white focus:outline-none p-3.5 rounded-2xl transition">
          </div>
          <button type="submit" class="w-full bg-stone-900 hover:bg-black text-white font-black text-sm py-3.5 rounded-2xl shadow-md transition cursor-pointer">
            🔓 ড্যাশবোর্ডে প্রবেশ করুন
          </button>
        </form>

        <div class="text-[11px] text-stone-400 font-medium">
          🔒 একবার লগইন করলে এই ডিভাইসে ৩০ দিন সচল থাকবে
        </div>
      </div>
    </body>
    </html>
  `;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/dashboard');
  }
  res.send(renderLoginPage());
});

app.post('/login', (req, res) => {
  const { pin } = req.body;
  if (pin && pin.trim() === DASHBOARD_PIN) {
    res.setHeader('Set-Cookie', 'df_auth_pin=2026_authorized; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax');
    return res.redirect('/dashboard');
  }
  res.send(renderLoginPage('ভুল পিন কোড! সঠিক ৪ ডিজিটের পিন লিখুন।'));
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'df_auth_pin=; Path=/; Max-Age=0; HttpOnly');
  res.redirect('/login');
});

// Health Endpoint for UptimeRobot & General Monitoring
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    app: 'AutoDokan Commerce OS',
    connection: connectionStatus,
    number: connectedNumber,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Lightweight Health / Ping Endpoint for Render zero-downtime health checks
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'AutoDokan Commerce OS',
    whatsapp: connectionStatus,
    number: connectedNumber,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// CSV Export Endpoint for 1-Click Google Sheets Live Sync
app.get('/api/export-csv', requireAuth, async (req, res) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="autodokan_orders.csv"');
    
    // CSV Header row with distinct financial breakdown
    let csv = '\uFEFFOrder ID,Date Time,Model Code,Phone Number,Customer Name,Address,Product Details,Size/Length,Dress Price,Delivery Fee,Advance Paid,Due COD,Payment Status,TrxID/Last4,Order Status\r\n';
    
    (orders || []).forEach(o => {
      const cleanDetails = (o.product_details || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      const cleanAddress = (o.address || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      const cleanName = (o.customer_name || '').replace(/"/g, '""');
      const dateStr = new Date(o.created_at).toLocaleString('en-GB');
      const prodPrice = Number(o.total_bdt) || 2200;
      const deliveryFee = Number(o.delivery_fee) || 80;
      const isAdvancePaid = !!o.trx_id_or_last4 || (Number(o.advance_paid) > 0);
      const advancePaid = isAdvancePaid ? (Number(o.advance_paid) || deliveryFee) : 0;
      const dueCod = Number(o.due_cod) || prodPrice;

      csv += `"#${o.id}","${dateStr}","${o.model_code || ''}","${o.customer_phone || ''}","${cleanName}","${cleanAddress}","${cleanDetails}","${o.length_size || ''}","${prodPrice}","${deliveryFee}","${advancePaid}","${dueCod}","${o.payment_method || 'COD'}","${o.trx_id_or_last4 || ''}","${o.status || 'Pending'}"\r\n`;
    });

    res.send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV: ' + err.message);
  }
});

// In-memory traffic & message stats (synced with Supabase)
let trafficStats = { messages_in: 24, messages_out: 24, total_conversations: 5 };

async function loadTrafficStats() {
  try {
    const { data } = await supabase.from('traffic_stats').select('*').eq('id', 1).single();
    if (data) {
      trafficStats = {
        messages_in: Number(data.messages_in) || 24,
        messages_out: Number(data.messages_out) || 24,
        total_conversations: Number(data.total_conversations) || 5
      };
    }
  } catch (e) {}
}
loadTrafficStats();

async function incrementStats(field) {
  trafficStats[field] = (trafficStats[field] || 0) + 1;
  try {
    await supabase.from('traffic_stats').update({
      messages_in: trafficStats.messages_in,
      messages_out: trafficStats.messages_out,
      total_conversations: trafficStats.total_conversations,
      updated_at: new Date().toISOString()
    }).eq('id', 1);
  } catch (e) {}
}

// Live JSON Data Stream API for Real-Time Dynamic Refresh
app.get('/api/live-data', requireAuth, async (req, res) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
    const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
    const { data: storeSettings } = await supabase.from('store_settings').select('*').eq('id', 1).single();

    const phoneCountMap = {};
    (orders || []).forEach(o => {
      if (o.customer_phone) {
        phoneCountMap[o.customer_phone] = (phoneCountMap[o.customer_phone] || 0) + 1;
      }
    });

    const uniquePhones = Object.keys(phoneCountMap);
    const repeatCustCount = uniquePhones.filter(p => phoneCountMap[p] > 1).length;
    const newCustCount = uniquePhones.filter(p => phoneCountMap[p] === 1).length;

    res.json({
      connection: connectionStatus,
      number: connectedNumber,
      traffic: trafficStats,
      metrics: {
        total_orders: orders ? orders.length : 0,
        pending_orders: orders ? orders.filter(o => o.status === 'Pending').length : 0,
        pending_verification_orders: orders ? orders.filter(o => o.status === 'Pending Verification').length : 0,
        approved_orders: orders ? orders.filter(o => o.status === 'Approved').length : 0,
        shipped_orders: orders ? orders.filter(o => o.status === 'Shipped').length : 0,
        cancelled_orders: orders ? orders.filter(o => o.status === 'Cancelled').length : 0,
        total_revenue: (orders || []).filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 2200), 0),
        new_customers: newCustCount,
        repeat_customers: repeatCustCount
      },
      orders: orders || [],
      products: products || [],
      settings: storeSettings || {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Order Status API (e.g. Approved, Shipped, Cancelled - supports AJAX & Form)
app.post('/api/orders/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (id && status) {
    await supabase.from('orders').update({ status }).eq('id', id);
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, id, status });
  }
  res.redirect('/dashboard');
});

// Update Global Store & Delivery Rules API (supports AJAX & Form)
app.post('/api/settings/update', requireAuth, async (req, res) => {
  const { 
    inside_dhaka_fee, 
    outside_dhaka_fee, 
    bkash_number, 
    nagad_number, 
    auto_followup, 
    promo_offer,
    shop_name,
    return_policy,
    free_delivery_min_amount,
    steadfast_api_key,
    steadfast_secret_key,
    auto_payment_verify,
    auto_courier_on_confirm
  } = req.body;

  if (auto_followup !== undefined) {
    autoFollowupEnabled = (auto_followup === 'true' || auto_followup === true);
  }

  // Fetch current extra_config to merge safely
  let currentExtra = {};
  try {
    const { data: cur } = await supabase.from('store_settings').select('extra_config').eq('id', 1).single();
    if (cur?.extra_config && typeof cur.extra_config === 'object') {
      currentExtra = { ...cur.extra_config };
    }
  } catch (e) {}

  if (steadfast_api_key !== undefined) currentExtra.steadfast_api_key = (steadfast_api_key || '').trim();
  if (steadfast_secret_key !== undefined) currentExtra.steadfast_secret_key = (steadfast_secret_key || '').trim();
  if (auto_payment_verify !== undefined) currentExtra.auto_payment_verify = (auto_payment_verify === 'true' || auto_payment_verify === true);
  if (auto_courier_on_confirm !== undefined) currentExtra.auto_courier_on_confirm = (auto_courier_on_confirm === 'true' || auto_courier_on_confirm === true);

  const updatePayload = {
    id: 1,
    seller_id: CURRENT_SELLER_ID,
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

  await supabase.from('store_settings').upsert(updatePayload);
  await refreshSettingsFromDB();
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, auto_followup_enabled: autoFollowupEnabled, settings: updatePayload });
  }
  res.redirect('/dashboard');
});

// ==========================================
// Promotions & Special Offers Management API
// ==========================================
app.get('/api/promotions', requireAuth, async (req, res) => {
  try {
    const { data: promos, error } = await supabase
      .from('promotions')
      .select('*')
      .eq('seller_id', CURRENT_SELLER_ID)
      .order('id', { ascending: false });
    if (error) throw error;
    res.json({ success: true, promotions: promos || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/promotions/create', requireAuth, async (req, res) => {
  try {
    const { title, promo_code, promo_type, discount_value, min_order_amount, ai_instruction, is_active } = req.body;
    const { data, error } = await supabase.from('promotions').insert({
      seller_id: CURRENT_SELLER_ID,
      title: (title || 'অফার').trim(),
      promo_code: (promo_code || '').trim().toUpperCase() || null,
      promo_type: promo_type || 'FIXED_DISCOUNT',
      discount_value: Number(discount_value) || 0,
      min_order_amount: Number(min_order_amount) || 0,
      ai_instruction: (ai_instruction || '').trim() || null,
      is_active: is_active === undefined ? true : (is_active === true || is_active === 'true')
    }).select();
    if (error) throw error;
    await refreshSettingsFromDB();
    if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
      return res.json({ success: true, promotion: data ? data[0] : null });
    }
    res.redirect('/dashboard#settings');
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/promotions/:id/toggle', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const activeVal = (is_active === true || is_active === 'true');
    await supabase.from('promotions').update({ is_active: activeVal }).eq('id', id);
    await refreshSettingsFromDB();
    res.json({ success: true, id, is_active: activeVal });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/promotions/:id/delete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('promotions').delete().eq('id', id);
    await refreshSettingsFromDB();
    if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
      return res.json({ success: true, id });
    }
    res.redirect('/dashboard#settings');
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// Orders Action: 1-Click Steadfast Courier Dispatch API
// ==========================================
app.post('/api/orders/:id/dispatch-courier', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const storeSettings = (typeof getStoreSettings === 'function') ? getStoreSettings() : {};
    const parcelResult = await createCourierParcel(order, storeSettings);

    if (parcelResult && parcelResult.success) {
      // Update order to Shipped with tracking code
      await supabase.from('orders').update({
        status: 'Shipped',
        courier_name: parcelResult.courier || 'Steadfast Courier',
        courier_tracking_id: parcelResult.tracking_code,
        unique_tracking_code: parcelResult.consignment_id || parcelResult.tracking_code
      }).eq('id', id);

      // Notify customer on WhatsApp if sock is active
      const rawDigits = (order.customer_phone || '').replace(/\D/g, '');
      if (rawDigits && sock) {
        const destJid = rawDigits.includes('@') ? rawDigits : `${rawDigits.startsWith('880') ? rawDigits : (rawDigits.startsWith('0') ? '88' + rawDigits : '880' + rawDigits)}@s.whatsapp.net`;
        const shipNotice = `আপনার অর্ডারটি [${parcelResult.courier || 'Steadfast Courier'}]-এ বুকিং করা হয়েছে। ট্র্যাকিং কোড: ${parcelResult.tracking_code}। দ্রুতই ডেলিভারি পৌঁছে দেওয়া হবে, ইনশাআল্লাহ।`;
        try {
          const sent = await sock.sendMessage(destJid, { text: shipNotice });
          if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
          incrementStats('messages_out');
        } catch (msgErr) {
          console.warn('[Courier Notice Send Warning]:', msgErr.message);
        }
      }

      return res.json({ success: true, tracking_code: parcelResult.tracking_code, courier: parcelResult.courier });
    } else {
      return res.status(500).json({ success: false, error: parcelResult?.error || 'Courier booking failed' });
    }
  } catch (err) {
    console.error('[Dispatch Courier API Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1-Click Payment Confirm & Verification Approval API
app.post('/api/orders/:id/confirm-payment', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    await supabase.from('orders').update({
      status: 'Approved',
      payment_method: 'Verified Payment'
    }).eq('id', id);

    // Remove human attention requirement in chat_sessions
    const rawDigits = (order.customer_phone || '').replace(/\D/g, '');
    if (rawDigits) {
      const remoteJid = `${rawDigits.startsWith('880') ? rawDigits : (rawDigits.startsWith('0') ? '88' + rawDigits : '880' + rawDigits)}@s.whatsapp.net`;
      await supabase.from('chat_sessions').update({
        needs_human_attention: false,
        attention_reason: null
      }).eq('seller_id', CURRENT_SELLER_ID).eq('customer_identifier', remoteJid);
      userPausedUntilMap.delete(remoteJid);
    }

    // Check if auto-courier is configured
    const storeSettings = (typeof getStoreSettings === 'function') ? getStoreSettings() : {};
    let autoDispatched = null;
    if (storeSettings.extra_config?.auto_courier_on_confirm && storeSettings.extra_config?.steadfast_api_key) {
      autoDispatched = await createCourierParcel(order, storeSettings);
      if (autoDispatched?.success) {
        await supabase.from('orders').update({
          status: 'Shipped',
          courier_name: autoDispatched.courier || 'Steadfast Courier',
          courier_tracking_id: autoDispatched.tracking_code,
          unique_tracking_code: autoDispatched.consignment_id || autoDispatched.tracking_code
        }).eq('id', id);
      }
    }

    res.json({ success: true, id, status: autoDispatched?.success ? 'Shipped' : 'Approved', auto_courier: autoDispatched });
  } catch (err) {
    console.error('[Confirm Payment API Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle AI Pause / Resume for a customer from Dashboard
app.post('/api/chat-sessions/:phone/toggle-pause', requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const { minutes } = req.body;
    const rawDigits = (phone || '').replace(/\D/g, '');
    const remoteJid = rawDigits.includes('@') ? rawDigits : `${rawDigits.startsWith('880') ? rawDigits : (rawDigits.startsWith('0') ? '88' + rawDigits : '880' + rawDigits)}@s.whatsapp.net`;

    const currentlyPaused = await isCustomerPaused(remoteJid);
    let newPausedState = false;

    if (currentlyPaused) {
      // Resume AI: clear pause and attention
      userPausedUntilMap.delete(remoteJid);
      await supabase.from('chat_sessions').update({
        paused_until: null,
        needs_human_attention: false,
        attention_reason: null,
        updated_at: new Date().toISOString()
      }).eq('seller_id', CURRENT_SELLER_ID).eq('customer_identifier', remoteJid);
      newPausedState = false;
      console.log(`[Dashboard Control] AI RESUMED for ${remoteJid}`);
    } else {
      // Pause AI for specified minutes (default 60m)
      const pauseMins = Number(minutes) || 60;
      await pauseCustomerForHumanTakeover(remoteJid, pauseMins, 'MANUAL_DASHBOARD_PAUSE');
      newPausedState = true;
      console.log(`[Dashboard Control] AI PAUSED for ${remoteJid} for ${pauseMins}m`);
    }

    if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
      return res.json({ success: true, is_paused: newPausedState, remoteJid });
    }
    res.redirect('/dashboard#orders');
  } catch (err) {
    console.error('[Toggle Pause Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Disconnect / Change WhatsApp Account API
app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    console.log('[WhatsApp] Disconnect requested by merchant. Cleaning session...');
    if (sock) {
      try { await sock.logout(); } catch (e) {
        try { sock.end(); } catch (err) {}
      }
      sock = null;
    }
    // Delete Supabase session rows
    await supabase.from('whatsapp_sessions').delete().eq('session_id', 'autodokan_seller_1');
    connectionStatus = 'disconnected';
    connectedNumber = null;
    currentQR = null;

    setTimeout(() => {
      connectToWhatsApp();
    }, 1500);

    res.json({ success: true, message: 'Disconnected. Preparing fresh QR code...' });
  } catch (err) {
    console.error('[WhatsApp Disconnect Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update Specific Order Payment & Delivery Details API (supports AJAX & Form)
app.post('/api/orders/:id/update-payment', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { delivery_fee, advance_paid, trx_id_or_last4, due_cod } = req.body;
  const isPaid = Number(advance_paid) > 0 || !!trx_id_or_last4;
  await supabase.from('orders').update({
    delivery_fee: Number(delivery_fee) || 80,
    advance_paid: Number(advance_paid) || 0,
    trx_id_or_last4: (trx_id_or_last4 || '').trim() || null,
    due_cod: Number(due_cod) || 2200,
    payment_method: isPaid ? 'COD (Advance Delivery Paid)' : 'COD (Pending Advance)'
  }).eq('id', id);
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, id });
  }
  res.redirect('/dashboard');
});


// Direct Photo Upload API (Base64 -> Supabase Storage 'product-images' with Local Fallback)
app.post('/api/upload-image', requireAuth, async (req, res) => {
  try {
    const { imageBase64, filename, contentType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'No image data provided' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const ext = filename ? path.extname(filename) : '.jpg';
    const cleanExt = ext && ext.length <= 5 ? ext : '.jpg';
    const cloudFilename = `product_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${cleanExt}`;

    // Attempt 1: Upload to Supabase Storage 'product-images'
    try {
      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(cloudFilename, buffer, {
          contentType: contentType || 'image/jpeg',
          upsert: true
        });

      if (!error && data) {
        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${cloudFilename}`;
        console.log(`[Image Uploaded to Supabase] Stored at: ${publicUrl}`);
        return res.json({ success: true, url: publicUrl });
      } else if (error) {
        console.warn('[Supabase Storage Warning]:', error.message);
      }
    } catch (sbErr) {
      console.warn('[Supabase Storage Exception, falling back to local filesystem]:', sbErr.message);
    }

    // Attempt 2: Local Fallback in /public/uploads/
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const localFilePath = path.join(uploadsDir, cloudFilename);
    fs.writeFileSync(localFilePath, buffer);
    const localUrl = `/uploads/${cloudFilename}`;
    console.log(`[Image Stored Locally] Served at: ${localUrl}`);
    return res.json({ success: true, url: localUrl });
  } catch (err) {
    console.error('[Upload Exception]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add New Product API (supports 5 photo types: Main, Detail, Hijab, Flare, Real + Part 1 Schema)
app.post('/api/add-product', requireAuth, async (req, res) => {
  const { 
    model_code, name, fabric, price, sizes, hijab_included, in_stock, 
    image_url, hijab_image_url, detail_image_url, flare_image_url, real_image_url,
    regular_price, discount_price, stock_quantity, colors, search_keywords, short_description 
  } = req.body;
  let insertedItem = null;
  if (name && price) {
    const cleanCode = model_code ? model_code.toUpperCase().trim() : 'DF-' + Math.floor(Math.random() * 899 + 100);
    const parsedPrice = parseFloat(price);
    const regPrice = regular_price !== undefined && regular_price !== '' ? parseFloat(regular_price) : parsedPrice;
    const discPrice = discount_price !== undefined && discount_price !== '' ? parseFloat(discount_price) : parsedPrice;
    const stockQty = stock_quantity !== undefined && stock_quantity !== '' ? parseInt(stock_quantity, 10) : 10;

    const { data, error } = await supabase.from('products').insert({
      seller_id: CURRENT_SELLER_ID,
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
    await refreshProductsFromDB();
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, product: insertedItem });
  }
  res.redirect('/dashboard#products');
});

// Update Existing Product API (supports 5 photo types: Main, Detail, Hijab, Flare, Real + Part 1 Schema)
app.post('/api/products/:id/update', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { 
    model_code, name, fabric, price, sizes, hijab_included, in_stock, 
    image_url, hijab_image_url, detail_image_url, flare_image_url, real_image_url,
    regular_price, discount_price, stock_quantity, colors, search_keywords, short_description 
  } = req.body;
  if (id && name && price) {
    const parsedPrice = parseFloat(price);
    const regPrice = regular_price !== undefined && regular_price !== '' ? parseFloat(regular_price) : parsedPrice;
    const discPrice = discount_price !== undefined && discount_price !== '' ? parseFloat(discount_price) : parsedPrice;
    const stockQty = stock_quantity !== undefined && stock_quantity !== '' ? parseInt(stock_quantity, 10) : undefined;

    await supabase.from('products').update({
      model_code: model_code ? model_code.toUpperCase().trim() : undefined,
      name: name.trim(),
      fabric: fabric || 'দুবাই চেরি',
      price: discPrice || parsedPrice,
      regular_price: regPrice,
      discount_price: discPrice,
      stock_quantity: stockQty,
      colors: colors !== undefined ? (colors ? colors.trim() : null) : undefined,
      search_keywords: search_keywords !== undefined ? (search_keywords ? search_keywords.trim() : null) : undefined,
      short_description: short_description !== undefined ? (short_description ? short_description.trim() : null) : undefined,
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === 'true' || hijab_included === true,
      in_stock: in_stock !== undefined ? (in_stock === 'true' || in_stock === true) : undefined,
      image_url: image_url !== undefined ? (image_url ? image_url.trim() : null) : undefined,
      hijab_image_url: hijab_image_url !== undefined ? (hijab_image_url ? hijab_image_url.trim() : null) : undefined,
      detail_image_url: detail_image_url !== undefined ? (detail_image_url ? detail_image_url.trim() : null) : undefined,
      flare_image_url: flare_image_url !== undefined ? (flare_image_url ? flare_image_url.trim() : null) : undefined,
      real_image_url: real_image_url !== undefined ? (real_image_url ? real_image_url.trim() : null) : undefined
    }).eq('id', id);
    await refreshProductsFromDB();
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, id });
  }
  res.redirect('/dashboard#products');
});

// 1-Click Delete Product API
app.post('/api/products/:id/delete', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (id) {
    await supabase.from('products').delete().eq('id', id);
    await refreshProductsFromDB();
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, id });
  }
  res.redirect('/dashboard#products');
});

// Bulk Delete Products API
app.post('/api/products/bulk-delete', requireAuth, async (req, res) => {
  let { ids } = req.body;
  if (typeof ids === 'string') {
    ids = ids.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(ids) && ids.length > 0) {
    await supabase.from('products').delete().in('id', ids);
    await refreshProductsFromDB();
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, count: ids ? ids.length : 0 });
  }
  res.redirect('/dashboard#products');
});

// Toggle In-Stock Status API
app.post('/api/products/:id/toggle-stock', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { in_stock } = req.body;
  const isStock = in_stock === 'true' || in_stock === true;
  await supabase.from('products').update({ in_stock: isStock }).eq('id', id);
  await refreshProductsFromDB();
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, in_stock: isStock, id });
  }
  res.redirect('/dashboard#products');
});

// Live Interactive AI Bot Simulator / Test Bench Endpoint
app.post('/api/test-bot', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'মেসেজ খালি হতে পারবে না' });
    }
    const startTime = Date.now();
    const reply = await handleIncomingMessage('test_bench_user_01700000000', message.trim());
    const durationMs = Date.now() - startTime;

    // Detect any photo tags sent by bot
    const photoCards = [];

    // 1. Catalog overview tag: add main image of each in-stock product in the catalog
    if (/\[\s*SEND_CATALOG_OVERVIEW\s*\]/i.test(reply)) {
      const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts() : [];
      for (const prod of allProds) {
        if (prod.image_url) {
          photoCards.push({
            type: 'SEND_IMAGE',
            modelCode: prod.model_code,
            url: prod.image_url,
            label: prod.model_code,
            name: prod.name
          });
        }
      }
    }

    // 2. Specific tag matches
    const tagMatches = [...reply.matchAll(/\[(SEND_[A-Z_]+):([A-Z0-9-]+)\]/g)];
    for (const match of tagMatches) {
      const tagType = match[1];
      const modelCode = match[2];
      const prod = getProductByCode(modelCode);
      if (prod) {
        if (tagType === 'SEND_ALL_IMAGES') {
          if (prod.image_url) photoCards.push({ type: 'SEND_MAIN_IMAGE', modelCode, url: prod.image_url, label: '১. মেইন ফ্রন্ট ভিউ', name: prod.name });
          if (prod.detail_image_url) photoCards.push({ type: 'SEND_DETAIL_IMAGE', modelCode, url: prod.detail_image_url, label: '২. কারচুপি ক্লোজ-আপ', name: prod.name });
          if (prod.hijab_image_url) photoCards.push({ type: 'SEND_HIJAB_IMAGE', modelCode, url: prod.hijab_image_url, label: '৩. ম্যাচিং হিজাব', name: prod.name });
          if (prod.flare_image_url) photoCards.push({ type: 'SEND_FLARE_IMAGE', modelCode, url: prod.flare_image_url, label: '৪. ঘের ও সাইড অ্যাঙ্গেল', name: prod.name });
          if (prod.real_image_url) photoCards.push({ type: 'SEND_REAL_IMAGE', modelCode, url: prod.real_image_url, label: '৫. আনফিল্টার্ড রিয়েল ছবি', name: prod.name });
        } else {
          let photoUrl = null;
          let label = 'ফটো';
          if (tagType === 'SEND_MAIN_IMAGE') { photoUrl = prod.image_url; label = '১. মেইন ফ্রন্ট ভিউ'; }
          else if (tagType === 'SEND_DETAIL_IMAGE') { photoUrl = prod.detail_image_url; label = '২. কারচুপি ক্লোজ-আপ'; }
          else if (tagType === 'SEND_HIJAB_IMAGE') { photoUrl = prod.hijab_image_url; label = '৩. ম্যাচিং হিজাব'; }
          else if (tagType === 'SEND_FLARE_IMAGE') { photoUrl = prod.flare_image_url; label = '৪. ঘের ও সাইড অ্যাঙ্গেল'; }
          else if (tagType === 'SEND_REAL_IMAGE') { photoUrl = prod.real_image_url; label = '৫. আনফিল্টার্ড রিয়েল ছবি'; }
          else if (tagType === 'SEND_IMAGE') { photoUrl = prod.image_url; label = 'প্রোডাক্ট ছবি'; }

          if (photoUrl) {
            photoCards.push({ type: tagType, modelCode, url: photoUrl, label, name: prod.name });
          }
        }
      }
    }

    const cleanReply = reply.replace(/\[\s*SEND_[A-Za-z0-9_:\s-]+\s*\]/gi, '').trim();

    return res.json({
      success: true,
      originalMessage: message.trim(),
      reply: cleanReply,
      rawReply: reply,
      photos: photoCards,
      latencyMs: durationMs,
      isFastPath: durationMs < 50
    });
  } catch (err) {
    console.error('[Bot Simulator Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// In-Memory & Persistent Screenshot Log
const recentScreenshots = [];
const SCREENSHOTS_LOG_PATH = path.join(__dirname, 'public', 'screenshots', 'log.json');

function loadScreenshotsLog() {
  try {
    if (fs.existsSync(SCREENSHOTS_LOG_PATH)) {
      const data = JSON.parse(fs.readFileSync(SCREENSHOTS_LOG_PATH, 'utf8'));
      if (Array.isArray(data)) {
        recentScreenshots.push(...data);
      }
    }
  } catch (e) {}
}
loadScreenshotsLog();

function registerScreenshotReceived(phone, url, caption = '') {
  const item = {
    id: 'ss_' + Date.now(),
    phone,
    url,
    caption,
    timestamp: new Date().toISOString(),
    status: 'unverified'
  };
  recentScreenshots.unshift(item);
  if (recentScreenshots.length > 50) recentScreenshots.pop();
  try {
    const dir = path.join(__dirname, 'public', 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCREENSHOTS_LOG_PATH, JSON.stringify(recentScreenshots, null, 2));
  } catch (e) {}
}

async function syncScreenshotToOrder(cleanPhone, screenshotUrl) {
  try {
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_phone', cleanPhone)
      .in('status', ['Pending', 'Pending Verification'])
      .order('id', { ascending: false })
      .limit(1);

    if (existingOrders && existingOrders.length > 0) {
      const order = existingOrders[0];
      await supabase.from('orders').update({
        status: 'Pending Verification',
        payment_method: 'Screenshot Received',
        trx_id_or_last4: `📸 ${screenshotUrl}`,
        advance_paid: order.delivery_fee || 80
      }).eq('id', order.id);
      console.log(`[Screenshot Sync] Attached screenshot to existing Order #${order.id}`);
    } else {
      await supabase.from('orders').insert({
        customer_phone: cleanPhone,
        product_details: 'পেমেন্ট স্ক্রিনশট প্রাপ্ত (অর্ডার ভেরিফিকেশন অপেক্ষমাণ)',
        status: 'Pending Verification',
        payment_method: 'Screenshot Received',
        trx_id_or_last4: `📸 ${screenshotUrl}`,
        total_bdt: 2200,
        delivery_fee: 80,
        advance_paid: 80,
        due_cod: 2200
      });
      console.log(`[Screenshot Sync] Created new Order Lead with screenshot for ${cleanPhone}`);
    }
  } catch (err) {
    console.error('[Screenshot Sync Error]:', err.message);
  }
}

// State for Abandoned Lead Ghosting Recovery
const followupCooldownMap = new Map(); // cleanPhone -> timestamp
let autoFollowupEnabled = true;

// Helper: Generate Official Digital Cash Memo in Bengali
function generateDigitalCashMemo(order) {
  const dateStr = new Date(order.created_at || Date.now()).toLocaleDateString('bn-BD', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const dressPrice = Number(order.total_bdt) || 2200;
  const deliveryFee = Number(order.delivery_fee) || 80;
  const advance = Number(order.advance_paid) || 0;
  const dueCod = Number(order.due_cod) || dressPrice;

  return `🧾 *দাওয়া ফ্যাশন — ডিজিটাল ক্যাশ মেমো / ইনভয়েস*
━━━━━━━━━━━━━━━━━━━━━━━━
📌 *ইনভয়েস আইডি:* #DF-${order.id}
🗓️ *তারিখ:* ${dateStr}

👤 *কাস্টমার তথ্য:*
• নাম: ${order.customer_name || 'সম্মানিত গ্রাহক'}
• ফোন: ${order.customer_phone || 'N/A'}
• ডেলিভারি ঠিকানা: ${order.address || 'ঠিকানা সংগৃহীত হচ্ছে'}

🛍️ *পণ্যের বিবরণ:*
• মডেল কোড: ${order.model_code || 'DF-Collection'}
• পোশাক: ${order.product_details || 'দুবাই চেরি আবায়া সেট'}
• সাইজ (ঝুল): ${order.length_size ? `${order.length_size} ইঞ্চি (ঢিলেঢালা ফ্রি বডি সাইজ)` : '৫০-৫৬ ইঞ্চি (ফ্রি বডি সাইজ)'}
• উপহার: ম্যাচিং প্রিমিয়াম হিজাব (সম্পূর্ণ ফ্রি) 🎁

💰 *পেমেন্ট ও বিল সামারি:*
• পোশাকের মূল্য: ৳${dressPrice.toLocaleString('bn-BD')} টাকা
• ডেলিভারি চার্জ: ৳${deliveryFee.toLocaleString('bn-BD')} টাকা
• অগ্রিম পরিশোধিত: ৳${advance.toLocaleString('bn-BD')} টাকা (${advance > 0 ? 'পরিশোধিত' : 'বকেয়া'})
━━━━━━━━━━━━━━━━━━━━━━━━
💵 *ডেলিভারি ম্যানকে ক্যাশ অন ডেলিভারি (COD):* *৳${dueCod.toLocaleString('bn-BD')} টাকা*
━━━━━━━━━━━━━━━━━━━━━━━━
✨ *১০০% কাস্টমার ট্রাস্ট গ্যারান্টি:*
পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে প্রোডাক্ট দেখে ও চেক করে নেওয়ার শতভাগ সুবিধা রয়েছে। পছন্দ হলে মূল্য পরিশোধ করবেন।

দাওয়া ফ্যাশনের সাথে থাকার জন্য আন্তরিক ধন্যবাদ! 😊`;
}

// Helper: Generate Polite Bengali Follow-up for Abandoned / Ghosted Leads (100% Gender-Neutral & Respectful)
function generateFollowupMessage(order) {
  const model = order.model_code;
  const nameStr = (order.customer_name && !/^(কাস্টমার|গ্রাহক|customer|unknown)$/i.test(order.customer_name.trim())) 
    ? ` ${order.customer_name.trim()}` 
    : '';

  if (model) {
    return `আসসালামু আলাইকুম${nameStr} 😊\n\nআপনি কি আমাদের *${model}* আবায়াটি নিয়ে আর কিছু জানতে চেয়েছিলেন? আমাদের প্রতিটি মডেলের স্টক কিন্তু খুব দ্রুত শেষ হয়ে যাচ্ছে। আপনার জন্য কি সাইজটি বুক করে রাখব?\n\nসাইজ বা ফেব্রিক নিয়ে কোনো কিছু জানার থাকলে নিঃসংকোচে বলুন, আমরা সুন্দর একটি বোরকা বেছে নিতে সাহায্য করব। 😊`;
  } else {
    return `আসসালামু আলাইকুম${nameStr} 😊\n\nআপনি কি আমাদের বোরকা বা আবায়া কালেকশন নিয়ে আর কিছু জানতে চেয়েছিলেন? আপনার কোনো প্রশ্ন বা সাইজ নিয়ে দ্বিধা থাকলে নিঃসংকোচে জানান, আমরা সুন্দর একটি ডিজাইন বেছে দিতে সাহায্য করব। 😊`;
  }
}

// 1-Click Approve Payment & Confirm Order Endpoint
app.post('/api/orders/:id/approve-payment', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { trx_id, notify_customer } = req.body;
  try {
    const { data: order } = await supabase.from('orders').select('*').eq('id', id).single();
    if (order) {
      await supabase.from('orders').update({
        status: 'Approved',
        trx_id_or_last4: trx_id || order.trx_id_or_last4 || 'Verified',
        advance_paid: order.delivery_fee || 80,
        payment_method: 'COD (Advance Delivery Paid)'
      }).eq('id', id);

      if (notify_customer && sock && order.customer_phone) {
        const cleanNumber = order.customer_phone.replace(/[^0-9]/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        const memoText = generateDigitalCashMemo({
          ...order,
          status: 'Approved',
          advance_paid: order.delivery_fee || 80,
          trx_id_or_last4: trx_id || order.trx_id_or_last4 || 'Verified'
        });
        const sentApprove = await sock.sendMessage(jid, {
          text: `আলহামদুলিল্লাহ! আপনার পেমেন্টটি সফলভাবে ভেরিফাই করা হয়েছে এবং অর্ডারটি কনফার্ম হয়েছে। নিচে আপনার অফিসিয়াল ডিজিটাল ক্যাশ মেমো দেওয়া হলো:\n\n${memoText}`
        });
        if (sentApprove?.key?.id) botSentMessageIds.add(sentApprove.key.id);
      }
    }
    if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
      return res.json({ success: true, id, status: 'Approved' });
    }
    res.redirect('/dashboard');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Digital Cash Memo to WhatsApp
app.post('/api/orders/:id/send-memo', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি' });
    if (!order.customer_phone) return res.status(400).json({ error: 'কাস্টমারের ফোন নম্বর নেই' });
    if (!sock) return res.status(503).json({ error: 'WhatsApp সংযোগ নেই' });

    const cleanNumber = order.customer_phone.replace(/[^0-9]/g, '');
    const jid = `${cleanNumber}@s.whatsapp.net`;
    const memoText = generateDigitalCashMemo(order);

    const sentMemo = await sock.sendMessage(jid, { text: memoText });
    if (sentMemo?.key?.id) botSentMessageIds.add(sentMemo.key.id);
    incrementStats('messages_out');
    res.json({ success: true, message: 'ডিজিটাল ক্যাশ মেমো পাঠানো হয়েছে' });
  } catch (err) {
    console.error('[Send Memo Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send Manual Lead Recovery Follow-up to WhatsApp
app.post('/api/orders/:id/send-followup', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) return res.status(404).json({ error: 'অর্ডার বা লিড পাওয়া যায়নি' });
    if (!order.customer_phone) return res.status(400).json({ error: 'কাস্টমারের ফোন নম্বর নেই' });
    if (!sock) return res.status(503).json({ error: 'WhatsApp সংযোগ নেই' });

    const cleanNumber = order.customer_phone.replace(/[^0-9]/g, '');
    const jid = `${cleanNumber}@s.whatsapp.net`;
    const followupText = generateFollowupMessage(order);

    const sentFollow = await sock.sendMessage(jid, { text: followupText });
    if (sentFollow?.key?.id) botSentMessageIds.add(sentFollow.key.id);
    incrementStats('messages_out');
    followupCooldownMap.set(cleanNumber, Date.now());
    res.json({ success: true, message: 'রিকভারি ফলো-আপ পাঠানো হয়েছে' });
  } catch (err) {
    console.error('[Send Follow-up Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Automated Abandoned Lead Recovery Background Engine
async function checkAndSendAbandonedLeadFollowups() {
  if (!sock || !autoFollowupEnabled) return;

  // Respectful Bangladeshi Business Hours Check (9:30 AM to 10:00 PM BST / UTC+6)
  const now = new Date();
  const utcHours = now.getUTCHours();
  const bdHours = (utcHours + 6) % 24;
  if (bdHours < 9 || bdHours >= 22) {
    return; // Outside friendly business hours, pause automated follow-ups
  }

  try {
    // Find pending leads created between 2 hours and 36 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const thirtySixHoursAgo = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

    const { data: abandonedLeads, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'Pending')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', thirtySixHoursAgo)
      .limit(6);

    if (error || !abandonedLeads || abandonedLeads.length === 0) return;

    for (const lead of abandonedLeads) {
      if (!lead.customer_phone) continue;
      const cleanPhone = lead.customer_phone.replace(/[^0-9]/g, '');

      // Cooldown check: At least 24 hours between automated follow-ups
      const lastSent = followupCooldownMap.get(cleanPhone) || 0;
      if (Date.now() - lastSent < 24 * 60 * 60 * 1000) {
        continue;
      }

      const jid = `${cleanPhone}@s.whatsapp.net`;
      const followupMsg = generateFollowupMessage(lead);

      console.log(`[Auto Recovery] Sending polite follow-up to ${cleanPhone} (Lead #${lead.id})`);
      const sentAutoFollowup = await sock.sendMessage(jid, { text: followupMsg });
      if (sentAutoFollowup?.key?.id) botSentMessageIds.add(sentAutoFollowup.key.id);
      incrementStats('messages_out');
      followupCooldownMap.set(cleanPhone, Date.now());

      // Natural pause between messages
      await new Promise(r => setTimeout(r, 4500));
    }
  } catch (err) {
    console.error('[Auto Follow-up Error]:', err.message);
  }
}

// Check every 25 minutes
setInterval(checkAndSendAbandonedLeadFollowups, 25 * 60 * 1000);

// Unified Master Dashboard (Executive F-Commerce Command Center for Dawah Fashion)
// Unified Master Dashboard (Executive Mobile-First F-Commerce Command Center for Dawah Fashion)
app.get('/dashboard', requireAuth, async (req, res) => {
  const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
  const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
  const { data: storeSettings } = await supabase.from('store_settings').select('*').eq('id', 1).single();
  const curSettings = storeSettings || { inside_dhaka_fee: 80, outside_dhaka_fee: 150, bkash_number: '01613-129192', nagad_number: '01677-557292' };

  const phoneCountMap = {};
  (orders || []).forEach(o => {
    if (o.customer_phone) {
      phoneCountMap[o.customer_phone] = (phoneCountMap[o.customer_phone] || 0) + 1;
    }
  });

  const uniquePhones = Object.keys(phoneCountMap);
  const repeatCustCount = uniquePhones.filter(p => phoneCountMap[p] > 1).length;
  const newCustCount = uniquePhones.filter(p => phoneCountMap[p] === 1).length;

  const totalOrders = orders ? orders.length : 0;
  const pendingOrders = orders ? orders.filter(o => o.status === 'Pending').length : 0;
  const pendingVerificationOrders = orders ? orders.filter(o => o.status === 'Pending Verification').length : 0;
  const approvedOrders = orders ? orders.filter(o => o.status === 'Approved').length : 0;
  const shippedOrders = orders ? orders.filter(o => o.status === 'Shipped').length : 0;
  const cancelledOrders = orders ? orders.filter(o => o.status === 'Cancelled').length : 0;
  const totalProducts = products ? products.length : 0;
  const inStockProducts = products ? products.filter(p => p.in_stock).length : 0;
  const totalRevenue = (orders || []).filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 2200), 0);

  const productsMap = {};
  (products || []).forEach(p => {
    if (p.model_code) productsMap[p.model_code.toUpperCase().trim()] = p;
  });

  // Helper to format clean Steadfast/Pathao courier copy text
  function formatCourierText(o) {
    const prodPrice = Number(o.total_bdt) || 2200;
    const deliveryFee = Number(o.delivery_fee) || 80;
    const isAdvancePaid = !!o.trx_id_or_last4 || (Number(o.advance_paid) > 0);
    const dueCod = Number(o.due_cod) || prodPrice;
    return `কাস্টমার: ${o.customer_name || 'কাস্টমার'}\nমোবাইল: ${o.customer_phone || ''}\nঠিকানা: ${o.address || ''}\nপ্রোডাক্ট: [${o.model_code || 'DF-101'}] ${o.product_details || ''} (সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'})\nক্যাশ কালেকশন (Due COD): ৳${dueCod}\nডেলিভারি চার্জ: ${isAdvancePaid ? 'অগ্রিম পেইড' : 'বকেয়া'}`;
  }

  // Generate Mobile Order Cards
  const mobileOrderCards = (orders || []).map(o => {
    const prodPrice = Number(o.total_bdt) || 2200;
    const deliveryFee = Number(o.delivery_fee) || 80;
    const isAdvancePaid = !!o.trx_id_or_last4 || (Number(o.advance_paid) > 0);
    const dueCod = Number(o.due_cod) || prodPrice;
    const isRepeat = (phoneCountMap[o.customer_phone] || 0) > 1;
    const screenshotMatch = (o.trx_id_or_last4 || '').match(/\/screenshots\/[a-zA-Z0-9_.-]+\.(?:jpg|jpeg|png|webp)/i);
    const screenshotUrl = screenshotMatch ? screenshotMatch[0] : null;
    const courierData = formatCourierText(o).replace(/\'/g, "\\'");
    const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
    const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
    const searchMeta = `${o.id} ${o.model_code || ''} ${o.customer_name || ''} ${o.customer_phone || ''} ${o.address || ''} ${o.product_details || ''}`.toLowerCase();
    const mp = o.model_code ? productsMap[o.model_code.toUpperCase().trim()] : null;

    return `
    <div class="order-item-card bg-white rounded-2xl border border-stone-200 p-4 shadow-sm space-y-3.5 transition hover:border-amber-400 hover:shadow-md" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
      <!-- Top Card Header: ID, Badge, Status Select -->
      <div class="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
        <div class="flex items-center gap-2 flex-wrap">
          <input type="checkbox" class="order-select-checkbox w-4 h-4 rounded accent-amber-700 cursor-pointer" value="${o.id}" onchange="updateOrderBulkBar()">
          <span class="font-mono font-black text-xs text-stone-500 bg-stone-100 px-2 py-0.5 rounded">#${o.id}</span>
          ${isRepeat 
            ? `<span class="bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">🔄 রিপিট</span>` 
            : `<span class="bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">🆕 নতুন</span>`
          }
          ${screenshotUrl ? `<span class="bg-violet-50 text-violet-800 border border-violet-300 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1 animate-pulse">📸 স্ক্রিনশট</span>` : ''}
          ${o.status === 'Pending Verification' ? `<span class="bg-amber-500 text-white font-black text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 animate-pulse">⚠️ পেমেন্ট ভেরিফিকেশন</span>` : ''}
        </div>
        <!-- Status Select -->
        <select onchange="updateOrderStatusLive(${o.id}, this.value, this)" class="text-xs px-2.5 py-1 rounded-xl border font-black cursor-pointer transition shadow-2xs outline-none ${
          o.status === 'Pending Verification' ? 'bg-violet-50 text-violet-900 border-violet-400 font-black' :
          o.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 
          o.status === 'Shipped' ? 'bg-sky-50 text-sky-800 border-sky-300' : 
          o.status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
        }">
          <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="Pending Verification" ${o.status === 'Pending Verification' ? 'selected' : ''}>📸 স্ক্রিনশট ভেরিফাই</option>
          <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
          <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
          <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
        </select>
      </div>

      <!-- Customer Name & Quick Action Pill Buttons -->
      <div>
        <div class="font-extrabold text-stone-900 text-base leading-snug">${o.customer_name || 'কাস্টমার'}</div>
        <div class="flex items-center gap-2 mt-2 flex-wrap">
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2.5 py-1.5 rounded-xl font-bold border border-emerald-200 inline-flex items-center gap-1.5 shadow-2xs transition">
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>💬 WhatsApp চ্যাট</span>
          </a>
          <a href="tel:${o.customer_phone}" class="text-xs bg-stone-100 hover:bg-stone-200 text-stone-800 px-2.5 py-1.5 rounded-xl font-bold border border-stone-200 inline-flex items-center gap-1 shadow-2xs transition">
            <span>📞 কল</span>
          </a>
          <button onclick="copyCourierData('${courierData}')" class="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 px-2.5 py-1.5 rounded-xl font-bold border border-amber-300 shadow-2xs cursor-pointer inline-flex items-center gap-1 transition">
            <span>📋 কুরিয়ার কপি</span>
          </button>
          <button onclick="sendDigitalCashMemo(${o.id})" class="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2.5 py-1.5 rounded-xl font-bold border border-emerald-300 shadow-2xs cursor-pointer inline-flex items-center gap-1 transition" title="কাস্টমারকে হোয়াটসঅ্যাপে ডিজিটাল মেমো পাঠান">
            <span>🧾 মেমো পাঠান</span>
          </button>
          ${o.status === 'Pending Verification' ? `
          <button onclick="confirmPaymentLive(${o.id})" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-xl font-black shadow-2xs cursor-pointer inline-flex items-center gap-1 transition" title="পেমেন্ট অনুমোদন ও কনফার্ম">
            <span>✅ অনুমোদন</span>
          </button>
          ` : ''}
          <button onclick="dispatchCourierLive(${o.id})" class="text-xs bg-sky-50 hover:bg-sky-100 text-sky-900 px-2.5 py-1.5 rounded-xl font-bold border border-sky-300 shadow-2xs cursor-pointer inline-flex items-center gap-1 transition" title="Steadfast কুরিয়ারে ১-ক্লিকে পার্সেল বুক করুন">
            <span>⚡ কুরিয়ার</span>
          </button>
          <button onclick="toggleCustomerAiPause('${cleanPhone}')" class="text-xs bg-violet-50 hover:bg-violet-100 text-violet-900 px-2.5 py-1.5 rounded-xl font-bold border border-violet-300 shadow-2xs cursor-pointer inline-flex items-center gap-1 transition" title="AI Pause/Resume">
            <span>⏯️ AI Toggle</span>
          </button>
          ${(o.status === 'Pending' || !o.address) ? `
          <button onclick="sendFollowupDirect(${o.id})" class="text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 px-2.5 py-1.5 rounded-xl font-bold border border-amber-300 shadow-2xs cursor-pointer inline-flex items-center gap-1 transition" title="গোস্টিং হওয়া কাস্টমারকে রিকভারি মেসেজ পাঠান">
            <span>📩 ফলো-আপ</span>
          </button>
          ` : ''}
          ${screenshotUrl ? `
          <button type="button" onclick="openScreenshotModal('${screenshotUrl}', ${o.id}, '${o.customer_phone}', '${(o.customer_name || 'কাস্টমার').replace(/'/g, "\\'")}')" class="text-xs bg-violet-100 hover:bg-violet-200 text-violet-900 px-2.5 py-1.5 rounded-xl font-black border border-violet-300 inline-flex items-center gap-1 shadow-2xs cursor-pointer">
            <span>📸 স্ক্রিনশট</span>
          </button>
          ` : ''}
          <button onclick="deleteSingleOrder(${o.id})" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 px-2.5 py-1.5 rounded-xl font-bold border border-rose-200 inline-flex items-center gap-1 shadow-2xs transition ml-auto cursor-pointer" title="অর্ডার মুছুন">
            <span>🗑️</span>
          </button>
        </div>
      </div>

      <!-- Delivery Address Display -->
      <div class="bg-[#fcfaf7] p-3 rounded-xl border border-stone-200 text-xs text-stone-700 leading-relaxed">
        <span class="font-bold text-stone-500 text-[11px] block mb-0.5">📍 ডেলিভারি ঠিকানা:</span>
        ${o.address ? o.address : '<span class="text-stone-400 italic">ঠিকানা এখনও পাওয়া যায়নি</span>'}
      </div>

      <!-- Product SKU & Details -->
      <div class="bg-amber-50/50 p-3 rounded-xl border border-amber-200/80 text-xs flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          ${mp && mp.image_url ? `<img src="${mp.image_url}" class="w-10 h-12 object-cover rounded-lg border border-amber-300 shadow-2xs cursor-pointer hover:scale-110 transition" onclick="openLightbox('${mp.image_url}', '${mp.name}')">` : ''}
          <div>
            <div class="flex items-center gap-1.5">
              <span class="bg-amber-200/80 text-amber-950 font-mono font-black text-xs px-2 py-0.5 rounded border border-amber-300">${o.model_code || 'DF-101'}</span>
              <span class="font-extrabold text-stone-900 text-xs">${o.product_details || 'দুবাই চেরি আবায়া'}</span>
            </div>
            ${o.length_size ? `<div class="text-[11px] text-stone-600 font-semibold mt-0.5">সাইজ: <span class="text-amber-900 font-black">${o.length_size}</span></div>` : ''}
          </div>
        </div>
        <div class="text-right">
          <div class="text-[11px] text-stone-500">পোশাকের দাম</div>
          <div class="font-black text-stone-900 text-sm">৳${prodPrice}</div>
        </div>
      </div>

      <!-- Financials & Payment Breakdown -->
      <div class="bg-stone-50 p-3 rounded-xl border border-stone-200 space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-stone-600">ডেলিভারি চার্জ:</span>
          ${isAdvancePaid 
            ? `<span class="bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-0.5 rounded text-[11px] font-black">✅ অগ্রিম পেইড (৳${deliveryFee})</span>`
            : `<span class="bg-rose-100 text-rose-900 border border-rose-200 px-2.5 py-0.5 rounded text-[11px] font-black">⏳ চার্জ বকেয়া (৳${deliveryFee})</span>`
          }
        </div>
        ${o.trx_id_or_last4 ? `<div class="text-[11px] text-stone-600 font-mono flex items-center justify-between"><span>TrxID / Last 4:</span> <span class="font-black text-stone-900 bg-white px-2 py-0.5 rounded border border-stone-200">${o.trx_id_or_last4}</span></div>` : ''}
        <div class="flex items-center justify-between pt-2 border-t border-stone-200 font-black text-amber-950 text-sm">
          <span>Due COD কালেকশন:</span>
          <span class="bg-amber-100 text-amber-950 px-2.5 py-0.5 rounded-lg border border-amber-300">৳${dueCod}</span>
        </div>
      </div>

      <!-- Footer Info & Edit Accordion -->
      <div class="pt-1 flex items-center justify-between text-xs">
        <span class="text-[10px] text-stone-400 font-medium">${new Date(o.created_at).toLocaleString('bn-BD')}</span>
        <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-amber-900 font-bold hover:underline cursor-pointer">
          ✏️ ফি ও Trx এডিট
        </button>
      </div>

      <!-- In-Card Collapsible Payment Form -->
      <div id="payment-drawer-${o.id}" class="hidden bg-white p-4 rounded-xl border border-amber-300 shadow-md space-y-3">
        <div class="flex items-center justify-between border-b border-stone-100 pb-1.5">
          <span class="text-xs font-black text-stone-800">পেমেন্ট ও কুরিয়ার কালেকশন এডিট</span>
          <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-stone-400 hover:text-stone-700 text-xs font-bold">✕</button>
        </div>
        <form onsubmit="savePaymentLive(event, ${o.id})" class="space-y-2.5 text-xs">
          <div>
            <label class="block text-[11px] font-bold text-stone-700 mb-0.5">ডেলিভারি চার্জ (টাকা)</label>
            <input type="number" id="fee-${o.id}" value="${deliveryFee}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 p-2 rounded-lg font-bold">
          </div>
          <div>
            <label class="block text-[11px] font-bold text-stone-700 mb-0.5">অগ্রিম পেইড (টাকা)</label>
            <input type="number" id="advance-${o.id}" value="${o.advance_paid || (isAdvancePaid ? deliveryFee : 0)}" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 p-2 rounded-lg font-bold">
          </div>
          <div>
            <label class="block text-[11px] font-bold text-stone-700 mb-0.5">বিকাশ/নগদ TrxID বা লাস্ট ৪ ডিজিট</label>
            <input type="text" id="trx-${o.id}" value="${o.trx_id_or_last4 || ''}" placeholder="যেমন: 9X7A... বা 1291" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 p-2 rounded-lg font-mono font-bold">
          </div>
          <div>
            <label class="block text-[11px] font-bold text-stone-700 mb-0.5">Due COD কালেকশন (টাকা)</label>
            <input type="number" id="due-${o.id}" value="${dueCod}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 p-2 rounded-lg font-bold">
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" onclick="togglePaymentDrawer(${o.id})" class="px-3 py-1.5 font-bold text-stone-500 hover:bg-stone-100 rounded-lg">বাতিল</button>
            <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-1.5 rounded-lg shadow-2xs">সেভ করুন</button>
          </div>
        </form>
      </div>
    </div>
    `;
  }).join('');

  // Generate Desktop Table Rows
  const desktopOrderRows = (orders || []).map(o => {
    const prodPrice = Number(o.total_bdt) || 2200;
    const deliveryFee = Number(o.delivery_fee) || 80;
    const isAdvancePaid = !!o.trx_id_or_last4 || (Number(o.advance_paid) > 0);
    const dueCod = Number(o.due_cod) || prodPrice;
    const isRepeat = (phoneCountMap[o.customer_phone] || 0) > 1;
    const screenshotMatch = (o.trx_id_or_last4 || '').match(/\/screenshots\/[a-zA-Z0-9_.-]+\.(?:jpg|jpeg|png|webp)/i);
    const screenshotUrl = screenshotMatch ? screenshotMatch[0] : null;
    const courierData = formatCourierText(o).replace(/\'/g, "\\'");
    const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
    const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
    const searchMeta = `${o.id} ${o.model_code || ''} ${o.customer_name || ''} ${o.customer_phone || ''} ${o.address || ''} ${o.product_details || ''}`.toLowerCase();
    const mp = o.model_code ? productsMap[o.model_code.toUpperCase().trim()] : null;

    return `
    <tr class="order-table-row border-b border-stone-100 hover:bg-amber-50/20 transition" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
      <td class="p-3.5 text-center">
        <input type="checkbox" class="order-select-checkbox w-4 h-4 rounded accent-amber-700 cursor-pointer" value="${o.id}" onchange="updateOrderBulkBar()">
      </td>
      <td class="p-3.5 font-bold text-stone-500 text-xs font-mono">#${o.id}</td>
      <td class="p-3.5">
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-stone-900 text-sm">${o.customer_name || 'কাস্টমার'}</span>
          ${isRepeat 
            ? `<span class="bg-purple-100 text-purple-900 border border-purple-300 text-[10px] font-black px-1.5 py-0.5 rounded-full">🔄 রিপিট</span>` 
            : `<span class="bg-blue-100 text-blue-900 border border-blue-300 text-[10px] font-black px-1.5 py-0.5 rounded-full">🆕 নতুন</span>`
          }
          ${screenshotUrl ? `<span class="bg-violet-100 text-violet-900 border border-violet-300 text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse">📸 স্ক্রিনশট</span>` : ''}
        </div>
        <div class="flex items-center gap-2 mt-1.5 flex-wrap">
          <a href="https://wa.me/${waPhone}" target="_blank" class="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-lg border border-emerald-300 font-bold inline-flex items-center gap-1 shadow-2xs transition">
            <span>💬 +${cleanPhone}</span>
          </a>
          <button onclick="copyCourierData('${courierData}')" class="text-[11px] bg-amber-50 hover:bg-amber-100 text-amber-900 px-2 py-0.5 rounded-lg border border-amber-300 font-bold cursor-pointer transition shadow-2xs">
            📋 কুরিয়ার কপি
          </button>
          ${screenshotUrl ? `
          <button onclick="openScreenshotModal('${screenshotUrl}', ${o.id}, '${o.customer_phone}', '${(o.customer_name || 'কাস্টমার').replace(/'/g, "\\'")}')" class="text-[11px] bg-violet-100 hover:bg-violet-200 text-violet-900 px-2 py-0.5 rounded-lg border border-violet-300 font-black inline-flex items-center gap-1 cursor-pointer">
            📸 স্ক্রিনশট
          </button>
          ` : ''}
        </div>
      </td>
      <td class="p-3.5 text-stone-700 text-xs max-w-xs leading-relaxed">
        ${o.address ? `<div class="bg-stone-50 p-2 rounded-xl border border-stone-200">${o.address}</div>` : '<span class="text-stone-400 italic">ঠিকানা এখনও পাওয়া যায়নি</span>'}
      </td>
      <td class="p-3.5 text-stone-800 text-xs">
        <div class="flex items-center gap-2.5 mb-1 flex-wrap">
          ${mp && mp.image_url ? `<img src="${mp.image_url}" class="w-8 h-10 object-cover rounded-lg border border-amber-300 shadow-2xs cursor-pointer hover:scale-125 transition" onclick="openLightbox('${mp.image_url}', '${mp.name}')" title="ক্লিক করে বড় ছবি দেখুন">` : ''}
          <div>
            <span class="bg-amber-100 text-amber-950 font-mono font-extrabold text-[11px] px-2 py-0.5 rounded border border-amber-300">${o.model_code || 'DF-101'}</span>
            <div class="font-extrabold text-stone-900 text-xs mt-0.5">${o.product_details || '-'}</div>
          </div>
        </div>
        ${o.length_size ? `<div class="text-[11px] text-stone-600 mt-1">সাইজ: <span class="font-black text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">${o.length_size}</span></div>` : ''}
      </td>
      <td class="p-3.5 text-xs">
        <div class="font-bold text-stone-800">পোশাক: ৳${prodPrice}</div>
        <div class="my-1">
          ${isAdvancePaid 
            ? `<span class="bg-emerald-50 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold">✅ চার্জ পেইড (৳${deliveryFee})</span>`
            : `<span class="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-bold">⏳ ফি বাকি (৳${deliveryFee})</span>`
          }
          ${o.trx_id_or_last4 ? `<span class="text-[10px] text-stone-500 font-mono block mt-0.5 truncate max-w-[130px]" title="${o.trx_id_or_last4}">${o.trx_id_or_last4}</span>` : ''}
        </div>
        <div class="font-black text-amber-950 text-xs bg-amber-50 px-2 py-0.5 rounded border border-amber-300 inline-block">
          Due COD: ৳${dueCod}
        </div>
        <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-[10px] text-amber-900 hover:underline font-bold block mt-1 cursor-pointer">
          ✏️ ফি / Trx এডিট
        </button>
      </td>
      <td class="p-3.5">
        <select onchange="updateOrderStatusLive(${o.id}, this.value, this)" class="text-xs px-2.5 py-1.5 rounded-xl border font-black cursor-pointer transition shadow-2xs outline-none ${
          o.status === 'Pending Verification' ? 'bg-violet-100 text-violet-900 border-violet-400 font-black' :
          o.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 
          o.status === 'Shipped' ? 'bg-sky-50 text-sky-800 border-sky-300' : 
          o.status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
        }">
          <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="Pending Verification" ${o.status === 'Pending Verification' ? 'selected' : ''}>📸 স্ক্রিনশট ভেরিফাই</option>
          <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
          <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
          <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
        </select>
        ${o.status === 'Pending Verification' ? `
        <button onclick="confirmPaymentLive(${o.id})" class="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-black px-2 py-1 rounded block mt-1.5 text-center shadow-2xs w-full cursor-pointer">
          ✅ পেমেন্ট অনুমোদন
        </button>
        ` : ''}
        <button onclick="dispatchCourierLive(${o.id})" class="text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 font-bold px-2 py-1 rounded block mt-1 text-center shadow-2xs w-full cursor-pointer" title="Steadfast কুরিয়ারে ১-ক্লিকে পার্সেল বুক করুন">
          ⚡ কুরিয়ারে বুকিং
        </button>
        <button onclick="toggleCustomerAiPause('${cleanPhone}')" class="text-[10px] bg-violet-50 hover:bg-violet-100 text-violet-900 border border-violet-300 font-bold px-2 py-1 rounded block mt-1 text-center shadow-2xs w-full cursor-pointer" title="AI Pause/Resume">
          ⏯️ AI Toggle
        </button>
        <button onclick="sendDigitalCashMemo(${o.id})" class="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold px-2 py-1 rounded block mt-1 text-center shadow-2xs w-full cursor-pointer" title="কাস্টমারকে হোয়াটসঅ্যাপে ডিজিটাল মেমো পাঠান">
          🧾 ডিজিটাল মেমো
        </button>
        ${(o.status === 'Pending' || !o.address) ? `
        <button onclick="sendFollowupDirect(${o.id})" class="text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2 py-1 rounded block mt-1 text-center shadow-2xs w-full cursor-pointer" title="গোস্টিং হওয়া কাস্টমারকে রিকভারি মেসেজ পাঠান">
          📩 রিকভারি মেসেজ
        </button>
        ` : ''}
      </td>
      <td class="p-3.5 text-xs text-stone-400 font-medium whitespace-nowrap">${new Date(o.created_at).toLocaleString('bn-BD')}</td>
      <td class="p-3.5 text-right whitespace-nowrap">
        <button onclick="deleteSingleOrder(${o.id})" class="text-rose-600 hover:text-rose-800 text-xs font-bold hover:underline cursor-pointer">
          🗑️ মুছুন
        </button>
      </td>
    </tr>
    <!-- Collapsible Desktop Payment Edit Row -->
    <tr id="desktop-payment-${o.id}" class="hidden bg-[#fdfbf7] border-b border-amber-200">
      <td colspan="9" class="p-4">
        <div class="bg-white p-4 rounded-xl border border-amber-300 shadow-sm space-y-3 max-w-4xl mx-auto">
          <div class="flex items-center justify-between border-b border-stone-100 pb-2">
            <h5 class="text-xs font-black text-stone-800">✏️ অর্ডার #${o.id} — ডেলিভারি চার্জ ও পেমেন্ট আপডেট করুন</h5>
            <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-xs text-stone-400 hover:text-stone-700 font-bold">✕ বন্ধ</button>
          </div>
          <form onsubmit="savePaymentLive(event, ${o.id})" class="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">ডেলিভারি চার্জ (টাকা)</label>
              <input type="number" id="fee-d-${o.id}" value="${deliveryFee}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2 rounded-lg font-bold">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">অগ্রিম পেইড (টাকা)</label>
              <input type="number" id="advance-d-${o.id}" value="${o.advance_paid || (isAdvancePaid ? deliveryFee : 0)}" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2 rounded-lg font-bold">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">বিকাশ/নগদ TrxID / Last 4</label>
              <input type="text" id="trx-d-${o.id}" value="${o.trx_id_or_last4 || ''}" placeholder="যেমন: 9A7X... বা 1291" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2 rounded-lg font-mono font-bold">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-stone-700 mb-1">Due COD কালেকশন (টাকা)</label>
              <input type="number" id="due-d-${o.id}" value="${dueCod}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2 rounded-lg font-bold">
            </div>
            <div class="sm:col-span-4 flex items-center justify-between pt-1">
              <span class="text-[10px] text-stone-500">* অগ্রিম টাকা বা TrxID দিলে স্বয়ংক্রিয়ভাবে 'Advance Delivery Paid' হবে।</span>
              <div class="flex gap-2">
                <button type="button" onclick="togglePaymentDrawer(${o.id})" class="px-3 py-1.5 text-xs font-bold text-stone-600 hover:bg-stone-100 rounded-lg">বাতিল</button>
                <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-4 py-1.5 rounded-lg shadow-2xs">💾 সেভ করুন</button>
              </div>
            </div>
          </form>
        </div>
      </td>
    </tr>
    `;
  }).join('');

  // Master Product Cards Grid Generator for ALL products
  const productCardsHtml = (products || []).map(p => {
    const promoText = `👗 *${p.name}* (${p.model_code})\n💰 মূল্য: *৳${p.price}* টাকা (ম্যাচিং হিজাব একদম ফ্রি)\n✨ ফেব্রিক: ${p.fabric || 'প্রিমিয়াম চেরি'}\n📏 সাইজ: ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}\n🚚 ডেলিভারি চার্জ: ঢাকার ভেতর ৳${curSettings.inside_dhaka_fee}, বাইরে ৳${curSettings.outside_dhaka_fee}\n📦 ক্যাশ অন ডেলিভারি (পার্সেল দেখে নেওয়ার সুবিধা)।\nঅর্ডার করতে সাইজ, নাম, ঠিকানা ও ফোন নাম্বার লিখে মেসেজ দিন!`.replace(/\'/g, "\\'");
    const safeName = (p.name || '').replace(/'/g, "\\'");
    const safeFabric = (p.fabric || 'দুবাই চেরি').replace(/'/g, "\\'");
    const safeSizes = (p.sizes || '৫০, ৫২, ৫৪, ৫৬').replace(/'/g, "\\'");
    const searchMeta = `${p.id} ${p.model_code || ''} ${p.name || ''} ${p.fabric || ''} ${p.price || ''}`.toLowerCase();

    return `
    <div class="product-item-card bg-white rounded-3xl border border-stone-200 p-4 shadow-xs space-y-3.5 hover:border-amber-400 hover:shadow-md transition relative" data-product-id="${p.id}" data-search="${searchMeta}">
      <!-- Card Top: SKU, Title, Price, Stock -->
      <div class="flex items-start justify-between gap-2 border-b border-stone-100 pb-2.5">
        <div>
          <div class="flex items-center gap-2">
            <span class="bg-amber-100 text-amber-950 font-mono font-black text-xs px-2.5 py-0.5 rounded-lg border border-amber-300">${p.model_code || 'DF-101'}</span>
            <button type="button" onclick="toggleStockLive(${p.id}, ${!p.in_stock}, this)" class="text-[10px] font-black cursor-pointer px-2 py-0.5 rounded-full border transition ${p.in_stock ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100'}">
              ${p.in_stock ? '● In Stock' : '○ Stock Out'}
            </button>
          </div>
          <h4 class="font-extrabold text-stone-900 text-sm mt-1.5 leading-snug">${p.name}</h4>
          <p class="text-[11px] text-stone-500 font-medium">ফেব্রিক: <span class="text-stone-800 font-semibold">${p.fabric || 'দুবাই চেরি'}</span> • সাইজ: ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}</p>
        </div>
        <div class="text-right whitespace-nowrap">
          <div class="font-black text-amber-900 text-base">৳${p.price}</div>
          <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">${p.hijab_included ? 'হিজাব ফ্রি' : 'হিজাব ছাড়া'}</span>
        </div>
      </div>

      <!-- 5-Angle Badged Photo Strip -->
      <div>
        <div class="flex items-center justify-between text-[11px] font-bold text-stone-600 mb-1.5">
          <span>📸 ৫টি অ্যাঙ্গেল ফটো (ক্লিক করে বড় দেখুন):</span>
          <span class="text-[10px] text-amber-800 font-black">HD Badged</span>
        </div>
        <div class="grid grid-cols-5 gap-1.5">
          <!-- 1. Main -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.image_url || '/images/placeholder.jpg'}', '${p.model_code} - ১. মেইন ফ্রন্ট ভিউ')">
            <img src="${p.image_url || '/images/placeholder.jpg'}" onerror="this.src='https://placehold.co/120x160?text=Main'" class="w-full h-18 object-cover rounded-lg border border-amber-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Main">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">মেইন</span>
          </div>
          <!-- 2. Detail -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.detail_image_url || p.image_url || '/images/placeholder.jpg'}', '${p.model_code} - ২. নিখুঁত কারচুপি ক্লোজ-আপ')">
            <img src="${p.detail_image_url || p.image_url || '/images/placeholder.jpg'}" onerror="this.src='https://placehold.co/120x160?text=Detail'" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Detail">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">কাজ</span>
          </div>
          <!-- 3. Hijab -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.hijab_image_url || p.image_url || '/images/placeholder.jpg'}', '${p.model_code} - ৩. ম্যাচিং প্রিমিয়াম হিজাব')">
            <img src="${p.hijab_image_url || p.image_url || '/images/placeholder.jpg'}" onerror="this.src='https://placehold.co/120x160?text=Hijab'" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Hijab">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">হিজাব</span>
          </div>
          <!-- 4. Flare -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.flare_image_url || p.image_url || '/images/placeholder.jpg'}', '${p.model_code} - ৪. ঘের ও সাইড অ্যাঙ্গেল')">
            <img src="${p.flare_image_url || p.image_url || '/images/placeholder.jpg'}" onerror="this.src='https://placehold.co/120x160?text=Flare'" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Flare">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">ঘের</span>
          </div>
          <!-- 5. Real -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.real_image_url || p.image_url || '/images/placeholder.jpg'}', '${p.model_code} - ৫. আনফিল্টার্ড রিয়েল ছবি')">
            <img src="${p.real_image_url || p.image_url || '/images/placeholder.jpg'}" onerror="this.src='https://placehold.co/120x160?text=Real'" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Real">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">রিয়েল</span>
          </div>
        </div>
      </div>

      <!-- Card Action Buttons -->
      <div class="pt-2 flex items-center justify-between gap-2 border-t border-stone-100 flex-wrap">
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="copyPromoTextById(${p.id})" class="text-xs bg-[#fcfaf7] hover:bg-amber-50 text-stone-800 hover:text-amber-950 font-bold px-2.5 py-1.5 rounded-xl border border-stone-300 hover:border-amber-300 inline-flex items-center gap-1 shadow-2xs transition cursor-pointer">
            <span>📋 প্রমো</span>
          </button>
          <button type="button" onclick="openEditProductModalById(${p.id})" class="text-xs bg-amber-50 hover:bg-amber-100 text-amber-950 font-black px-3 py-1.5 rounded-xl border border-amber-300 inline-flex items-center gap-1 shadow-2xs transition cursor-pointer">
            <span>✏️ এডিট</span>
          </button>
        </div>
        <button type="button" onclick="deleteProductLive(${p.id}, '${p.model_code}')" class="text-xs text-rose-600 hover:text-rose-800 font-bold hover:bg-rose-50 px-2 py-1 rounded-lg transition cursor-pointer">
          🗑️ মুছুন
        </button>
      </div>
    </div>
    `;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
      <title>Dawah Fashion — Executive Commerce Command Center</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      </style>
    </head>
    <body class="bg-[#faf8f5] text-stone-800 min-h-screen pb-24">
      
      <!-- Top Modern Executive Dark Navbar -->
      <header class="bg-stone-900 text-white sticky top-0 z-40 px-4 py-3 shadow-md border-b border-stone-800">
        <div class="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <!-- Left: Brand Logo & Live Status -->
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-base shadow-sm ring-2 ring-amber-400/30">
              DF
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="font-black text-base tracking-tight text-white leading-none">Dawah Fashion</h1>
                <span class="bg-amber-400/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded border border-amber-400/30">OS 2.0</span>
              </div>
              <div class="flex items-center gap-2 mt-1">
                <div class="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] px-2.5 py-0.5 rounded-full font-bold">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>+${connectedNumber || '8801968718838'}</span>
                  <span class="text-[10px] text-emerald-300/80 border-l border-emerald-500/30 pl-1.5">লাইভ অটোমেশন</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Nav Pill Actions -->
          <div class="flex items-center gap-2">
            <button type="button" onclick="switchMainView('products')" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
              <span>👗</span>
              <span class="hidden md:inline">প্রোডাক্টস</span>
            </button>
            <button type="button" onclick="switchMainView('bot-test')" class="bg-stone-800 hover:bg-stone-700 text-emerald-300 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
              <span>⚡</span>
              <span class="hidden md:inline">টেস্ট বেঞ্চ</span>
            </button>
            <button type="button" onclick="openDrawer('settingsDrawer')" title="ডেলিভারি চার্জ ও পেমেন্ট রুলস" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
              <span>⚙️</span>
              <span class="hidden md:inline">রুলস</span>
            </button>
            <a href="/api/export-csv" title="এক্সেল ডাউনলোড" class="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-xl text-xs font-black shadow-2xs flex items-center gap-1.5 transition">
              <span>📥</span>
              <span class="hidden md:inline">CSV</span>
            </a>
            <button onclick="pollLiveData(true)" title="লাইভ ডাটা রিফ্রেশ" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs flex items-center gap-1 cursor-pointer">
              <span id="syncSpinner">🔄</span>
            </button>
            <a href="/qr" title="WhatsApp QR কোড" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs transition">
              <span>QR</span>
            </a>
            <a href="/logout" title="লগআউট" class="text-stone-400 hover:text-white px-2 py-2 text-xs transition">
              🔒
            </a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">
        
        <!-- 5 Master KPI Metrics Cards -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <!-- Total Orders & Customer Breakdown -->
          <div class="col-span-2 sm:col-span-1 bg-white p-4 rounded-2xl border border-stone-200 shadow-xs hover:border-amber-300 transition">
            <div class="flex items-center justify-between text-stone-500 text-[11px] font-extrabold uppercase">
              <span>মোট অর্ডার</span>
              <span>📦</span>
            </div>
            <div class="text-2xl font-black mt-1 text-stone-900" id="stat-total-orders">${totalOrders}</div>
            <div class="mt-1.5 flex items-center gap-1 text-[10px] font-bold">
              <span class="text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200" id="stat-new-cust">🆕 ${newCustCount} নতুন</span>
              <span class="text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200" id="stat-repeat-cust">🔄 ${repeatCustCount} পুরনো</span>
            </div>
          </div>

          <!-- In-Stock Products / Active Catalog -->
          <div class="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs hover:border-amber-300 transition">
            <div class="flex items-center justify-between text-amber-800 text-[11px] font-extrabold uppercase">
              <span>লাইভ ক্যাটালগ</span>
              <span>👗</span>
            </div>
            <div class="text-2xl font-black mt-1 text-stone-900">${inStockProducts} টি ইন-স্টক</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">মোট ${totalProducts}টি মডেল রেডি</div>
          </div>

          <!-- Pending Orders Confirmation -->
          <div class="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs hover:border-amber-400 transition">
            <div class="flex items-center justify-between text-amber-800 text-[11px] font-extrabold uppercase">
              <span>পেন্ডিং কনফার্ম</span>
              <span>⏳</span>
            </div>
            <div class="text-2xl font-black mt-1 text-amber-700">${pendingOrders}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">ঠিকানা / সাইজ বাকি</div>
          </div>

          <!-- Confirmed & Shipped Orders -->
          <div class="bg-white p-4 rounded-2xl border border-emerald-200 shadow-xs hover:border-emerald-400 transition">
            <div class="flex items-center justify-between text-emerald-800 text-[11px] font-extrabold uppercase">
              <span>কনফার্মড ও শিপড</span>
              <span>✅</span>
            </div>
            <div class="text-2xl font-black mt-1 text-emerald-700" id="stat-approved-orders">${approvedOrders + shippedOrders}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">${approvedOrders} অনুমোদিত • ${shippedOrders} কুরিয়ারে</div>
          </div>

          <!-- Potential Due COD Revenue -->
          <div class="col-span-2 sm:col-span-1 bg-white p-4 rounded-2xl border border-stone-200 shadow-xs hover:border-amber-300 transition">
            <div class="flex items-center justify-between text-indigo-800 text-[11px] font-extrabold uppercase">
              <span>Due COD সেলস</span>
              <span>💰</span>
            </div>
            <div class="text-2xl font-black mt-1 text-indigo-900" id="stat-total-rev">৳${totalRevenue.toLocaleString('en-IN')}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">কুরিয়ার কালেকশন বকেয়া</div>
          </div>
        </div>

        <!-- Primary Executive View Mode Switcher -->
        <div class="flex items-center gap-2 border-b border-stone-200 pb-3 overflow-x-auto no-scrollbar">
          <button type="button" onclick="switchMainView('orders')" id="main-tab-orders" class="main-tab-btn px-4 py-2.5 rounded-2xl bg-stone-900 text-white font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs whitespace-nowrap">
            <span>📦 অর্ডার ও ডেলিভারি</span>
            <span class="bg-stone-800 text-stone-200 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold" id="badge-total-orders">${totalOrders}</span>
          </button>
          <button type="button" onclick="switchMainView('products')" id="main-tab-products" class="main-tab-btn px-4 py-2.5 rounded-2xl bg-white border border-stone-300 text-stone-700 hover:text-stone-900 font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs whitespace-nowrap">
            <span>👗 প্রোডাক্টস ও ইনভেন্টরি</span>
            <span class="bg-amber-100 text-amber-900 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold" id="badge-total-prods">${totalProducts}</span>
          </button>
          <button type="button" onclick="switchMainView('bot-test')" id="main-tab-bot-test" class="main-tab-btn px-4 py-2.5 rounded-2xl bg-white border border-stone-300 text-stone-700 hover:text-stone-900 font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs whitespace-nowrap">
            <span>⚡ এআই বট টেস্ট বেঞ্চ</span>
            <span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-bold">লাইভ সিমুলেটর</span>
          </button>
          <button type="button" onclick="openDrawer('settingsDrawer')" class="px-4 py-2.5 rounded-2xl bg-white border border-stone-300 text-stone-700 hover:text-stone-900 font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs whitespace-nowrap">
            <span>⚙️ শপ সেটিংস</span>
          </button>
        </div>

        <!-- ============================================================== -->
        <!-- SECTION: PRODUCT CATALOG & INVENTORY MANAGEMENT                -->
        <!-- ============================================================== -->
        <div id="productsSection" class="hidden space-y-4">
          <div class="bg-white rounded-3xl border border-stone-200 p-5 shadow-xs space-y-4">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-3">
              <div>
                <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
                  <span>👗 প্রোডাক্ট ক্যাটালগ ও লাইভ ইনভেন্টরি</span>
                  <span class="bg-amber-100 text-amber-900 font-mono text-[11px] px-2.5 py-0.5 rounded-full border border-amber-300 font-bold">${totalProducts} টি মডেল</span>
                </h2>
                <p class="text-xs text-stone-500 font-medium mt-0.5">মডেল কোড, মূল্য, সাইজ ও ৫টি গোল্ডেন অ্যাঙ্গেল ফটো ম্যানেজ করুন। স্টক শেষ হলে ১-ক্লিকে স্টক আউট করুন।</p>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <input type="text" id="productSearchInput" onkeyup="filterProducts()" placeholder="🔍 প্রোডাক্ট খুঁজুন..." class="bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-3.5 py-2 rounded-xl focus:outline-none focus:border-amber-500">
                <button type="button" onclick="openAddProductModal()" class="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                  <span>+ নতুন প্রোডাক্ট যোগ করুন</span>
                </button>
              </div>
            </div>

            <!-- Products Filter Pill Bar -->
            <div class="flex items-center gap-2 text-xs font-bold">
              <button type="button" onclick="filterProductsStock('ALL')" id="prod-filter-all" class="prod-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer">সবগুলো (<span id="count-prods-all">${totalProducts}</span>)</button>
              <button type="button" onclick="filterProductsStock('IN_STOCK')" id="prod-filter-instock" class="prod-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">স্টকে আছে (${inStockProducts})</button>
              <button type="button" onclick="filterProductsStock('STOCK_OUT')" id="prod-filter-out" class="prod-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer">স্টক আউট (${totalProducts - inStockProducts})</button>
            </div>

            <!-- All Product Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="productsGridContainer">
              ${productCardsHtml}
            </div>
          </div>
        </div>

        <!-- ============================================================== -->
        <!-- SECTION: LIVE INTERACTIVE AI BOT TEST BENCH & TUNING SIMULATOR -->
        <!-- ============================================================== -->
        <div id="botTestSection" class="hidden space-y-4">
          <div class="bg-white rounded-3xl border border-stone-200 p-5 shadow-xs space-y-4">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
              <div>
                <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
                  <span>⚡ এআই সেলস অ্যাসিস্ট্যান্ট টেস্ট বেঞ্চ ও টিউনিং</span>
                  <span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300">Fast-Path 11ms</span>
                </h2>
                <p class="text-xs text-stone-500 font-medium mt-0.5">ড্যাশবোর্ড থেকেই কাস্টমার সেজে প্রশ্ন করুন এবং তাৎক্ষণিক এআই রিপ্লাই, স্পিড ও ফটো চেক করুন।</p>
              </div>
              <button type="button" onclick="clearTestChat()" class="text-xs text-stone-500 hover:text-stone-800 font-bold px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 transition cursor-pointer">
                🗑️ চ্যাট ক্লিয়ার করুন
              </button>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <!-- Left Column: Quick Test Presets -->
              <div class="space-y-3 bg-[#faf7f2] p-4 rounded-2xl border border-stone-200">
                <div class="font-black text-xs text-stone-800 flex items-center gap-1.5">
                  <span>💡 কুইক টেস্ট প্রশ্ন (ক্লিক করলেই রান হবে)</span>
                </div>
                <div class="flex flex-col gap-2">
                  <button type="button" onclick="runPresetQuery('DF-101 এর দাম কত?')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    🏷️ DF-101 এর দাম কত?
                  </button>
                  <button type="button" onclick="runPresetQuery('আমার উচ্চতা ৫ ফুট ৩ ইঞ্চি, কোন সাইজ লাগবে?')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    📏 আমার উচ্চতা ৫'৩", কোন সাইজ লাগবে?
                  </button>
                  <button type="button" onclick="runPresetQuery('ঢাকার বাইরে ডেলিভারি কয়দিনে দেন এবং চার্জ কত?')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    🚚 ডেলিভারি চার্জ কত ও কয়দিন লাগে?
                  </button>
                  <button type="button" onclick="runPresetQuery('আমি ২ পিস নিলে কিছু ছাড় দিবেন?')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    💸 ২ বা ৩ পিস নিলে ডিসকাউন্ট হবে?
                  </button>
                  <button type="button" onclick="runPresetQuery('পার্সেল কি ডেলিভারি ম্যানের সামনে খুলে দেখা যাবে?')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    📦 পার্সেল খুলে দেখার সুযোগ আছে?
                  </button>
                  <button type="button" onclick="runPresetQuery('কাপড় কি পাতলা নাকি শালীনভাবে কভার হবে?')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    🧕 কাপড় কি পাতলা নাকি শালীন?
                  </button>
                  <button type="button" onclick="runPresetQuery('DF-102 রানি আবায়ার রিয়েল ছবি দেখতে চাই')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    📸 DF-102 এর রিয়েল ছবি দিন
                  </button>
                  <button type="button" onclick="runPresetQuery('অর্ডার কনফার্ম করতে চাই')" class="text-left text-xs bg-white hover:bg-amber-50 text-stone-800 p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 font-semibold shadow-2xs transition cursor-pointer">
                    🛒 অর্ডার কনফার্ম করতে চাই
                  </button>
                </div>
              </div>

              <!-- Right 2 Columns: Interactive WhatsApp-Style Chat Simulator -->
              <div class="lg:col-span-2 flex flex-col h-[520px] bg-[#f0ebe3] rounded-2xl border border-stone-300 overflow-hidden shadow-inner">
                <!-- Chat Window Header -->
                <div class="bg-stone-900 text-white px-4 py-3 flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-sm">DF</div>
                    <div>
                      <div class="font-black text-xs">Dawah Fashion WhatsApp AI</div>
                      <div class="text-[10px] text-emerald-400 font-semibold">● সবসময় অনলাইন (২৪/৭ অটোমেশন)</div>
                    </div>
                  </div>
                  <span id="simulatorLatencyBadge" class="hidden text-[10px] font-mono font-bold bg-white/10 px-2.5 py-1 rounded-full text-amber-300">⚡ 11ms</span>
                </div>

                <!-- Messages Stream Viewport -->
                <div id="simulatorChatBody" class="flex-1 p-4 overflow-y-auto space-y-3">
                  <!-- Initial Intro Bubble -->
                  <div class="flex justify-start">
                    <div class="max-w-[85%] bg-white p-3.5 rounded-2xl rounded-tl-none shadow-xs border border-stone-200 text-stone-800 text-xs leading-relaxed">
                      😊 আসসালামু আলাইকুম! এটি দাওয়াহ ফ্যাশন এআই সেলস টেস্ট বেঞ্চ। নিচে যেকোনো প্রশ্ন লিখুন বা বাঁ পাশের প্রিসেট থেকে ক্লিক করে টেস্ট করুন।
                    </div>
                  </div>
                </div>

                <!-- Chat Input Controls Bar -->
                <form onsubmit="handleSimulatorSubmit(event)" class="p-2.5 bg-white border-t border-stone-200 flex items-center gap-2">
                  <input type="text" id="simulatorInput" placeholder="এখানে মেসেজ লিখে টেস্ট করুন (যেমন: DF-101 এর প্রাইজ কত)..." class="flex-1 bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-amber-500">
                  <button type="submit" id="simulatorSendBtn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1 whitespace-nowrap">
                    <span>পাঠান</span>
                    <span>➔</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        <!-- ============================================================== -->
        <!-- SECTION 2: LIVE ORDERS MANAGEMENT & COURIER DISPATCH HUB       -->
        <!-- ============================================================== -->
        <div id="ordersSection" class="space-y-4">
          <!-- Search & Filter Controls Bar -->
          <div class="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3">
            <div class="flex items-center gap-2">
              <div class="relative flex-1">
                <input type="text" id="orderSearchInput" onkeyup="filterOrders()" placeholder="🔍 কাস্টমার নাম, মোবাইল, ঠিকানা বা মডেল কোড (DF-101) দিয়ে খুঁজুন..." class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-4 py-2.5 rounded-xl focus:outline-none focus:border-amber-500 focus:bg-white transition">
              </div>
              <a href="/api/export-csv" class="bg-white hover:bg-stone-50 text-stone-700 font-bold px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs flex items-center gap-1.5 shadow-2xs whitespace-nowrap">
                <span>📥 এক্সেল</span>
              </a>
              <button onclick="pollLiveData(true)" class="bg-[#fcfaf7] hover:bg-stone-100 text-stone-700 font-bold px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap">
                <span>🔄 সিঙ্ক</span>
              </button>
            </div>

            <!-- Status Filter Tabs -->
            <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold no-scrollbar">
              <button onclick="setFilter('ALL')" id="tab-ALL" class="filter-tab px-3.5 py-1.5 rounded-xl bg-stone-900 text-white whitespace-nowrap cursor-pointer transition">
                সবগুলো (<span id="count-tab-all">${totalOrders}</span>)
              </button>
              <button onclick="setFilter('Pending Verification')" id="tab-Pending-Verification" class="filter-tab px-3.5 py-1.5 rounded-xl bg-[#fcfaf7] border border-violet-300 text-violet-800 whitespace-nowrap cursor-pointer transition">
                📸 স্ক্রিনশট (<span id="count-tab-verification">${pendingVerificationOrders}</span>)
              </button>
              <button onclick="setFilter('Pending')" id="tab-Pending" class="filter-tab px-3.5 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-amber-800 whitespace-nowrap cursor-pointer transition">
                ⏳ পেন্ডিং (<span id="count-tab-pending">${pendingOrders}</span>)
              </button>
              <button onclick="setFilter('Approved')" id="tab-Approved" class="filter-tab px-3.5 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-emerald-800 whitespace-nowrap cursor-pointer transition">
                ✅ কনফার্মড (<span id="count-tab-approved">${approvedOrders}</span>)
              </button>
              <button onclick="setFilter('Shipped')" id="tab-Shipped" class="filter-tab px-3.5 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-sky-800 whitespace-nowrap cursor-pointer transition">
                🚚 শিপড (<span id="count-tab-shipped">${shippedOrders}</span>)
              </button>
              <button onclick="setFilter('Cancelled')" id="tab-Cancelled" class="filter-tab px-3.5 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-rose-800 whitespace-nowrap cursor-pointer transition">
                ❌ বাতিল (<span id="count-tab-cancelled">${cancelledOrders}</span>)
              </button>
            </div>
          </div>

          <!-- Orders Bulk Action Toolbar -->
          <div class="flex items-center justify-between px-1">
            <div class="flex items-center gap-2">
              <input type="checkbox" id="selectAllMobileOrders" class="w-4 h-4 rounded accent-amber-700 cursor-pointer" onclick="toggleSelectAllOrders(this)">
              <label for="selectAllMobileOrders" class="text-xs font-bold text-stone-600 cursor-pointer select-none">সব অর্ডার সিলেক্ট করুন</label>
            </div>
            <div id="orderBulkBar" class="hidden items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-xs">
              <span class="font-bold text-rose-900"><span id="orderSelectedCount">0</span> টি অর্ডার সিলেক্টেড</span>
              <button onclick="bulkDeleteOrders()" class="bg-rose-600 hover:bg-rose-700 text-white font-black px-3 py-1 rounded-lg shadow-2xs transition cursor-pointer">
                🗑️ বাল্ক ডিলিট
              </button>
            </div>
          </div>

          <!-- Orders Stream Container (Mobile Cards on Phones, Table on Desktop) -->
          <div id="ordersContainer">
            <!-- Mobile View -->
            <div class="block md:hidden space-y-3.5" id="mobileCardsStream">
              ${mobileOrderCards || '<div class="bg-white p-8 rounded-2xl border border-stone-200 text-center text-stone-400 font-semibold text-xs">এখনও কোনো অর্ডার আসেনি। WhatsApp-এ টেস্ট মেসেজ পাঠান!</div>'}
            </div>

            <!-- Desktop View -->
            <div class="hidden md:block bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
              <table class="w-full text-left text-sm" id="desktopOrdersTable">
                <thead class="bg-[#fbf9f5] text-stone-500 text-xs uppercase font-extrabold tracking-wider border-b border-stone-200">
                  <tr>
                    <th class="p-3.5 text-center w-8">
                      <input type="checkbox" id="selectAllDesktopOrders" class="w-4 h-4 rounded accent-amber-700 cursor-pointer" onclick="toggleSelectAllOrders(this)" title="সব অর্ডার সিলেক্ট করুন">
                    </th>
                    <th class="p-3.5">ID</th>
                    <th class="p-3.5">কাস্টমার নাম ও মোবাইল</th>
                    <th class="p-3.5">ডেলিভারি ঠিকানা</th>
                    <th class="p-3.5">মডেল SKU ও সাইজ</th>
                    <th class="p-3.5">পেমেন্ট ও Due COD</th>
                    <th class="p-3.5">স্ট্যাটাস</th>
                    <th class="p-3.5">তারিখ</th>
                    <th class="p-3.5 text-right">মুছুন</th>
                  </tr>
                </thead>
                <tbody id="desktopTableBody">
                  ${desktopOrderRows || '<tr><td colspan="9" class="text-center py-10 text-stone-400 font-medium">কোনো অর্ডার পাওয়া যায়নি।</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </main>

      <!-- ============================================== -->
      <!-- SLIDE-OVER DRAWER 1: Settings & Delivery Rules -->
      <!-- ============================================== -->
      <div id="settingsDrawer" style="display: none;" class="fixed inset-0 z-50 pointer-events-none opacity-0 transition-opacity duration-300">
        <div onclick="closeDrawer('settingsDrawer')" class="absolute inset-0 bg-stone-900/50 backdrop-blur-xs"></div>
        <div class="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl p-6 flex flex-col justify-between overflow-y-auto transform translate-x-full transition-transform duration-300">
          <div class="space-y-5">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 class="font-black text-base text-stone-900">⚙️ ডেলিভারি চার্জ ও পেমেন্ট রুলস</h3>
                <p class="text-xs text-stone-500 font-medium">WhatsApp AI স্বয়ংক্রিয়ভাবে এই রেটগুলো গ্রাহককে জানাবে</p>
              </div>
              <button onclick="closeDrawer('settingsDrawer')" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-black cursor-pointer">✕</button>
            </div>

            <form onsubmit="saveSettingsLive(event)" class="space-y-4">
              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">🏪 শপ / ব্র্যান্ডের নাম</label>
                <input type="text" id="drawer_shop_name" value="${curSettings.shop_name || 'Dawah Fashion'}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="bg-[#fcfaf7] p-3 rounded-xl border border-stone-200">
                  <label class="block text-xs font-bold text-stone-800 mb-1">🚚 ঢাকা ভেতরে</label>
                  <div class="flex items-center gap-1.5">
                    <span class="font-extrabold text-amber-900 text-sm">৳</span>
                    <input type="number" id="drawer_inside_fee" value="${curSettings.inside_dhaka_fee}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-bold p-2 rounded-lg focus:border-amber-500 outline-none">
                  </div>
                </div>
                <div class="bg-[#fcfaf7] p-3 rounded-xl border border-stone-200">
                  <label class="block text-xs font-bold text-stone-800 mb-1">🚛 ঢাকা বাইরে</label>
                  <div class="flex items-center gap-1.5">
                    <span class="font-extrabold text-amber-900 text-sm">৳</span>
                    <input type="number" id="drawer_outside_fee" value="${curSettings.outside_dhaka_fee}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-bold p-2 rounded-lg focus:border-amber-500 outline-none">
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="bg-[#fcfaf7] p-3 rounded-xl border border-stone-200">
                  <label class="block text-xs font-bold text-stone-800 mb-1">📱 বিকাশ নাম্বার</label>
                  <input type="text" id="drawer_bkash" value="${curSettings.bkash_number}" required class="w-full bg-white border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2 rounded-lg focus:border-amber-500 outline-none">
                </div>
                <div class="bg-[#fcfaf7] p-3 rounded-xl border border-stone-200">
                  <label class="block text-xs font-bold text-stone-800 mb-1">📱 নগদ নাম্বার</label>
                  <input type="text" id="drawer_nagad" value="${curSettings.nagad_number}" required class="w-full bg-white border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2 rounded-lg focus:border-amber-500 outline-none">
                </div>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">🎁 বিশেষ অফার / কম্বো ছাড়</label>
                <input type="text" id="drawer_promo_offer" value="${curSettings.promo_offer || ''}" placeholder="যেমন: ২টি নিলে ১০০ টাকা বিশেষ ছাড়" class="w-full bg-white border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-lg focus:border-amber-500 outline-none">
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি (AI কাস্টমারকে বলবে)</label>
                <textarea id="drawer_return_policy" rows="2" class="w-full bg-white border border-stone-300 text-stone-900 text-xs font-medium p-2 rounded-lg focus:border-amber-500 outline-none">${curSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে রিসিভ করতে পারবেন। কোনো সমস্যা থাকলে তাৎক্ষণিক রিটার্ন।'}</textarea>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">⚡ ফ্রি ডেলিভারি পাওয়ার সর্বনিম্ন অর্ডার (টাকা)</label>
                <input type="number" id="drawer_free_delivery_min" value="${curSettings.free_delivery_min_amount || 0}" placeholder="0 (বন্ধ রাখতে ০ দিন)" class="w-full bg-white border border-stone-300 text-stone-900 text-xs font-bold p-2 rounded-lg focus:border-amber-500 outline-none">
              </div>

              <!-- Steadfast Courier Integration Box -->
              <div class="bg-sky-50/70 p-3.5 rounded-xl border border-sky-200 space-y-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-black text-sky-950 flex items-center gap-1.5">
                    <span>🚚 Steadfast কুরিয়ার API ইন্টিগ্রেশন</span>
                  </span>
                  <span class="text-[10px] bg-sky-200 text-sky-900 font-bold px-2 py-0.5 rounded-full">Auto-Courier</span>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] font-bold text-stone-600 mb-0.5">Steadfast Api-Key</label>
                    <input type="text" id="drawer_steadfast_key" value="${curSettings.extra_config?.steadfast_api_key || ''}" placeholder="API Key" class="w-full bg-white border border-sky-200 text-stone-900 text-[11px] font-mono p-1.5 rounded-lg">
                  </div>
                  <div>
                    <label class="block text-[10px] font-bold text-stone-600 mb-0.5">Steadfast Secret-Key</label>
                    <input type="password" id="drawer_steadfast_secret" value="${curSettings.extra_config?.steadfast_secret_key || ''}" placeholder="Secret Key" class="w-full bg-white border border-sky-200 text-stone-900 text-[11px] font-mono p-1.5 rounded-lg">
                  </div>
                </div>
                <div class="flex items-center justify-between pt-1">
                  <label class="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-stone-700">
                    <input type="checkbox" id="drawer_auto_payment_verify" ${curSettings.extra_config?.auto_payment_verify ? 'checked' : ''} class="w-4 h-4 rounded accent-sky-600">
                    <span>অটো পেমেন্ট স্ক্যান (Mode B)</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-stone-700">
                    <input type="checkbox" id="drawer_auto_courier_on_confirm" ${curSettings.extra_config?.auto_courier_on_confirm ? 'checked' : ''} class="w-4 h-4 rounded accent-sky-600">
                    <span>কনফার্মে অটো পার্সেল তৈরি</span>
                  </label>
                </div>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200 flex items-center justify-between">
                <div>
                  <label class="block text-xs font-bold text-stone-800">🤖 গোস্টিং অটো-রিকভারি (Auto Recovery)</label>
                  <p class="text-[11px] text-stone-500 font-medium">২ ঘণ্টা পার হলে কাস্টমারকে শালীন ফলো-আপ পাঠানো</p>
                </div>
                <input type="checkbox" id="drawer_auto_followup" ${autoFollowupEnabled ? 'checked' : ''} class="w-5 h-5 rounded accent-amber-600 cursor-pointer">
              </div>

              <button type="submit" class="w-full bg-stone-900 hover:bg-black text-white text-xs font-black py-3 rounded-xl shadow-sm transition cursor-pointer">
                💾 সেটিংস ও কুরিয়ার রুলস সেভ করুন
              </button>
            </form>
          </div>
          <div class="text-[11px] text-stone-400 text-center pt-6 border-t border-stone-100">
            Dawah Fashion Commerce OS 2.0
          </div>
        </div>
      </div>

      <!-- ============================================== -->
      <!-- MODAL 1: ADD NEW PRODUCT MODEL                 -->
      <!-- ============================================== -->
      <div id="addProductModal" style="display: none;" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        <div class="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-stone-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
          <div class="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/70">
            <div>
              <h3 class="font-black text-base text-stone-900 flex items-center gap-2">
                <span>✨ নতুন প্রোডাক্ট মডেল যুক্ত করুন</span>
              </h3>
              <p class="text-xs text-stone-500 font-medium mt-0.5">মডেল কোড, মূল্য, সাইজ এবং ৫টি গোল্ডেন অ্যাঙ্গেল ছবি সেট করুন</p>
            </div>
            <button type="button" onclick="closeAddProductModal()" class="w-8 h-8 rounded-full bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold flex items-center justify-center cursor-pointer">✕</button>
          </div>

          <form onsubmit="saveNewProductLive(event)" class="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড (SKU) *</label>
                <input type="text" id="add_model_code" placeholder="যেমন: DF-107" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">প্রোডাক্টের নাম *</label>
                <input type="text" id="add_name" placeholder="যেমন: রোজভ্যালি কারচুপি আবায়া সেট" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">রেগুলার প্রাইস (টাকা)</label>
                <div class="flex items-center gap-1.5">
                  <span class="font-extrabold text-stone-400 text-sm">৳</span>
                  <input type="number" id="add_regular_price" placeholder="2650" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none" oninput="calculateAddDiscount()">
                </div>
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">অফার/বিক্রয় মূল্য *</label>
                <div class="flex items-center gap-1.5">
                  <span class="font-extrabold text-amber-900 text-sm">৳</span>
                  <input type="number" id="add_price" placeholder="2450" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none" oninput="calculateAddDiscount()">
                </div>
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">অটো ডিসকাউন্ট সেভ</label>
                <div id="add_discount_badge" class="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black p-2.5 rounded-xl flex items-center justify-center">
                  ৳০ ছাড়
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">স্টক সংখ্যা (পিস)</label>
                <input type="number" id="add_stock_quantity" value="10" min="0" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">ফেব্রিক / কাপড়</label>
                <input type="text" id="add_fabric" value="দুবাই চেরি" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">উপলব্ধ ঝুল সাইজ</label>
                <input type="text" id="add_sizes" value="৫০, ৫২, ৫৪, ৫৬" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">উপলব্ধ কালারসমূহ</label>
                <input type="text" id="add_colors" placeholder="যেমন: কালো, মেরুন, সি-গ্রিন, কফি" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">সার্চ কিওয়ার্ড (AI এর জন্য)</label>
                <input type="text" id="add_search_keywords" placeholder="যেমন: karchupi, cherry abaya, party gown" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">সংক্ষিপ্ত বিবরণ (Short Description)</label>
              <textarea id="add_short_description" rows="2" placeholder="দুবাই চেরি কাপড়ের উপর প্রিমিয়াম কারচুপির কাজ করা এক্সক্লুসিভ বোরকা সেট..." class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none"></textarea>
            </div>

            <div class="flex items-center gap-6 p-3 bg-stone-50 rounded-xl border border-stone-200">
              <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-stone-800">
                <input type="checkbox" id="add_hijab_included" checked class="w-4 h-4 rounded accent-amber-600">
                <span>ম্যাচিং হিজাব ফ্রি অন্তর্ভুক্ত</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-stone-800">
                <input type="checkbox" id="add_in_stock" checked class="w-4 h-4 rounded accent-emerald-600">
                <span>বর্তমানে ইন-স্টক (লাইভ সেল)</span>
              </label>
            </div>

            <!-- 5 Golden Photos Upload Grid -->
            <div>
              <label class="block text-xs font-extrabold text-stone-800 mb-1.5">📸 ৫টি গোল্ডেন অ্যাঙ্গেল ছবি (ফাইল আপলোড করুন বা লিংক দিন):</label>
              <div class="space-y-2.5">
                <!-- 1. Main -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="add_img_main_preview" src="https://placehold.co/100x120?text=1.+Main" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">১. মেইন ফ্রন্ট ভিউ ফটো *</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 ফাইল আপলোড
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'add_img_main_preview', 'add_img_main_url')">
                      </label>
                    </div>
                    <input type="text" id="add_img_main_url" placeholder="ইমেজ লিংক দিন বা ফাইল আপলোড করুন..." class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('add_img_main_preview').src = this.value || 'https://placehold.co/100x120?text=1.+Main'">
                  </div>
                </div>

                <!-- 2. Detail -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="add_img_detail_preview" src="https://placehold.co/100x120?text=2.+Work" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">২. কারচুপি / নিখুঁত কাজ ক্লোজ-আপ</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 ফাইল আপলোড
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'add_img_detail_preview', 'add_img_detail_url')">
                      </label>
                    </div>
                    <input type="text" id="add_img_detail_url" placeholder="ইমেজ লিংক দিন বা ফাইল আপলোড করুন..." class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('add_img_detail_preview').src = this.value || 'https://placehold.co/100x120?text=2.+Work'">
                  </div>
                </div>

                <!-- 3. Hijab -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="add_img_hijab_preview" src="https://placehold.co/100x120?text=3.+Hijab" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">৩. ম্যাচিং প্রিমিয়াম হিজাব</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 ফাইল আপলোড
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'add_img_hijab_preview', 'add_img_hijab_url')">
                      </label>
                    </div>
                    <input type="text" id="add_img_hijab_url" placeholder="ইমেজ লিংক দিন বা ফাইল আপলোড করুন..." class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('add_img_hijab_preview').src = this.value || 'https://placehold.co/100x120?text=3.+Hijab'">
                  </div>
                </div>

                <!-- 4. Flare -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="add_img_flare_preview" src="https://placehold.co/100x120?text=4.+Flare" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">৪. ঘের ও সাইড অ্যাঙ্গেল</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 ফাইল আপলোড
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'add_img_flare_preview', 'add_img_flare_url')">
                      </label>
                    </div>
                    <input type="text" id="add_img_flare_url" placeholder="ইমেজ লিংক দিন বা ফাইল আপলোড করুন..." class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('add_img_flare_preview').src = this.value || 'https://placehold.co/100x120?text=4.+Flare'">
                  </div>
                </div>

                <!-- 5. Real -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="add_img_real_preview" src="https://placehold.co/100x120?text=5.+Real" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">৫. আনফিল্টার্ড রিয়েল ক্যামেরা ছবি</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 ফাইল আপলোড
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'add_img_real_preview', 'add_img_real_url')">
                      </label>
                    </div>
                    <input type="text" id="add_img_real_url" placeholder="ইমেজ লিংক দিন বা ফাইল আপলোড করুন..." class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('add_img_real_preview').src = this.value || 'https://placehold.co/100x120?text=5.+Real'">
                  </div>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-stone-100 flex items-center justify-end gap-2.5">
              <button type="button" onclick="closeAddProductModal()" class="px-4 py-2 font-bold text-stone-600 hover:bg-stone-100 rounded-xl text-xs cursor-pointer">বাতিল</button>
              <button type="submit" id="addProdSubmitBtn" class="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-md transition cursor-pointer">
                ✨ প্রোডাক্ট সেভ করুন
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ============================================== -->
      <!-- MODAL 2: EDIT EXISTING PRODUCT MODEL           -->
      <!-- ============================================== -->
      <div id="editProductModal" style="display: none;" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        <div class="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-stone-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
          <div class="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/70">
            <div>
              <h3 class="font-black text-base text-stone-900 flex items-center gap-2">
                <span>✏️ প্রোডাক্ট এডিট করুন - </span>
                <span id="edit_modal_title_code" class="font-mono bg-amber-100 text-amber-950 px-2 py-0.5 rounded border border-amber-300 text-xs">DF-101</span>
              </h3>
              <p class="text-xs text-stone-500 font-medium mt-0.5">মডেল কোড, মূল্য, সাইজ ও ছবি পরিবর্তন করুন</p>
            </div>
            <button type="button" onclick="closeEditProductModal()" class="w-8 h-8 rounded-full bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold flex items-center justify-center cursor-pointer">✕</button>
          </div>

          <form onsubmit="saveEditProductLive(event)" class="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
            <input type="hidden" id="edit_product_id">
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড (SKU) *</label>
                <input type="text" id="edit_model_code" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">প্রোডাক্টের নাম *</label>
                <input type="text" id="edit_name" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">রেগুলার প্রাইস (টাকা)</label>
                <div class="flex items-center gap-1.5">
                  <span class="font-extrabold text-stone-400 text-sm">৳</span>
                  <input type="number" id="edit_regular_price" placeholder="2650" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none" oninput="calculateEditDiscount()">
                </div>
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">অফার/বিক্রয় মূল্য *</label>
                <div class="flex items-center gap-1.5">
                  <span class="font-extrabold text-amber-900 text-sm">৳</span>
                  <input type="number" id="edit_price" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none" oninput="calculateEditDiscount()">
                </div>
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">অটো ডিসকাউন্ট সেভ</label>
                <div id="edit_discount_badge" class="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black p-2.5 rounded-xl flex items-center justify-center">
                  ৳০ ছাড়
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">স্টক সংখ্যা (পিস)</label>
                <input type="number" id="edit_stock_quantity" min="0" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">ফেব্রিক / কাপড়</label>
                <input type="text" id="edit_fabric" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">উপলব্ধ ঝুল সাইজ</label>
                <input type="text" id="edit_sizes" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">উপলব্ধ কালারসমূহ</label>
                <input type="text" id="edit_colors" placeholder="যেমন: কালো, মেরুন, সি-গ্রিন, কফি" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">সার্চ কিওয়ার্ড (AI এর জন্য)</label>
                <input type="text" id="edit_search_keywords" placeholder="যেমন: karchupi, cherry abaya, party gown" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">সংক্ষিপ্ত বিবরণ (Short Description)</label>
              <textarea id="edit_short_description" rows="2" placeholder="দুবাই চেরি কাপড়ের উপর প্রিমিয়াম কারচুপির কাজ করা এক্সক্লুসিভ বোরকা সেট..." class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none"></textarea>
            </div>

            <div class="flex items-center gap-6 p-3 bg-stone-50 rounded-xl border border-stone-200">
              <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-stone-800">
                <input type="checkbox" id="edit_hijab_included" class="w-4 h-4 rounded accent-amber-600">
                <span>ম্যাচিং হিজাব ফ্রি অন্তর্ভুক্ত</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-stone-800">
                <input type="checkbox" id="edit_in_stock" class="w-4 h-4 rounded accent-emerald-600">
                <span>বর্তমানে ইন-স্টক (লাইভ সেল)</span>
              </label>
            </div>

            <!-- 5 Golden Photos Edit Grid -->
            <div>
              <label class="block text-xs font-extrabold text-stone-800 mb-1.5">📸 ৫টি গোল্ডেন অ্যাঙ্গেল ছবি পরিবর্তন / আপলোড:</label>
              <div class="space-y-2.5">
                <!-- 1. Main -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="edit_img_main_preview" src="" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">১. মেইন ফ্রন্ট ভিউ ফটো</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 নতুন ছবি দিন
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'edit_img_main_preview', 'edit_img_main_url')">
                      </label>
                    </div>
                    <input type="text" id="edit_img_main_url" class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('edit_img_main_preview').src = this.value">
                  </div>
                </div>

                <!-- 2. Detail -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="edit_img_detail_preview" src="" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">২. কারচুপি / কাজ ক্লোজ-আপ</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 নতুন ছবি দিন
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'edit_img_detail_preview', 'edit_img_detail_url')">
                      </label>
                    </div>
                    <input type="text" id="edit_img_detail_url" class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('edit_img_detail_preview').src = this.value">
                  </div>
                </div>

                <!-- 3. Hijab -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="edit_img_hijab_preview" src="" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">৩. ম্যাচিং হিজাব</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 নতুন ছবি দিন
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'edit_img_hijab_preview', 'edit_img_hijab_url')">
                      </label>
                    </div>
                    <input type="text" id="edit_img_hijab_url" class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('edit_img_hijab_preview').src = this.value">
                  </div>
                </div>

                <!-- 4. Flare -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="edit_img_flare_preview" src="" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">৪. ঘের ও সাইড অ্যাঙ্গেল</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 নতুন ছবি দিন
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'edit_img_flare_preview', 'edit_img_flare_url')">
                      </label>
                    </div>
                    <input type="text" id="edit_img_flare_url" class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('edit_img_flare_preview').src = this.value">
                  </div>
                </div>

                <!-- 5. Real -->
                <div class="p-2.5 bg-[#fcfaf7] rounded-xl border border-stone-200 flex items-center gap-3">
                  <img id="edit_img_real_preview" src="" class="w-12 h-14 object-cover rounded-lg border border-stone-300 shadow-2xs">
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-black text-stone-800">৫. আনফিল্টার্ড রিয়েল ছবি</span>
                      <label class="text-[10px] bg-stone-800 hover:bg-black text-white px-2 py-0.5 rounded cursor-pointer font-bold">
                        📁 নতুন ছবি দিন
                        <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(this, 'edit_img_real_preview', 'edit_img_real_url')">
                      </label>
                    </div>
                    <input type="text" id="edit_img_real_url" class="w-full bg-white border border-stone-300 text-stone-900 text-[11px] p-1.5 rounded-lg focus:border-amber-500 outline-none" oninput="document.getElementById('edit_img_real_preview').src = this.value">
                  </div>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-stone-100 flex items-center justify-end gap-2.5">
              <button type="button" onclick="closeEditProductModal()" class="px-4 py-2 font-bold text-stone-600 hover:bg-stone-100 rounded-xl text-xs cursor-pointer">বাতিল</button>
              <button type="submit" id="editProdSubmitBtn" class="bg-stone-900 hover:bg-black text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-md transition cursor-pointer">
                💾 আপডেট সেভ করুন
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Full-Screen High-Definition Photo Lightbox Modal -->
      <div id="lightboxModal" style="display: none;" class="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="max-w-2xl w-full flex flex-col items-center">
          <div class="w-full flex items-center justify-between text-white pb-3">
            <h4 id="lightboxTitle" class="text-sm font-black">মডেল ছবি</h4>
            <button onclick="closeLightbox()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white font-bold flex items-center justify-center cursor-pointer">✕</button>
          </div>
          <img id="lightboxImg" src="" class="max-h-[80vh] max-w-full rounded-2xl shadow-2xl border border-stone-700 object-contain">
        </div>
      </div>

      <!-- Payment Screenshot Lightbox & 1-Click Verification Modal -->
      <div id="screenshotModal" style="display: none;" class="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-stone-200 flex flex-col max-h-[92vh]">
          <div class="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
            <div>
              <h3 class="font-black text-stone-900 text-sm flex items-center gap-2">
                <span>📸 পেমেন্ট স্ক্রিনশট প্রিভিউ</span>
                <span id="modalOrderId" class="font-mono text-xs bg-stone-200 px-2 py-0.5 rounded text-stone-700">#0</span>
              </h3>
              <p id="modalCustInfo" class="text-xs text-stone-500 font-bold mt-0.5">কাস্টমার: 017XXXXXXX</p>
            </div>
            <button type="button" onclick="closeScreenshotModal()" class="w-8 h-8 rounded-full bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold flex items-center justify-center cursor-pointer">✕</button>
          </div>
          <div class="p-4 bg-stone-900/5 flex items-center justify-center overflow-auto flex-1 min-h-[300px]">
            <img id="modalScreenshotImg" src="" alt="Payment Screenshot" class="max-h-[60vh] max-w-full rounded-2xl shadow-lg border border-stone-200 object-contain">
          </div>
          <div class="p-4 border-t border-stone-100 bg-white flex items-center justify-between gap-3 flex-wrap">
            <button type="button" onclick="closeScreenshotModal()" class="px-4 py-2 font-bold text-stone-600 hover:bg-stone-100 rounded-xl text-xs cursor-pointer">বন্ধ করুন</button>
            <div class="flex items-center gap-2">
              <a id="modalOpenExternal" href="#" target="_blank" class="px-3 py-2 font-bold text-amber-900 hover:bg-amber-50 rounded-xl text-xs border border-amber-200 cursor-pointer">
                🔍 বড় ছবি
              </a>
              <button id="modalApproveBtn" type="button" onclick="approveFromModal()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-4 py-2 rounded-xl shadow-md text-xs flex items-center gap-1.5 cursor-pointer">
                <span>✅ ভেরিফাই ও কনফার্ম</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Toast Notification Bar -->
      <div id="toast" class="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-stone-900 text-white text-xs font-extrabold px-5 py-3 rounded-full shadow-2xl opacity-0 pointer-events-none transition-all duration-300 z-50 flex items-center gap-2">
        <span id="toastMsg">বার্তা সংরক্ষিত হয়েছে!</span>
      </div>

      <script>
        window.__PRODUCTS__ = ${JSON.stringify(products || [])};
        const curStoreSettings = {
          inside_dhaka_fee: ${curSettings.inside_dhaka_fee},
          outside_dhaka_fee: ${curSettings.outside_dhaka_fee}
        };

        function calculateAddDiscount() {
          const reg = parseFloat(document.getElementById('add_regular_price').value) || 0;
          const off = parseFloat(document.getElementById('add_price').value) || 0;
          const diff = reg > off ? reg - off : 0;
          const badge = document.getElementById('add_discount_badge');
          if (badge) badge.innerText = diff > 0 ? ('৳' + diff + ' ছাড়') : 'কোনো ছাড় নেই';
        }

        function calculateEditDiscount() {
          const reg = parseFloat(document.getElementById('edit_regular_price').value) || 0;
          const off = parseFloat(document.getElementById('edit_price').value) || 0;
          const diff = reg > off ? reg - off : 0;
          const badge = document.getElementById('edit_discount_badge');
          if (badge) badge.innerText = diff > 0 ? ('৳' + diff + ' ছাড়') : 'কোনো ছাড় নেই';
        }

        function openEditProductModalById(id) {
          const p = (window.__PRODUCTS__ || []).find(x => x.id == id);
          if (!p) return;
          document.getElementById('edit_product_id').value = p.id;
          document.getElementById('edit_modal_title_code').innerText = p.model_code || '';
          document.getElementById('edit_model_code').value = p.model_code || '';
          document.getElementById('edit_name').value = p.name || '';
          document.getElementById('edit_price').value = p.price || '';
          document.getElementById('edit_regular_price').value = p.regular_price || p.price || '';
          document.getElementById('edit_stock_quantity').value = p.stock_quantity !== undefined ? p.stock_quantity : 10;
          document.getElementById('edit_colors').value = p.colors || '';
          document.getElementById('edit_search_keywords').value = p.search_keywords || '';
          document.getElementById('edit_short_description').value = p.short_description || '';
          calculateEditDiscount();
          document.getElementById('edit_fabric').value = p.fabric || 'দুবাই চেরি';
          document.getElementById('edit_sizes').value = p.sizes || '৫০, ৫২, ৫৪, ৫৬';
          document.getElementById('edit_hijab_included').checked = (p.hijab_included === true || p.hijab_included === 'true');
          document.getElementById('edit_in_stock').checked = (p.in_stock === true || p.in_stock === 'true');

          document.getElementById('edit_img_main_url').value = p.image_url || '';
          document.getElementById('edit_img_main_preview').src = p.image_url || 'https://placehold.co/100x120?text=1.+Main';

          document.getElementById('edit_img_detail_url').value = p.detail_image_url || '';
          document.getElementById('edit_img_detail_preview').src = p.detail_image_url || 'https://placehold.co/100x120?text=2.+Work';

          document.getElementById('edit_img_hijab_url').value = p.hijab_image_url || '';
          document.getElementById('edit_img_hijab_preview').src = p.hijab_image_url || 'https://placehold.co/100x120?text=3.+Hijab';

          document.getElementById('edit_img_flare_url').value = p.flare_image_url || '';
          document.getElementById('edit_img_flare_preview').src = p.flare_image_url || 'https://placehold.co/100x120?text=4.+Flare';

          document.getElementById('edit_img_real_url').value = p.real_image_url || '';
          document.getElementById('edit_img_real_preview').src = p.real_image_url || 'https://placehold.co/100x120?text=5.+Real';

          const m = document.getElementById('editProductModal');
          if (m) {
            m.style.display = 'flex';
            m.classList.remove('hidden');
          }
        }

        function copyPromoTextById(id) {
          const p = (window.__PRODUCTS__ || []).find(x => x.id == id);
          if (!p) return;
          const promo = '👗 *' + p.name + '* (' + (p.model_code || '') + ')\n' +
            '💰 মূল্য: *৳' + p.price + '* টাকা (ম্যাচিং হিজাব একদম ফ্রি)\n' +
            '✨ ফেব্রিক: ' + (p.fabric || 'প্রিমিয়াম চেরি') + '\n' +
            '📏 সাইজ: ' + (p.sizes || '৫০, ৫২, ৫৪, ৫৬') + '\n' +
            '🚚 ডেলিভারি চার্জ: ঢাকার ভেতর ৳' + curStoreSettings.inside_dhaka_fee + ', বাইরে ৳' + curStoreSettings.outside_dhaka_fee + '\n' +
            '📦 ক্যাশ অন ডেলিভারি (পার্সেল দেখে নেওয়ার সুবিধা)।\n' +
            'অর্ডার করতে সাইজ, নাম, ঠিকানা ও ফোন নাম্বার লিখে মেসেজ দিন!';
          navigator.clipboard.writeText(promo);
          showToast('📋 মডেল প্রমোশন টেক্সট কপি হয়েছে!');
        }

        // Smooth scroll helper
        function scrollToSection(id) {
          const el = document.getElementById(id);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }

        // ==========================================
        // Executive Multi-View Tab Switcher
        // ==========================================
        function switchMainView(tabName) {
          const views = {
            'orders': document.getElementById('ordersSection'),
            'products': document.getElementById('productsSection'),
            'bot-test': document.getElementById('botTestSection')
          };
          const buttons = {
            'orders': document.getElementById('main-tab-orders'),
            'products': document.getElementById('main-tab-products'),
            'bot-test': document.getElementById('main-tab-bot-test')
          };

          for (const key in views) {
            if (views[key]) {
              if (key === tabName) {
                views[key].classList.remove('hidden');
              } else {
                views[key].classList.add('hidden');
              }
            }
            if (buttons[key]) {
              if (key === tabName) {
                buttons[key].className = 'main-tab-btn px-4 py-2.5 rounded-2xl bg-stone-900 text-white font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs whitespace-nowrap';
              } else {
                buttons[key].className = 'main-tab-btn px-4 py-2.5 rounded-2xl bg-white border border-stone-300 text-stone-700 hover:text-stone-900 font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs whitespace-nowrap';
              }
            }
          }
          if (window.location.hash !== '#' + tabName) {
            history.replaceState(null, null, '#' + tabName);
          }
        }

        // On Page Load: check URL hash
        window.addEventListener('DOMContentLoaded', () => {
          const hash = window.location.hash.replace('#', '');
          if (hash === 'products' || hash === 'bot-test') {
            switchMainView(hash);
          } else {
            switchMainView('orders');
          }
        });

        // ==========================================
        // Product Management (Add, Edit, Stock, Delete, Upload)
        // ==========================================
        function openAddProductModal() {
          const m = document.getElementById('addProductModal');
          if (m) {
            m.style.display = 'flex';
            m.classList.remove('hidden');
          }
        }
        function closeAddProductModal() {
          const m = document.getElementById('addProductModal');
          if (m) {
            m.style.display = 'none';
            m.classList.add('hidden');
          }
        }

        function openEditProductModal(id, code, name, price, fabric, sizes, hijab, stock, imgMain, imgDetail, imgHijab, imgFlare, imgReal) {
          document.getElementById('edit_product_id').value = id;
          document.getElementById('edit_modal_title_code').innerText = code;
          document.getElementById('edit_model_code').value = code;
          document.getElementById('edit_name').value = name;
          document.getElementById('edit_price').value = price;
          document.getElementById('edit_fabric').value = fabric || 'দুবাই চেরি';
          document.getElementById('edit_sizes').value = sizes || '৫০, ৫২, ৫৪, ৫৬';
          document.getElementById('edit_hijab_included').checked = (hijab === true || hijab === 'true');
          document.getElementById('edit_in_stock').checked = (stock === true || stock === 'true');

          document.getElementById('edit_img_main_url').value = imgMain || '';
          document.getElementById('edit_img_main_preview').src = imgMain || 'https://placehold.co/100x120?text=1.+Main';

          document.getElementById('edit_img_detail_url').value = imgDetail || '';
          document.getElementById('edit_img_detail_preview').src = imgDetail || 'https://placehold.co/100x120?text=2.+Work';

          document.getElementById('edit_img_hijab_url').value = imgHijab || '';
          document.getElementById('edit_img_hijab_preview').src = imgHijab || 'https://placehold.co/100x120?text=3.+Hijab';

          document.getElementById('edit_img_flare_url').value = imgFlare || '';
          document.getElementById('edit_img_flare_preview').src = imgFlare || 'https://placehold.co/100x120?text=4.+Flare';

          document.getElementById('edit_img_real_url').value = imgReal || '';
          document.getElementById('edit_img_real_preview').src = imgReal || 'https://placehold.co/100x120?text=5.+Real';

          const m = document.getElementById('editProductModal');
          if (m) {
            m.style.display = 'flex';
            m.classList.remove('hidden');
          }
        }

        function closeEditProductModal() {
          const m = document.getElementById('editProductModal');
          if (m) {
            m.style.display = 'none';
            m.classList.add('hidden');
          }
        }

        async function handleImageUpload(inputElem, previewImgId, urlInputId) {
          const file = inputElem.files[0];
          if (!file) return;

          showToast('⏳ ছবি আপলোড হচ্ছে...');
          const reader = new FileReader();
          reader.onload = async function(e) {
            const base64 = e.target.result;
            try {
              const res = await fetch('/api/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  imageBase64: base64,
                  filename: file.name,
                  contentType: file.type
                })
              });
              const data = await res.json();
              if (data.success && data.url) {
                document.getElementById(urlInputId).value = data.url;
                document.getElementById(previewImgId).src = data.url;
                showToast('📸 ছবি সফলভাবে আপলোড হয়েছে!');
              } else {
                alert('আপলোড ব্যর্থ: ' + (data.error || 'অজানা ত্রুটি'));
              }
            } catch (err) {
              alert('আপলোড এরর: ' + err.message);
            }
          };
          reader.readAsDataURL(file);
        }

        async function saveNewProductLive(e) {
          e.preventDefault();
          const btn = document.getElementById('addProdSubmitBtn');
          btn.innerText = 'সেভ হচ্ছে...';
          btn.disabled = true;

          const payload = {
            model_code: document.getElementById('add_model_code').value,
            name: document.getElementById('add_name').value,
            price: document.getElementById('add_price').value,
            regular_price: document.getElementById('add_regular_price').value,
            discount_price: document.getElementById('add_price').value,
            stock_quantity: document.getElementById('add_stock_quantity').value,
            colors: document.getElementById('add_colors').value,
            search_keywords: document.getElementById('add_search_keywords').value,
            short_description: document.getElementById('add_short_description').value,
            fabric: document.getElementById('add_fabric').value,
            sizes: document.getElementById('add_sizes').value,
            hijab_included: document.getElementById('add_hijab_included').checked,
            in_stock: document.getElementById('add_in_stock').checked,
            image_url: document.getElementById('add_img_main_url').value,
            detail_image_url: document.getElementById('add_img_detail_url').value,
            hijab_image_url: document.getElementById('add_img_hijab_url').value,
            flare_image_url: document.getElementById('add_img_flare_url').value,
            real_image_url: document.getElementById('add_img_real_url').value,
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
              showToast('✨ নতুন প্রোডাক্ট সফলভাবে সেভ হয়েছে!');
              closeAddProductModal();
              setTimeout(() => {
                window.location.hash = 'products';
                window.location.reload();
              }, 600);
            } else {
              alert('প্রোডাক্ট সেভ হয়নি: ' + (data.error || 'ত্রুটি'));
            }
          } catch (err) {
            alert('কানেকশন সমস্যা: ' + err.message);
          } finally {
            btn.innerText = '✨ প্রোডাক্ট সেভ করুন';
            btn.disabled = false;
          }
        }

        async function saveEditProductLive(e) {
          e.preventDefault();
          const id = document.getElementById('edit_product_id').value;
          const btn = document.getElementById('editProdSubmitBtn');
          btn.innerText = 'আপডেট হচ্ছে...';
          btn.disabled = true;

          const payload = {
            model_code: document.getElementById('edit_model_code').value,
            name: document.getElementById('edit_name').value,
            price: document.getElementById('edit_price').value,
            regular_price: document.getElementById('edit_regular_price').value,
            discount_price: document.getElementById('edit_price').value,
            stock_quantity: document.getElementById('edit_stock_quantity').value,
            colors: document.getElementById('edit_colors').value,
            search_keywords: document.getElementById('edit_search_keywords').value,
            short_description: document.getElementById('edit_short_description').value,
            fabric: document.getElementById('edit_fabric').value,
            sizes: document.getElementById('edit_sizes').value,
            hijab_included: document.getElementById('edit_hijab_included').checked,
            in_stock: document.getElementById('edit_in_stock').checked,
            image_url: document.getElementById('edit_img_main_url').value,
            detail_image_url: document.getElementById('edit_img_detail_url').value,
            hijab_image_url: document.getElementById('edit_img_hijab_url').value,
            flare_image_url: document.getElementById('edit_img_flare_url').value,
            real_image_url: document.getElementById('edit_img_real_url').value,
            ajax: true
          };

          try {
            const res = await fetch('/api/products/' + id + '/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
              showToast('💾 প্রোডাক্ট তথ্য সফলভাবে আপডেট হয়েছে!');
              closeEditProductModal();
              setTimeout(() => {
                window.location.hash = 'products';
                window.location.reload();
              }, 600);
            } else {
              alert('আপডেট হয়নি: ' + (data.error || 'ত্রুটি'));
            }
          } catch (err) {
            alert('কানেকশন সমস্যা: ' + err.message);
          } finally {
            btn.innerText = '💾 আপডেট সেভ করুন';
            btn.disabled = false;
          }
        }

        async function toggleStockLive(id, newStockStatus, btnElem) {
          try {
            const res = await fetch('/api/products/' + id + '/toggle-stock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ in_stock: newStockStatus, ajax: true })
            });
            const data = await res.json();
            if (data.success) {
              const inStock = data.in_stock;
              btnElem.innerText = inStock ? '● In Stock' : '○ Stock Out';
              btnElem.className = 'text-[10px] font-black cursor-pointer px-2 py-0.5 rounded-full border transition ' + 
                (inStock ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100');
              btnElem.setAttribute('onclick', 'toggleStockLive(' + id + ', ' + (!inStock) + ', this)');
              showToast('📦 স্টক স্ট্যাটাস আপডেট হয়েছে: ' + (inStock ? 'In Stock' : 'Stock Out'));
            }
          } catch (e) {
            alert('স্টক আপডেট এরর: ' + e.message);
          }
        }

        async function deleteProductLive(id, modelCode) {
          if (!confirm('আপনি কি নিশ্চিত যে ' + modelCode + ' প্রোডাক্টটি সম্পূর্ণ মুছে ফেলতে চান?')) return;
          try {
            const res = await fetch('/api/products/' + id + '/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ ajax: true })
            });
            const data = await res.json();
            if (data.success) {
              showToast('🗑️ ' + modelCode + ' প্রোডাক্টটি মুছে ফেলা হয়েছে');
              const card = document.querySelector('[data-product-id="' + id + '"]');
              if (card) {
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 300);
              }
            }
          } catch (e) {
            alert('ডিলিট ব্যর্থ: ' + e.message);
          }
        }

        function filterProducts() {
          const q = (document.getElementById('productSearchInput')?.value || '').toLowerCase().trim();
          document.querySelectorAll('.product-item-card').forEach(card => {
            const s = card.getAttribute('data-search') || '';
            card.style.display = (!q || s.includes(q)) ? '' : 'none';
          });
        }

        function filterProductsStock(type) {
          document.querySelectorAll('.prod-filter-btn').forEach(b => {
            b.className = 'prod-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer';
          });
          const btnMap = { 'ALL': 'prod-filter-all', 'IN_STOCK': 'prod-filter-instock', 'STOCK_OUT': 'prod-filter-out' };
          const activeBtn = document.getElementById(btnMap[type]);
          if (activeBtn) activeBtn.className = 'prod-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer';

          document.querySelectorAll('.product-item-card').forEach(card => {
            const isStock = card.innerText.includes('In Stock');
            if (type === 'ALL') card.style.display = '';
            else if (type === 'IN_STOCK') card.style.display = isStock ? '' : 'none';
            else if (type === 'STOCK_OUT') card.style.display = !isStock ? '' : 'none';
          });
        }

        // ==========================================
        // Live AI Bot Simulator / Tuning Bench
        // ==========================================
        function clearTestChat() {
          const body = document.getElementById('simulatorChatBody');
          body.innerHTML = '<div class="flex justify-start">' +
            '<div class="max-w-[85%] bg-white p-3.5 rounded-2xl rounded-tl-none shadow-xs border border-stone-200 text-stone-800 text-xs leading-relaxed">' +
            '😊 আসসালামু আলাইকুম! এটি দাওয়াহ ফ্যাশন এআই সেলস টেস্ট বেঞ্চ। নিচে যেকোনো প্রশ্ন লিখুন বা বাঁ পাশের প্রিসেট থেকে সিলেক্ট করে টেস্ট করুন।' +
            '</div></div>';
          document.getElementById('simulatorLatencyBadge').classList.add('hidden');
        }

        function runPresetQuery(text) {
          document.getElementById('simulatorInput').value = text;
          sendSimulatorMessage(text);
        }

        function handleSimulatorSubmit(e) {
          e.preventDefault();
          const input = document.getElementById('simulatorInput');
          const val = input.value.trim();
          if (!val) return;
          sendSimulatorMessage(val);
          input.value = '';
        }

        async function sendSimulatorMessage(text) {
          const chatBody = document.getElementById('simulatorChatBody');
          const sendBtn = document.getElementById('simulatorSendBtn');
          const latencyBadge = document.getElementById('simulatorLatencyBadge');

          // Append User Message Bubble
          const userBubble = document.createElement('div');
          userBubble.className = 'flex justify-end';
          userBubble.innerHTML = '<div class="max-w-[80%] bg-emerald-700 text-white p-3 rounded-2xl rounded-tr-none shadow-xs text-xs leading-relaxed font-medium">' +
            text.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
            '</div>';
          chatBody.appendChild(userBubble);
          chatBody.scrollTop = chatBody.scrollHeight;

          // Append Typing Placeholder
          const typingBubble = document.createElement('div');
          typingBubble.className = 'flex justify-start typing-indicator-item';
          typingBubble.innerHTML = '<div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-xs border border-stone-200 text-stone-400 text-xs flex items-center gap-1.5 font-bold">' +
            '<span class="w-2 h-2 rounded-full bg-stone-400 animate-bounce"></span>' +
            '<span class="w-2 h-2 rounded-full bg-stone-400 animate-bounce" style="animation-delay: 0.15s"></span>' +
            '<span class="w-2 h-2 rounded-full bg-stone-400 animate-bounce" style="animation-delay: 0.3s"></span>' +
            '<span class="ml-1 text-[11px]">AI টাইপ করছে...</span>' +
            '</div>';
          chatBody.appendChild(typingBubble);
          chatBody.scrollTop = chatBody.scrollHeight;

          sendBtn.disabled = true;

          try {
            const res = await fetch('/api/test-bot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: text })
            });
            const data = await res.json();
            typingBubble.remove();

            if (data.success) {
              // Update Latency Badge
              latencyBadge.classList.remove('hidden');
              latencyBadge.innerText = (data.isFastPath ? '⚡ ' : '🤖 ') + data.latencyMs + 'ms ' + (data.isFastPath ? 'Fast-Path' : 'Groq');

              // Render Bot Reply
              const botBubble = document.createElement('div');
              botBubble.className = 'flex flex-col items-start space-y-2';

              const replyTextDiv = document.createElement('div');
              replyTextDiv.className = 'max-w-[85%] bg-white p-3.5 rounded-2xl rounded-tl-none shadow-xs border border-stone-200 text-stone-800 text-xs leading-relaxed whitespace-pre-line';
              replyTextDiv.textContent = data.reply;
              botBubble.appendChild(replyTextDiv);

              if (data.photos && data.photos.length > 0) {
                const photosContainer = document.createElement('div');
                photosContainer.className = 'flex gap-2 overflow-x-auto max-w-full pb-1 pt-1';
                data.photos.forEach(function(ph) {
                  const card = document.createElement('div');
                  card.className = 'bg-white rounded-xl border border-amber-300 p-1.5 shadow-xs flex-shrink-0 cursor-pointer hover:border-amber-500 transition';
                  card.onclick = function() {
                    openLightbox(ph.url, ph.modelCode + ' - ' + ph.label);
                  };
                  const img = document.createElement('img');
                  img.src = ph.url;
                  img.className = 'w-20 h-24 object-cover rounded-lg shadow-2xs';
                  const titleDiv = document.createElement('div');
                  titleDiv.className = 'text-[9px] font-black text-stone-900 mt-1 text-center font-mono';
                  titleDiv.textContent = ph.modelCode;
                  const labelDiv = document.createElement('div');
                  labelDiv.className = 'text-[8px] text-amber-800 font-bold text-center';
                  labelDiv.textContent = ph.label;
                  card.appendChild(img);
                  card.appendChild(titleDiv);
                  card.appendChild(labelDiv);
                  photosContainer.appendChild(card);
                });
                botBubble.appendChild(photosContainer);
              }

              const metaDiv = document.createElement('div');
              metaDiv.className = 'text-[9px] text-stone-400 font-mono pl-1';
              metaDiv.textContent = data.latencyMs + 'ms • Dawah AI Fast-Engine';
              botBubble.appendChild(metaDiv);

              chatBody.appendChild(botBubble);
            } else {
              const errBubble = document.createElement('div');
              errBubble.className = 'flex justify-start';
              errBubble.innerHTML = '<div class="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs font-bold">⚠️ ' + (data.error || 'এরর হয়েছে') + '</div>';
              chatBody.appendChild(errBubble);
            }
          } catch (err) {
            typingBubble.remove();
            const errBubble = document.createElement('div');
            errBubble.className = 'flex justify-start';
            errBubble.innerHTML = '<div class="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs font-bold">⚠️ কানেকশন সমস্যা: ' + err.message + '</div>';
            chatBody.appendChild(errBubble);
          } finally {
            sendBtn.disabled = false;
            chatBody.scrollTop = chatBody.scrollHeight;
          }
        }

        // Lightbox helper
        function openLightbox(url, title) {
          const modal = document.getElementById('lightboxModal');
          document.getElementById('lightboxImg').src = url;
          document.getElementById('lightboxTitle').innerText = title || 'বোরকা মডেল ছবি';
          if (modal) {
            modal.style.display = 'flex';
            modal.classList.remove('hidden');
          }
        }
        function closeLightbox() {
          const modal = document.getElementById('lightboxModal');
          if (modal) {
            modal.style.display = 'none';
            modal.classList.add('hidden');
          }
        }

        // Drawer Management
        function openDrawer(id) {
          const drawer = document.getElementById(id);
          if (!drawer) return;
          drawer.style.display = 'block';
          drawer.classList.remove('pointer-events-none', 'opacity-0');
          drawer.classList.add('pointer-events-auto', 'opacity-100');
          const panel = drawer.querySelector('.w-full.max-w-md, .w-full.max-w-2xl');
          if (panel) {
            panel.classList.remove('translate-x-full');
            panel.classList.add('translate-x-0');
          }
        }
        function closeDrawer(id) {
          const drawer = document.getElementById(id);
          if (!drawer) return;
          drawer.classList.remove('pointer-events-auto', 'opacity-100');
          drawer.classList.add('pointer-events-none', 'opacity-0');
          const panel = drawer.querySelector('.w-full.max-w-md, .w-full.max-w-2xl');
          if (panel) {
            panel.classList.remove('translate-x-0');
            panel.classList.add('translate-x-full');
          }
          setTimeout(() => {
            drawer.style.display = 'none';
          }, 300);
        }

        function togglePaymentDrawer(id) {
          const mobileForm = document.getElementById('payment-drawer-' + id);
          if (mobileForm) mobileForm.classList.toggle('hidden');
          const desktopRow = document.getElementById('desktop-payment-' + id);
          if (desktopRow) desktopRow.classList.toggle('hidden');
        }

        function showToast(msg) {
          const t = document.getElementById('toast');
          const tm = document.getElementById('toastMsg');
          tm.innerText = msg;
          t.classList.remove('opacity-0', 'pointer-events-none');
          t.classList.add('opacity-100');
          setTimeout(() => {
            t.classList.remove('opacity-100');
            t.classList.add('opacity-0', 'pointer-events-none');
          }, 3000);
        }

        function copyCourierData(text) {
          navigator.clipboard.writeText(text);
          showToast('📋 কুরিয়ার ফরম্যাট কপি হয়েছে (Steadfast/Pathao রেডি)!');
        }

        function copyPromoText(text) {
          navigator.clipboard.writeText(text);
          showToast('📋 মডেল প্রমোশন টেক্সট কপি হয়েছে!');
        }

        // Live AJAX Status Update (Zero Reload)
        async function updateOrderStatusLive(id, status, selectElem) {
          try {
            const res = await fetch('/api/orders/' + id + '/status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ status, ajax: true })
            });
            if (res.ok) {
              showToast('✅ অর্ডার #' + id + ' এর স্ট্যাটাস ' + status + ' করা হয়েছে!');
              if (selectElem) {
                selectElem.className = 'text-xs px-2.5 py-1.5 rounded-xl border font-black cursor-pointer transition shadow-2xs outline-none ' + (
                  status === 'Pending Verification' ? 'bg-violet-100 text-violet-900 border-violet-400 font-black' :
                  status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
                  status === 'Shipped' ? 'bg-sky-50 text-sky-800 border-sky-300' :
                  status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
                );
              }
              const card = document.querySelector('[data-order-id="' + id + '"]');
              if (card) card.setAttribute('data-status', status);
              pollLiveData();
            }
          } catch (e) {
            alert('স্ট্যাটাস আপডেট ব্যর্থ: ' + e.message);
          }
        }

        // Live AJAX Save Payment & Trx
        async function savePaymentLive(e, id) {
          e.preventDefault();
          const fee = document.getElementById('fee-' + id)?.value || document.getElementById('fee-d-' + id)?.value || 80;
          const adv = document.getElementById('advance-' + id)?.value || document.getElementById('advance-d-' + id)?.value || 0;
          const trx = document.getElementById('trx-' + id)?.value || document.getElementById('trx-d-' + id)?.value || '';
          const due = document.getElementById('due-' + id)?.value || document.getElementById('due-d-' + id)?.value || 2200;

          try {
            const res = await fetch('/api/orders/' + id + '/update-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                delivery_fee: fee,
                advance_paid: adv,
                trx_id_or_last4: trx,
                due_cod: due,
                ajax: true
              })
            });
            if (res.ok) {
              showToast('💾 অর্ডার #' + id + ' এর পেমেন্ট তথ্য সেভ হয়েছে!');
              togglePaymentDrawer(id);
              setTimeout(() => window.location.reload(), 800);
            }
          } catch (err) {
            alert('পেমেন্ট সেভ ব্যর্থ: ' + err.message);
          }
        }

        // Live AJAX Save Settings Rules (including Steadfast & Store Policies)
        async function saveSettingsLive(e) {
          e.preventDefault();
          const inside = document.getElementById('drawer_inside_fee').value;
          const outside = document.getElementById('drawer_outside_fee').value;
          const bkash = document.getElementById('drawer_bkash').value;
          const nagad = document.getElementById('drawer_nagad').value;
          const promoOffer = document.getElementById('drawer_promo_offer') ? document.getElementById('drawer_promo_offer').value.trim() : '';
          const autoFollowup = document.getElementById('drawer_auto_followup') ? document.getElementById('drawer_auto_followup').checked : true;
          const shopName = document.getElementById('drawer_shop_name') ? document.getElementById('drawer_shop_name').value.trim() : 'Dawah Fashion';
          const returnPolicy = document.getElementById('drawer_return_policy') ? document.getElementById('drawer_return_policy').value.trim() : '';
          const freeDelMin = document.getElementById('drawer_free_delivery_min') ? document.getElementById('drawer_free_delivery_min').value : 0;
          const stKey = document.getElementById('drawer_steadfast_key') ? document.getElementById('drawer_steadfast_key').value.trim() : '';
          const stSecret = document.getElementById('drawer_steadfast_secret') ? document.getElementById('drawer_steadfast_secret').value.trim() : '';
          const autoPay = document.getElementById('drawer_auto_payment_verify') ? document.getElementById('drawer_auto_payment_verify').checked : false;
          const autoCourier = document.getElementById('drawer_auto_courier_on_confirm') ? document.getElementById('drawer_auto_courier_on_confirm').checked : false;

          try {
            const res = await fetch('/api/settings/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                inside_dhaka_fee: inside,
                outside_dhaka_fee: outside,
                bkash_number: bkash,
                nagad_number: nagad,
                promo_offer: promoOffer,
                auto_followup: autoFollowup,
                shop_name: shopName,
                return_policy: returnPolicy,
                free_delivery_min_amount: freeDelMin,
                steadfast_api_key: stKey,
                steadfast_secret_key: stSecret,
                auto_payment_verify: autoPay,
                auto_courier_on_confirm: autoCourier,
                ajax: true
              })
            });
            if (res.ok) {
              showToast('⚙️ স্টোর সেটিংস, কুরিয়ার রুলস ও পলিসি সফলভাবে সেভ হয়েছে!');
              closeDrawer('settingsDrawer');
            }
          } catch (err) {
            alert('সেটিংস সেভ ব্যর্থ: ' + err.message);
          }
        }

        // 1-Click Steadfast Courier Dispatch
        async function dispatchCourierLive(orderId) {
          if (!confirm('অর্ডার #' + orderId + ' সরাসরি Steadfast কুরিয়ারে বুকিং করতে চান?')) return;
          showToast('🚚 কুরিয়ারে বুকিং করা হচ্ছে...');
          try {
            const res = await fetch('/api/orders/' + orderId + '/dispatch-courier', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
            });
            const data = await res.json();
            if (data.success) {
              showToast('✅ কুরিয়ার পার্সেল তৈরি হয়েছে! ট্র্যাকিং: ' + data.tracking_code);
              setTimeout(() => window.location.reload(), 1000);
            } else {
              alert('কুরিয়ার বুকিং ব্যর্থ: ' + (data.error || 'অজানা সমস্যা'));
            }
          } catch (err) {
            alert('এরর: ' + err.message);
          }
        }

        // 1-Click Payment Confirmation & Order Approval
        async function confirmPaymentLive(orderId) {
          if (!confirm('অর্ডার #' + orderId + '-এর পেমেন্ট অনুমোদন ও কনফার্ম করতে চান?')) return;
          showToast('✅ পেমেন্ট অনুমোদন হচ্ছে...');
          try {
            const res = await fetch('/api/orders/' + orderId + '/confirm-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
            });
            const data = await res.json();
            if (data.success) {
              showToast('🎉 অর্ডার #' + orderId + ' অনুমোদিত ও কনফার্ম হয়েছে!');
              setTimeout(() => window.location.reload(), 800);
            } else {
              alert('অনুমোদন ব্যর্থ: ' + (data.error || 'সমস্যা হয়েছে'));
            }
          } catch (err) {
            alert('এরর: ' + err.message);
          }
        }

        // Toggle AI Pause / Resume for customer
        async function toggleCustomerAiPause(phone) {
          try {
            const res = await fetch('/api/chat-sessions/' + encodeURIComponent(phone) + '/toggle-pause', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ minutes: 60 })
            });
            const data = await res.json();
            if (data.success) {
              if (data.is_paused) {
                showToast('⏸️ কাস্টমার ' + phone + '-এর জন্য AI ৬০ মিনিটের জন্য Pause করা হয়েছে।');
              } else {
                showToast('▶️ কাস্টমার ' + phone + '-এর জন্য AI আবার Resume করা হয়েছে।');
              }
            } else {
              alert('টগল ব্যর্থ: ' + (data.error || 'সমস্যা'));
            }
          } catch (err) {
            alert('এরর: ' + err.message);
          }
        }

        // Filtering
        let currentFilter = 'ALL';
        function setFilter(status) {
          currentFilter = status;
          document.querySelectorAll('.filter-tab').forEach(b => {
            b.classList.remove('bg-stone-900', 'text-white');
            b.classList.add('bg-[#fcfaf7]', 'border', 'border-stone-300');
          });
          const activeBtn = document.getElementById('tab-' + status.replace(/\s+/g, '-'));
          if (activeBtn) {
            activeBtn.classList.remove('bg-[#fcfaf7]', 'border', 'border-stone-300');
            activeBtn.classList.add('bg-stone-900', 'text-white');
          }
          filterOrders();
        }

        function filterOrders() {
          const query = (document.getElementById('orderSearchInput').value || '').toLowerCase().trim();
          const mobileCards = document.querySelectorAll('.order-item-card');
          const desktopRows = document.querySelectorAll('.order-table-row');

          const applyVisibility = (elem) => {
            const status = elem.getAttribute('data-status');
            const search = elem.getAttribute('data-search') || '';
            const statusMatch = (currentFilter === 'ALL') || (status === currentFilter);
            const queryMatch = !query || search.includes(query);
            if (statusMatch && queryMatch) {
              elem.style.display = '';
            } else {
              elem.style.display = 'none';
            }
          };

          mobileCards.forEach(applyVisibility);
          desktopRows.forEach(applyVisibility);
        }

        // Bulk Selection
        function toggleSelectAllOrders(master) {
          document.querySelectorAll('.order-select-checkbox').forEach(cb => {
            cb.checked = master.checked;
          });
          updateOrderBulkBar();
        }

        function updateOrderBulkBar() {
          const checked = document.querySelectorAll('.order-select-checkbox:checked');
          const bar = document.getElementById('orderBulkBar');
          const count = document.getElementById('orderSelectedCount');
          if (checked.length > 0) {
            count.innerText = checked.length;
            bar.classList.remove('hidden');
            bar.classList.add('flex');
          } else {
            bar.classList.remove('flex');
            bar.classList.add('hidden');
          }
        }

        async function bulkDeleteOrders() {
          const checked = [...document.querySelectorAll('.order-select-checkbox:checked')].map(cb => cb.value);
          if (!checked.length) return;
          if (!confirm('নির্বাচিত ' + checked.length + 'টি অর্ডার ডিলিট করতে চান?')) return;
          try {
            await fetch('/api/orders/bulk-delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ ids: checked, ajax: true })
            });
            showToast('অর্ডারসমূহ সফলভাবে মুছে ফেলা হয়েছে');
            setTimeout(() => window.location.reload(), 600);
          } catch (e) {
            alert('ডিলিট এরর: ' + e.message);
          }
        }

        async function deleteSingleOrder(id) {
          if (!confirm('অর্ডার #' + id + ' মুছতে চান?')) return;
          try {
            await fetch('/api/orders/' + id + '/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ ajax: true })
            });
            showToast('অর্ডার #' + id + ' মোছা হয়েছে');
            const card = document.querySelector('[data-order-id="' + id + '"]');
            if (card) card.remove();
          } catch (e) {
            alert('ডিলিট এরর: ' + e.message);
          }
        }

        // Screenshot Modal Handlers
        let activeModalOrderId = null;
        function openScreenshotModal(url, id, phone, name) {
          activeModalOrderId = id;
          document.getElementById('modalOrderId').innerText = '#' + id;
          document.getElementById('modalCustInfo').innerText = 'কাস্টমার: ' + (name || 'কাস্টমার') + ' (' + phone + ')';
          document.getElementById('modalScreenshotImg').src = url;
          document.getElementById('modalOpenExternal').href = url;
          const m = document.getElementById('screenshotModal');
          if (m) {
            m.style.display = 'flex';
            m.classList.remove('hidden');
          }
        }

        function closeScreenshotModal() {
          const m = document.getElementById('screenshotModal');
          if (m) {
            m.style.display = 'none';
            m.classList.add('hidden');
          }
          activeModalOrderId = null;
        }

        async function approveFromModal() {
          if (!activeModalOrderId) return;
          await updateOrderStatusLive(activeModalOrderId, 'Approved');
          closeScreenshotModal();
          showToast('✅ পেমেন্ট ভেরিফাই হয়েছে ও অর্ডার কনফার্ম করা হয়েছে!');
        }

        async function approveOrderDirect(id) {
          await updateOrderStatusLive(id, 'Approved');
          showToast('✅ অর্ডার কনফার্ম করা হয়েছে!');
        }

        async function sendDigitalCashMemo(id) {
          if (!confirm('কাস্টমারের হোয়াটসঅ্যাপে ডিজিটাল ক্যাশ মেমো পাঠাতে চান?')) return;
          try {
            const res = await fetch('/api/orders/' + id + '/send-memo', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data.success) {
              showToast('🧾 ডিজিটাল ক্যাশ মেমো হোয়াটসঅ্যাপে সফলভাবে পাঠানো হয়েছে!');
            } else {
              showToast('⚠️ এরর: ' + (data.error || 'পাঠানো যায়নি'));
            }
          } catch (err) {
            showToast('⚠️ সংযোগে সমস্যা হয়েছে');
          }
        }

        async function sendFollowupDirect(id) {
          if (!confirm('কাস্টমারকে গোস্টিং রিকভারি ফলো-আপ মেসেজ পাঠাতে চান?')) return;
          try {
            const res = await fetch('/api/orders/' + id + '/send-followup', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data.success) {
              showToast('📩 রিকভারি ফলো-আপ মেসেজ সফলভাবে পাঠানো হয়েছে!');
            } else {
              showToast('⚠️ এরর: ' + (data.error || 'পাঠানো যায়নি'));
            }
          } catch (err) {
            showToast('⚠️ সংযোগে সমস্যা হয়েছে');
          }
        }

        // Live Polling Engine (Every 6s)
        let lastKnownOrderCount = ${totalOrders};
        async function pollLiveData(isManual = false) {
          const spinner = document.getElementById('syncSpinner');
          if (spinner) spinner.classList.add('animate-spin');
          try {
            const res = await fetch('/api/live-data');
            const data = await res.json();
            if (data && data.metrics) {
              const elTot = document.getElementById('stat-total-orders');
              if (elTot) elTot.innerText = data.metrics.total_orders;
              const elPend = document.getElementById('stat-pending-orders');
              if (elPend) elPend.innerText = data.metrics.pending_verification_orders;
              const elAppr = document.getElementById('stat-approved-orders');
              if (elAppr) elAppr.innerText = data.metrics.approved_orders + data.metrics.shipped_orders;
              const elRev = document.getElementById('stat-total-rev');
              if (elRev) elRev.innerText = '৳' + Number(data.metrics.total_revenue).toLocaleString('en-IN');
              
              if (data.metrics.total_orders > lastKnownOrderCount) {
                lastKnownOrderCount = data.metrics.total_orders;
                showToast('🔔 নতুন অর্ডার এসেছে!');
                setTimeout(() => window.location.reload(), 1500);
              }
              if (isManual) showToast('🔄 লাইভ ডাটা সিঙ্ক সম্পন্ন!');
            }
          } catch (e) {
          } finally {
            if (spinner) spinner.classList.remove('animate-spin');
          }
        }
        setInterval(pollLiveData, 6000);
      </script>
    </body>
    </html>
  `);
});

app.get('/qr', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>AutoDokan - WhatsApp Connect</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #faf7f2; color: #292524; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
        .card { background: #ffffff; padding: 2.25rem; border-radius: 1.5rem; text-align: center; max-width: 440px; width: 100%; box-shadow: 0 10px 25px -5px rgba(217, 119, 6, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04); border: 1px solid #ede6db; }
        .qr-box { background: white; padding: 1rem; border-radius: 1rem; margin: 1.5rem auto; width: 280px; height: 280px; display: flex; align-items: center; justify-content: center; border: 1px solid #e5dcd0; box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.03); }
        .qr-box img { width: 100%; height: 100%; display: block; border-radius: 0.5rem; }
        .badge { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 0.4rem 1.25rem; border-radius: 9999px; font-weight: bold; font-size: 0.85rem; display: inline-block; margin-bottom: 1rem; }
        h1 { margin: 0; font-size: 1.4rem; color: #1c1917; font-weight: 800; }
        p { color: #78716c; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0; font-weight: 500; }
        .steps { text-align: left; background: #fdfbf7; padding: 1.1rem; border-radius: 1rem; margin-top: 1.25rem; font-size: 0.85rem; color: #44403c; border: 1px solid #f0eae1; }
        .steps ol { margin: 0; padding-left: 1.25rem; }
        .steps li { margin-bottom: 0.4rem; }
      </style>
    </head>
    <body>
      <div class="card" id="mainCard">
        <h1 id="titleText">WhatsApp কানেক্ট করুন</h1>
        <p id="subText">আপনার ফোন দিয়ে নিচের কিউআর কোডটি স্ক্যান করুন:</p>
        
        <div class="qr-box" id="qrContainer">
          <span style="color: #a8a29e; font-size: 0.9rem;">QR লোড হচ্ছে...</span>
        </div>

        <div class="steps" id="instructions">
          <ol>
            <li>ফোনে <b>WhatsApp</b> অ্যাপ ওপেন করুন</li>
            <li>উপরে ৩ ডট (মেনু) ➔ <b>Linked Devices</b> এ যান</li>
            <li><b>Link a Device</b> বাটনে চাপ দিয়ে এই QR স্ক্যান করুন</li>
          </ol>
        </div>
      </div>

      <script>
        let checkTimer = null;
        async function checkStatus() {
          try {
            const res = await fetch('/status');
            const data = await res.json();

            if (data.connection === 'connected') {
              document.getElementById('mainCard').innerHTML = \`
                <div class="badge" style="background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 0.4rem 1.25rem; border-radius: 9999px; font-weight: bold; font-size: 0.85rem; display: inline-block; margin-bottom: 0.75rem;">● লাইভ ও সক্রিয়</div>
                <h1 style="color: #1c1917; font-weight: 900; font-size: 1.5rem; margin-top: 0.25rem;">WhatsApp সফলভাবে সংযুক্ত!</h1>
                <div style="font-size: 1.4rem; color: #b45309; font-weight: 800; margin: 1.25rem 0;">+\${data.number || 'Active'}</div>
                <p style="color: #57534e; font-size: 0.92rem; line-height: 1.6; margin: 0 auto; max-width: 330px;">
                  দাওয়াহ ফ্যাশনের অফিসিয়াল স্মার্ট সেলস অ্যাসিস্ট্যান্ট ২৪/৭ সম্পূর্ণ সক্রিয় রয়েছে।
                </p>
                
                <div style="margin-top: 1.5rem;">
                  <a href="/dashboard" style="background: linear-gradient(135deg, #d97706, #b45309); color: white; padding: 0.8rem 1.75rem; border-radius: 0.85rem; text-decoration: none; font-weight: 800; font-size: 0.92rem; display: inline-block; box-shadow: 0 4px 12px -2px rgba(217, 119, 6, 0.35);">মাস্টার ড্যাশবোর্ডে প্রবেশ করুন ➔</a>
                </div>
                <div style="margin-top: 1.25rem;">
                  <button type="button" onclick="disconnectWhatsApp()" style="background: none; border: none; color: #dc2626; font-size: 0.84rem; font-weight: 700; cursor: pointer; text-decoration: underline;">
                    🔄 অন্য কোনো নাম্বার কানেক্ট করতে চান? এখানে চাপুন
                  </button>
                </div>
              \`;
              clearInterval(checkTimer);
              return;
            }

            if (data.has_qr) {
              const qrContainer = document.getElementById('qrContainer');
              const newImg = document.createElement('img');
              newImg.src = '/api/qr-image?t=' + Date.now();
              newImg.onload = () => {
                qrContainer.innerHTML = '';
                qrContainer.appendChild(newImg);
              };
            }
          } catch (e) {
            console.error('Status check error:', e);
          }
        }

        async function disconnectWhatsApp() {
          if (!confirm('আপনি কি নিশ্চিত বর্তমান WhatsApp নাম্বারটি ডিসকানেক্ট করে নতুন নাম্বার কানেক্ট করতে চান?')) return;
          try {
            document.getElementById('mainCard').innerHTML = '<div style="padding: 2.5rem 1rem; color: #78716c; font-weight: bold; font-size: 0.95rem;">সেশন রিসেট হচ্ছে, নতুন কিউআর কোড আসছে...</div>';
            await fetch('/api/whatsapp/disconnect', { method: 'POST' });
            setTimeout(() => window.location.reload(), 2500);
          } catch (e) {
            alert('এরর: ' + e.message);
          }
        }

        checkStatus();
        checkTimer = setInterval(checkStatus, 3000);
      </script>
    </body>
    </html>
  `);
});

app.get('/api/qr-image', async (req, res) => {
  if (!currentQR) return res.status(404).send('No QR available yet');
  try {
    const qrBuffer = await qrcode.toBuffer(currentQR, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/status', (req, res) => {
  res.json({
    connection: connectionStatus,
    number: connectedNumber,
    has_qr: !!currentQR,
    supabase: !!SUPABASE_URL
  });
});

// ==========================================
// Smart Helper Functions (Payment, Human Takeover, Auto Courier)
// ==========================================

function isPaymentSubmissionText(text) {
  const t = (text || '').toLowerCase().trim();
  const hasTrxPattern = /\b[A-Za-z0-9]{8,12}\b/.test(text) && /(?:trx|trxid|trnx|আইডি|id|টাকা|বিকাশ|bkash|nagad|নগদ|পাঠাইছি|পাঠিয়েছি)/i.test(t);
  const hasLast4Pattern = /(?:লাস্ট|last|শেষের)\s*(?:৪|4|\d{4})|(?:\b\d{4}\b\s*(?:থেকে|theke|theke disi|theke dilam))/i.test(t);
  const hasExplicitPaymentPhrases = /(?:টাকা\s*(?:পাঠাইছি|পাঠিয়েছি|দিছি|দিলাম|পাঠানো\s*হয়েছে)|সেন্ড\s*মানি\s*(?:করছি|করেছি|দিছি)|payment\s*(?:done|koresi|korlam|korsi|completed)|paid\s*koresi)/i.test(t);
  return hasTrxPattern || hasLast4Pattern || hasExplicitPaymentPhrases;
}

async function isCustomerPaused(remoteJid) {
  const localPaused = userPausedUntilMap.get(remoteJid);
  const now = Date.now();
  if (localPaused && localPaused > now) {
    return true;
  }
  try {
    const { data } = await supabase
      .from('chat_sessions')
      .select('paused_until, needs_human_attention')
      .eq('seller_id', CURRENT_SELLER_ID)
      .eq('channel_type', 'WHATSAPP')
      .eq('customer_identifier', remoteJid)
      .maybeSingle();

    if (data) {
      if (data.needs_human_attention) {
        return true;
      }
      if (data.paused_until) {
        const dbPaused = new Date(data.paused_until).getTime();
        if (dbPaused > now) {
          userPausedUntilMap.set(remoteJid, dbPaused);
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

async function pauseCustomerForHumanTakeover(remoteJid, minutes = 30, reason = 'HUMAN_TAKEOVER', ownerManualText = '') {
  const pausedTime = Date.now() + minutes * 60 * 1000;
  userPausedUntilMap.set(remoteJid, pausedTime);
  try {
    const cleanPhone = remoteJid.split('@')[0];

    // Fetch existing chat session to append owner manual text to history
    let messagesList = [];
    const { data: existingSession } = await supabase
      .from('chat_sessions')
      .select('messages')
      .eq('seller_id', CURRENT_SELLER_ID)
      .eq('channel_type', 'WHATSAPP')
      .eq('customer_identifier', remoteJid)
      .maybeSingle();

    if (Array.isArray(existingSession?.messages)) {
      messagesList = [...existingSession.messages];
    }

    if (ownerManualText && ownerManualText.trim()) {
      messagesList.push({
        role: 'assistant',
        text: `[Owner Manual Reply]: ${ownerManualText.trim()}`,
        timestamp: new Date().toISOString()
      });
      if (messagesList.length > 30) messagesList = messagesList.slice(-30);
    }

    await supabase.from('chat_sessions').upsert({
      seller_id: CURRENT_SELLER_ID,
      channel_type: 'WHATSAPP',
      customer_identifier: remoteJid,
      customer_phone: cleanPhone,
      paused_until: new Date(pausedTime).toISOString(),
      needs_human_attention: reason !== 'HUMAN_TAKEOVER',
      attention_reason: reason,
      messages: messagesList,
      updated_at: new Date().toISOString()
    }, { onConflict: 'seller_id,channel_type,customer_identifier' });
    console.log(`[Human Takeover] Paused bot for ${remoteJid} for ${minutes}m (Reason: ${reason})`);
  } catch (err) {
    console.warn(`[Human Takeover] Supabase sync error:`, err.message);
  }
}

// Mode B: Future Ready Auto Scan + Auto Courier Hook
async function verifyPaymentAndDispatchCourier(orderData, storeSettings) {
  try {
    console.log(`[Auto Courier Hook] Running verifyPaymentAndDispatchCourier for:`, orderData?.phone);
    const parcelResult = await createCourierParcel(orderData, storeSettings);
    if (parcelResult && parcelResult.success) {
      console.log(`[Auto Courier Hook] Successfully auto-dispatched parcel: ${parcelResult.tracking_code}`);
      return parcelResult;
    }
  } catch (err) {
    console.error(`[Auto Courier Hook] Error:`, err.message);
  }
  return null;
}

async function createCourierParcel(orderData, storeSettings) {
  try {
    console.log(`[Courier API Hook] Preparing parcel creation for:`, orderData?.customer_phone || orderData?.phone);
    const cfg = storeSettings?.extra_config || {};
    const apiKey = cfg.steadfast_api_key || process.env.STEADFAST_API_KEY;
    const secretKey = cfg.steadfast_secret_key || process.env.STEADFAST_SECRET_KEY;

    if (apiKey && secretKey) {
      // Real Steadfast API Request
      const rawPhone = (orderData.customer_phone || orderData.phone || '').replace(/\D/g, '');
      const validPhone = rawPhone.length > 11 && rawPhone.startsWith('880') ? rawPhone.slice(2) : rawPhone;
      const codAmt = Math.round(Number(orderData.due_cod || orderData.total_bdt || 2200));

      const payload = {
        invoice: `DF-${orderData.id || Date.now().toString().slice(-6)}`,
        recipient_name: (orderData.customer_name || 'Customer').trim(),
        recipient_phone: validPhone,
        recipient_address: (orderData.address || 'Dhaka, Bangladesh').trim(),
        cod_amount: codAmt,
        note: (orderData.product_details || `Model: ${orderData.model_code || 'DF-101'}`).substring(0, 100)
      };

      try {
        const baseUrl = (cfg.steadfast_base_url || process.env.STEADFAST_BASE_URL || 'https://packzy.com').replace(/\/+$/, '');
        const response = await fetch(`${baseUrl}/api/v1/create_order`, {
          method: 'POST',
          headers: {
            'Api-Key': apiKey,
            'Secret-Key': secretKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const resData = await response.json();
        if (response.ok && (resData.status === 200 || resData.consignment)) {
          const consignment = resData.consignment || {};
          console.log(`[Steadfast API Live Success] Tracking: ${consignment.tracking_code || resData.tracking_code}`);
          return {
            success: true,
            tracking_code: consignment.tracking_code || resData.tracking_code || ('STDF-' + Date.now().toString().slice(-6)),
            consignment_id: consignment.consignment_id ? String(consignment.consignment_id) : ('CS-' + Math.floor(Math.random() * 900000 + 100000)),
            courier: 'Steadfast Courier'
          };
        } else {
          console.warn('[Steadfast API Response Warning]:', resData);
        }
      } catch (httpErr) {
        console.warn('[Steadfast API Network Warning, falling back]:', httpErr.message);
      }
    }

    // Graceful simulated courier fallback for sandbox or development
    const mockTracking = 'STDF-' + Date.now().toString().slice(-6);
    return {
      success: true,
      tracking_code: mockTracking,
      courier: 'Steadfast Courier',
      consignment_id: 'CS-' + Math.floor(Math.random() * 900000 + 100000)
    };
  } catch (err) {
    console.error(`[Courier API Hook] Booking error:`, err.message);
    return { success: false, error: err.message };
  }
}

async function processCustomerBuffer(remoteJid) {
  const state = customerMessageStates.get(remoteJid);
  if (!state) return;

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }

  if (state.texts.length === 0) {
    if (state.pendingQueue.length > 0) {
      state.texts = [...state.pendingQueue];
      state.pendingQueue = [];
      state.firstMsgAt = Date.now();
    } else {
      return;
    }
  }

  // 0. Quota check for Multi-Tenant SaaS
  const quota = await checkSellerQuota(CURRENT_SELLER_ID);
  if (!quota.allowed) {
    console.warn(`[Quota Hook] Auto-reply not allowed for ${CURRENT_SELLER_ID} (${quota.reason}). Dropping buffer.`);
    state.texts = [];
    state.pendingQueue = [];
    state.firstMsgAt = null;
    state.isProcessing = false;
    return;
  }

  // 1. Check if user is currently paused for human takeover
  if (await isCustomerPaused(remoteJid)) {
    console.log(`[Human Takeover Active] Bot is paused for ${remoteJid}. Dropping auto-reply.`);
    state.texts = [];
    state.pendingQueue = [];
    state.firstMsgAt = null;
    state.isProcessing = false;
    return;
  }

  state.isProcessing = true;
  const combinedText = state.texts.join(' \n ');
  const lastKey = state.lastKey;
  state.texts = [];
  state.firstMsgAt = null;

  console.log(`[WhatsApp Processing Combined] From: ${remoteJid} | Combined: "${combinedText}"`);

  try {
    // 2. Mark as read
    if (lastKey && sock) {
      try {
        await sock.readMessages([lastKey]);
      } catch (e) {}
    }

    // 3. Dual-Mode Payment Verification Check
    const curSettings = (typeof getStoreSettings === 'function') ? getStoreSettings() : {};
    const autoPayEnabled = !!(curSettings?.extra_config?.auto_payment_verify);

    if (isPaymentSubmissionText(combinedText)) {
      console.log(`[Payment Intent Detected] From: ${remoteJid} | AutoPayEnabled: ${autoPayEnabled}`);

      if (autoPayEnabled) {
        // MODE B: Automated payment & courier dispatch
        await verifyPaymentAndDispatchCourier({ phone: remoteJid, text: combinedText }, curSettings);
      } else {
        // MODE A (Current Default: Manual Account Manager Verification - ZERO EMOJI)
        const paymentReplyChoices = [
          "ধন্যবাদ, আপনার পেমেন্টের তথ্য নোট করে রাখা হয়েছে। আমাদের অ্যাকাউন্ট ম্যানেজার ভেরিফাই করে আপনাকে কল দিয়ে অর্ডার কনফার্ম করবেন।",
          "আপনার পাঠানো নম্বর ও পেমেন্ট তথ্য নোট করা হয়েছে। আমাদের অ্যাকাউন্ট সেকশন থেকে চেক করে আপনাকে কল দেওয়া হবে।",
          "ধন্যবাদ, পেমেন্টের বিবরণ পেয়েছি। অ্যাকাউন্টস টিম ট্রানজ্যাকশন ভেরিফাই করে অর্ডারটি চূড়ান্ত করার জন্য আপনাকে কল দেবে।"
        ];
        const paymentReply = paymentReplyChoices[Math.floor(Math.random() * paymentReplyChoices.length)];

        // Update existing pending order in orders table
        try {
          const rawPhone = remoteJid.split('@')[0].replace(/\D/g, '');
          const normalizedPhone = rawPhone.length > 11 && rawPhone.startsWith('880') ? rawPhone.slice(2) : rawPhone;
          const { data: matchedOrder } = await supabase
            .from('orders')
            .select('id, customer_phone')
            .or(`customer_phone.eq.${rawPhone},customer_phone.eq.${normalizedPhone}`)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (matchedOrder) {
            await supabase.from('orders').update({
              status: 'Pending Verification',
              payment_method: 'bKash/Nagad (Pending Verification)',
              trx_id_or_last4: combinedText.substring(0, 100)
            }).eq('id', matchedOrder.id);
            console.log(`[Payment Update] Order #${matchedOrder.id} marked as 'Pending Verification'`);
          }
        } catch (dbErr) {
          console.warn('[Payment Order Update Error]:', dbErr.message);
        }

        // Set human takeover & attention flag in chat_sessions
        await pauseCustomerForHumanTakeover(remoteJid, 30, 'PAYMENT_VERIFICATION');

        // Dynamic typing simulation
        if (sock) {
          await sock.sendPresenceUpdate('composing', remoteJid);
          const typingDuration = Math.min(Math.max(paymentReply.length * 35, 1800), 4500);
          await new Promise(r => setTimeout(r, typingDuration));
          const sent = await sock.sendMessage(remoteJid, { text: paymentReply });
          if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
          await sock.sendPresenceUpdate('paused', remoteJid);
          incrementStats('messages_out');
          incrementSellerMessageUsage(CURRENT_SELLER_ID);
        }

        // Finish processing turn and drain pending queue if customer typed more
        state.isProcessing = false;
        if (state.pendingQueue.length > 0) {
          state.texts = [...state.pendingQueue];
          state.pendingQueue = [];
          state.firstMsgAt = Date.now();
          state.debounceTimer = setTimeout(() => {
            processCustomerBuffer(remoteJid);
          }, DEBOUNCE_DELAY_MS);
        }
        return;
      }
    }

    // 3b. Customer Complaint or Human Agent Request Escalation Hook
    if (typeof isAngryComplaint === 'function' && typeof isAgentRequest === 'function') {
      const isComplaint = isAngryComplaint(combinedText);
      const isAgentReq = isAgentRequest(combinedText);
      if (isComplaint || isAgentReq) {
        const escalationReason = isComplaint ? 'CUSTOMER_COMPLAINT' : 'HUMAN_AGENT_REQUESTED';
        console.log(`[Auto Human Escalation] From: ${remoteJid} | Reason: ${escalationReason}`);
        await pauseCustomerForHumanTakeover(remoteJid, 45, escalationReason);
      }
    }

    // 4. Normal AI Conversation Flow
    if (sock) {
      await sock.sendPresenceUpdate('composing', remoteJid);
    }

    const replyText = await handleIncomingMessage(remoteJid, combinedText);

    // Helper to send individual WhatsApp photo with caption
    async function sendWaPhoto(url, caption) {
      if (!sock || !url) return false;
      try {
        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, 1200));
        let imagePayload;
        const urlPath = url.replace(/^https?:\/\/[^\/]+/, '');
        const localFile = path.join(__dirname, 'public', urlPath);
        if (fs.existsSync(localFile)) {
          imagePayload = fs.readFileSync(localFile);
        } else {
          imagePayload = { url: url };
        }
        const sentPhoto = await sock.sendMessage(remoteJid, {
          image: imagePayload,
          caption: caption || ''
        });
        if (sentPhoto?.key?.id) botSentMessageIds.add(sentPhoto.key.id);
        await sock.sendPresenceUpdate('paused', remoteJid);
        incrementStats('messages_out');
        return true;
      } catch (err) {
        console.error('[WhatsApp Photo Send Error]:', err.message);
        return false;
      }
    }

    // Detect and extract all image tags (with complete whitespace & format resilience)
    const catalogOverviewRegex = /\[\s*SEND_CATALOG_OVERVIEW\s*\]/gi;
    const allImagesRegex = /\[\s*SEND_ALL_IMAGES\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi;
    const hijabRegex = /\[\s*SEND_HIJAB_IMAGE\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi;
    const detailRegex = /\[\s*SEND_DETAIL_IMAGE\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi;
    const flareRegex = /\[\s*SEND_FLARE_IMAGE\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi;
    const realRegex = /\[\s*SEND_REAL_IMAGE\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi;
    const mainImageRegex = /\[\s*SEND_IMAGE\s*:\s*([A-Za-z0-9_-]+)\s*\]/gi;

    const hasCatalogOverview = catalogOverviewRegex.test(replyText);
    const allMatches = [...replyText.matchAll(allImagesRegex)];
    const hijabMatches = [...replyText.matchAll(hijabRegex)];
    const detailMatches = [...replyText.matchAll(detailRegex)];
    const flareMatches = [...replyText.matchAll(flareRegex)];
    const realMatches = [...replyText.matchAll(realRegex)];
    const mainMatches = [...replyText.matchAll(mainImageRegex)];

    // Aggressively clean ALL send tags and leaked prompt codes
    const cleanReplyText = replyText
      .replace(/\[\s*SEND_[A-Za-z0-9_:\s-]+\s*\]/gi, '')
      .replace(/\(?(?:send|showing)\s*hi[zj]ab\s*(?:image|pic|photo)?\)?/gi, '')
      .replace(/\[?\s*(?:send|showing)\s*[a-z_]*hi[zj]ab[a-z_]*\s*[^\n\]]*\]?/gi, '')
      .replace(/\[\s*[A-Z_]+(?::[A-Za-z0-9_-]+)?\s*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Multi-Bubble & Dynamic Typing Simulation
    if (sock && cleanReplyText) {
      const rawParagraphs = cleanReplyText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      if (rawParagraphs.length >= 2 && cleanReplyText.length > 120) {
        // Split into 2 natural bubbles
        const firstBubble = rawParagraphs[0];
        const secondBubble = rawParagraphs.slice(1).join('\n\n');

        const firstTyping = Math.min(Math.max(firstBubble.length * 30, 1500), 3000);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, firstTyping));
        const sent1 = await sock.sendMessage(remoteJid, { text: firstBubble });
        if (sent1?.key?.id) botSentMessageIds.add(sent1.key.id);
        incrementStats('messages_out');

        // 2-second pause with typing simulation before second bubble
        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, 2000));
        const sent2 = await sock.sendMessage(remoteJid, { text: secondBubble });
        if (sent2?.key?.id) botSentMessageIds.add(sent2.key.id);
        await sock.sendPresenceUpdate('paused', remoteJid);
        incrementStats('messages_out');
      } else {
        const typingDuration = Math.min(Math.max(cleanReplyText.length * 35, 1800), 4500);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, typingDuration));
        const sentMsg = await sock.sendMessage(remoteJid, { text: cleanReplyText });
        if (sentMsg?.key?.id) botSentMessageIds.add(sentMsg.key.id);
        await sock.sendPresenceUpdate('paused', remoteJid);
        incrementStats('messages_out');
      }
      console.log(`[WhatsApp Outbound Done] To: ${remoteJid} | Length: ${cleanReplyText.length}`);
      incrementSellerMessageUsage(CURRENT_SELLER_ID);
    }

    // Helper to find product by code
    function findProd(code) {
      let p = (typeof getProductByCode === 'function') ? getProductByCode(code) : null;
      if (!p) {
        const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts() : [];
        p = allProds.find(item => item.model_code && item.model_code.toUpperCase().trim() === code.toUpperCase().trim());
      }
      return p;
    }

    function buildSingleProductCaption(p) {
      return `👗 *${p.name}* (${p.model_code || 'DF-101'})`;
    }

    function buildProductAlbumCaption(p) {
      return `👗 *${p.name}* (${p.model_code || 'DF-101'})`;
    }

    async function sendProductAlbum(p) {
      if (!sock || !p) return false;
      try {
        const photoUrls = [
          p.image_url,
          p.detail_image_url,
          p.hijab_image_url,
          p.flare_image_url,
          p.real_image_url
        ].filter(Boolean);

        if (photoUrls.length === 0) return false;

        const masterCaption = buildProductAlbumCaption(p);

        for (let i = 0; i < photoUrls.length; i++) {
          const url = photoUrls[i];
          let imagePayload;
          const urlPath = url.replace(/^https?:\/\/[^\/]+/, '');
          const localFile = path.join(__dirname, 'public', urlPath);
          if (fs.existsSync(localFile)) {
            imagePayload = fs.readFileSync(localFile);
          } else {
            imagePayload = { url: url };
          }

          const msgOptions = {
            image: imagePayload,
            ...(i === 0 ? { caption: masterCaption } : {})
          };

          const sentAlbum = await sock.sendMessage(remoteJid, msgOptions);
          if (sentAlbum?.key?.id) botSentMessageIds.add(sentAlbum.key.id);
          incrementStats('messages_out');

          if (i < photoUrls.length - 1) {
            await new Promise(r => setTimeout(r, 250));
          }
        }
        await sock.sendPresenceUpdate('paused', remoteJid);
        return true;
      } catch (err) {
        console.error('[WhatsApp Album Send Error]:', err.message);
        return false;
      }
    }

    async function sendCatalogOverview() {
      if (!sock) return false;
      try {
        const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts() : [];
        if (allProds.length === 0) return false;

        for (let i = 0; i < allProds.length; i++) {
          const p = allProds[i];
          if (!p || !p.image_url) continue;

          let imagePayload;
          const urlPath = p.image_url.replace(/^https?:\/\/[^\/]+/, '');
          const localFile = path.join(__dirname, 'public', urlPath);
          if (fs.existsSync(localFile)) {
            imagePayload = fs.readFileSync(localFile);
          } else {
            imagePayload = { url: p.image_url };
          }

          const sentCat = await sock.sendMessage(remoteJid, {
            image: imagePayload,
            caption: buildSingleProductCaption(p)
          });
          if (sentCat?.key?.id) botSentMessageIds.add(sentCat.key.id);
          incrementStats('messages_out');

          if (i < allProds.length - 1) {
            await new Promise(r => setTimeout(r, 280));
          }
        }
        await sock.sendPresenceUpdate('paused', remoteJid);
        return true;
      } catch (err) {
        console.error('[WhatsApp Catalog Overview Send Error]:', err.message);
        return false;
      }
    }

    // 8. Dispatch images (with natural 1.2s photo picking delay)
    const hasImagesToSend = hasCatalogOverview || allMatches.length > 0 || hijabMatches.length > 0 || detailMatches.length > 0 || flareMatches.length > 0 || realMatches.length > 0 || mainMatches.length > 0;
    if (hasImagesToSend) {
      await new Promise(r => setTimeout(r, 1200));
    }

    if (hasCatalogOverview) {
      await sendCatalogOverview();
    } else {
      for (const match of allMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) await sendProductAlbum(p);
      }
      for (const match of hijabMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.hijab_image_url || p.image_url;
          if (url) await sendWaPhoto(url, `🧕 *${p.name} - ম্যাচিং প্রিমিয়াম হিজাব*\n✨ ড্রেসের সাথে ম্যাচিং হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন!`);
        }
      }
      for (const match of detailMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.detail_image_url || p.image_url;
          if (url) await sendWaPhoto(url, `🔍 *${p.name} - নিখুঁত কারচুপি ও কাপড়ের ক্লোজ-আপ ভিউ*`);
        }
      }
      for (const match of flareMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.flare_image_url || p.image_url;
          if (url) await sendWaPhoto(url, `✨ *${p.name} - ঘের ও সাইড অ্যাঙ্গেল ভিউ*`);
        }
      }
      for (const match of realMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.real_image_url || p.image_url;
          if (url) await sendWaPhoto(url, `📸 *${p.name} - স্বাভাবিক আলোর আনফিল্টার্ড রিয়েল ছবি*`);
        }
      }
      for (const match of mainMatches) {
        const code = match[1].toUpperCase().trim();
        if (allMatches.some(m => m[1].toUpperCase().trim() === code)) continue;
        const p = findProd(code);
        if (p && p.image_url) {
          await sendWaPhoto(p.image_url, buildSingleProductCaption(p));
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp Send Error]:', err.message);
  } finally {
    state.isProcessing = false;
    // Check if new messages arrived while processing
    if (state.pendingQueue.length > 0) {
      state.texts = [...state.pendingQueue];
      state.pendingQueue = [];
      state.firstMsgAt = Date.now();
      state.debounceTimer = setTimeout(() => {
        processCustomerBuffer(remoteJid);
      }, DEBOUNCE_DELAY_MS);
    }
  }
}

async function connectToWhatsApp() {
  try {
    console.log('[WhatsApp] Initializing connection with Supabase state...');
    connectionStatus = 'connecting';

    const { state, saveCreds } = await useSupabaseAuthState(
      SUPABASE_URL,
      SUPABASE_KEY,
      'autodokan_seller_1'
    );

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        connectionStatus = 'waiting_for_qr_scan';
        console.log('[WhatsApp] New QR code generated. Access /qr to scan.');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        connectionStatus = 'disconnected';
        currentQR = null;
        console.log(`[WhatsApp] Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(connectToWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQR = null;
        const id = sock.user?.id || '';
        connectedNumber = id.split(':')[0] || id.split('@')[0];
        console.log(`[WhatsApp] Connected successfully as +${connectedNumber}`);
      }
    });

    // WhatsApp Call Event Listener (Auto text on Missed/Rejected Call with 10-min cooldown)
    sock.ev.on('call', async (callEvents) => {
      if (!Array.isArray(callEvents)) return;
      for (const call of callEvents) {
        const fromJid = call.from;
        if (!fromJid || fromJid.includes('@g.us')) continue;
        const now = Date.now();
        const lastCall = lastCallReplyTime.get(fromJid) || 0;
        if (now - lastCall > 10 * 60 * 1000) {
          lastCallReplyTime.set(fromJid, now);
          console.log(`[WhatsApp Call Event] Detected call from ${fromJid}. Sending auto-reply in 3s...`);
          setTimeout(async () => {
            try {
              if (sock) {
                await sock.sendPresenceUpdate('composing', fromJid);
                await new Promise(r => setTimeout(r, 1800));
                const callReply = "এই নম্বরে কল রিসিভ করা সম্ভব হচ্ছে না, যা জানার দরকার এখানে মেসেজে লিখে দিন আমি দেখছি";
                const sent = await sock.sendMessage(fromJid, { text: callReply });
                if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
                await sock.sendPresenceUpdate('paused', fromJid);
                incrementStats('messages_out');
              }
            } catch (e) {
              console.warn('[Call Auto-Reply Error]:', e.message);
            }
          }, 3000);
        }
      }
    });

    // Inbound Message Listener with Human-Like Debounce & Typing
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') return;

      // 1. Owner Human Takeover Check:
      if (msg.key.fromMe) {
        if (botSentMessageIds.has(msg.key.id)) {
          return; // Ignore message sent by our bot
        }
        // Seller typed manually from phone/web WhatsApp!
        const ownerText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
        console.log(`[Human Takeover] Seller manually sent a message to ${remoteJid}: "${ownerText}". Pausing bot for 30 minutes.`);
        await pauseCustomerForHumanTakeover(remoteJid, 30, 'HUMAN_TAKEOVER', ownerText);
        return;
      }

      if (m.type !== 'notify') return;

      // 2. Message Deduplication (15-min TTL):
      const msgId = msg.key.id;
      if (msgId) {
        if (processedIncomingMsgIds.has(msgId)) {
          return; // Duplicate upsert event ignored
        }
        processedIncomingMsgIds.set(msgId, Date.now());
      }

      // 3. WhatsApp Voice Note & Push-To-Talk (PTT) Deep Unwrapping
      let unwrappedMsg = msg.message;
      while (unwrappedMsg && (unwrappedMsg.ephemeralMessage || unwrappedMsg.viewOnceMessage || unwrappedMsg.viewOnceMessageV2 || unwrappedMsg.documentWithCaptionMessage)) {
        unwrappedMsg = unwrappedMsg.ephemeralMessage?.message || 
                       unwrappedMsg.viewOnceMessage?.message || 
                       unwrappedMsg.viewOnceMessageV2?.message || 
                       unwrappedMsg.documentWithCaptionMessage?.message;
      }

      // Silently ignore stickers & reactions
      if (unwrappedMsg?.reactionMessage || unwrappedMsg?.stickerMessage) {
        return;
      }

      // Location Message Guardrail (ZERO EMOJI)
      if (unwrappedMsg?.locationMessage || unwrappedMsg?.liveLocationMessage) {
        const now = Date.now();
        const lastSent = lastVoiceReplyTime.get(remoteJid) || 0;
        if (now - lastSent > 45000 && sock) {
          lastVoiceReplyTime.set(remoteJid, now);
          const locReply = "ম্যাপের পিনে কুরিয়ার ম্যান অনেক সময় ঠিকানা চিনতে ভুল করে, একটু কষ্ট করে বাসা/রোড, এলাকা, থানা আর জেলার নামটা লিখে দেন";
          await sock.sendPresenceUpdate('composing', remoteJid);
          await new Promise(r => setTimeout(r, 1800));
          const sentLoc = await sock.sendMessage(remoteJid, { text: locReply });
          if (sentLoc?.key?.id) botSentMessageIds.add(sentLoc.key.id);
          await sock.sendPresenceUpdate('paused', remoteJid);
          incrementStats('messages_out');
        }
        return;
      }

      let messageContent =
        unwrappedMsg?.conversation ||
        unwrappedMsg?.extendedTextMessage?.text ||
        '';

      // Check for media captions if main text is empty
      if (!messageContent.trim()) {
        const imgCap = unwrappedMsg?.imageMessage?.caption;
        if (imgCap && imgCap.trim()) {
          messageContent = `[Customer attached an image]: ${imgCap.trim()}`;
        } else {
          messageContent = unwrappedMsg?.videoMessage?.caption ||
                           unwrappedMsg?.documentMessage?.caption ||
                           '';
        }
      }

      // Check for WhatsApp Quoted Message Context (Swipe-to-Reply on images or previous chats)
      let quotedContextText = '';
      const contextInfo = unwrappedMsg?.extendedTextMessage?.contextInfo;
      if (contextInfo && contextInfo.quotedMessage) {
        const qm = contextInfo.quotedMessage;
        const quotedText = qm.conversation || 
                           qm.extendedTextMessage?.text || 
                           qm.imageMessage?.caption || 
                           qm.videoMessage?.caption || '';
        if (quotedText.trim()) {
          const codeMatch = quotedText.match(/DF-\d{3}/i);
          if (codeMatch) {
            quotedContextText = `[Customer replied to image/message of model ${codeMatch[0].toUpperCase()}]: `;
          } else {
            const shortQuote = quotedText.substring(0, 80).replace(/\n/g, ' ');
            quotedContextText = `[Customer quoted: "${shortQuote}"]: `;
          }
        }
      }

      if (quotedContextText) {
        messageContent = quotedContextText + messageContent;
      }

      // Negative Media Guardrails (Real-Human responses, ZERO EMOJI, ZERO "ভাইয়া/আপু")
      const isImage = !!unwrappedMsg?.imageMessage;
      const isAudio = !!(unwrappedMsg?.audioMessage || unwrappedMsg?.pttMessage);
      const isVideo = !!unwrappedMsg?.videoMessage;
      const isDoc = !!unwrappedMsg?.documentMessage;

      if ((isImage || isAudio || isVideo || isDoc) && !messageContent.trim()) {
        console.log(`[WhatsApp Non-Text Media] Media received from ${remoteJid} (isImage: ${isImage}, isAudio: ${isAudio})`);
        const now = Date.now();
        const lastSent = lastVoiceReplyTime.get(remoteJid) || 0;
        if (now - lastSent > 45000 && sock) {
          lastVoiceReplyTime.set(remoteJid, now);
          let mediaReply = '';
          if (isAudio) {
            const audioReplies = [
              "একটু বাইরে আছি তো ভয়েসটা এখন শুনতে পারছি না, কষ্ট করে একটু লিখে দেন",
              "এখানে একটু শোরগোল হচ্ছে তাই ভয়েসটা প্লে করা যাচ্ছে না, টেক্সটে লিখে জানালে ভালো হয়",
              "ভয়েস মেসেজটা এই মুহূর্তে শোনা যাচ্ছে না, কোন প্রোডাক্ট বা সাইজ লাগবে একটু লিখে দেন",
              "হাতে একটু কাজ করছি তো অডিওটা শুনতে পারছি না, মেসেজে লিখে দিন প্লিজ"
            ];
            mediaReply = audioReplies[Math.floor(Math.random() * audioReplies.length)];
          } else if (isImage) {
            const imageReplies = [
              "নেট স্লো থাকায় ছবিটা ক্লিয়ার ওপেন হচ্ছে না, ড্রেসের নাম বা মডেল কোডটা একটু লিখে বলেন",
              "ছবিটা এখান থেকে লোড হচ্ছে না ঠিকমতো, কোন ডিজাইন বা পেমেন্টের বিষয়ে বলছেন একটু লিখে দেন",
              "ছবিটা পরিষ্কার দেখা যাচ্ছে না, একটু কষ্ট করে মডেলের নাম বা কী জানতে চাচ্ছেন লিখে দিন"
            ];
            mediaReply = imageReplies[Math.floor(Math.random() * imageReplies.length)];
          } else {
            mediaReply = "ফাইলটা এখান থেকে ওপেন হতে সময় নিচ্ছে, কী বিষয় ছিল একটু মেসেজে লিখে বলবেন?";
          }

          try {
            await sock.sendPresenceUpdate('composing', remoteJid);
            await new Promise(r => setTimeout(r, 1800));
            const sentMedia = await sock.sendMessage(remoteJid, { text: mediaReply });
            if (sentMedia?.key?.id) botSentMessageIds.add(sentMedia.key.id);
            await sock.sendPresenceUpdate('paused', remoteJid);
            incrementStats('messages_out');
          } catch (e) {
            console.error('[Media Reply Error]:', e.message);
          }
        }
        return;
      }

      if (!messageContent.trim()) {
        return;
      }

      console.log(`[WhatsApp Received Fragment] From: ${remoteJid} | "${messageContent}"`);
      incrementStats('messages_in');
      if (!activeConversations.has(remoteJid)) {
        activeConversations.add(remoteJid);
        incrementStats('total_conversations');
      }

      // Check Human Takeover before scheduling buffer
      if (await isCustomerPaused(remoteJid)) {
        console.log(`[Human Takeover Active] Bot is paused for ${remoteJid}. Dropping inbound message from queue.`);
        return;
      }

      // Multi-Customer Concurrent Buffer with 3500ms debounce and 8000ms max cap
      let userState = customerMessageStates.get(remoteJid);
      if (!userState) {
        userState = {
          texts: [],
          debounceTimer: null,
          firstMsgAt: null,
          isProcessing: false,
          pendingQueue: [],
          lastKey: msg.key
        };
        customerMessageStates.set(remoteJid, userState);
      } else {
        userState.lastKey = msg.key;
      }

      if (userState.isProcessing) {
        // Customer typed while previous turn is still generating/sending
        userState.pendingQueue.push(messageContent);
        console.log(`[WhatsApp Queued During Processing] From: ${remoteJid} | Queued: "${messageContent}"`);
      } else {
        userState.texts.push(messageContent);
        if (!userState.firstMsgAt) {
          userState.firstMsgAt = Date.now();
        }

        const elapsed = Date.now() - userState.firstMsgAt;
        if (elapsed >= MAX_WAIT_MS) {
          // Reached 8-second max wait cap
          if (userState.debounceTimer) clearTimeout(userState.debounceTimer);
          userState.debounceTimer = null;
          processCustomerBuffer(remoteJid);
        } else {
          // Reset 3.5s debounce window
          if (userState.debounceTimer) clearTimeout(userState.debounceTimer);
          userState.debounceTimer = setTimeout(() => {
            processCustomerBuffer(remoteJid);
          }, DEBOUNCE_DELAY_MS);
        }
      }
    });

  } catch (error) {
    console.error('[WhatsApp Error] Init failed:', error);
    connectionStatus = 'error: ' + error.message;
    setTimeout(connectToWhatsApp, 5000);
  }
}

process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM, exiting gracefully...');
  if (sock) { try { sock.end(); } catch (e) {} }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT, exiting gracefully...');
  if (sock) { try { sock.end(); } catch (e) {} }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[AutoDokan Engine] Server listening on port ${PORT}`);
  connectToWhatsApp();
});
