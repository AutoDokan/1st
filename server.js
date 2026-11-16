const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage, refreshProductsFromDB, refreshSettingsFromDB, getStoreSettings, getProductByCode, getAllCachedProducts } = require('./borkha_brain');
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

const userMessageBuffers = new Map();
const activeConversations = new Set();
const lastVoiceReplyTime = new Map();
const DEBOUNCE_DELAY_MS = 4000;


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

// Health Endpoint for UptimeRobot
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
  const { inside_dhaka_fee, outside_dhaka_fee, bkash_number, nagad_number, auto_followup } = req.body;
  if (auto_followup !== undefined) {
    autoFollowupEnabled = (auto_followup === 'true' || auto_followup === true);
  }
  await supabase.from('store_settings').upsert({
    id: 1,
    inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
    outside_dhaka_fee: Number(outside_dhaka_fee) || 150,
    bkash_number: (bkash_number || '01613-129192').trim(),
    nagad_number: (nagad_number || '01677-557292').trim(),
    updated_at: new Date().toISOString()
  });
  await refreshSettingsFromDB();
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, auto_followup_enabled: autoFollowupEnabled });
  }
  res.redirect('/dashboard');
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


// Direct Photo Upload API (Base64 -> Supabase Storage 'product-images')
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

    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(cloudFilename, buffer, {
        contentType: contentType || 'image/jpeg',
        upsert: true
      });

    if (error) {
      console.error('[Supabase Storage Upload Error]:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${cloudFilename}`;
    console.log(`[Image Uploaded to Supabase] Stored at: ${publicUrl}`);
    res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error('[Upload Exception]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add New Product API (supports 5 photo types: Main, Detail, Hijab, Flare, Real)
app.post('/api/add-product', requireAuth, async (req, res) => {
  const { model_code, name, fabric, price, sizes, hijab_included, image_url, hijab_image_url, detail_image_url, flare_image_url, real_image_url } = req.body;
  if (name && price) {
    await supabase.from('products').insert({
      model_code: model_code ? model_code.toUpperCase().trim() : 'DF-' + Math.floor(Math.random() * 899 + 100),
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included !== 'false',
      image_url: image_url ? image_url.trim() : null,
      hijab_image_url: hijab_image_url ? hijab_image_url.trim() : null,
      detail_image_url: detail_image_url ? detail_image_url.trim() : null,
      flare_image_url: flare_image_url ? flare_image_url.trim() : null,
      real_image_url: real_image_url ? real_image_url.trim() : null,
      in_stock: true
    });
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Update Existing Product API (supports 5 photo types: Main, Detail, Hijab, Flare, Real)
app.post('/api/products/:id/update', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { model_code, name, fabric, price, sizes, hijab_included, image_url, hijab_image_url, detail_image_url, flare_image_url, real_image_url } = req.body;
  if (id && name && price) {
    await supabase.from('products').update({
      model_code: model_code ? model_code.toUpperCase().trim() : undefined,
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === 'true' || hijab_included === true,
      image_url: image_url !== undefined ? (image_url ? image_url.trim() : null) : undefined,
      hijab_image_url: hijab_image_url !== undefined ? (hijab_image_url ? hijab_image_url.trim() : null) : undefined,
      detail_image_url: detail_image_url !== undefined ? (detail_image_url ? detail_image_url.trim() : null) : undefined,
      flare_image_url: flare_image_url !== undefined ? (flare_image_url ? flare_image_url.trim() : null) : undefined,
      real_image_url: real_image_url !== undefined ? (real_image_url ? real_image_url.trim() : null) : undefined
    }).eq('id', id);
    await refreshProductsFromDB();
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

// 1-Click Delete Order API
app.post('/api/orders/:id/delete', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (id) {
    await supabase.from('orders').delete().eq('id', id);
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, id });
  }
  res.redirect('/dashboard');
});

// Bulk Delete Orders API
app.post('/api/orders/bulk-delete', requireAuth, async (req, res) => {
  let { ids } = req.body;
  if (typeof ids === 'string') {
    ids = ids.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(ids) && ids.length > 0) {
    await supabase.from('orders').delete().in('id', ids);
  }
  if (req.headers['accept']?.includes('application/json') || req.body.ajax) {
    return res.json({ success: true, count: ids ? ids.length : 0 });
  }
  res.redirect('/dashboard');
});

// Toggle In-Stock Status
app.post('/api/products/:id/toggle-stock', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { in_stock } = req.body;
  await supabase.from('products').update({ in_stock: in_stock === 'true' }).eq('id', id);
  await refreshProductsFromDB();
  res.redirect('/dashboard#products');
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

দাওয়া ফ্যাশনের সাথে থাকার জন্য আন্তরিক ধন্যবাদ! 🌸`;
}

// Helper: Generate Polite Bengali Follow-up for Abandoned / Ghosted Leads (100% Gender-Neutral & Respectful)
function generateFollowupMessage(order) {
  const model = order.model_code;
  const nameStr = (order.customer_name && !/^(কাস্টমার|গ্রাহক|customer|unknown)$/i.test(order.customer_name.trim())) 
    ? ` ${order.customer_name.trim()}` 
    : '';

  if (model) {
    return `আসসালামু আলাইকুম${nameStr} 🌸\n\nআপনি কি আমাদের *${model}* আবায়াটি নিয়ে আর কিছু জানতে চেয়েছিলেন? আমাদের প্রতিটি মডেলের স্টক কিন্তু খুব দ্রুত শেষ হয়ে যাচ্ছে। আপনার জন্য কি সাইজটি বুক করে রাখব?\n\nসাইজ বা ফেব্রিক নিয়ে কোনো কিছু জানার থাকলে নিঃসংকোচে বলুন, আমরা সুন্দর একটি বোরকা বেছে নিতে সাহায্য করব। 🌸`;
  } else {
    return `আসসালামু আলাইকুম${nameStr} 🌸\n\nআপনি কি আমাদের বোরকা বা আবায়া কালেকশন নিয়ে আর কিছু জানতে চেয়েছিলেন? আপনার কোনো প্রশ্ন বা সাইজ নিয়ে দ্বিধা থাকলে নিঃসংকোচে জানান, আমরা সুন্দর একটি ডিজাইন বেছে দিতে সাহায্য করব। 🌸`;
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
        await sock.sendMessage(jid, {
          text: `আলহামদুলিল্লাহ! আপনার পেমেন্টটি সফলভাবে ভেরিফাই করা হয়েছে এবং অর্ডারটি কনফার্ম হয়েছে। নিচে আপনার অফিসিয়াল ডিজিটাল ক্যাশ মেমো দেওয়া হলো:\n\n${memoText}`
        });
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

    await sock.sendMessage(jid, { text: memoText });
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

    await sock.sendMessage(jid, { text: followupText });
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
      await sock.sendMessage(jid, { text: followupMsg });
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
        <button onclick="approveOrderDirect(${o.id})" class="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-black px-2 py-1 rounded block mt-1.5 text-center shadow-2xs w-full cursor-pointer">
          ✅ ১-ক্লিকে কনফার্ম
        </button>
        ` : ''}
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

  // 5 Golden Models Visual Cards Grid Generator
  const goldenProductCards = (products || []).slice(0, 5).map(p => {
    const promoText = `👗 *${p.name}* (${p.model_code})\n💰 মূল্য: *৳${p.price}* টাকা (ম্যাচিং হিজাব একদম ফ্রি)\n✨ ফেব্রিক: ${p.fabric || 'প্রিমিয়াম চেরি'}\n📏 সাইজ: ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}\n🚚 ডেলিভারি চার্জ: ঢাকার ভেতর ৳${curSettings.inside_dhaka_fee}, বাইরে ৳${curSettings.outside_dhaka_fee}\n📦 ক্যাশ অন ডেলিভারি (পার্সেল দেখে নেওয়ার সুবিধা)।\nঅর্ডার করতে সাইজ, নাম, ঠিকানা ও ফোন নাম্বার লিখে মেসেজ দিন!`.replace(/\'/g, "\\'");

    return `
    <div class="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm space-y-3 hover:border-amber-400 hover:shadow-md transition">
      <!-- Card Top: SKU, Title, Price, Stock -->
      <div class="flex items-start justify-between gap-2 border-b border-stone-100 pb-2.5">
        <div>
          <div class="flex items-center gap-2">
            <span class="bg-amber-100 text-amber-950 font-mono font-black text-xs px-2.5 py-0.5 rounded-lg border border-amber-300">${p.model_code || 'DF-101'}</span>
            <span class="text-[10px] font-black ${p.in_stock ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'} px-2 py-0.5 rounded-full">
              ${p.in_stock ? '● In Stock' : '○ Stock Out'}
            </span>
          </div>
          <h4 class="font-extrabold text-stone-900 text-sm mt-1.5 leading-snug">${p.name}</h4>
          <p class="text-[11px] text-stone-500 font-medium">ফেব্রিক: <span class="text-stone-800 font-semibold">${p.fabric || 'দুবাই চেরি'}</span> • সাইজ: ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}</p>
        </div>
        <div class="text-right whitespace-nowrap">
          <div class="font-black text-amber-900 text-base">৳${p.price}</div>
          <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">হিজাব ফ্রি</span>
        </div>
      </div>

      <!-- 5-Angle Badged Photo Strip -->
      <div>
        <div class="flex items-center justify-between text-[11px] font-bold text-stone-600 mb-1.5">
          <span>📸 ৫টি অ্যাঙ্গেল ফটো (ক্লিক করে বড় ছবি দেখুন):</span>
          <span class="text-[10px] text-amber-800 font-black">HD Badged</span>
        </div>
        <div class="grid grid-cols-5 gap-1.5">
          <!-- 1. Main -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.image_url}', '${p.model_code} - ১. মেইন ফ্রন্ট ভিউ')">
            <img src="${p.image_url}" class="w-full h-18 object-cover rounded-lg border border-amber-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Main">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">মেইন</span>
          </div>
          <!-- 2. Detail -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.detail_image_url}', '${p.model_code} - ২. নিখুঁত কারচুপি ক্লোজ-আপ')">
            <img src="${p.detail_image_url}" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Detail">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">কাজ</span>
          </div>
          <!-- 3. Hijab -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.hijab_image_url}', '${p.model_code} - ৩. ম্যাচিং প্রিমিয়াম হিজাব')">
            <img src="${p.hijab_image_url}" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Hijab">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">হিজাব</span>
          </div>
          <!-- 4. Flare -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.flare_image_url}', '${p.model_code} - ৪. ঘের ও সাইড অ্যাঙ্গেল')">
            <img src="${p.flare_image_url}" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Flare">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">ঘের</span>
          </div>
          <!-- 5. Real -->
          <div class="relative group cursor-pointer" onclick="openLightbox('${p.real_image_url}', '${p.model_code} - ৫. আনফিল্টার্ড রিয়েল ছবি')">
            <img src="${p.real_image_url}" class="w-full h-18 object-cover rounded-lg border border-stone-200 group-hover:border-amber-500 group-hover:scale-105 transition shadow-2xs" alt="Real">
            <span class="absolute bottom-0 inset-x-0 bg-stone-900/80 text-white text-[8px] font-bold text-center py-0.5 rounded-b-lg">রিয়েল</span>
          </div>
        </div>
      </div>

      <!-- Card Action Buttons -->
      <div class="pt-2 flex items-center justify-between gap-2 border-t border-stone-100">
        <button onclick="copyPromoText('${promoText}')" class="text-xs bg-[#fcfaf7] hover:bg-amber-50 text-stone-800 hover:text-amber-950 font-bold px-3 py-1.5 rounded-xl border border-stone-300 hover:border-amber-300 inline-flex items-center gap-1.5 shadow-2xs transition cursor-pointer">
          <span>📋 প্রমো টেক্সট কপি</span>
        </button>
        <button onclick="openDrawer('catalogDrawer')" class="text-xs text-amber-900 font-extrabold hover:underline cursor-pointer">
          ✏️ এডিট / ছবি আপলোড
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
            <button onclick="scrollToSection('productsHub')" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
              <span>👗</span>
              <span class="hidden md:inline">কালেকশন</span>
            </button>
            <button onclick="openDrawer('settingsDrawer')" title="ডেলিভারি চার্জ ও পেমেন্ট রুলস" class="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-bold border border-stone-700 shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
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

          <!-- Pending Screenshot / Payment Verification -->
          <div class="bg-white p-4 rounded-2xl border ${pendingVerificationOrders > 0 ? 'border-violet-400 bg-violet-50/20' : 'border-stone-200'} shadow-xs hover:border-violet-400 transition">
            <div class="flex items-center justify-between text-violet-800 text-[11px] font-extrabold uppercase">
              <span>পেমেন্ট ভেরিফাই</span>
              <span>📸</span>
            </div>
            <div class="text-2xl font-black mt-1 text-violet-700" id="stat-pending-orders">${pendingVerificationOrders}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">স্ক্রিনশট বা TrxID প্রাপ্ত</div>
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

        ${pendingVerificationOrders > 0 ? `
        <!-- Highlighted Screenshot Verification Alert Banner -->
        <div class="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-md">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl backdrop-blur-xs">
              📸
            </div>
            <div>
              <div class="font-black text-sm">নতুন ${pendingVerificationOrders}টি পেমেন্ট স্ক্রিনশট ভেরিফিকেশন অপেক্ষমাণ!</div>
              <div class="text-violet-100 text-xs">কাস্টমাররা ডেলিভারি চার্জ পরিশোধ করেছেন। চেক করে ১-ক্লিকে কনফার্ম করুন।</div>
            </div>
          </div>
          <button onclick="setFilter('Pending Verification')" class="bg-white hover:bg-violet-50 text-violet-900 font-black text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer whitespace-nowrap">
            ফিল্টার করুন ➔
          </button>
        </div>
        ` : ''}

        <!-- ============================================================== -->
        <!-- SECTION 1: 5 GOLDEN PRODUCT MODELS SHOWCASE (Interactive Grid) -->
        <!-- ============================================================== -->
        <div id="productsHub" class="bg-white rounded-3xl border border-stone-200 p-5 shadow-xs space-y-4">
          <div class="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
            <div>
              <h2 class="font-black text-base text-stone-900 flex items-center gap-2">
                <span>👗 আমাদের ৫টি এক্সক্লুসিভ বোরকা ও আবায়া কালেকশন</span>
                <span class="bg-amber-100 text-amber-900 font-mono text-[11px] px-2 py-0.5 rounded-full border border-amber-300">${totalProducts} টি মডেল</span>
              </h2>
              <p class="text-xs text-stone-500 font-medium mt-0.5">প্রতিটি মডেলের জন্য ৫টি গোল্ডেন অ্যাঙ্গেল ছবি লাইভ আছে। গ্রাহক চাইলে AI স্বয়ংক্রিয়ভাবে পাঠায়।</p>
            </div>
            <button onclick="openDrawer('catalogDrawer')" class="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5">
              <span>+ নতুন মডেল যোগ / এডিট</span>
            </button>
          </div>

          <!-- 5 Product Cards Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${goldenProductCards}
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
      <div id="settingsDrawer" class="fixed inset-0 z-50 pointer-events-none opacity-0 transition-opacity duration-300">
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
                <label class="block text-xs font-bold text-stone-800 mb-1">🚚 ঢাকার ভেতরে চার্জ (টাকা)</label>
                <div class="flex items-center gap-2">
                  <span class="font-extrabold text-amber-900 text-sm">৳</span>
                  <input type="number" id="drawer_inside_fee" value="${curSettings.inside_dhaka_fee}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
                </div>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">🚛 ঢাকার বাইরে চার্জ (টাকা)</label>
                <div class="flex items-center gap-2">
                  <span class="font-extrabold text-amber-900 text-sm">৳</span>
                  <input type="number" id="drawer_outside_fee" value="${curSettings.outside_dhaka_fee}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
                </div>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">📱 বিকাশ নাম্বার</label>
                <input type="text" id="drawer_bkash" value="${curSettings.bkash_number}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-mono font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">📱 নগদ নাম্বার</label>
                <input type="text" id="drawer_nagad" value="${curSettings.nagad_number}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-mono font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200 flex items-center justify-between">
                <div>
                  <label class="block text-xs font-bold text-stone-800">🤖 গোস্টিং অটো-রিকভারি (Auto Recovery)</label>
                  <p class="text-[11px] text-stone-500 font-medium">২ ঘণ্টা পার হলে কাস্টমারকে শালীন ফলো-আপ পাঠানো</p>
                </div>
                <input type="checkbox" id="drawer_auto_followup" ${autoFollowupEnabled ? 'checked' : ''} class="w-5 h-5 rounded accent-amber-600 cursor-pointer">
              </div>

              <button type="submit" class="w-full bg-stone-900 hover:bg-black text-white text-xs font-black py-3 rounded-xl shadow-sm transition cursor-pointer">
                💾 রুলস সেভ করুন
              </button>
            </form>
          </div>
          <div class="text-[11px] text-stone-400 text-center pt-6 border-t border-stone-100">
            Dawah Fashion Commerce OS 2.0
          </div>
        </div>
      </div>

      <!-- ============================================== -->
      <!-- SLIDE-OVER DRAWER 2: Product Catalog & SKU Hub -->
      <!-- ============================================== -->
      <div id="catalogDrawer" class="fixed inset-0 z-50 pointer-events-none opacity-0 transition-opacity duration-300">
        <div onclick="closeDrawer('catalogDrawer')" class="absolute inset-0 bg-stone-900/50 backdrop-blur-xs"></div>
        <div class="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl p-6 flex flex-col justify-between overflow-y-auto transform translate-x-full transition-transform duration-300">
          <div class="space-y-5">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 class="font-black text-base text-stone-900">👗 বোরকা ও আবায়া ক্যাটালগ ম্যানেজার</h3>
                <p class="text-xs text-stone-500 font-medium">মডেল কোড ও প্রাইজ আপডেট করুন</p>
              </div>
              <button onclick="closeDrawer('catalogDrawer')" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-black cursor-pointer">✕</button>
            </div>

            <!-- Product Cards List inside Drawer -->
            <div class="space-y-3">
              ${(products || []).map(p => `
              <div class="bg-[#fcfaf7] p-3.5 rounded-2xl border border-stone-200 flex items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                  <img src="${p.image_url}" class="w-12 h-14 object-cover rounded-xl border border-amber-300 shadow-2xs">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-mono font-black text-xs bg-amber-100 text-amber-950 px-2 py-0.5 rounded border border-amber-300">${p.model_code}</span>
                      <span class="font-extrabold text-stone-900 text-xs">${p.name}</span>
                    </div>
                    <div class="text-[11px] text-stone-500 mt-1">প্রাইজ: <span class="font-black text-stone-900">৳${p.price}</span> • সাইজ: ${p.sizes}</div>
                  </div>
                </div>
                <div class="text-right">
                  <span class="text-[10px] font-black ${p.in_stock ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'} px-2 py-0.5 rounded-full border">
                    ${p.in_stock ? 'In Stock' : 'Stock Out'}
                  </span>
                </div>
              </div>
              `).join('')}
            </div>
          </div>
          <div class="text-[11px] text-stone-400 text-center pt-6 border-t border-stone-100">
            Dawah Fashion বোরকা ক্যাটালগ
          </div>
        </div>
      </div>

      <!-- Full-Screen High-Definition Photo Lightbox Modal -->
      <div id="lightboxModal" class="fixed inset-0 z-50 hidden bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="max-w-2xl w-full flex flex-col items-center">
          <div class="w-full flex items-center justify-between text-white pb-3">
            <h4 id="lightboxTitle" class="text-sm font-black">মডেল ছবি</h4>
            <button onclick="closeLightbox()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white font-bold flex items-center justify-center cursor-pointer">✕</button>
          </div>
          <img id="lightboxImg" src="" class="max-h-[80vh] max-w-full rounded-2xl shadow-2xl border border-stone-700 object-contain">
        </div>
      </div>

      <!-- Payment Screenshot Lightbox & 1-Click Verification Modal -->
      <div id="screenshotModal" class="fixed inset-0 z-50 hidden bg-black/85 backdrop-blur-xs flex items-center justify-center p-4">
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
        // Smooth scroll helper
        function scrollToSection(id) {
          const el = document.getElementById(id);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }

        // Lightbox helper
        function openLightbox(url, title) {
          const modal = document.getElementById('lightboxModal');
          document.getElementById('lightboxImg').src = url;
          document.getElementById('lightboxTitle').innerText = title || 'বোরকা মডেল ছবি';
          modal.classList.remove('hidden');
        }
        function closeLightbox() {
          document.getElementById('lightboxModal').classList.add('hidden');
        }

        // Drawer Management
        function openDrawer(id) {
          const drawer = document.getElementById(id);
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
          drawer.classList.remove('pointer-events-auto', 'opacity-100');
          drawer.classList.add('pointer-events-none', 'opacity-0');
          const panel = drawer.querySelector('.w-full.max-w-md, .w-full.max-w-2xl');
          if (panel) {
            panel.classList.remove('translate-x-0');
            panel.classList.add('translate-x-full');
          }
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

        // Live AJAX Save Settings Rules
        async function saveSettingsLive(e) {
          e.preventDefault();
          const inside = document.getElementById('drawer_inside_fee').value;
          const outside = document.getElementById('drawer_outside_fee').value;
          const bkash = document.getElementById('drawer_bkash').value;
          const nagad = document.getElementById('drawer_nagad').value;
          const autoFollowup = document.getElementById('drawer_auto_followup') ? document.getElementById('drawer_auto_followup').checked : true;

          try {
            const res = await fetch('/api/settings/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                inside_dhaka_fee: inside,
                outside_dhaka_fee: outside,
                bkash_number: bkash,
                nagad_number: nagad,
                auto_followup: autoFollowup,
                ajax: true
              })
            });
            if (res.ok) {
              showToast('⚙️ ডেলিভারি চার্জ ও অটো-ফলোআপ রুলস সেভ হয়েছে! AI এখন নতুন নিয়মে চলবে।');
              closeDrawer('settingsDrawer');
            }
          } catch (err) {
            alert('সেটিংস সেভ ব্যর্থ: ' + err.message);
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
          document.getElementById('screenshotModal').classList.remove('hidden');
        }

        function closeScreenshotModal() {
          document.getElementById('screenshotModal').classList.add('hidden');
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

async function processBufferedUserMessages(remoteJid) {
  const userData = userMessageBuffers.get(remoteJid);
  if (!userData || !userData.messages.length) return;

  const combinedText = userData.messages.join(' \n ');
  const lastKey = userData.lastKey;
  userMessageBuffers.delete(remoteJid);

  console.log(`[WhatsApp Processing Combined] From: ${remoteJid} | Combined: "${combinedText}"`);

  try {
    // 1. Mark as read
    if (lastKey && sock) {
      await sock.readMessages([lastKey]);
    }

    // 2. Initial human reading pause (1.8s)
    await new Promise(r => setTimeout(r, 1800));

    // 3. Show "typing..." presence
    if (sock) {
      await sock.sendPresenceUpdate('composing', remoteJid);
    }

    // 4. Generate AI reply
    const replyText = await handleIncomingMessage(remoteJid, combinedText);

    // Helper to send individual WhatsApp photo with caption
    async function sendWaPhoto(url, caption) {
      if (!sock || !url) return false;
      try {
        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, 1100));
        let imagePayload;
        const urlPath = url.replace(/^https?:\/\/[^\/]+/, '');
        const localFile = path.join(__dirname, 'public', urlPath);
        if (fs.existsSync(localFile)) {
          imagePayload = fs.readFileSync(localFile);
        } else {
          imagePayload = { url: url };
        }
        await sock.sendMessage(remoteJid, {
          image: imagePayload,
          caption: caption || ''
        });
        await sock.sendPresenceUpdate('available', remoteJid);
        incrementStats('messages_out');
        return true;
      } catch (err) {
        console.error('[WhatsApp Photo Send Error]:', err.message);
        return false;
      }
    }

    // 5. Detect and extract all image tags (with complete whitespace & format resilience)
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

    // Aggressively clean ALL send tags and leaked prompt codes so customer NEVER sees raw tags
    const cleanReplyText = replyText
      .replace(/\[\s*SEND_[A-Za-z0-9_:\s-]+\s*\]/gi, '')
      .replace(/\(?(?:send|showing)\s*hi[zj]ab\s*(?:image|pic|photo)?\)?/gi, '')
      .replace(/\[?\s*(?:send|showing)\s*[a-z_]*hi[zj]ab[a-z_]*\s*[^\n\]]*\]?/gi, '')
      .replace(/\[\s*[A-Z_]+(?::[A-Za-z0-9_-]+)?\s*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // 6. Realistic human typing duration
    const typingDuration = Math.min(Math.max(cleanReplyText.length * 35, 1800), 4500);
    await new Promise(r => setTimeout(r, typingDuration));

    // 7. Send text reply
    if (sock && cleanReplyText) {
      await sock.sendMessage(remoteJid, { text: cleanReplyText });
      await sock.sendPresenceUpdate('available', remoteJid);
      console.log(`[WhatsApp Outbound Done] To: ${remoteJid} | Reply: "${cleanReplyText}"`);
      incrementStats('messages_out');
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
      const store = (typeof getStoreSettings === 'function') ? getStoreSettings() : {};
      const insideFee = store.inside_dhaka_fee || 80;
      const outsideFee = store.outside_dhaka_fee || 150;
      const hijabText = p.hijab_included ? 'ম্যাচিং হিজাব একদম ফ্রি' : 'হিজাব আলাদা';

      return `👗 *${p.name}* (${p.model_code || 'DF-101'})
💰 প্রাইজ: *৳${p.price}* টাকা (${hijabText})
✨ ফেব্রিক: ${p.fabric || 'প্রিমিয়াম দুবাই চেরি'}
📏 সাইজ (ঝুল): ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'} (বডি ফ্রি সাইজ)
──────────
🚚 ডেলিভারি চার্জ: ঢাকার ভেতর ৳${insideFee}, ঢাকার বাইরে ৳${outsideFee}
📦 সম্পূর্ণ ক্যাশ অন ডেলিভারি (পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে চেক করে নিতে পারবেন)।

✨ এই মডেলটির হিজাব, কাজের ক্লোজ-আপ বা ঘেরের আরও ছবি দেখতে চাইলে লিখে জানাতে পারেন। আর অর্ডার করতে চাইলে আপনার সাইজ ও ঠিকানা পাঠিয়ে দিন!`;
    }

    function buildProductAlbumCaption(p) {
      const store = (typeof getStoreSettings === 'function') ? getStoreSettings() : {};
      const insideFee = store.inside_dhaka_fee || 80;
      const outsideFee = store.outside_dhaka_fee || 150;
      const hijabText = p.hijab_included ? 'ম্যাচিং হিজাব একদম ফ্রি' : 'হিজাব আলাদা';

      return `👗 *${p.name}* (${p.model_code || 'DF-101'})
──────────
💰 প্রাইজ: *৳${p.price}* টাকা (${hijabText})
✨ ফেব্রিক: ${p.fabric || 'প্রিমিয়াম দুবাই চেরি'}
📏 সাইজ (ঝুল): ${p.sizes || '৫০, ৫২, ৫৪, ৫৬'} (বডি ফ্রি সাইজ)
🪡 কাজ: হাতা ও কটিতে নিখুঁত কারচুপির হ্যান্ডওয়ার্ক
──────────
🚚 ডেলিভারি চার্জ: ঢাকার ভেতর ৳${insideFee}, ঢাকার বাইরে ৳${outsideFee}
📦 সম্পূর্ণ ক্যাশ অন ডেলিভারি (পার্সেল হাতে পেয়ে ডেলিভারি ম্যানের সামনে দেখে চেক করে নিতে পারবেন)।

🛍️ অর্ডার করতে চাইলে আপনার পছন্দের *সাইজ, নাম, সম্পূর্ণ ঠিকানা (গ্রাম/এলাকা, থানা, জেলা) ও মোবাইল নাম্বার* লিখে জানিয়ে দিন।`;
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

          // Attach the complete product overview card only to the 1st photo.
          // Subsequent photos are sent without caption so WhatsApp automatically clusters them into a native Album grid.
          const msgOptions = {
            image: imagePayload,
            ...(i === 0 ? { caption: masterCaption } : {})
          };

          await sock.sendMessage(remoteJid, msgOptions);
          incrementStats('messages_out');

          // 250ms gap keeps socket reliable while triggering native WhatsApp album grouping
          if (i < photoUrls.length - 1) {
            await new Promise(r => setTimeout(r, 250));
          }
        }
        await sock.sendPresenceUpdate('available', remoteJid);
        return true;
      } catch (err) {
        console.error('[WhatsApp Album Send Error]:', err.message);
        return false;
      }
    }

    // Helper to send Catalog Overview (1 badged main front photo per model for all 5 products)
    async function sendCatalogOverview() {
      if (!sock) return false;
      try {
        const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts() : [];
        const catalogProds = allProds.slice(0, 5);
        if (catalogProds.length === 0) return false;

        const store = (typeof getStoreSettings === 'function') ? getStoreSettings() : {};
        const insideFee = store.inside_dhaka_fee || 80;
        const outsideFee = store.outside_dhaka_fee || 150;

        const masterCaption = `🌸 *দাওয়া ফ্যাশন — এক্সক্লুসিভ কালেকশন ওভারভিউ* 🌸
────────────────────
আমাদের ৫টি রানিং হট-সেলিং আবায়া ও বোরকার ছবি নিচে দেওয়া হলো। প্রতিটির ছবির ওপর মডেল কোড ও মূল্য উল্লেখ আছে।

১. *DF-101*: রয়াল ব্ল্যাক দুবাই চেরি কোটি আবায়া (৳২,৪৫০)
২. *DF-102*: অলিভ গ্রিন এলিগ্যান্ট বোরকা (৳২,২০০)
৩. *DF-103*: সি-গ্রিন কোরিয়ান চেরি ফ্রন্ট-ওপেন কাফতান (৳১,৯৫০)
৪. *DF-104*: নেভি ব্লু এ-লাইন ক্যাজুয়াল আবায়া (৳১,৬৫০)
৫. *DF-105*: মেরুন এক্সক্লুসিভ বাটারফ্লাই পার্টি বোরকা (৳২,৩০০)
────────────────────
✨ প্রতিটির সাথে ম্যাচিং প্রিমিয়াম হিজাব একদম ফ্রি!
🚚 ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${insideFee}, বাইরে ৳${outsideFee}
📦 সম্পূর্ণ ক্যাশ অন ডেলিভারি (পার্সেল দেখে নেওয়ার সুবিধা)।

👉 আপনার পছন্দের মডেল কোড বা নম্বর লিখে জানালে (যেমন: *DF-103* বা *৩ নম্বর*), সেটির সমস্ত রিয়েল ছবি ও সাইজ বিস্তারিত জানিয়ে দিচ্ছি! 💖`;

        for (let i = 0; i < catalogProds.length; i++) {
          const p = catalogProds[i];
          const url = p.image_url;
          if (!url) continue;

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

          await sock.sendMessage(remoteJid, msgOptions);
          incrementStats('messages_out');

          if (i < catalogProds.length - 1) {
            await new Promise(r => setTimeout(r, 280));
          }
        }
        await sock.sendPresenceUpdate('available', remoteJid);
        return true;
      } catch (err) {
        console.error('[WhatsApp Catalog Overview Send Error]:', err.message);
        return false;
      }
    }

    // 8. Dispatch images
    if (hasCatalogOverview) {
      // General catalog inquiry -> send 1 main image per model
      await sendCatalogOverview();
    } else {
      // Handle ALL IMAGES requested (Unified WhatsApp Album)
      for (const match of allMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          await sendProductAlbum(p);
        }
      }

      // Handle Hijab Image requested
      for (const match of hijabMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.hijab_image_url || p.image_url;
          if (url) {
            await sendWaPhoto(url, `🧕 *${p.name} - ম্যাচিং প্রিমিয়াম হিজাব*\n✨ ড্রেসের সাথে ম্যাচিং হিজাব সম্পূর্ণ ফ্রি পাচ্ছেন!`);
          }
        }
      }

      // Handle Detail Image requested
      for (const match of detailMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.detail_image_url || p.image_url;
          if (url) {
            await sendWaPhoto(url, `🔍 *${p.name} - নিখুঁত কারচুপি ও কাপড়ের ক্লোজ-আপ ভিউ*`);
          }
        }
      }

      // Handle Flare Image requested
      for (const match of flareMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.flare_image_url || p.image_url;
          if (url) {
            await sendWaPhoto(url, `✨ *${p.name} - ঘের ও সাইড অ্যাঙ্গেল ভিউ*`);
          }
        }
      }

      // Handle Real Image requested
      for (const match of realMatches) {
        const code = match[1].toUpperCase().trim();
        const p = findProd(code);
        if (p) {
          const url = p.real_image_url || p.image_url;
          if (url) {
            await sendWaPhoto(url, `📸 *${p.name} - স্বাভাবিক আলোর আনফিল্টার্ড রিয়েল ছবি*`);
          }
        }
      }

      // Handle Main Image: sends ONLY 1 MAIN BADGED PHOTO!
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

    // Inbound Message Listener with Human-Like Debounce & Typing
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe || m.type !== 'notify') return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') return;

            // WhatsApp Voice Note & Push-To-Talk (PTT) Deep Unwrapping
      let unwrappedMsg = msg.message;
      while (unwrappedMsg && (unwrappedMsg.ephemeralMessage || unwrappedMsg.viewOnceMessage || unwrappedMsg.viewOnceMessageV2 || unwrappedMsg.documentWithCaptionMessage)) {
        unwrappedMsg = unwrappedMsg.ephemeralMessage?.message || 
                       unwrappedMsg.viewOnceMessage?.message || 
                       unwrappedMsg.viewOnceMessageV2?.message || 
                       unwrappedMsg.documentWithCaptionMessage?.message;
      }

      let messageContent =
        unwrappedMsg?.conversation ||
        unwrappedMsg?.extendedTextMessage?.text ||
        '';

      // Check for media captions if main text is empty
      if (!messageContent.trim()) {
        messageContent = unwrappedMsg?.imageMessage?.caption ||
                         unwrappedMsg?.videoMessage?.caption ||
                         unwrappedMsg?.documentMessage?.caption ||
                         '';
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

      // Check if incoming is non-text media (photo, voice note, video, sticker, document)
      const hasMedia = !!(
        unwrappedMsg?.imageMessage ||
        unwrappedMsg?.audioMessage ||
        unwrappedMsg?.pttMessage ||
        unwrappedMsg?.videoMessage ||
        unwrappedMsg?.stickerMessage ||
        unwrappedMsg?.documentMessage
      );

      // If user sent media without text (or voice note/video), send polite text-only guidance
      if (hasMedia && !messageContent.trim()) {
        console.log(`[WhatsApp Non-Text Media] Media received from ${remoteJid}`);
        const now = Date.now();
        const lastSent = lastVoiceReplyTime.get(remoteJid) || 0;
        if (now - lastSent > 45000 && sock) {
          lastVoiceReplyTime.set(remoteJid, now);
          try {
            await sock.sendMessage(remoteJid, {
              text: 'আসসালামু আলাইকুম! আমাদের এই হোয়াটসঅ্যাপ নাম্বারে শুধুমাত্র লিখে মেসেজ দেওয়া যায়, কোনো ছবি, ভয়েস বা ভিডিও মেসেজ এখানে দেখা বা শোনা যায় না।\n\nঅনুগ্রহ করে আপনি যে বোরকাটি নিতে চাচ্ছেন বা যে বিষয়ে জানতে চাচ্ছেন তা লিখে মেসেজ করুন, আমরা দ্রুত ছবি ও সকল বিস্তারিত জানিয়ে সাহায্য করছি। ধন্যবাদ! 🌸'
            });
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

      let userData = userMessageBuffers.get(remoteJid);
      if (!userData) {
        userData = { messages: [], timer: null, lastKey: msg.key };
        userMessageBuffers.set(remoteJid, userData);
      } else {
        clearTimeout(userData.timer);
        userData.lastKey = msg.key;
      }

      userData.messages.push(messageContent);

      userData.timer = setTimeout(() => {
        processBufferedUserMessages(remoteJid);
      }, DEBOUNCE_DELAY_MS);
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
