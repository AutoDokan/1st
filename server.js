const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage, refreshProductsFromDB, refreshSettingsFromDB, getStoreSettings, getProductByCode, getAllCachedProducts, transcribeAudioVoiceNote } = require('./borkha_brain');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
  const { inside_dhaka_fee, outside_dhaka_fee, bkash_number, nagad_number } = req.body;
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
    return res.json({ success: true });
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

// Add New Product API
app.post('/api/add-product', requireAuth, async (req, res) => {
  const { model_code, name, fabric, price, sizes, hijab_included, image_url } = req.body;
  if (name && price) {
    await supabase.from('products').insert({
      model_code: model_code ? model_code.toUpperCase().trim() : 'DF-' + Math.floor(Math.random() * 899 + 100),
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included !== 'false',
      image_url: image_url ? image_url.trim() : null,
      in_stock: true
    });
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Update Existing Product API
app.post('/api/products/:id/update', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { model_code, name, fabric, price, sizes, hijab_included, image_url } = req.body;
  if (id && name && price) {
    await supabase.from('products').update({
      model_code: model_code ? model_code.toUpperCase().trim() : undefined,
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === 'true' || hijab_included === true,
      image_url: image_url !== undefined ? (image_url ? image_url.trim() : null) : undefined
    }).eq('id', id);
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Delete Product API
app.post('/api/products/:id/delete', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (id) {
    await supabase.from('products').delete().eq('id', id);
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Toggle In-Stock Status
app.post('/api/products/:id/toggle-stock', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { in_stock } = req.body;
  await supabase.from('products').update({ in_stock: in_stock === 'true' }).eq('id', id);
  await refreshProductsFromDB();
  res.redirect('/dashboard#products');
});

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

  // Generate Mobile Order Cards (Optimized for Smartphone Screens)
  const mobileOrderCards = (orders || []).map(o => {
    const prodPrice = Number(o.total_bdt) || 2200;
    const deliveryFee = Number(o.delivery_fee) || 80;
    const isAdvancePaid = !!o.trx_id_or_last4 || (Number(o.advance_paid) > 0);
    const dueCod = Number(o.due_cod) || prodPrice;
    const isRepeat = (phoneCountMap[o.customer_phone] || 0) > 1;
    const courierData = `কাস্টমার: ${o.customer_name || 'কাস্টমার'}\nফোন: ${o.customer_phone || ''}\nঠিকানা: ${o.address || ''}\nপ্রোডাক্ট: [${o.model_code || 'DF-Model'}] ${o.product_details || ''} (সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'})\nকুরিয়ার কালেকশন (Due COD): ৳${dueCod}\nডেলিভারি চার্জ: ${isAdvancePaid ? 'অগ্রিম পেইড' : 'বকেয়া'}`;
    const searchMeta = `${o.id} ${o.model_code || ''} ${o.customer_name || ''} ${o.customer_phone || ''} ${o.address || ''} ${o.product_details || ''}`.toLowerCase();

    return `
    <div class="order-item-card bg-white rounded-2xl border border-[#ede6db] p-4 shadow-xs space-y-3 transition hover:border-amber-300" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
      <!-- Top Card Header: ID, Customer Type Badge, Live Status Select -->
      <div class="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-mono font-black text-xs text-stone-400">#${o.id}</span>
          ${isRepeat 
            ? `<span class="bg-purple-100 text-purple-900 border border-purple-300 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">🔄 রিপিট কাস্টমার</span>` 
            : `<span class="bg-blue-100 text-blue-900 border border-blue-300 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">🆕 নতুন কাস্টমার</span>`
          }
        </div>
        <!-- Instant AJAX Status Select -->
        <select onchange="updateOrderStatusLive(${o.id}, this.value, this)" class="status-select text-xs px-2.5 py-1 rounded-lg border font-black cursor-pointer transition shadow-2xs outline-none ${
          o.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 
          o.status === 'Shipped' ? 'bg-sky-50 text-sky-800 border-sky-300' : 
          o.status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
        }">
          <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
          <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
          <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
        </select>
      </div>

      <!-- Customer Name & Instant Phone / WhatsApp / Courier Actions -->
      <div>
        <div class="font-extrabold text-stone-900 text-base leading-snug">${o.customer_name || 'কাস্টমার'}</div>
        <div class="flex items-center gap-2 mt-2 flex-wrap">
          <a href="tel:${o.customer_phone}" class="text-xs bg-stone-100 hover:bg-stone-200 text-stone-800 px-2.5 py-1 rounded-lg font-bold border border-stone-200 inline-flex items-center gap-1 shadow-2xs">
            <span>📞 কল</span>
          </a>
          <a href="https://wa.me/${o.customer_phone}" target="_blank" class="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg font-bold border border-emerald-200 inline-flex items-center gap-1 shadow-2xs">
            <svg class="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z"/></svg>
            <span>+${o.customer_phone}</span>
          </a>
          <button onclick="copyCourierData('${courierData}')" class="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 px-2.5 py-1 rounded-lg font-bold border border-amber-300 shadow-2xs cursor-pointer inline-flex items-center gap-1">
            <span>📋 কুরিয়ার কপি</span>
          </button>
        </div>
      </div>

      <!-- Delivery Address -->
      <div class="bg-[#fcfaf7] p-2.5 rounded-xl border border-stone-200 text-xs text-stone-700 leading-relaxed">
        <span class="font-bold text-stone-500 text-[11px] block mb-0.5">📍 ডেলিভারি ঠিকানা:</span>
        ${o.address ? o.address : '<span class="text-stone-400 italic">ঠিকানা এখনও পাওয়া যায়নি</span>'}
      </div>

      <!-- Product & SKU -->
      <div class="bg-amber-50/40 p-2.5 rounded-xl border border-amber-200/70 text-xs space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          ${(() => {
            const mp = o.model_code ? productsMap[o.model_code.toUpperCase().trim()] : null;
            return mp && mp.image_url ? `<img src="${mp.image_url}" class="w-8 h-10 object-cover rounded-md border border-amber-300 shadow-2xs cursor-pointer hover:scale-110 transition" onclick="window.open('${mp.image_url}', '_blank')">` : '';
          })()}
          <span class="bg-amber-100 text-amber-950 font-mono font-black text-xs px-2 py-0.5 rounded border border-amber-300">${o.model_code || 'DF-101'}</span>
          <span class="font-extrabold text-stone-900">${o.product_details || 'দুবাই চেরি আবায়া'}</span>
        </div>
        ${o.length_size ? `<div class="text-[11px] text-stone-600 font-semibold">সাইজ: <span class="text-amber-900 font-black">${o.length_size}</span></div>` : ''}
      </div>

      <!-- Financials & Delivery Breakdown -->
      <div class="bg-[#faf8f5] p-3 rounded-xl border border-stone-200 space-y-2 text-xs">
        <div class="flex items-center justify-between text-stone-600">
          <span>পোশাকের মূল্য:</span>
          <span class="font-black text-stone-900">৳${prodPrice}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span>ডেলিভারি ফি:</span>
          ${isAdvancePaid 
            ? `<span class="bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded text-[10px] font-black">✅ অগ্রিম পেইড (৳${deliveryFee})</span>`
            : `<span class="bg-rose-100 text-rose-900 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-black">⏳ চার্জ বকেয়া (৳${deliveryFee})</span>`
          }
        </div>
        ${o.trx_id_or_last4 ? `<div class="text-[11px] text-stone-500 font-mono flex items-center justify-between"><span>TrxID / Last 4:</span> <span class="font-black text-stone-800">${o.trx_id_or_last4}</span></div>` : ''}
        <div class="flex items-center justify-between pt-2 border-t border-stone-200 font-black text-amber-950 text-sm">
          <span>Due COD কালেকশন:</span>
          <span class="bg-amber-100 text-amber-950 px-2.5 py-0.5 rounded-lg border border-amber-300">৳${dueCod}</span>
        </div>
      </div>

      <!-- In-Card Action & Payment Edit Accordion Trigger -->
      <div class="pt-1 flex items-center justify-between">
        <span class="text-[10px] text-stone-400 font-semibold">${new Date(o.created_at).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' })} • ${new Date(o.created_at).toLocaleDateString('bn-BD')}</span>
        <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-xs text-amber-900 font-bold hover:underline cursor-pointer">
          ✏️ ফি ও Trx এডিট
        </button>
      </div>

      <!-- In-Card Collapsible Payment Form -->
      <div id="payment-drawer-${o.id}" class="hidden bg-white p-3.5 rounded-xl border border-amber-300 shadow-sm space-y-3">
        <div class="flex items-center justify-between border-b border-stone-100 pb-1.5">
          <span class="text-xs font-black text-stone-800">পেমেন্ট ও কুরিয়ার কালেকশন এডিট</span>
          <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-stone-400 hover:text-stone-700 text-xs font-bold">✕</button>
        </div>
        <form onsubmit="savePaymentLive(event, ${o.id})" class="space-y-2 text-xs">
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
    const courierData = `কাস্টমার: ${o.customer_name || 'কাস্টমার'}\nফোন: ${o.customer_phone || ''}\nঠিকানা: ${o.address || ''}\nপ্রোডাক্ট: [${o.model_code || 'DF-Model'}] ${o.product_details || ''} (সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'})\nকুরিয়ার কালেকশন (Due COD): ৳${dueCod}\nডেলিভারি চার্জ: ${isAdvancePaid ? 'অগ্রিম পেইড' : 'বকেয়া'}`;
    const searchMeta = `${o.id} ${o.model_code || ''} ${o.customer_name || ''} ${o.customer_phone || ''} ${o.address || ''} ${o.product_details || ''}`.toLowerCase();

    return `
    <tr class="order-table-row border-b border-stone-100 hover:bg-amber-50/25 transition" data-order-id="${o.id}" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
      <td class="p-3.5 font-bold text-stone-400 text-xs font-mono">#${o.id}</td>
      <td class="p-3.5">
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-stone-900 text-sm">${o.customer_name || 'কাস্টমার'}</span>
          ${isRepeat 
            ? `<span class="bg-purple-100 text-purple-900 border border-purple-300 text-[10px] font-black px-1.5 py-0.5 rounded-full">🔄 রিপিট</span>` 
            : `<span class="bg-blue-100 text-blue-900 border border-blue-300 text-[10px] font-black px-1.5 py-0.5 rounded-full">🆕 নতুন</span>`
          }
        </div>
        <div class="flex items-center gap-2 mt-1">
          <a href="https://wa.me/${o.customer_phone}" target="_blank" class="text-xs text-amber-800 hover:underline inline-flex items-center gap-1 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
            <span>+${o.customer_phone}</span>
          </a>
          <button onclick="copyCourierData('${courierData}')" class="text-[11px] bg-stone-100 hover:bg-stone-200 text-stone-700 px-2 py-0.5 rounded border border-stone-300 font-semibold cursor-pointer">
            📋 কুরিয়ার কপি
          </button>
        </div>
      </td>
      <td class="p-3.5 text-stone-600 text-xs max-w-xs leading-relaxed">
        ${o.address ? `<div class="bg-stone-50/80 p-2 rounded-lg border border-stone-200">${o.address}</div>` : '<span class="text-stone-400 italic">ঠিকানা এখনও পাওয়া যায়নি</span>'}
      </td>
      <td class="p-3.5 text-stone-800 text-xs">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          ${(() => {
            const mp = o.model_code ? productsMap[o.model_code.toUpperCase().trim()] : null;
            return mp && mp.image_url ? `<img src="${mp.image_url}" class="w-7 h-9 object-cover rounded border border-amber-300 shadow-2xs cursor-pointer hover:scale-125 transition" onclick="window.open('${mp.image_url}', '_blank')">` : '';
          })()}
          <span class="bg-amber-100 text-amber-950 font-mono font-extrabold text-[11px] px-2 py-0.5 rounded border border-amber-300">${o.model_code || 'DF-101'}</span>
          <span class="font-extrabold text-stone-900">${o.product_details || '-'}</span>
        </div>
        ${o.length_size ? `<div class="text-[11px] text-stone-600">সাইজ: <span class="font-extrabold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-300">${o.length_size}</span></div>` : ''}
      </td>
      <td class="p-3.5 text-xs">
        <div class="font-bold text-stone-700 text-xs">ড্রেস: ৳${prodPrice}</div>
        <div class="my-1">
          ${isAdvancePaid 
            ? `<span class="bg-emerald-50 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold">✅ চার্জ পেইড (৳${deliveryFee})</span>`
            : `<span class="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-bold">⏳ ফি বাকি (৳${deliveryFee})</span>`
          }
          ${o.trx_id_or_last4 ? `<span class="text-[10px] text-stone-500 font-mono block mt-0.5">Trx: ${o.trx_id_or_last4}</span>` : ''}
        </div>
        <div class="font-black text-amber-950 text-xs bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block">
          Due COD: ৳${dueCod}
        </div>
        <button type="button" onclick="togglePaymentDrawer(${o.id})" class="text-[10px] text-amber-900 hover:underline font-bold block mt-1 cursor-pointer">
          ✏️ ফি / Trx এডিট
        </button>
      </td>
      <td class="p-3.5">
        <select onchange="updateOrderStatusLive(${o.id}, this.value, this)" class="text-xs px-2.5 py-1.5 rounded-lg border font-black cursor-pointer transition shadow-2xs outline-none ${
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
      <td class="p-3.5 text-xs text-stone-400 font-medium whitespace-nowrap">${new Date(o.created_at).toLocaleString('bn-BD')}</td>
    </tr>
    <!-- Collapsible Desktop Payment Edit Row -->
    <tr id="desktop-payment-${o.id}" class="hidden bg-[#fdfbf7] border-b border-amber-200">
      <td colspan="7" class="p-4">
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

  const productRows = (products || []).map(p => `
    <tr class="border-b border-stone-100 hover:bg-amber-50/20 transition">
      <td class="p-2.5">
        ${p.image_url ? `
          <img src="${p.image_url}" class="w-10 h-12 object-cover rounded-lg border border-amber-200 shadow-2xs hover:scale-125 transition cursor-pointer" onclick="window.open('${p.image_url}', '_blank')" title="ক্লিক করে বড় ছবি দেখুন">
        ` : `
          <div class="w-10 h-12 bg-stone-100 border border-dashed border-stone-300 rounded-lg flex items-center justify-center text-[10px] text-stone-400">
            ছবি নাই
          </div>
        `}
      </td>
      <td class="p-3">
        <span class="font-mono font-black text-xs px-2 py-0.5 rounded-md bg-stone-100 text-stone-900 border border-stone-300">
          ${p.model_code || 'DF-' + p.id}
        </span>
      </td>
      <td class="p-3">
        <div class="font-extrabold text-stone-900 text-xs">${p.name}</div>
        ${p.hijab_included ? '<span class="text-[9px] bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded font-bold">ম্যাচিং হিজাব ফ্রি</span>' : ''}
      </td>
      <td class="p-3 text-stone-600 text-xs">${p.fabric || '-'}</td>
      <td class="p-3 font-black text-amber-900 text-xs">৳${p.price}</td>
      <td class="p-3">
        <form method="POST" action="/api/products/${p.id}/toggle-stock" class="inline">
          <input type="hidden" name="in_stock" value="${!p.in_stock}">
          <button type="submit" class="px-2.5 py-0.5 text-[11px] font-extrabold rounded-full cursor-pointer transition shadow-2xs ${
            p.in_stock ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'
          }">
            ${p.in_stock ? '● In Stock' : '○ Stock Out'}
          </button>
        </form>
      </td>
      <td class="p-3 text-right">
        <button onclick="toggleProductEdit(${p.id})" class="text-amber-900 font-bold text-xs hover:underline cursor-pointer">
          ✏️ এডিট
        </button>
      </td>
    </tr>
    <tr id="edit-product-${p.id}" class="hidden bg-[#fdfbf7] border-b border-amber-200">
      <td colspan="7" class="p-4">
        <form method="POST" action="/api/products/${p.id}/update" class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div>
            <label class="block font-bold text-stone-700 mb-0.5">মডেল কোড</label>
            <input type="text" name="model_code" value="${p.model_code || 'DF-' + p.id}" required class="w-full bg-white border border-stone-300 p-2 rounded-lg font-mono font-bold">
          </div>
          <div>
            <label class="block font-bold text-stone-700 mb-0.5">মডেল নাম</label>
            <input type="text" name="name" value="${p.name}" required class="w-full bg-white border border-stone-300 p-2 rounded-lg font-bold">
          </div>
          <div>
            <label class="block font-bold text-stone-700 mb-0.5">মূল্য (টাকা)</label>
            <input type="number" name="price" value="${p.price}" required class="w-full bg-white border border-stone-300 p-2 rounded-lg font-bold">
          </div>
          <div class="sm:col-span-3">
            <label class="block font-bold text-stone-700 mb-0.5">ছবি লিংক (Image URL)</label>
            <input type="url" name="image_url" value="${p.image_url || ''}" placeholder="যেমন: https://... বা /images/products/df-101.jpg" class="w-full bg-white border border-stone-300 p-2 rounded-lg font-mono text-xs">
          </div>
          <div class="sm:col-span-3 flex justify-between items-center pt-1">
            <button type="button" onclick="toggleProductEdit(${p.id})" class="text-stone-500 font-bold hover:underline">বাতিল</button>
            <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-1.5 rounded-lg shadow-2xs">সেভ করুন</button>
          </div>
        </form>
      </td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
      <title>Dawah Fashion — Mobile Commerce OS</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        .drawer-overlay { transition: opacity 0.3s ease; }
        .drawer-content { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
      </style>
    </head>
    <body class="bg-[#faf7f2] text-stone-800 min-h-screen pb-20">
      
      <!-- Top Warm Mobile-First Header -->
      <header class="bg-white/95 backdrop-blur border-b border-[#ece5da] sticky top-0 z-40 px-4 py-3 shadow-xs">
        <div class="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <!-- Left: Brand & Status -->
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-600 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white text-sm shadow-sm">
              DF
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <h1 class="font-black text-base text-stone-900 leading-none">Dawah Fashion</h1>
                <span class="w-2 h-2 rounded-full ${connectedNumber ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}" title="${connectedNumber ? 'WhatsApp Live' : 'Offline'}"></span>
              </div>
              <p class="text-[11px] text-stone-500 font-semibold mt-0.5 flex items-center gap-1">
                <span>📱 +${connectedNumber || '8801778181418'}</span>
                <span class="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[10px]">● লাইভ অটোমেশন</span>
              </p>
            </div>
          </div>

          <!-- Right: Off-Canvas Drawer Buttons (Keeps main screen clean!) -->
          <div class="flex items-center gap-2">
            <button onclick="openDrawer('settingsDrawer')" title="ডেলিভারি চার্জ ও পেমেন্ট রুলস" class="bg-[#fcfaf7] hover:bg-stone-100 text-stone-800 px-3 py-2 rounded-xl border border-stone-300 text-xs font-black shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
              <span>⚙️</span>
              <span class="hidden sm:inline">রুলস</span>
            </button>
            <button onclick="openDrawer('catalogDrawer')" title="বোরকা ও আবায়া ক্যাটালগ" class="bg-amber-50 hover:bg-amber-100 text-amber-950 px-3 py-2 rounded-xl border border-amber-300 text-xs font-black shadow-2xs flex items-center gap-1.5 transition cursor-pointer">
              <span>👗</span>
              <span class="hidden sm:inline">ক্যাটালগ</span>
            </button>
            <a href="/qr" class="bg-stone-900 hover:bg-black text-white px-3 py-2 rounded-xl text-xs font-bold shadow-2xs transition">
              <span>QR</span>
            </a>
            <a href="/logout" title="লগআউট" class="text-stone-400 hover:text-stone-700 text-xs font-bold px-2 py-2 transition cursor-pointer">
              🔒
            </a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-5 space-y-5">
        <!-- 5 KPI Analytics Cards (Mobile 2-col, Desktop 5-col) -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <!-- Total Orders & Customer Breakdown -->
          <div class="col-span-2 sm:col-span-1 bg-white p-3.5 rounded-2xl border border-[#ede6db] shadow-xs">
            <div class="flex items-center justify-between text-stone-500 text-[11px] font-extrabold uppercase">
              <span>মোট কাস্টমার</span>
              <span>👥</span>
            </div>
            <div class="text-2xl font-black mt-1 text-stone-900" id="stat-total-orders">${totalOrders}</div>
            <div class="mt-1 flex items-center gap-1 text-[10px] font-bold">
              <span class="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200" id="stat-new-cust">🆕 ${newCustCount} নতুন</span>
              <span class="text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200" id="stat-repeat-cust">🔄 ${repeatCustCount} পুরনো</span>
            </div>
          </div>

          <!-- Pending Orders -->
          <div class="bg-white p-3.5 rounded-2xl border border-amber-200 shadow-xs">
            <div class="flex items-center justify-between text-amber-800 text-[11px] font-extrabold uppercase">
              <span>পেন্ডিং অর্ডার</span>
              <span>⏳</span>
            </div>
            <div class="text-2xl font-black mt-1 text-amber-700" id="stat-pending-orders">${pendingOrders}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">ভেরিফিকেশন বাকি</div>
          </div>

          <!-- Confirmed Orders -->
          <div class="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs">
            <div class="flex items-center justify-between text-emerald-800 text-[11px] font-extrabold uppercase">
              <span>কনফার্মড</span>
              <span>✅</span>
            </div>
            <div class="text-2xl font-black mt-1 text-emerald-700" id="stat-approved-orders">${approvedOrders + shippedOrders}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">${approvedOrders} Appr | ${shippedOrders} Ship</div>
          </div>

          <!-- Potential Revenue (Due COD) -->
          <div class="bg-white p-3.5 rounded-2xl border border-[#ede6db] shadow-xs">
            <div class="flex items-center justify-between text-indigo-800 text-[11px] font-extrabold uppercase">
              <span>সম্ভাব্য সেলস</span>
              <span>💰</span>
            </div>
            <div class="text-2xl font-black mt-1 text-indigo-900" id="stat-total-rev">৳${totalRevenue.toLocaleString('en-IN')}</div>
            <div class="text-[10px] text-stone-400 font-semibold mt-1">Due COD কালেকশন</div>
          </div>

          <!-- Message Traffic Analytics -->
          <div class="col-span-2 sm:col-span-1 bg-white p-3.5 rounded-2xl border border-[#ede6db] shadow-xs">
            <div class="flex items-center justify-between text-stone-600 text-[11px] font-extrabold uppercase">
              <span>WhatsApp ট্রাফিক</span>
              <span>💬</span>
            </div>
            <div class="text-xl font-black mt-1 text-stone-900" id="stat-msg-total">
              ${(trafficStats.messages_in || 18) + (trafficStats.messages_out || 18)} টি
            </div>
            <div class="mt-1 flex items-center gap-1.5 text-[10px] text-stone-500 font-bold flex-wrap">
              <span class="text-emerald-700 font-black" id="stat-msg-in">📥 ${trafficStats.messages_in || 18} In</span>
              <span>•</span>
              <span class="text-sky-700 font-black" id="stat-msg-out">📤 ${trafficStats.messages_out || 18} Out</span>
              <span>•</span>
              <span class="text-amber-800 font-black" id="stat-msg-conv">👥 ${trafficStats.total_conversations || 4} চ্যাট</span>
            </div>
          </div>
        </div>

        <!-- Sticky Search & Filter Bar -->
        <div class="bg-white rounded-2xl border border-[#ede6db] p-3 shadow-xs space-y-3">
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <input type="text" id="orderSearchInput" onkeyup="filterOrders()" placeholder="🔍 কাস্টমার নাম, ফোন বা ঠিকানা দিয়ে খুঁজুন..." class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-amber-500 focus:bg-white transition">
            </div>
            <a href="/api/export-csv" title="এক্সেল ডাউনলোড" class="bg-white hover:bg-stone-50 text-stone-700 font-bold px-3 py-2.5 rounded-xl border border-stone-300 text-xs flex items-center gap-1 shadow-2xs whitespace-nowrap">
              <span>📥</span>
              <span class="hidden sm:inline">এক্সেল</span>
            </a>
            <button onclick="pollLiveData(true)" title="লাইভ ডাটা সিঙ্ক" class="bg-[#fbf9f5] hover:bg-stone-100 text-stone-700 font-bold px-3 py-2.5 rounded-xl border border-stone-300 text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap">
              <span id="syncSpinner">🔄</span>
              <span class="hidden sm:inline">সিঙ্ক</span>
            </button>
          </div>

          <!-- Status Filter Pills -->
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold no-scrollbar">
            <button onclick="setFilter('ALL')" id="tab-ALL" class="filter-tab px-3 py-1.5 rounded-xl bg-stone-900 text-white whitespace-nowrap cursor-pointer transition">
              সবগুলো (<span id="count-tab-all">${totalOrders}</span>)
            </button>
            <button onclick="setFilter('Pending')" id="tab-Pending" class="filter-tab px-3 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-amber-800 whitespace-nowrap cursor-pointer transition">
              ⏳ পেন্ডিং (<span id="count-tab-pending">${pendingOrders}</span>)
            </button>
            <button onclick="setFilter('Approved')" id="tab-Approved" class="filter-tab px-3 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-emerald-800 whitespace-nowrap cursor-pointer transition">
              ✅ কনফার্মড (<span id="count-tab-approved">${approvedOrders}</span>)
            </button>
            <button onclick="setFilter('Shipped')" id="tab-Shipped" class="filter-tab px-3 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-sky-800 whitespace-nowrap cursor-pointer transition">
              🚚 শিপড (<span id="count-tab-shipped">${shippedOrders}</span>)
            </button>
            <button onclick="setFilter('Cancelled')" id="tab-Cancelled" class="filter-tab px-3 py-1.5 rounded-xl bg-[#fcfaf7] border border-stone-300 text-rose-800 whitespace-nowrap cursor-pointer transition">
              ❌ বাতিল (<span id="count-tab-cancelled">${cancelledOrders}</span>)
            </button>
          </div>
        </div>

        <!-- Orders View (Mobile Cards on Phone, Clean Table on Desktop) -->
        <div id="ordersContainer">
          <!-- Mobile Card Stream (Phones) -->
          <div class="block md:hidden space-y-3.5" id="mobileCardsStream">
            ${mobileOrderCards || '<div class="bg-white p-8 rounded-2xl border border-[#ede6db] text-center text-stone-400 font-semibold text-xs">এখনও কোনো অর্ডার আসেনি। WhatsApp-এ টেস্ট মেসেজ পাঠান!</div>'}
          </div>

          <!-- Desktop Table (Laptops & Desktops) -->
          <div class="hidden md:block bg-white rounded-2xl border border-[#ede6db] shadow-xs overflow-hidden">
            <table class="w-full text-left text-sm" id="desktopOrdersTable">
              <thead class="bg-[#fbf9f5] text-stone-500 text-xs uppercase font-extrabold tracking-wider border-b border-stone-200">
                <tr>
                  <th class="p-3.5">ID</th>
                  <th class="p-3.5">কাস্টমার নাম ও ফোন</th>
                  <th class="p-3.5">ডেলিভারি ঠিকানা</th>
                  <th class="p-3.5">মডেল SKU ও সাইজ</th>
                  <th class="p-3.5">পেমেন্ট ও Due COD</th>
                  <th class="p-3.5">স্ট্যাটাস</th>
                  <th class="p-3.5">তারিখ</th>
                </tr>
              </thead>
              <tbody id="desktopTableBody">
                ${desktopOrderRows || '<tr><td colspan="7" class="text-center py-10 text-stone-400 font-medium">কোনো অর্ডার পাওয়া যায়নি।</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      <!-- ============================================== -->
      <!-- SLIDE-OVER DRAWER 1: Settings & Delivery Rules -->
      <!-- ============================================== -->
      <div id="settingsDrawer" class="fixed inset-0 z-50 pointer-events-none opacity-0 transition-opacity duration-300">
        <!-- Backdrop -->
        <div onclick="closeDrawer('settingsDrawer')" class="absolute inset-0 bg-stone-900/50 backdrop-blur-xs"></div>
        <!-- Drawer Panel -->
        <div class="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl p-6 flex flex-col justify-between overflow-y-auto transform translate-x-full transition-transform duration-300">
          <div class="space-y-5">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 class="font-black text-base text-stone-900 flex items-center gap-2">
                  <span>⚙️ ডেলিভারি চার্জ ও পেমেন্ট রুলস</span>
                </h3>
                <p class="text-xs text-stone-500 font-medium">WhatsApp AI স্বয়ংক্রিয়ভাবে এই রেটগুলো জানাবে</p>
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
                <span class="text-[10px] text-stone-500 mt-1 block">মিরপুর, ধানমন্ডি, গুলশান ও সমগ্র ঢাকা সিটি</span>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">🚛 ঢাকার বাইরে চার্জ (টাকা)</label>
                <div class="flex items-center gap-2">
                  <span class="font-extrabold text-amber-900 text-sm">৳</span>
                  <input type="number" id="drawer_outside_fee" value="${curSettings.outside_dhaka_fee}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
                </div>
                <span class="text-[10px] text-stone-500 mt-1 block">চট্টগ্রাম, সিলেট, রাজশাহী ও সকল জেলা সদর</span>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">📱 বিকাশ পার্সোনাল / মার্চেন্ট নাম্বার</label>
                <input type="text" id="drawer_bkash" value="${curSettings.bkash_number}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-mono font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
                <span class="text-[10px] text-stone-500 mt-1 block">কাস্টমারকে এই নাম্বারে ডেলিভারি চার্জ পাঠাতে বলা হবে</span>
              </div>

              <div class="bg-[#fcfaf7] p-3.5 rounded-xl border border-stone-200">
                <label class="block text-xs font-bold text-stone-800 mb-1">📱 নগদ নাম্বার</label>
                <input type="text" id="drawer_nagad" value="${curSettings.nagad_number}" required class="w-full bg-white border border-stone-300 text-stone-900 text-sm font-mono font-bold p-2.5 rounded-lg focus:border-amber-500 outline-none">
              </div>

              <div class="pt-2">
                <button type="submit" class="w-full bg-stone-900 hover:bg-black text-white text-xs font-black py-3 rounded-xl shadow-sm transition cursor-pointer flex items-center justify-center gap-2">
                  <span>💾 পরিবর্তন সেভ করুন</span>
                </button>
              </div>
            </form>

            <!-- WhatsApp Number Management -->
            <div class="bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-2.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-stone-800">📱 সংযুক্ত WhatsApp</span>
                <span class="text-[10px] font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">সক্রিয়</span>
              </div>
              <div class="font-mono text-xs font-black text-stone-900">+${connectedNumber || '8801778181418'}</div>
              <p class="text-[10px] text-stone-500">অন্য কোনো হোয়াটসঅ্যাপ নাম্বার পরিবর্তন বা কানেক্ট করতে চান?</p>
              <button type="button" onclick="disconnectWhatsAppLive()" class="w-full text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-bold py-2 rounded-lg transition cursor-pointer">
                🔄 নাম্বার পরিবর্তন / ডিসকানেক্ট করুন
              </button>
            </div>
          </div>

          <div class="text-[11px] text-stone-400 text-center pt-6 border-t border-stone-100">
            Dawah Fashion Commerce Engine • AutoDokan 1st Edition
          </div>
        </div>
      </div>

      <!-- ============================================== -->
      <!-- SLIDE-OVER DRAWER 2: Product Catalog & SKU Hub -->
      <!-- ============================================== -->
      <div id="catalogDrawer" class="fixed inset-0 z-50 pointer-events-none opacity-0 transition-opacity duration-300">
        <!-- Backdrop -->
        <div onclick="closeDrawer('catalogDrawer')" class="absolute inset-0 bg-stone-900/50 backdrop-blur-xs"></div>
        <!-- Drawer Panel -->
        <div class="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl p-6 flex flex-col justify-between overflow-y-auto transform translate-x-full transition-transform duration-300">
          <div class="space-y-5">
            <div class="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 class="font-black text-base text-stone-900 flex items-center gap-2">
                  <span>👗 বোরকা ও আবায়া ক্যাটালগ (${totalProducts} টি মডেল)</span>
                </h3>
                <p class="text-xs text-stone-500 font-medium">মডেল কোড ও দাম পরিবর্তন করলে AI স্বয়ংক্রিয়ভাবে নতুন তথ্য বলবে</p>
              </div>
              <button onclick="closeDrawer('catalogDrawer')" class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 font-black cursor-pointer">✕</button>
            </div>

            <!-- Add Product Button & Form -->
            <div>
              <button onclick="document.getElementById('drawerAddProductCard').classList.toggle('hidden')" class="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5">
                <span>+ নতুন বোরকা মডেল যোগ করুন</span>
              </button>

              <div id="drawerAddProductCard" class="hidden mt-3 bg-[#fcfaf7] p-4 rounded-2xl border border-amber-300 space-y-3">
                <form method="POST" action="/api/add-product" class="space-y-3 text-xs">
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block font-bold text-stone-700 mb-1">মডেল কোড (SKU)</label>
                      <input type="text" name="model_code" placeholder="যেমন: DF-107" required class="w-full bg-white border border-stone-300 p-2 rounded-lg font-mono font-bold">
                    </div>
                    <div>
                      <label class="block font-bold text-stone-700 mb-1">মূল্য (টাকা)</label>
                      <input type="number" name="price" placeholder="যেমন: ২২৫০" required class="w-full bg-white border border-stone-300 p-2 rounded-lg font-bold">
                    </div>
                  </div>
                  <div>
                    <label class="block font-bold text-stone-700 mb-1">মডেলের নাম</label>
                    <input type="text" name="name" placeholder="যেমন: প্রিমিয়াম কাশ্মীরি আবায়া" required class="w-full bg-white border border-stone-300 p-2 rounded-lg font-bold">
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block font-bold text-stone-700 mb-1">কাপড় / ফেব্রিক</label>
                      <input type="text" name="fabric" value="দুবাই চেরি" required class="w-full bg-white border border-stone-300 p-2 rounded-lg">
                    </div>
                    <div>
                      <label class="block font-bold text-stone-700 mb-1">সাইজ</label>
                      <input type="text" name="sizes" value="৫০, ৫২, ৫৪, ৫৬" class="w-full bg-white border border-stone-300 p-2 rounded-lg">
                    </div>
                  </div>
                  <div>
                    <label class="block font-bold text-stone-700 mb-1">ছবি লিংক (Image URL)</label>
                    <input type="url" name="image_url" placeholder="যেমন: https://... বা ফাঁকা রাখুন" class="w-full bg-white border border-stone-300 p-2 rounded-lg font-mono text-xs">
                  </div>
                  <div class="flex items-center justify-between pt-1">
                    <label class="flex items-center gap-1.5 font-bold text-stone-700 cursor-pointer">
                      <input type="checkbox" name="hijab_included" value="true" checked class="rounded text-amber-600">
                      <span>ম্যাচিং হিজাব ফ্রি</span>
                    </label>
                    <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-2 rounded-xl shadow-2xs">
                      + সেভ করুন
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <!-- Product Table -->
            <div class="overflow-x-auto rounded-xl border border-stone-200">
              <table class="w-full text-left text-xs">
                <thead class="bg-[#fbf9f5] text-stone-500 font-extrabold uppercase border-b border-stone-200">
                  <tr>
                    <th class="p-2.5">ছবি</th>
                    <th class="p-2.5">SKU</th>
                    <th class="p-2.5">নাম</th>
                    <th class="p-2.5">ফেব্রিক</th>
                    <th class="p-2.5">মূল্য</th>
                    <th class="p-2.5">স্টক</th>
                    <th class="p-2.5 text-right">এডিট</th>
                  </tr>
                </thead>
                <tbody>
                  ${productRows}
                </tbody>
              </table>
            </div>
          </div>

          <div class="text-[11px] text-stone-400 text-center pt-6 border-t border-stone-100">
            Dawah Fashion বোরকা ক্যাটালগ রিয়েল-টাইমে আপডেট হয়
          </div>
        </div>
      </div>

      <!-- Toast Notification Bar -->
      <div id="toast" class="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-stone-900 text-white text-xs font-extrabold px-5 py-3 rounded-full shadow-2xl opacity-0 pointer-events-none transition-all duration-300 z-50 flex items-center gap-2">
        <span id="toastMsg">বার্তা সংরক্ষিত হয়েছে!</span>
      </div>

      <script>
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

        function toggleProductEdit(id) {
          const row = document.getElementById('edit-product-' + id);
          if (row) row.classList.toggle('hidden');
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
          showToast('📋 কুরিয়ার এড্রেস কপি হয়েছে!');
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
                selectElem.className = 'text-xs px-2.5 py-1.5 rounded-lg border font-black cursor-pointer transition shadow-2xs outline-none ' + (
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
              setTimeout(() => window.location.reload(), 1000);
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

          try {
            const res = await fetch('/api/settings/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                inside_dhaka_fee: inside,
                outside_dhaka_fee: outside,
                bkash_number: bkash,
                nagad_number: nagad,
                ajax: true
              })
            });
            if (res.ok) {
              showToast('⚙️ ডেলিভারি চার্জ ও বিকাশ রুলস সেভ হয়েছে! AI এখন নতুন রেট বলবে।');
              closeDrawer('settingsDrawer');
            }
          } catch (err) {
            alert('সেটিংস সেভ ব্যর্থ: ' + err.message);
          }
        }

        // Filtering
        let currentFilter = 'ALL';
        async function disconnectWhatsAppLive() {
          if (!confirm('আপনি কি নিশ্চিত বর্তমান WhatsApp নাম্বারটি পরিবর্তন বা ডিসকানেক্ট করতে চান? এর ফলে নতুন QR কোড স্ক্যান করতে হবে।')) return;
          try {
            showToast('সেশন রিসেট হচ্ছে... QR পেজে নেওয়া হচ্ছে');
            await fetch('/api/whatsapp/disconnect', { method: 'POST' });
            setTimeout(() => { window.location.href = '/qr'; }, 1500);
          } catch (e) {
            alert('এরর: ' + e.message);
          }
        }

        function setFilter(status) {
          currentFilter = status;
          document.querySelectorAll('.filter-tab').forEach(b => {
            b.classList.remove('bg-stone-900', 'text-white');
            b.classList.add('bg-[#fcfaf7]', 'border', 'border-stone-300');
          });
          const activeBtn = document.getElementById('tab-' + status);
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
            const matchesStatus = (currentFilter === 'ALL' || status === currentFilter);
            const matchesQuery = (!query || search.includes(query));
            elem.style.display = (matchesStatus && matchesQuery) ? '' : 'none';
          };

          mobileCards.forEach(applyVisibility);
          desktopRows.forEach(applyVisibility);
        }

        // Live Polling Engine (Every 7s)
        let lastOrderCount = ${totalOrders};
        async function pollLiveData(manual = false) {
          const spinner = document.getElementById('syncSpinner');
          if (spinner) spinner.classList.add('animate-spin');
          try {
            const res = await fetch('/api/live-data');
            const data = await res.json();
            if (data && data.metrics) {
              document.getElementById('stat-total-orders').innerText = data.metrics.total_orders;
              document.getElementById('stat-pending-orders').innerText = data.metrics.pending_orders;
              document.getElementById('stat-approved-orders').innerText = data.metrics.approved_orders + data.metrics.shipped_orders;
              document.getElementById('stat-total-rev').innerText = '৳' + data.metrics.total_revenue.toLocaleString('en-IN');
              document.getElementById('stat-new-cust').innerText = '🆕 ' + data.metrics.new_customers + ' নতুন';
              document.getElementById('stat-repeat-cust').innerText = '🔄 ' + data.metrics.repeat_customers + ' পুরনো';

              document.getElementById('count-tab-all').innerText = data.metrics.total_orders;
              document.getElementById('count-tab-pending').innerText = data.metrics.pending_orders;
              document.getElementById('count-tab-approved').innerText = data.metrics.approved_orders;
              document.getElementById('count-tab-shipped').innerText = data.metrics.shipped_orders;
              document.getElementById('count-tab-cancelled').innerText = data.metrics.cancelled_orders;

              if (data.traffic) {
                document.getElementById('stat-msg-total').innerText = (data.traffic.messages_in + data.traffic.messages_out) + ' টি';
                document.getElementById('stat-msg-in').innerText = '📥 ' + data.traffic.messages_in + ' In';
                document.getElementById('stat-msg-out').innerText = '📤 ' + data.traffic.messages_out + ' Out';
                document.getElementById('stat-msg-conv').innerText = '👥 ' + data.traffic.total_conversations + ' চ্যাট';
              }

              if (data.metrics.total_orders > lastOrderCount) {
                showToast('🔔 নতুন কাস্টমার অর্ডার যুক্ত হয়েছে!');
                lastOrderCount = data.metrics.total_orders;
                setTimeout(() => window.location.reload(), 1500);
              }
              if (manual) showToast('⚡ লাইভ ডাটা সিঙ্ক সম্পন্ন!');
            }
          } catch (e) {
            console.error('Polling error', e);
          } finally {
            if (spinner) spinner.classList.remove('animate-spin');
          }
        }

        setInterval(() => pollLiveData(false), 7000);
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

    // 5. Detect and extract image tags: [SEND_IMAGE:DF-XXX]
    const imageTagRegex = /\[SEND_IMAGE:\s*([A-Za-z0-9_-]+)\]/gi;
    const imageMatches = [...replyText.matchAll(imageTagRegex)];
    const cleanReplyText = replyText.replace(imageTagRegex, '').trim();

    // 6. Realistic human typing duration
    const typingDuration = Math.min(Math.max(cleanReplyText.length * 35, 2000), 5000);
    await new Promise(r => setTimeout(r, typingDuration));

    // 7. Send text reply
    if (sock && cleanReplyText) {
      await sock.sendMessage(remoteJid, { text: cleanReplyText });
      await sock.sendPresenceUpdate('available', remoteJid);
      console.log(`[WhatsApp Outbound Done] To: ${remoteJid} | Reply: "${cleanReplyText}"`);
      incrementStats('messages_out');
    }

    // 8. Send product images if requested
    if (sock && imageMatches.length > 0) {
      const sentCodes = new Set();
      for (const match of imageMatches) {
        const modelCode = match[1].toUpperCase().trim();
        if (sentCodes.has(modelCode)) continue;
        sentCodes.add(modelCode);

        let product = (typeof getProductByCode === 'function') ? getProductByCode(modelCode) : null;
        if (!product) {
          const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts() : [];
          product = allProds.find(p => p.model_code && p.model_code.toUpperCase().trim() === modelCode);
        }

        if (product && product.image_url) {
          try {
            await sock.sendPresenceUpdate('composing', remoteJid);
            await new Promise(r => setTimeout(r, 1200));

            let imageMessagePayload;
            const urlPath = product.image_url.replace(/^https?:\/\/[^\/]+/, '');
            const localFile = path.join(__dirname, 'public', urlPath);
            if (fs.existsSync(localFile)) {
              imageMessagePayload = fs.readFileSync(localFile);
            } else {
              imageMessagePayload = { url: product.image_url };
            }

            await sock.sendMessage(remoteJid, {
              image: imageMessagePayload,
              caption: `👗 *${product.name}*\n🏷️ মডেল কোড: *${product.model_code}*\n💰 মূল্য: *৳${product.price}* টাকা (হিজাব ফ্রি)\n✨ ফেব্রিক: ${product.fabric || 'দুবাই চেরি'}`
            });
            await sock.sendPresenceUpdate('available', remoteJid);
            console.log(`[WhatsApp Outbound Image Sent] Sent ${product.model_code} photo to ${remoteJid}`);
            incrementStats('messages_out');
          } catch (imgErr) {
            console.error(`[WhatsApp Image Send Error] Failed to send photo for ${modelCode}:`, imgErr.message);
          }
        } else {
          console.log(`[WhatsApp Photo Notice] No image_url found for product ${modelCode}`);
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

      let messageContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      // WhatsApp Voice Note / Audio Message Listener (Groq Whisper Turbo)
      const isAudio = !!msg.message?.audioMessage;
      if (isAudio) {
        console.log(`[WhatsApp Voice Note Received] From: ${remoteJid} | Downloading & transcribing with Groq Whisper...`);
        try {
          const audioBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { 
              logger: pino({ level: 'silent' }),
              reuploadRequest: sock.updateMediaMessage 
            }
          );

          if (audioBuffer && audioBuffer.length > 0) {
            const transcribed = await transcribeAudioVoiceNote(audioBuffer);
            if (transcribed && transcribed.trim()) {
              messageContent = transcribed.trim();
              console.log(`[WhatsApp Voice Transcribed] From: ${remoteJid} | Transcribed: "${messageContent}"`);
            }
          }
        } catch (audioErr) {
          console.error('[WhatsApp Voice Download/Transcribe Error]:', audioErr.message);
        }
      }

      if (!messageContent.trim()) {
        if (isAudio && sock) {
          try {
            await sock.sendMessage(remoteJid, {
              text: 'আসসালামু আলাইকুম! আপনার পাঠানো ভয়েস মেসেজটি নেটওয়ার্ক সমস্যার কারণে স্পষ্ট শুনতে পারিনি। আপনি কি একটু কষ্ট করে মেসেজে লিখে জানাবেন, নাকি আমি আপনাকে কল করব? 😊'
            });
          } catch (e) {}
        }
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
