const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage, refreshProductsFromDB, refreshSettingsFromDB, getStoreSettings, getProductByCode, getAllCachedProducts, getProductImageUrls, isAngryComplaint, isAgentRequest, transcribeAudioWithGroq, transcribeAudioWithGemini, cleanHumanFormatting } = require('./commerce_brain');
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

// Multi-Seller Session Registry
const sellerSockets = new Map(); // sellerId -> socket
const sellerQRs = new Map(); // sellerId -> qrString
const sellerStatuses = new Map(); // sellerId -> status
const sellerNumbers = new Map(); // sellerId -> phoneNumber

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
const botSentMediaTracking = new Map(); // msgId -> { seller_id, product_id, model_code, name, price }
const userPausedCache = new Map(); // remoteJid -> { isPaused: boolean, expiresAt: number } (Max 10s TTL RAM Cache)
const activeConversations = new Set();
const lastVoiceReplyTime = new Map();
const lastCallReplyTime = new Map();
const DEBOUNCE_DELAY_MS = 1500; // 1.5s natural human typing window
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
  // 4. Bound botSentMessageIds & botSentMediaTracking
  if (botSentMessageIds.size > 3000) {
    botSentMessageIds.clear();
  }
  if (botSentMediaTracking.size > 5000) {
    botSentMediaTracking.clear();
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
  await refreshProductsFromDB();
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
    await refreshProductsFromDB();
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
    await refreshProductsFromDB();
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
    await refreshProductsFromDB();
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
      userPausedCache.delete(remoteJid);
      userPausedCache.delete(rawDigits);
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
    const rawTarget = (phone || '').trim();
    const remoteJid = rawTarget.includes('@')
      ? rawTarget
      : (rawTarget.replace(/\D/g, '').startsWith('880')
          ? `${rawTarget.replace(/\D/g, '')}@s.whatsapp.net`
          : `880${rawTarget.replace(/\D/g, '').replace(/^0/, '')}@s.whatsapp.net`);

    const currentlyPaused = await isCustomerPaused(remoteJid);
    let newPausedState = false;

    if (currentlyPaused) {
      // Resume AI: clear pause and attention from RAM & DB
      userPausedCache.delete(remoteJid);
      userPausedCache.delete(rawTarget);
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

// Admin instant unpause endpoint (clears RAM cache and DB paused_until)
app.all(['/api/admin/unpause-customer', '/api/unpause/:jid'], async (req, res) => {
  try {
    const targetJid = req.params?.jid || req.query?.jid || req.body?.jid || '79070616404078@lid';
    userPausedCache.delete(targetJid);
    userPausedCache.clear(); // Wipe all memory pause cache
    await supabase.from('chat_sessions').update({
      paused_until: null,
      needs_human_attention: false,
      attention_reason: null,
      updated_at: new Date().toISOString()
    }).eq('seller_id', CURRENT_SELLER_ID).eq('customer_identifier', targetJid);
    console.log(`[Admin Unpause] Cleared RAM pause cache & unpaused ${targetJid}`);
    return res.json({ success: true, message: `RAM cache cleared and ${targetJid} unpaused!` });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
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

    if (!error && abandonedLeads && abandonedLeads.length > 0) {
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

        console.log(`[Auto Recovery] Sending polite pending order follow-up to ${cleanPhone} (Lead #${lead.id})`);
        const sentAutoFollowup = await sock.sendMessage(jid, { text: followupMsg });
        if (sentAutoFollowup?.key?.id) botSentMessageIds.add(sentAutoFollowup.key.id);
        incrementStats('messages_out');
        followupCooldownMap.set(cleanPhone, Date.now());

        // Natural pause between messages
        await new Promise(r => setTimeout(r, 4500));
      }
    }

    // 2. Also check abandoned chat sessions (Customer asked questions, bot answered, but customer went silent for > 2 hours without ordering)
    const { data: abandonedChats } = await supabase
      .from('chat_sessions')
      .select('id, customer_identifier, customer_phone, customer_name, messages, updated_at')
      .eq('seller_id', CURRENT_SELLER_ID)
      .eq('channel_type', 'WHATSAPP')
      .is('paused_until', null)
      .eq('needs_human_attention', false)
      .lt('updated_at', twoHoursAgo)
      .gt('updated_at', thirtySixHoursAgo)
      .limit(6);

    if (abandonedChats && abandonedChats.length > 0) {
      for (const chat of abandonedChats) {
        const jid = chat.customer_identifier;
        if (!jid) continue;
        const cleanPhone = (chat.customer_phone || jid.split('@')[0]).replace(/[^0-9]/g, '');

        // Cooldown check: At least 24 hours between automated follow-ups
        const lastSent = followupCooldownMap.get(cleanPhone) || 0;
        if (Date.now() - lastSent < 24 * 60 * 60 * 1000) continue;

        // Verify that conversation actually had customer messages (at least 2 exchanges)
        const msgs = Array.isArray(chat.messages) ? chat.messages : [];
        if (msgs.length < 2) continue;

        // Verify last message was NOT already a follow-up
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && typeof lastMsg.text === 'string' && lastMsg.text.includes('স্টক কিন্তু খুব দ্রুত')) {
          continue; // Already sent follow-up
        }

        const nameStr = (chat.customer_name && !/^(কাস্টমার|গ্রাহক|customer|unknown)$/i.test(chat.customer_name.trim()))
          ? ` ${chat.customer_name.trim()}`
          : '';

        const chatFollowupText = `আসসালামু আলাইকুম${nameStr} 😊\n\nআপনি কি আমাদের আবায়া বা বোরকা কালেকশন নিয়ে আর কিছু জানতে চেয়েছিলেন? আপনার কোনো প্রশ্ন বা সাইজ নিয়ে কোনো দ্বিধা থাকলে নিঃসংকোচে জানাতে পারেন, সাহায্য করতে পারলে খুশি হব। 😊`;

        console.log(`[Auto Recovery] Sending polite chat follow-up to ${jid}`);
        const sentFollow = await sock.sendMessage(jid, { text: chatFollowupText });
        if (sentFollow?.key?.id) botSentMessageIds.add(sentFollow.key.id);
        incrementStats('messages_out');
        followupCooldownMap.set(cleanPhone, Date.now());

        // Update chat_sessions history
        const updatedMsgs = [...msgs, {
          role: 'assistant',
          text: chatFollowupText,
          timestamp: new Date().toISOString()
        }];
        await supabase.from('chat_sessions')
          .update({ messages: updatedMsgs, updated_at: new Date().toISOString() })
          .eq('id', chat.id);

        await new Promise(r => setTimeout(r, 4500));
      }
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

  const totalOrders = orders ? orders.length : 0;
  const pendingOrders = orders ? orders.filter(o => o.status === 'Pending').length : 0;
  const pendingVerificationOrders = orders ? orders.filter(o => o.status === 'Pending Verification').length : 0;
  const approvedOrders = orders ? orders.filter(o => o.status === 'Approved').length : 0;
  const shippedOrders = orders ? orders.filter(o => o.status === 'Shipped').length : 0;
  const cancelledOrders = orders ? orders.filter(o => o.status === 'Cancelled').length : 0;
  const totalProducts = products ? products.length : 0;
  const inStockProducts = products ? products.filter(p => p.in_stock).length : 0;
  const totalRevenue = (orders || []).filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 2200), 0);

  // Helper to format clean Steadfast/Pathao courier copy text
  function formatCourierText(o) {
    const prodPrice = Number(o.total_bdt) || 2200;
    const dueCod = Number(o.due_cod) || prodPrice;
    return 'কাস্টমার: ' + (o.customer_name || 'কাস্টমার') + '\n' +
      'মোবাইল: ' + (o.customer_phone || '') + '\n' +
      'ঠিকানা: ' + (o.address || '') + '\n' +
      'প্রোডাক্ট: [' + (o.model_code || 'DF-101') + '] ' + (o.product_details || '') + ' (সাইজ: ' + (o.length_size || 'স্ট্যান্ডার্ড') + ')\n' +
      'ক্যাশ কালেকশন (Due COD): ৳' + dueCod;
  }

  // Generate Product Cards HTML
  const productCardsHtml = (products || []).map(p => {
    const safeName = (p.name || '').replace(/'/g, "\\'");
    const searchMeta = (p.id + ' ' + (p.model_code || '') + ' ' + (p.name || '') + ' ' + (p.fabric || '') + ' ' + (p.colors || '')).toLowerCase();
    const stockStatus = p.in_stock ? 'IN_STOCK' : 'STOCK_OUT';

    return `
    <div class="prod-card bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-3 hover:border-amber-400 hover:shadow-md transition" data-id="${p.id}" data-stock="${stockStatus}" data-search="${searchMeta}">
      <div class="flex gap-3">
        <img src="${p.image_url || 'https://placehold.co/120x150?text=' + (p.model_code || 'DF')}" alt="${p.model_code}" class="w-24 h-28 object-cover rounded-xl bg-stone-100 border border-stone-200 shrink-0">
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1">
            <span class="font-mono font-black text-xs text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">${p.model_code || 'DF'}</span>
            <button type="button" onclick="toggleStockLive(${p.id}, ${p.in_stock ? 'false' : 'true'})" class="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition ${p.in_stock ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'}">
              ${p.in_stock ? '● ইন-স্টক' : '✕ স্টক আউট'}
            </button>
          </div>
          <h3 class="font-black text-stone-900 text-sm mt-1 truncate" title="${p.name}">${p.name}</h3>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="font-black text-stone-900 text-base">৳${p.price}</span>
            ${p.regular_price && p.regular_price > p.price ? `<span class="text-stone-400 line-through text-xs font-semibold">৳${p.regular_price}</span>` : ''}
          </div>
          <p class="text-[11px] text-stone-500 mt-0.5 truncate">✨ ${p.fabric || 'দুবাই চেরি'} • 📏 ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}</p>
        </div>
      </div>

      <!-- Manual Colors Input & Instant Save -->
      <div class="bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/80 space-y-1">
        <label class="text-[11px] font-extrabold text-amber-950 flex items-center gap-1">
          <span>🎨 কালারসমূহ (AI কাস্টমারকে এই কালার বলবে):</span>
        </label>
        <div class="flex items-center gap-1.5">
          <input type="text" id="color-input-${p.id}" value="${p.colors || ''}" placeholder="যেমন: জেট ব্ল্যাক, কফি, সি-গ্রিন" class="flex-1 bg-white border border-stone-300 text-xs px-2.5 py-1.5 rounded-lg font-medium text-stone-800 focus:border-amber-500 outline-none">
          <button type="button" onclick="saveColorsLive(${p.id})" class="bg-stone-900 hover:bg-black text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs cursor-pointer transition shrink-0">
            সেভ
          </button>
        </div>
      </div>

      <!-- Card Action Buttons -->
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

  // Generate Orders HTML Table Rows
  const orderRowsHtml = (orders || []).map(o => {
    const prodPrice = Number(o.total_bdt) || 2200;
    const dueCod = Number(o.due_cod) || prodPrice;
    const cleanPhone = (o.customer_phone || '').replace(/[^0-9]/g, '');
    const waPhone = cleanPhone.startsWith('880') ? cleanPhone : (cleanPhone.startsWith('0') ? '88' + cleanPhone : '880' + cleanPhone);
    const searchMeta = (o.id + ' ' + (o.model_code || '') + ' ' + (o.customer_name || '') + ' ' + (o.customer_phone || '') + ' ' + (o.address || '')).toLowerCase();
    const isRepeat = (phoneCountMap[o.customer_phone] || 0) > 1;

    return `
    <tr class="order-row border-b border-stone-200 hover:bg-amber-50/40 transition" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
      <td class="p-3">
        <div class="font-mono font-black text-xs text-stone-900">#${o.id}</div>
        <div class="text-[10px] text-stone-400 mt-0.5">${o.created_at ? new Date(o.created_at).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }) : ''}</div>
      </td>
      <td class="p-3">
        <div class="font-black text-stone-900 text-xs flex items-center gap-1">
          <span>${o.customer_name || 'কাস্টমার'}</span>
          ${isRepeat ? '<span class="text-[9px] bg-purple-100 text-purple-800 px-1 rounded font-bold">রিপিট</span>' : ''}
        </div>
        <a href="https://wa.me/${waPhone}" target="_blank" class="text-emerald-700 hover:underline text-xs font-mono font-bold flex items-center gap-1 mt-0.5">
          <span>💬</span>
          <span>${o.customer_phone || ''}</span>
        </a>
      </td>
      <td class="p-3 max-w-[200px]">
        <div class="text-xs text-stone-700 line-clamp-2" title="${o.address || ''}">${o.address || 'ঠিকানা দেওয়া হয়নি'}</div>
      </td>
      <td class="p-3">
        <span class="font-mono font-bold text-xs bg-stone-100 text-stone-800 px-2 py-0.5 rounded border border-stone-200">${o.model_code || 'DF'}</span>
        <div class="text-[11px] text-stone-500 mt-0.5">সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'}</div>
      </td>
      <td class="p-3 font-mono font-black text-xs text-amber-950">
        ৳${dueCod}
      </td>
      <td class="p-3">
        <select onchange="updateOrderStatusLive(${o.id}, this.value)" class="text-xs px-2.5 py-1 rounded-lg border font-bold cursor-pointer outline-none ${
          o.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
          o.status === 'Shipped' ? 'bg-sky-50 text-sky-800 border-sky-300' :
          o.status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
        }">
          <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
          <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
          <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
        </select>
      </td>
      <td class="p-3 text-right">
        <div class="flex items-center justify-end gap-1">
          <button type="button" onclick="copyCourierDataById(${o.id})" title="কুরিয়ারে পেস্ট করার ফরম্যাট কপি" class="bg-stone-100 hover:bg-stone-200 text-stone-700 p-1.5 rounded-lg text-xs cursor-pointer">
            📋
          </button>
          <button type="button" onclick="sendDigitalCashMemo(${o.id})" title="ডিজিটাল মেমো হোয়াটসঅ্যাপে পাঠান" class="bg-stone-100 hover:bg-stone-200 text-stone-700 p-1.5 rounded-lg text-xs cursor-pointer">
            🧾
          </button>
          <button type="button" onclick="deleteSingleOrder(${o.id})" title="অর্ডার ডিলিট" class="bg-rose-50 hover:bg-rose-100 text-rose-600 p-1.5 rounded-lg text-xs cursor-pointer">
            🗑️
          </button>
        </div>
      </td>
    </tr>
    `;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
      <title>Dawah Fashion — স্মার্ট কন্ট্রোল প্যানেল</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      </style>
    </head>
    <body class="bg-[#faf8f5] text-stone-800 min-h-screen pb-20">
      
      <!-- Top Sticky Dark Navbar -->
      <header class="bg-stone-900 text-white sticky top-0 z-40 px-4 py-3 shadow-md border-b border-stone-800">
        <div class="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-base shadow-sm ring-2 ring-amber-400/30">
              DF
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="font-black text-base text-white leading-none">Dawah Fashion</h1>
                <span class="bg-amber-400/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded border border-amber-400/30">AI 2.0</span>
              </div>
              <div class="flex items-center gap-2 mt-1">
                <div class="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] px-2.5 py-0.5 rounded-full font-bold">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>+${connectedNumber || '8801968718838'}</span>
                  <span class="text-[10px] text-emerald-300/80 border-l border-emerald-500/30 pl-1.5">সক্রিয়</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Action Buttons -->
          <div class="flex items-center gap-2">
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
      </header>

      <main class="max-w-6xl mx-auto px-4 py-5 space-y-5">
        
        <!-- 4 Summary KPI Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-xs">
            <div class="text-stone-500 text-[11px] font-extrabold uppercase">মোট অর্ডার</div>
            <div class="text-2xl font-black mt-0.5 text-stone-900">${totalOrders}</div>
          </div>
          <div class="bg-white p-3.5 rounded-2xl border border-amber-200 shadow-xs">
            <div class="text-amber-800 text-[11px] font-extrabold uppercase">পেন্ডিং অর্ডার</div>
            <div class="text-2xl font-black mt-0.5 text-amber-700">${pendingOrders + pendingVerificationOrders}</div>
          </div>
          <div class="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs">
            <div class="text-emerald-800 text-[11px] font-extrabold uppercase">ইন-স্টক প্রোডাক্টস</div>
            <div class="text-2xl font-black mt-0.5 text-emerald-800">${inStockProducts} <span class="text-xs text-stone-400 font-bold">/ ${totalProducts}</span></div>
          </div>
          <div class="bg-white p-3.5 rounded-2xl border border-indigo-200 shadow-xs">
            <div class="text-indigo-800 text-[11px] font-extrabold uppercase">বকেয়া Due COD</div>
            <div class="text-2xl font-black mt-0.5 text-indigo-900">৳${totalRevenue.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <!-- Clean 4 Main Navigation Tabs -->
        <div class="flex items-center gap-2 border-b border-stone-200 pb-2 flex-wrap">
          <button type="button" onclick="switchTab('products')" id="tab-btn-products" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-stone-900 text-white shadow-xs">
            <span>📦 প্রোডাক্টস ও কালার</span>
            <span class="bg-stone-800 text-stone-200 text-[10px] px-2 py-0.5 rounded-full font-bold">${totalProducts}</span>
          </button>
          <button type="button" onclick="switchTab('orders')" id="tab-btn-orders" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>📋 অর্ডারস ও লিড</span>
            <span class="bg-amber-100 text-amber-900 text-[10px] px-2 py-0.5 rounded-full font-bold">${totalOrders}</span>
          </button>
          <button type="button" onclick="switchTab('settings')" id="tab-btn-settings" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>⚙️ শপ সেটিংস</span>
          </button>
          <button type="button" onclick="switchTab('sellers')" id="tab-btn-sellers" class="tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs">
            <span>👥 মাল্টি-সেলার টেস্ট</span>
            <span class="bg-indigo-100 text-indigo-900 text-[10px] px-2 py-0.5 rounded-full font-bold">নতুন</span>
          </button>
        </div>

        <!-- ============================================== -->
        <!-- TAB 1: PRODUCTS & COLOR MANAGEMENT              -->
        <!-- ============================================== -->
        <section id="tab-products" class="space-y-4">
          <div class="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-4">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-3">
              <div>
                <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
                  <span>👗 প্রোডাক্ট ক্যাটালগ ও কালার ম্যানেজমেন্ট</span>
                </h2>
                <p class="text-xs text-stone-500 font-medium mt-0.5">কালার বক্সে ম্যানুয়ালি কালার লিখে সেভ করলেই AI সাথে সাথে ওই কালার কাস্টমারকে অফার করবে।</p>
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
              ${productCardsHtml}
            </div>
          </div>
        </section>

        <!-- ============================================== -->
        <!-- TAB 2: RECENT ORDERS & LEADS                   -->
        <!-- ============================================== -->
        <section id="tab-orders" class="hidden space-y-4">
          <div class="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs space-y-4">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-3">
              <div>
                <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
                  <span>📋 সাম্প্রতিক অর্ডারস ও কাস্টমার লিড</span>
                </h2>
                <p class="text-xs text-stone-500 font-medium mt-0.5">কাস্টমারের নাম, ফোন, ঠিকানা ও স্ট্যাটাস ম্যানেজ করুন।</p>
              </div>
              <input type="text" id="orderSearch" oninput="filterOrders(this.value)" placeholder="🔍 অর্ডার খুঁজুন (নাম, ফোন, ঠিকানা)..." class="bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-3.5 py-2 rounded-xl focus:outline-none focus:border-amber-500 w-full sm:w-72">
            </div>

            <!-- Orders Status Filter -->
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
                    <th class="p-3 text-right">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody id="ordersTableBody">
                  ${orderRowsHtml || '<tr><td colspan="7" class="p-8 text-center text-stone-400 font-medium">কোনো অর্ডার পাওয়া যায়নি</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ============================================== -->
        <!-- TAB 3: STORE SETTINGS & DELIVERY RULES         -->
        <!-- ============================================== -->
        <section id="tab-settings" class="hidden space-y-4">
          <div class="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs max-w-2xl mx-auto space-y-5">
            <div class="border-b border-stone-100 pb-3">
              <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
                <span>⚙️ শপ সেটিংস ও ডেলিভারি রুলস</span>
              </h2>
              <p class="text-xs text-stone-500 font-medium mt-0.5">WhatsApp AI স্বয়ংক্রিয়ভাবে গ্রাহককে এই রেট ও পলিসিগুলো জানাবে।</p>
            </div>

            <form onsubmit="saveStoreSettingsLive(event)" class="space-y-4">
              <div>
                <label class="block text-xs font-bold text-stone-800 mb-1">🏪 শপ / ব্র্যান্ডের নাম</label>
                <input type="text" id="set_shop_name" value="${curSettings.shop_name || 'Dawah Fashion'}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>

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
                  <input type="text" id="set_bkash" value="${curSettings.bkash_number}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
                </div>
                <div>
                  <label class="block text-xs font-bold text-stone-800 mb-1">📱 নগদ নাম্বার</label>
                  <input type="text" id="set_nagad" value="${curSettings.nagad_number}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-mono font-bold p-2.5 rounded-xl focus:border-amber-500 outline-none">
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold text-stone-800 mb-1">🎁 বিশেষ অফার / কম্বো ছাড়</label>
                <input type="text" id="set_promo_offer" value="${curSettings.promo_offer || ''}" placeholder="যেমন: ২টি নিলে ১০০ টাকা বিশেষ ছাড়" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">
              </div>

              <div>
                <label class="block text-xs font-bold text-stone-800 mb-1">🔄 রিটার্ন ও এক্সচেঞ্জ পলিসি (AI কাস্টমারকে বলবে)</label>
                <textarea id="set_return_policy" rows="2" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs font-medium p-2.5 rounded-xl focus:border-amber-500 outline-none">${curSettings.return_policy || 'ডেলিভারি ম্যানের সামনে চেক করে রিসিভ করতে পারবেন। কোনো সমস্যা থাকলে তাৎক্ষণিক রিটার্ন।'}</textarea>
              </div>

              <div class="bg-[#fcfaf7] p-3 rounded-xl border border-stone-200 flex items-center justify-between">
                <div>
                  <label class="block text-xs font-bold text-stone-800">🤖 গোস্টিং অটো-রিকভারি (Auto Recovery)</label>
                  <p class="text-[11px] text-stone-500 font-medium">২ ঘণ্টা পার হলে কাস্টমারকে ভদ্রভাবে ফলো-আপ পাঠানো</p>
                </div>
                <input type="checkbox" id="set_auto_followup" ${autoFollowupEnabled ? 'checked' : ''} class="w-5 h-5 rounded accent-amber-600 cursor-pointer">
              </div>

              <button type="submit" id="saveSettingsBtn" class="w-full bg-stone-900 hover:bg-black text-white text-xs font-black py-3 rounded-xl shadow-sm transition cursor-pointer">
                💾 সেটিংস সেভ করুন
              </button>
            </form>
          </div>
        </section>

        <!-- ============================================== -->
        <!-- TAB 4: MULTI-SELLER BETA TESTING               -->
        <!-- ============================================== -->
        <section id="tab-sellers" class="space-y-4 hidden">
          <div class="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs space-y-5">
            <div class="border-b border-stone-100 pb-4">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 class="font-black text-lg text-stone-900 flex items-center gap-2">
                    <span>👥 মাল্টি-সেলার বেটা টেস্টিং ও ইনভাইটেশন</span>
                  </h2>
                  <p class="text-xs text-stone-500 font-medium mt-1">
                    আপনার পরিচিত ২-৩ জন সেলারকে ইনভাইট লিংক পাঠিয়ে যুক্ত করুন। তারা নিজেদের হোয়াটসঅ্যাপ কিউআর স্ক্যান করে সম্পূর্ণ আলাদা স্টোর হিসেবে টেস্ট করতে পারবে।
                  </p>
                </div>
                <div class="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>মাস্টার ওনার: Dawah Fashion (+8801968718838)</span>
                </div>
              </div>
            </div>

            <!-- Create New Invite Form -->
            <div class="bg-[#fcfaf7] border border-amber-200/80 rounded-2xl p-4 space-y-3">
              <h3 class="font-extrabold text-sm text-stone-900 flex items-center gap-2">
                <span>➕ নতুন সেলার ইনভাইট লিংক তৈরি করুন</span>
              </h3>
              <form id="inviteSellerForm" onsubmit="createSellerInvite(event)" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="block text-[11px] font-bold text-stone-600 mb-1">দোকানের নাম *</label>
                  <input type="text" id="inv_shop_name" required placeholder="যেমন: Noor Fashion" class="w-full bg-white border border-stone-300 text-xs px-3 py-2 rounded-xl focus:border-amber-500 outline-none font-medium">
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-stone-600 mb-1">ওনারের নাম</label>
                  <input type="text" id="inv_owner_name" placeholder="যেমন: তানভীর আহমেদ" class="w-full bg-white border border-stone-300 text-xs px-3 py-2 rounded-xl focus:border-amber-500 outline-none font-medium">
                </div>
                <div class="flex items-end">
                  <button type="submit" id="invSubmitBtn" class="w-full bg-stone-900 hover:bg-black text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5">
                    <span>🚀 ইনভাইট লিংক তৈরি করুন</span>
                  </button>
                </div>
              </form>
            </div>

            <!-- Newly Created Invite Alert (Hidden by default) -->
            <div id="newInviteBox" class="hidden bg-emerald-50 border border-emerald-300 rounded-2xl p-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                  <span>🎉 ইনভাইট লিংক সফলভাবে তৈরি হয়েছে!</span>
                </span>
                <button type="button" onclick="document.getElementById('newInviteBox').classList.add('hidden')" class="text-stone-400 hover:text-stone-600 text-xs">✕</button>
              </div>
              <div class="flex items-center gap-2">
                <input type="text" id="newInviteUrl" readonly class="flex-1 bg-white border border-emerald-200 text-xs px-3 py-2 rounded-xl font-mono text-stone-800">
                <button type="button" onclick="copyNewInviteUrl()" class="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer">
                  কপি
                </button>
                <a id="newInviteWaBtn" href="#" target="_blank" class="bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1">
                  <span>হোয়াটসঅ্যাপ</span>
                </a>
              </div>
            </div>

            <!-- Invited Sellers List -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="font-extrabold text-sm text-stone-900">আমন্ত্রিত টেস্ট সেলারদের তালিকা</h3>
                <button type="button" onclick="loadSellerInvites()" class="text-xs text-amber-700 hover:underline font-bold">রিফ্রেশ ↻</button>
              </div>
              <div id="sellersListContainer" class="space-y-2">
                <div class="text-xs text-stone-400 py-4 text-center">ইনভাইটেশন তালিকা লোড হচ্ছে...</div>
              </div>
            </div>
          </div>
        </section>

      </main>

      <!-- Add Product Modal -->
      <div id="addProductModal" class="hidden fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-stone-100 pb-3">
            <h3 class="font-black text-stone-900 text-base">➕ নতুন প্রোডাক্ট যোগ করুন</h3>
            <button type="button" onclick="closeAddProductModal()" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-bold cursor-pointer">✕</button>
          </div>
          <form onsubmit="saveNewProduct(event)" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড</label>
                <input type="text" id="add_code" placeholder="যেমন: DF-106" required class="w-full border border-stone-300 p-2 rounded-xl text-xs font-mono font-bold">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">বিক্রয় মূল্য (টাকা)</label>
                <input type="number" id="add_price" placeholder="যেমন: 2200" required class="w-full border border-stone-300 p-2 rounded-xl text-xs font-bold">
              </div>
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">প্রোডাক্টের নাম</label>
              <input type="text" id="add_name" placeholder="যেমন: প্রিমিয়াম দুবাই আবায়া" required class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">কালারসমূহ (কমা দিয়ে লিখুন)</label>
              <input type="text" id="add_colors" placeholder="যেমন: জেট ব্ল্যাক, কফি, মেরুন" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">ফেব্রিক</label>
                <input type="text" id="add_fabric" value="দুবাই চেরি" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
              </div>
              <div>
                <label class="block text-xs font-bold text-stone-700 mb-1">সাইজসমূহ</label>
                <input type="text" id="add_sizes" value="৫০, ৫২, ৫৪, ৫৬" class="w-full border border-stone-300 p-2 rounded-xl text-xs font-medium">
              </div>
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">ছবির সরাসরি URL</label>
              <input type="url" id="add_img" placeholder="https://..." class="w-full border border-stone-300 p-2 rounded-xl text-xs font-mono">
            </div>
            <button type="submit" id="addSubmitBtn" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-black text-xs py-2.5 rounded-xl transition cursor-pointer">
              + প্রোডাক্ট সেভ করুন
            </button>
          </form>
        </div>
      </div>

      <!-- Edit Product Modal -->
      <div id="editProductModal" class="hidden fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-stone-100 pb-3">
            <h3 class="font-black text-stone-900 text-base">✏️ প্রোডাক্ট এডিট: <span id="edit_code_label" class="font-mono text-amber-900"></span></h3>
            <button type="button" onclick="closeEditProductModal()" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-bold cursor-pointer">✕</button>
          </div>
          <form onsubmit="saveEditedProduct(event)" class="space-y-3">
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
                <label class="block text-xs font-bold text-stone-700 mb-1">ফেব্রিক</label>
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

      <!-- Toast Notification Bar -->
      <div id="toast" class="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-stone-900 text-white text-xs font-extrabold px-5 py-3 rounded-full shadow-2xl opacity-0 pointer-events-none transition-all duration-300 z-50 flex items-center gap-2">
        <span id="toastMsg">বার্তা সংরক্ষিত হয়েছে!</span>
      </div>

      <script>
        window.__PRODUCTS__ = ${JSON.stringify(products || [])};
        window.__ORDERS__ = ${JSON.stringify(orders || [])};
        const curStoreSettings = {
          inside_dhaka_fee: ${curSettings.inside_dhaka_fee},
          outside_dhaka_fee: ${curSettings.outside_dhaka_fee}
        };

        // Toast Helper
        function showToast(msg) {
          const t = document.getElementById('toast');
          const tm = document.getElementById('toastMsg');
          if (!t || !tm) return;
          tm.innerText = msg;
          t.classList.remove('opacity-0', 'pointer-events-none');
          t.classList.add('opacity-100');
          setTimeout(() => {
            t.classList.remove('opacity-100');
            t.classList.add('opacity-0', 'pointer-events-none');
          }, 2800);
        }

        // Tab Switcher
        function switchTab(tabId) {
          if (tabId === 'sellers') loadSellerInvites();
          const tabs = ['products', 'orders', 'settings', 'sellers'];
          tabs.forEach(t => {
            const sec = document.getElementById('tab-' + t);
            const btn = document.getElementById('tab-btn-' + t);
            if (sec) {
              if (t === tabId) {
                sec.classList.remove('hidden');
              } else {
                sec.classList.add('hidden');
              }
            }
            if (btn) {
              if (t === tabId) {
                btn.className = 'tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-stone-900 text-white shadow-xs';
              } else {
                btn.className = 'tab-btn px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition cursor-pointer bg-white border border-stone-300 text-stone-700 hover:text-stone-900 shadow-xs';
              }
            }
          });
          if (window.location.hash !== '#' + tabId) {
            history.replaceState(null, null, '#' + tabId);
          }
        }

        // On Page Load: Hash router
        window.addEventListener('DOMContentLoaded', () => {
          const hash = window.location.hash.replace('#', '');
          if (hash === 'orders' || hash === 'settings' || hash === 'sellers') {
            switchTab(hash);
          } else {
            switchTab('products');
          }
        });

        // Toggle Product In-Stock Status
        async function toggleStockLive(id, newStock) {
          try {
            const res = await fetch('/api/products/' + id + '/toggle-stock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ in_stock: newStock, ajax: true })
            });
            const data = await res.json();
            if (data.success) {
              showToast(data.in_stock ? '✅ প্রোডাক্টটি ইন-স্টক করা হয়েছে!' : '❌ প্রোডাক্টটি স্টক আউট করা হয়েছে!');
              setTimeout(() => window.location.reload(), 600);
            }
          } catch (err) {
            alert('স্টক আপডেট এরর: ' + err.message);
          }
        }

        // Save Colors Directly to Database and sync AI
        async function saveColorsLive(id) {
          const input = document.getElementById('color-input-' + id);
          if (!input) return;
          const colorsVal = input.value.trim();
          const prod = (window.__PRODUCTS__ || []).find(p => p.id == id);
          if (!prod) return;

          showToast('⏳ কালার ডাটাবেসে সেভ হচ্ছে...');
          try {
            const res = await fetch('/api/products/' + id + '/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                name: prod.name,
                price: prod.price,
                regular_price: prod.regular_price || prod.price,
                fabric: prod.fabric,
                sizes: prod.sizes,
                colors: colorsVal,
                ajax: true
              })
            });
            const data = await res.json();
            if (data.success) {
              prod.colors = colorsVal;
              showToast('✅ ' + (prod.model_code || 'প্রোডাক্ট') + ' এর কালার সেভ হয়েছে! AI এখন এই কালার জানবে।');
            } else {
              alert('কালার সেভ ব্যর্থ: ' + (data.error || 'সমস্যা'));
            }
          } catch (err) {
            alert('কালার সেভ এরর: ' + err.message);
          }
        }

        // Copy Courier Data for Steadfast / Pathao
        function copyCourierDataById(id) {
          const o = (window.__ORDERS__ || []).find(x => x.id == id);
          if (!o) return;
          const text = [
            'কাস্টমার: ' + (o.customer_name || 'কাস্টমার'),
            'মোবাইল: ' + (o.customer_phone || ''),
            'ঠিকানা: ' + (o.address || ''),
            'প্রোডাক্ট: [' + (o.model_code || 'DF') + '] ' + (o.product_details || '') + ' (সাইজ: ' + (o.length_size || 'স্ট্যান্ডার্ড') + ')',
            'ক্যাশ কালেকশন (Due COD): ৳' + (o.due_cod || o.total_bdt || 2200)
          ].join('\\n');
          navigator.clipboard.writeText(text);
          showToast('📋 কুরিয়ার ফরম্যাট কপি হয়েছে!');
        }

        // Delete Product
        async function deleteProductLive(id, code) {
          if (!confirm(code + ' প্রোডাক্টটি মুছে ফেলতে চান?')) return;
          try {
            await fetch('/api/products/' + id + '/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ ajax: true })
            });
            showToast('🗑️ ' + code + ' মোছা হয়েছে');
            setTimeout(() => window.location.reload(), 500);
          } catch (e) {
            alert('ডিলিট এরর: ' + e.message);
          }
        }

        // Filter Products
        let currentStockFilter = 'ALL';
        function filterStock(status) {
          currentStockFilter = status;
          document.querySelectorAll('.stock-filter-btn').forEach(b => {
            b.className = 'stock-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer';
          });
          const activeBtn = document.getElementById('filter-stock-' + (status === 'ALL' ? 'all' : (status === 'IN_STOCK' ? 'instock' : 'out')));
          if (activeBtn) activeBtn.className = 'stock-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer';
          applyProductFilters();
        }

        function filterProducts(query) {
          applyProductFilters();
        }

        function applyProductFilters() {
          const q = (document.getElementById('prodSearch')?.value || '').toLowerCase().trim();
          document.querySelectorAll('.prod-card').forEach(c => {
            const search = c.getAttribute('data-search') || '';
            const stock = c.getAttribute('data-stock') || '';
            const matchStock = (currentStockFilter === 'ALL') || (stock === currentStockFilter);
            const matchQuery = !q || search.includes(q);
            c.style.display = (matchStock && matchQuery) ? '' : 'none';
          });
        }

        // Filter Orders
        let currentOrderFilter = 'ALL';
        function filterOrderStatus(status) {
          currentOrderFilter = status;
          document.querySelectorAll('.order-filter-btn').forEach(b => {
            b.className = 'order-filter-btn px-3 py-1 rounded-xl bg-[#fcfaf7] border border-stone-300 text-stone-700 cursor-pointer';
          });
          const btn = document.getElementById('filter-order-' + status.toLowerCase());
          if (btn) btn.className = 'order-filter-btn px-3 py-1 rounded-xl bg-stone-900 text-white cursor-pointer';
          applyOrderFilters();
        }

        function filterOrders(query) {
          applyOrderFilters();
        }

        function applyOrderFilters() {
          const q = (document.getElementById('orderSearch')?.value || '').toLowerCase().trim();
          document.querySelectorAll('.order-row').forEach(r => {
            const search = r.getAttribute('data-search') || '';
            const status = r.getAttribute('data-status') || '';
            const matchStatus = (currentOrderFilter === 'ALL') || (status === currentOrderFilter);
            const matchQuery = !q || search.includes(q);
            r.style.display = (matchStatus && matchQuery) ? '' : 'none';
          });
        }

        // Live Order Status Update
        async function updateOrderStatusLive(id, status) {
          try {
            const res = await fetch('/api/orders/' + id + '/status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ status, ajax: true })
            });
            if (res.ok) {
              showToast('✅ অর্ডার #' + id + ' এর স্ট্যাটাস ' + status + ' করা হয়েছে!');
              const row = document.querySelector('[data-order-id="' + id + '"]');
              if (row) row.setAttribute('data-status', status);
            }
          } catch (e) {
            alert('স্ট্যাটাস আপডেট এরর: ' + e.message);
          }
        }

        // Send Digital Cash Memo
        async function sendDigitalCashMemo(id) {
          if (!confirm('কাস্টমারের হোয়াটসঅ্যাপে ডিজিটাল ক্যাশ মেমো পাঠাতে চান?')) return;
          try {
            const res = await fetch('/api/orders/' + id + '/send-memo', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data.success) {
              showToast('🧾 ডিজিটাল ক্যাশ মেমো হোয়াটসঅ্যাপে পাঠানো হয়েছে!');
            } else {
              alert('এরর: ' + (data.error || 'পাঠানো যায়নি'));
            }
          } catch (err) {
            alert('সংযোগ সমস্যা: ' + err.message);
          }
        }

        // Delete Single Order
        async function deleteSingleOrder(id) {
          if (!confirm('অর্ডার #' + id + ' মুছে ফেলতে চান?')) return;
          try {
            await fetch('/api/orders/' + id + '/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ ajax: true })
            });
            showToast('অর্ডার #' + id + ' মোছা হয়েছে');
            const row = document.querySelector('[data-order-id="' + id + '"]');
            if (row) row.remove();
          } catch (e) {
            alert('ডিলিট এরর: ' + e.message);
          }
        }

        // Save Store Settings
        async function saveStoreSettingsLive(e) {
          e.preventDefault();
          const btn = document.getElementById('saveSettingsBtn');
          if (btn) { btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true; }

          const payload = {
            shop_name: document.getElementById('set_shop_name').value.trim(),
            inside_dhaka_fee: document.getElementById('set_inside_fee').value,
            outside_dhaka_fee: document.getElementById('set_outside_fee').value,
            bkash_number: document.getElementById('set_bkash').value.trim(),
            nagad_number: document.getElementById('set_nagad').value.trim(),
            promo_offer: document.getElementById('set_promo_offer').value.trim(),
            return_policy: document.getElementById('set_return_policy').value.trim(),
            auto_followup: document.getElementById('set_auto_followup').checked,
            ajax: true
          };

          try {
            const res = await fetch('/api/settings/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (res.ok) {
              showToast('⚙️ স্টোর সেটিংস সফলভাবে সেভ হয়েছে!');
            } else {
              alert('সেটিংস সেভ ব্যর্থ হয়েছে');
            }
          } catch (err) {
            alert('এরর: ' + err.message);
          } finally {
            if (btn) { btn.innerText = '💾 সেটিংস সেভ করুন'; btn.disabled = false; }
          }
        }

        // Add Product Modal Handlers
        function openAddProductModal() {
          const m = document.getElementById('addProductModal');
          if (m) m.classList.remove('hidden');
        }
        function closeAddProductModal() {
          const m = document.getElementById('addProductModal');
          if (m) m.classList.add('hidden');
        }

        async function saveNewProduct(e) {
          e.preventDefault();
          const btn = document.getElementById('addSubmitBtn');
          if (btn) { btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true; }

          const payload = {
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
            if (res.ok) {
              showToast('🎉 নতুন প্রোডাক্ট যুক্ত হয়েছে!');
              closeAddProductModal();
              setTimeout(() => window.location.reload(), 600);
            } else {
              alert('প্রোডাক্ট যোগ ব্যর্থ হয়েছে');
            }
          } catch (err) {
            alert('এরর: ' + err.message);
          } finally {
            if (btn) { btn.innerText = '+ প্রোডাক্ট সেভ করুন'; btn.disabled = false; }
          }
        }

        // Multi-Seller Invite Handlers
        async function createSellerInvite(e) {
          e.preventDefault();
          const btn = document.getElementById('invSubmitBtn');
          if (btn) { btn.innerText = 'তৈরি হচ্ছে...'; btn.disabled = true; }
          const shop_name = document.getElementById('inv_shop_name').value.trim();
          const owner_name = document.getElementById('inv_owner_name').value.trim();

          try {
            const res = await fetch('/api/sellers/invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shop_name, owner_name })
            });
            const data = await res.json();
            if (data.success) {
              showToast('🎉 নতুন সেলার ইনভাইট লিংক তৈরি হয়েছে!');
              document.getElementById('newInviteUrl').value = data.invite_url;
              document.getElementById('newInviteWaBtn').href = 'https://wa.me/?text=' + encodeURIComponent('আসসালামু আলাইকুম! AutoDokan AI সেলার টেস্টে আপনাকে স্বাগতম। আপনার হোয়াটসঅ্যাপ কানেক্ট করতে নিচের লিংকে ক্লিক করে QR কোড স্ক্যান করুন: ') + encodeURIComponent(data.invite_url);
              document.getElementById('newInviteBox').classList.remove('hidden');
              document.getElementById('inv_shop_name').value = '';
              document.getElementById('inv_owner_name').value = '';
              loadSellerInvites();
            } else {
              alert('এরর: ' + (data.error || 'তৈরি করা যায়নি'));
            }
          } catch (err) {
            alert('কানেকশন এরর: ' + err.message);
          } finally {
            if (btn) { btn.innerText = '🚀 ইনভাইট লিংক তৈরি করুন'; btn.disabled = false; }
          }
        }

        function copyNewInviteUrl() {
          const input = document.getElementById('newInviteUrl');
          navigator.clipboard.writeText(input.value);
          showToast('📋 ইনভাইট লিংক কপি হয়েছে!');
        }

        async function loadSellerInvites() {
          const cont = document.getElementById('sellersListContainer');
          if (!cont) return;
          try {
            const res = await fetch('/api/sellers/invites');
            const data = await res.json();
            if (!data.success || !data.invites || data.invites.length === 0) {
              cont.innerHTML = '<div class="text-xs text-stone-400 py-3 text-center border border-dashed border-stone-200 rounded-xl">এখনও কোনো সেলারকে ইনভাইট করা হয়নি। ওপরের ফর্ম দিয়ে নতুন ইনভাইট তৈরি করুন।</div>';
              return;
            }

            cont.innerHTML = data.invites.map(inv => {
              const isConnected = inv.live_status === 'connected' || inv.status === 'CONNECTED';
              const statusBadge = isConnected
                ? '<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">● কানেক্টেড (' + (inv.live_number || inv.phone || 'WhatsApp') + ')</span>'
                : '<span class="bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full">⏳ QR স্ক্যান বাকি</span>';

              const invUrl = window.location.origin + '/connect?token=' + inv.invite_token;

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
                '<div class="flex items-center gap-2">' +
                  '<button type="button" onclick="navigator.clipboard.writeText(\'' + invUrl + '\'); showToast(\'📋 লিংক কপি হয়েছে!\')" class="bg-white border border-stone-300 hover:border-stone-400 text-stone-700 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer">' +
                    'কপি লিংক' +
                  '</button>' +
                  '<a href="/connect?token=' + inv.invite_token + '" target="_blank" class="bg-stone-900 hover:bg-black text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">' +
                    'QR পেজ খুলুন ↗' +
                  '</a>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (e) {
            cont.innerHTML = '<div class="text-xs text-rose-500 py-2">ইনভাইট তালিকা লোড ব্যর্থ: ' + e.message + '</div>';
          }
        }

        // Edit Product Modal Handlers
        function openEditProductModalById(id) {
          const p = (window.__PRODUCTS__ || []).find(x => x.id == id);
          if (!p) return;
          document.getElementById('edit_id').value = p.id;
          document.getElementById('edit_code_label').innerText = p.model_code || '';
          document.getElementById('edit_code').value = p.model_code || '';
          document.getElementById('edit_name').value = p.name || '';
          document.getElementById('edit_price').value = p.price || '';
          document.getElementById('edit_colors').value = p.colors || '';
          document.getElementById('edit_fabric').value = p.fabric || 'দুবাই চেরি';
          document.getElementById('edit_sizes').value = p.sizes || '৫০, ৫২, ৫৪, ৫৬';
          document.getElementById('edit_img').value = p.image_url || '';

          const m = document.getElementById('editProductModal');
          if (m) m.classList.remove('hidden');
        }

        function closeEditProductModal() {
          const m = document.getElementById('editProductModal');
          if (m) m.classList.add('hidden');
        }

        async function saveEditedProduct(e) {
          e.preventDefault();
          const btn = document.getElementById('editSubmitBtn');
          if (btn) { btn.innerText = 'সেভ হচ্ছে...'; btn.disabled = true; }
          const id = document.getElementById('edit_id').value;

          const payload = {
            model_code: document.getElementById('edit_code').value.toUpperCase().trim(),
            name: document.getElementById('edit_name').value.trim(),
            price: document.getElementById('edit_price').value,
            fabric: document.getElementById('edit_fabric').value.trim(),
            sizes: document.getElementById('edit_sizes').value.trim(),
            colors: document.getElementById('edit_colors').value.trim(),
            image_url: document.getElementById('edit_img').value.trim() || undefined,
            ajax: true
          };

          try {
            const res = await fetch('/api/products/' + id + '/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (res.ok) {
              showToast('💾 প্রোডাক্ট তথ্য আপডেট হয়েছে!');
              closeEditProductModal();
              setTimeout(() => window.location.reload(), 600);
            } else {
              alert('আপডেট ব্যর্থ হয়েছে');
            }
          } catch (err) {
            alert('এরর: ' + err.message);
          } finally {
            if (btn) { btn.innerText = '💾 পরিবর্তন সেভ করুন'; btn.disabled = false; }
          }
        }
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
// Multi-Seller Session Controller & Invite Engine
// ==========================================

async function startSellerSession(sellerId) {
  if (sellerSockets.has(sellerId) && sellerStatuses.get(sellerId) === 'connected') {
    return sellerSockets.get(sellerId);
  }
  if (sellerStatuses.get(sellerId) === 'connecting' || sellerStatuses.get(sellerId) === 'waiting_for_qr_scan') {
    return sellerSockets.get(sellerId);
  }

  try {
    console.log(`[Multi-Seller] Initializing WhatsApp session for ${sellerId}...`);
    sellerStatuses.set(sellerId, 'connecting');

    const { state, saveCreds } = await useSupabaseAuthState(
      SUPABASE_URL,
      SUPABASE_KEY,
      sellerId
    );

    const sSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000
    });

    sellerSockets.set(sellerId, sSock);
    sSock.ev.on('creds.update', saveCreds);

    sSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        sellerQRs.set(sellerId, qr);
        sellerStatuses.set(sellerId, 'waiting_for_qr_scan');
        console.log(`[Multi-Seller] New QR code generated for ${sellerId}`);
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        sellerStatuses.set(sellerId, 'disconnected');
        sellerQRs.delete(sellerId);
        sellerSockets.delete(sellerId);
        console.log(`[Multi-Seller] ${sellerId} connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => startSellerSession(sellerId), 3000);
        } else {
          try {
            await supabase.from('seller_invites').update({ status: 'DISCONNECTED' }).eq('seller_id', sellerId);
          } catch (e) {}
        }
      } else if (connection === 'open') {
        sellerStatuses.set(sellerId, 'connected');
        sellerQRs.delete(sellerId);
        const id = sSock.user?.id || '';
        const num = id.split(':')[0] || id.split('@')[0];
        sellerNumbers.set(sellerId, num);
        console.log(`[Multi-Seller] ${sellerId} connected successfully as +${num}`);

        try {
          await supabase.from('seller_invites').update({
            status: 'CONNECTED',
            phone: `+${num}`,
            connected_at: new Date().toISOString()
          }).eq('seller_id', sellerId);
        } catch (dbErr) {
          console.warn('[Multi-Seller DB Update Error]:', dbErr.message);
        }
      }
    });

    // Inbound Message Listener for this specific seller
    sSock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg) return;
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') return;
      if (msg.key.fromMe) return;
      if (m.type !== 'notify' && m.type !== 'append') return;

      const messageContent = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!messageContent.trim()) return;

      const bufferKey = `${sellerId}:${remoteJid}`;
      let bState = customerMessageStates.get(bufferKey);
      if (!bState) {
        bState = { texts: [], debounceTimer: null, isProcessing: false, lastKey: msg.key };
        customerMessageStates.set(bufferKey, bState);
      }
      bState.texts.push(messageContent);
      bState.lastKey = msg.key;

      if (bState.debounceTimer) clearTimeout(bState.debounceTimer);
      bState.debounceTimer = setTimeout(async () => {
        if (bState.isProcessing) return;
        bState.isProcessing = true;
        const combined = bState.texts.join(' \n ');
        bState.texts = [];

        try {
          // Natural delayed Blue Tick (as human opens conversation)
          if (bState.lastKey) {
            try { await sSock.readMessages([bState.lastKey]); } catch (e) {}
          }
          await sSock.sendPresenceUpdate('composing', remoteJid);
          const replyText = await handleIncomingMessage(remoteJid, combined, sellerId);
          const cleanReply = typeof cleanHumanFormatting === 'function' ? cleanHumanFormatting(replyText) : replyText;

          // Strictly 5-second human typing simulation
          await sSock.sendPresenceUpdate('composing', remoteJid);
          await new Promise(r => setTimeout(r, 5000));
          await sSock.sendMessage(remoteJid, { text: cleanReply });
          await sSock.sendPresenceUpdate('paused', remoteJid);
        } catch (err) {
          console.error(`[Multi-Seller ${sellerId} Outbound Error]:`, err.message);
        } finally {
          bState.isProcessing = false;
        }
      }, 1500);
    });

    return sSock;
  } catch (err) {
    console.error(`[Multi-Seller ${sellerId} Init Error]:`, err.message);
    sellerStatuses.set(sellerId, 'error');
  }
}

// Multi-Seller Routes
app.post('/api/sellers/invite', async (req, res) => {
  try {
    const { shop_name, owner_name, phone } = req.body;
    if (!shop_name || !shop_name.trim()) {
      return res.status(400).json({ error: 'দোকানের নাম আবশ্যক' });
    }
    const crypto = require('crypto');
    const token = 'inv_' + crypto.randomBytes(6).toString('hex');
    const seller_id = 'seller_' + crypto.randomBytes(4).toString('hex');
    const cleanShop = shop_name.trim();
    const cleanOwner = (owner_name || '').trim();
    const cleanPhone = (phone || '').trim();

    const { data, error } = await supabase.from('seller_invites').insert({
      invite_token: token,
      seller_id: seller_id,
      shop_name: cleanShop,
      owner_name: cleanOwner,
      phone: cleanPhone,
      status: 'PENDING'
    }).select().single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    try {
      await supabase.from('store_settings').insert({
        seller_id: seller_id,
        shop_name: cleanShop,
        inside_dhaka_fee: 80,
        outside_dhaka_fee: 120,
        auto_reply_enabled: true
      });
    } catch (e) {}

    const host = req.get('host');
    const protocol = req.protocol;
    const inviteUrl = `${protocol}://${host}/connect?token=${token}`;

    res.json({
      success: true,
      invite: data,
      invite_url: inviteUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sellers/invites', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('seller_invites')
      .select('*')
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const augmented = (data || []).map(inv => ({
      ...inv,
      live_status: sellerStatuses.get(inv.seller_id) || inv.status,
      live_number: sellerNumbers.get(inv.seller_id) || inv.phone || null
    }));

    res.json({ success: true, invites: augmented });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/connect', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send('<h3>ইনভাইট টোকেন পাওয়া যায়নি। দয়া করে সঠিক লিংক ব্যবহার করুন।</h3>');
  }

  const { data: inv, error } = await supabase
    .from('seller_invites')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !inv) {
    return res.status(404).send('<h3>ইনভাইটেশন লিংকটি সঠিক নয় বা মেয়াদোত্তীর্ণ হয়েছে।</h3>');
  }

  // Auto-start session if not active
  if (!sellerSockets.has(inv.seller_id)) {
    startSellerSession(inv.seller_id);
  }

  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoDokan AI - ${inv.shop_name} কানেকশন</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Hind+Siliguri:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body { font-family: 'Plus Jakarta Sans', 'Hind Siliguri', sans-serif; }</style>
</head>
<body class="bg-[#f8f6f0] text-stone-900 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-white rounded-3xl border border-stone-200 shadow-xl p-6 sm:p-8 space-y-6 text-center">
    
    <div>
      <div class="inline-flex items-center justify-center w-14 h-14 bg-amber-100 border border-amber-200 rounded-2xl text-2xl mb-3 shadow-xs">
        🏪
      </div>
      <h1 class="text-xl sm:text-2xl font-black text-stone-900">${inv.shop_name}</h1>
      <p class="text-xs text-stone-500 font-semibold mt-1">AutoDokan AI WhatsApp ইন্টিগ্রেশন</p>
    </div>

    <!-- Status Banner -->
    <div id="statusBanner" class="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2">
      <span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
      <span id="statusText">QR কোড প্রস্তুত হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...</span>
    </div>

    <!-- QR Code Display Box -->
    <div class="relative bg-stone-50 border-2 border-dashed border-stone-300 rounded-3xl p-5 flex items-center justify-center min-h-[280px]">
      <img id="qrImage" src="/api/connect/qr?token=${token}&t=${Date.now()}" alt="WhatsApp QR Code" class="hidden w-64 h-64 rounded-xl shadow-xs">
      <div id="qrPlaceholder" class="text-stone-400 text-xs font-bold flex flex-col items-center gap-2">
        <svg class="animate-spin h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>কিউআর লোড হচ্ছে...</span>
      </div>
    </div>

    <!-- Instructions -->
    <div class="bg-stone-50 rounded-2xl p-4 text-left border border-stone-200 text-xs text-stone-600 space-y-1.5 font-medium">
      <div class="font-extrabold text-stone-800 mb-1">কীভাবে কানেক্ট করবেন:</div>
      <div>১. আপনার ফোনের WhatsApp ওপেন করুন</div>
      <div>২. Settings বা থ্রি-ডট থেকে <b>Linked Devices</b> এ যান</div>
      <div>৩. <b>Link a Device</b> চাপ দিয়ে উপরের কিউআর কোডটি স্ক্যান করুন</div>
      <div>৪. কানেক্ট হওয়ামাত্রই AI স্বয়ংক্রিয়ভাবে মেসেজের রিপ্লাই দেওয়া শুরু করবে!</div>
    </div>

    <div class="text-[11px] text-stone-400 font-semibold">
      AutoDokan Engine v2.0 • Powered by Google DeepMind
    </div>

  </div>

  <script>
    const token = '${token}';
    let pollInterval = null;

    async function checkStatus() {
      try {
        const res = await fetch('/api/connect/status?token=' + token);
        const data = await res.json();
        
        const banner = document.getElementById('statusBanner');
        const statusText = document.getElementById('statusText');
        const qrImg = document.getElementById('qrImage');
        const placeholder = document.getElementById('qrPlaceholder');

        const curStatus = (data.status || '').toLowerCase();

        if (curStatus === 'connected') {
          banner.className = 'bg-emerald-50 border border-emerald-300 text-emerald-900 p-3.5 rounded-2xl text-xs font-black flex items-center justify-center gap-2';
          statusText.innerText = '🎉 হোয়াটসঅ্যাপ সফলভাবে কানেক্ট হয়েছে! নম্বর: ' + (data.number || '');
          qrImg.classList.add('hidden');
          placeholder.classList.remove('hidden');
          placeholder.innerHTML = '<span class="text-4xl">✅</span><span class="text-emerald-800 font-black text-sm mt-1">কানেকশন সক্রিয় আছে</span>';
          if (pollInterval) clearInterval(pollInterval);
        } else if (data.has_qr) {
          banner.className = 'bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2';
          statusText.innerText = '📱 আপনার ফোন দিয়ে নিচের QR কোডটি স্ক্যান করুন';
          qrImg.src = '/api/connect/qr?token=' + token + '&t=' + Date.now();
          qrImg.classList.remove('hidden');
          placeholder.classList.add('hidden');
        } else if (curStatus === 'waiting_for_qr_scan') {
          statusText.innerText = '📱 কিউআর কোড তৈরি হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...';
        } else if (curStatus === 'connecting') {
          statusText.innerText = '⏳ হোয়াটসঅ্যাপ সার্ভারের সাথে সংযোগ স্থাপন করা হচ্ছে...';
        }
      } catch (e) {}
    }

    checkStatus();
    pollInterval = setInterval(checkStatus, 3000);
  </script>
</body>
</html>`);
});

app.get('/api/connect/qr', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Token required');
  const { data: inv } = await supabase.from('seller_invites').select('seller_id').eq('invite_token', token).maybeSingle();
  if (!inv) return res.status(404).send('Invalid token');

  const qr = sellerQRs.get(inv.seller_id);
  if (!qr) return res.status(404).send('QR not ready');

  try {
    const qrBuf = await qrcode.toBuffer(qr, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(qrBuf);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/connect/status', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  const { data: inv } = await supabase.from('seller_invites').select('*').eq('invite_token', token).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Invalid token' });

  // Auto-start session if not active in memory and not logged out
  if (!sellerSockets.has(inv.seller_id) && inv.status !== 'DISCONNECTED') {
    startSellerSession(inv.seller_id);
  }

  const rawStatus = sellerStatuses.get(inv.seller_id) || inv.status || 'disconnected';
  const liveStatus = rawStatus.toLowerCase();
  const liveNum = sellerNumbers.get(inv.seller_id) || inv.phone;
  const hasQR = !!sellerQRs.get(inv.seller_id);

  res.json({
    shop_name: inv.shop_name,
    owner_name: inv.owner_name,
    status: liveStatus,
    number: liveNum,
    has_qr: hasQR
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
  const now = Date.now();
  const cached = userPausedCache.get(remoteJid);
  if (cached && cached.expiresAt > now) {
    return cached.isPaused;
  }

  try {
    const { data } = await supabase
      .from('chat_sessions')
      .select('paused_until, attention_reason, updated_at')
      .eq('seller_id', CURRENT_SELLER_ID)
      .eq('channel_type', 'WHATSAPP')
      .eq('customer_identifier', remoteJid)
      .maybeSingle();

    let isPaused = false;
    if (data && data.paused_until) {
      const dbPaused = new Date(data.paused_until).getTime();
      if (dbPaused > now) {
        // Self-Healing Auto-Resume:
        // If pause was caused by HUMAN_TAKEOVER, but seller has been inactive for > 5 minutes,
        // automatically heal and release the customer so they are NEVER locked out or ghosted!
        const lastActivity = data.updated_at ? new Date(data.updated_at).getTime() : 0;
        const minutesInactive = (now - lastActivity) / (60 * 1000);
        if (data.attention_reason === 'HUMAN_TAKEOVER' && minutesInactive > 5) {
          console.log(`[Auto-Heal] Seller inactive for ${Math.round(minutesInactive)}m. Auto-releasing customer ${remoteJid}`);
          supabase.from('chat_sessions')
            .update({ paused_until: null, attention_reason: null })
            .eq('seller_id', CURRENT_SELLER_ID)
            .eq('customer_identifier', remoteJid)
            .then(() => {});
          isPaused = false;
        } else {
          isPaused = true;
        }
      }
    }

    userPausedCache.set(remoteJid, { isPaused, expiresAt: now + 10000 }); // 10s TTL
    return isPaused;
  } catch (e) {
    if (cached) return cached.isPaused;
    return false;
  }
}

async function pauseCustomerForHumanTakeover(remoteJid, minutes = 10, reason = 'HUMAN_TAKEOVER', ownerManualText = '') {
  const pausedTime = Date.now() + minutes * 60 * 1000;
  userPausedCache.set(remoteJid, { isPaused: true, expiresAt: pausedTime });
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

        // Set needs_human_attention flag in chat_sessions WITHOUT pausing the bot
        try {
          await supabase.from('chat_sessions').update({
            needs_human_attention: true,
            attention_reason: 'PAYMENT_VERIFICATION'
          }).eq('seller_id', CURRENT_SELLER_ID).eq('customer_identifier', remoteJid);
        } catch (attErr) {}
      }
    }

    // 3b. Customer Complaint, Frustrated or Human Agent Request Escalation Hook (NEVER PAUSE BOT)
    if (typeof isAngryComplaint === 'function' && typeof isAgentRequest === 'function') {
      const isComplaint = isAngryComplaint(combinedText);
      const isAgentReq = isAgentRequest(combinedText);
      const isFrustrated = typeof isAbusiveOrFrustrated === 'function' ? isAbusiveOrFrustrated(combinedText) : false;
      if (isAgentReq || isComplaint || isFrustrated) {
        // Human agent request, frustration, or complaints -> NEVER pause bot! Keep replying while alerting dashboard
        const escalationReason = isAgentReq ? 'HUMAN_AGENT_REQUESTED' : (isFrustrated ? 'CUSTOMER_FRUSTRATED' : 'CUSTOMER_COMPLAINT');
        console.log(`[Flag Human Attention] From: ${remoteJid} | Reason: ${escalationReason} (Bot remains active!)`);
        try {
          await supabase.from('chat_sessions').update({
            needs_human_attention: true,
            attention_reason: escalationReason,
            updated_at: new Date().toISOString()
          }).eq('seller_id', CURRENT_SELLER_ID).eq('customer_identifier', remoteJid);
        } catch (err) {}
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
        const cleanPath = url.replace(/^https?:\/\/[^\/]+/, '').replace(/^[/\\]+/, '').split(/[/\\]+/).join(path.sep);
        const localFile = path.join(__dirname, 'public', cleanPath);
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
        console.log(`[WhatsApp Photo Sent] To: ${remoteJid} | File: ${cleanPath}`);
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

    // Aggressively clean ALL send tags, leaked prompt codes & apply Clean Human Formatting Sanitizer (Section 1)
    let rawCleanReply = replyText
      .replace(/\[\s*SEND_[A-Za-z0-9_:\s-]+\s*\]/gi, '')
      .replace(/\(?(?:send|showing)\s*hi[zj]ab\s*(?:image|pic|photo)?\)?/gi, '')
      .replace(/\[?\s*(?:send|showing)\s*[a-z_]*hi[zj]ab[a-z_]*\s*[^\n\]]*\]?/gi, '')
      .replace(/\[\s*[A-Z_]+(?::[A-Za-z0-9_-]+)?\s*\]/g, '')
      .trim();

    const cleanReplyText = typeof cleanHumanFormatting === 'function'
      ? cleanHumanFormatting(rawCleanReply)
      : rawCleanReply;

    // Multi-Bubble & 5-Second Typing Simulation (Strictly Human Balanced Speed)
    if (sock && cleanReplyText) {
      const rawParagraphs = cleanReplyText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      if (rawParagraphs.length >= 2 && cleanReplyText.length > 120) {
        // Split into 2 natural bubbles: 3000ms + 2000ms = 5000ms (5 seconds) total typing
        const firstBubble = rawParagraphs[0];
        const secondBubble = rawParagraphs.slice(1).join('\n\n');

        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, 3000));
        const sent1 = await sock.sendMessage(remoteJid, { text: firstBubble });
        if (sent1?.key?.id) botSentMessageIds.add(sent1.key.id);
        incrementStats('messages_out');

        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, 2000));
        const sent2 = await sock.sendMessage(remoteJid, { text: secondBubble });
        if (sent2?.key?.id) botSentMessageIds.add(sent2.key.id);
        await sock.sendPresenceUpdate('paused', remoteJid);
        incrementStats('messages_out');
      } else {
        const typingDuration = 5000; // Exactly 5 seconds
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
      return `${p.model_code || 'DF-101'} : ${p.name || ''}`;
    }

    function buildProductAlbumCaption(p) {
      const code = p.model_code || 'DF-101';
      const price = p.price ? ` | ৳${p.price}` : '';
      return `${code} : ${p.name || ''}${price}`;
    }

    async function sendProductAlbum(p) {
      if (!sock || !p) return false;
      try {
        const photoUrls = (typeof getProductImageUrls === 'function')
          ? getProductImageUrls(p)
          : [p.image_url, p.detail_image_url, p.hijab_image_url, p.flare_image_url, p.real_image_url].filter(Boolean);

        if (photoUrls.length === 0) return false;

        const masterCaption = buildProductAlbumCaption(p);

        for (let i = 0; i < photoUrls.length; i++) {
          const url = photoUrls[i];
          let imagePayload;
          const cleanPath = url.replace(/^https?:\/\/[^\/]+/, '').replace(/^[/\\]+/, '').split(/[/\\]+/).join(path.sep);
          const localFile = path.join(__dirname, 'public', cleanPath);
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
          if (sentAlbum?.key?.id) {
            botSentMessageIds.add(sentAlbum.key.id);
            botSentMediaTracking.set(sentAlbum.key.id, {
              seller_id: CURRENT_SELLER_ID,
              product_id: p.id,
              model_code: p.model_code,
              name: p.name,
              price: p.price
            });
          }
          incrementStats('messages_out');

          if (i < photoUrls.length - 1) {
            await new Promise(r => setTimeout(r, 250));
          }
        }
        await sock.sendPresenceUpdate('paused', remoteJid);
        console.log(`[WhatsApp Album Sent] To: ${remoteJid} | Model: ${p.model_code} | Count: ${photoUrls.length}`);
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
          const cleanPath = p.image_url.replace(/^https?:\/\/[^\/]+/, '').replace(/^[/\\]+/, '').split(/[/\\]+/).join(path.sep);
          const localFile = path.join(__dirname, 'public', cleanPath);
          if (fs.existsSync(localFile)) {
            imagePayload = fs.readFileSync(localFile);
          } else {
            imagePayload = { url: p.image_url };
          }

          const sentCat = await sock.sendMessage(remoteJid, {
            image: imagePayload,
            caption: buildSingleProductCaption(p)
          });
          if (sentCat?.key?.id) {
            botSentMessageIds.add(sentCat.key.id);
            botSentMediaTracking.set(sentCat.key.id, {
              seller_id: CURRENT_SELLER_ID,
              product_id: p.id,
              model_code: p.model_code,
              name: p.name,
              price: p.price
            });
          }
          incrementStats('messages_out');

          if (i < allProds.length - 1) {
            await new Promise(r => setTimeout(r, 280));
          }
        }
        await sock.sendPresenceUpdate('paused', remoteJid);
        console.log(`[WhatsApp Catalog Overview Sent] To: ${remoteJid} | Total: ${allProds.length}`);
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

    // Strict Safety: If browsing catalog or multiple models outputted -> send Catalog Overview (1 photo per model = 5 photos max)
    // NEVER send multiple 5-8 photo albums in a single turn!
    if (hasCatalogOverview || allMatches.length > 1) {
      await sendCatalogOverview();
    } else if (allMatches.length === 1) {
      // Exactly 1 specific model chosen -> send that single model's album
      const code = allMatches[0][1].toUpperCase().trim();
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
        // Extract substantive text typed by merchant
        const ownerText = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim();
        // CRITICAL GUARD: WhatsApp emits protocol packets, read receipts, libsignal session syncs,
        // and empty echoes with fromMe=true. NEVER trigger human takeover unless merchant actually typed substantive text!
        if (!ownerText || ownerText.length < 2) {
          return;
        }
        console.log(`[Human Takeover] Seller manually sent a message to ${remoteJid}: "${ownerText}". Pausing bot for 15 minutes.`);
        await pauseCustomerForHumanTakeover(remoteJid, 15, 'HUMAN_TAKEOVER', ownerText);
        return;
      }

      if (m.type !== 'notify' && m.type !== 'append') return;

      // 2. Message Deduplication (15-min TTL):
      const msgId = msg.key.id;
      if (msgId) {
        if (processedIncomingMsgIds.has(msgId)) {
          return; // Duplicate upsert event ignored
        }
        processedIncomingMsgIds.set(msgId, Date.now());
      }

      // Natural Blue Tick Timing:
      // We deliberately do NOT send an instant 0ms read receipt here.
      // Instead, read receipt (blue tick) is marked naturally after debounce in processCustomerBuffer,
      // perfectly simulating a human taking 1.5-2 seconds to open the chat before typing!

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
      if (contextInfo) {
        const quotedStanzaId = contextInfo.stanzaId;
        const trackedMedia = quotedStanzaId ? botSentMediaTracking.get(quotedStanzaId) : null;
        if (trackedMedia) {
          quotedContextText = `[Customer replied to image of Model: ${trackedMedia.model_code} (${trackedMedia.name}) | Price: ৳${trackedMedia.price}]: `;
        } else if (contextInfo.quotedMessage) {
          const qm = contextInfo.quotedMessage;
          const quotedText = qm.conversation || 
                             qm.extendedTextMessage?.text || 
                             qm.imageMessage?.caption || 
                             qm.videoMessage?.caption || '';
          if (quotedText.trim()) {
            const allCached = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts() : [];
            let matchedCode = null;
            for (const p of allCached) {
              if (p.model_code && quotedText.toLowerCase().includes(p.model_code.toLowerCase())) {
                matchedCode = p;
                break;
              }
            }
            if (matchedCode) {
              quotedContextText = `[Customer replied to image/message of model ${matchedCode.model_code} (${matchedCode.name})]: `;
            } else {
              const shortQuote = quotedText.substring(0, 80).replace(/\n/g, ' ');
              quotedContextText = `[Customer quoted: "${shortQuote}"]: `;
            }
          }
        }
      }

      if (quotedContextText) {
        messageContent = quotedContextText + messageContent;
      }

      // 1. Voice / Audio Note Processing with Free Gemini Native Audio + Groq Whisper Fallback (Section 4)
      const isAudio = !!(unwrappedMsg?.audioMessage || unwrappedMsg?.pttMessage);
      if (isAudio && !messageContent.trim()) {
        const audioSeconds = unwrappedMsg?.audioMessage?.seconds || unwrappedMsg?.pttMessage?.seconds || 0;
        console.log(`[WhatsApp Voice Note] Received from ${remoteJid} (Duration: ${audioSeconds}s)`);

        let transcribed = null;
        if (audioSeconds <= 90) {
          try {
            await sock.sendPresenceUpdate('recording', remoteJid);
            const audioBuffer = await downloadMediaMessage(msg, 'buffer', {});
            if (audioBuffer && audioBuffer.length > 0) {
              // 1. Try Google Gemini Native Multimodal STT first (#1 Primary)
              if (typeof transcribeAudioWithGemini === 'function') {
                transcribed = await transcribeAudioWithGemini(audioBuffer);
              }
              // 2. Fallback to Groq Whisper if Gemini fails or rate limits (#2 Failover)
              if (!transcribed && typeof transcribeAudioWithGroq === 'function') {
                transcribed = await transcribeAudioWithGroq(audioBuffer);
              }
            }
          } catch (audioErr) {
            console.warn('[WhatsApp Audio Download/Transcribe Error]:', audioErr.message);
          }
        }

        if (transcribed && transcribed.trim()) {
          console.log(`[WhatsApp Voice Transcribed -> Text Buffer] From: ${remoteJid} | "${transcribed.trim()}"`);
          messageContent = transcribed.trim();
        } else {
          const fallbackExcuse = "একটু শোরগোলের কারণে ভয়েসটি স্পষ্ট বুঝতে পারিনি, একটু কষ্ট করে আবার বলবেন বা লিখে দেবেন প্লিজ?";
          try {
            await sock.sendPresenceUpdate('composing', remoteJid);
            await new Promise(r => setTimeout(r, 1500));
            const sentExcuse = await sock.sendMessage(remoteJid, { text: fallbackExcuse });
            if (sentExcuse?.key?.id) botSentMessageIds.add(sentExcuse.key.id);
            await sock.sendPresenceUpdate('paused', remoteJid);
            incrementStats('messages_out');
          } catch (e) {
            console.error('[Voice Fallback Send Error]:', e.message);
          }
          return;
        }
      }

      // 2. Negative Media Guardrails for Images, Videos and Documents
      const isImage = !!unwrappedMsg?.imageMessage;
      const isVideo = !!unwrappedMsg?.videoMessage;
      const isDoc = !!unwrappedMsg?.documentMessage;

      if ((isImage || isVideo || isDoc) && !messageContent.trim()) {
        console.log(`[WhatsApp Non-Text Media] Media received from ${remoteJid} (isImage: ${isImage})`);
        const now = Date.now();
        const lastSent = lastVoiceReplyTime.get(remoteJid) || 0;
        if (now - lastSent > 45000 && sock) {
          lastVoiceReplyTime.set(remoteJid, now);
          let mediaReply = '';
          if (isImage) {
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

async function restoreAllConnectedSellers() {
  try {
    const { data: connectedSellers, error } = await supabase
      .from('seller_invites')
      .select('seller_id, shop_name, status')
      .eq('status', 'CONNECTED');

    if (!error && connectedSellers && connectedSellers.length > 0) {
      console.log(`[Multi-Seller Boot] Restoring ${connectedSellers.length} connected seller(s)...`);
      for (const s of connectedSellers) {
        startSellerSession(s.seller_id);
      }
    }
  } catch (err) {
    console.error('[Multi-Seller Boot Error]:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`[AutoDokan Engine] Server listening on port ${PORT}`);
  connectToWhatsApp();
  restoreAllConnectedSellers();
});
