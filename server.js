const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage, refreshProductsFromDB } = require('./borkha_brain');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentQR = null;
let connectionStatus = 'initializing';
let connectedNumber = null;
let sock = null;

const userMessageBuffers = new Map();
const DEBOUNCE_DELAY_MS = 4000;

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
app.get('/api/export-csv', async (req, res) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="autodokan_orders.csv"');
    
    // CSV Header row
    let csv = '\uFEFFOrder ID,Date Time,Phone Number,Customer Name,Address,Product Details,Size/Length,Total BDT,Payment Mode,TrxID/Last4,Status\r\n';
    
    (orders || []).forEach(o => {
      const cleanDetails = (o.product_details || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      const cleanAddress = (o.address || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      const cleanName = (o.customer_name || '').replace(/"/g, '""');
      const dateStr = new Date(o.created_at).toLocaleString('en-GB');

      csv += `"#${o.id}","${dateStr}","${o.customer_phone || ''}","${cleanName}","${cleanAddress}","${cleanDetails}","${o.length_size || ''}","${o.total_bdt || ''}","${o.payment_method || 'COD'}","${o.trx_id_or_last4 || ''}","${o.status || 'Pending'}"\r\n`;
    });

    res.send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV: ' + err.message);
  }
});

// Update Order Status API (e.g. Approved, Shipped, Cancelled)
app.post('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (id && status) {
    await supabase.from('orders').update({ status }).eq('id', id);
  }
  res.redirect('/dashboard');
});

// Add New Product API
app.post('/api/add-product', async (req, res) => {
  const { name, fabric, price, sizes } = req.body;
  if (name && price) {
    await supabase.from('products').insert({
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: true,
      in_stock: true
    });
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Toggle In-Stock Status
app.post('/api/products/:id/toggle-stock', async (req, res) => {
  const { id } = req.params;
  const { in_stock } = req.body;
  await supabase.from('products').update({ in_stock: in_stock === 'true' }).eq('id', id);
  await refreshProductsFromDB();
  res.redirect('/dashboard#products');
});

// Unified Master Dashboard (Full-Featured F-Commerce Admin Portal)
app.get('/dashboard', async (req, res) => {
  const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
  const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });

  const totalOrders = orders ? orders.length : 0;
  const pendingOrders = orders ? orders.filter(o => o.status === 'Pending').length : 0;
  const approvedOrders = orders ? orders.filter(o => o.status === 'Approved').length : 0;
  const totalProducts = products ? products.length : 0;

  const orderRows = (orders || []).map(o => `
    <tr class="border-b border-slate-700/50 hover:bg-slate-800/40 transition">
      <td class="p-3 font-semibold text-slate-300">#${o.id}</td>
      <td class="p-3">
        <div class="font-bold text-white text-sm">${o.customer_name || 'কাস্টমার'}</div>
        <a href="https://wa.me/${o.customer_phone}" target="_blank" class="text-xs text-sky-400 hover:underline flex items-center gap-1 mt-0.5">
          <span>+${o.customer_phone}</span>
          <svg class="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z"/></svg>
        </a>
      </td>
      <td class="p-3 text-slate-300 text-xs max-w-xs leading-relaxed">${o.address || '-'}</td>
      <td class="p-3 text-slate-200 text-xs">
        <span class="font-medium text-sky-300">${o.product_details || '-'}</span>
        ${o.length_size ? `<div class="text-[11px] text-slate-400 mt-0.5">সাইজ: ${o.length_size}</div>` : ''}
      </td>
      <td class="p-3 text-xs">
        <div class="font-bold text-emerald-400">৳${o.total_bdt || 2200}</div>
        <div class="text-[11px] text-slate-400">${o.payment_method || 'COD'}${o.trx_id_or_last4 ? ` (${o.trx_id_or_last4})` : ''}</div>
      </td>
      <td class="p-3">
        <form method="POST" action="/api/orders/${o.id}/status" class="inline">
          <select name="status" onchange="this.form.submit()" class="bg-slate-900 text-xs px-2.5 py-1 rounded border border-slate-700 font-semibold ${
            o.status === 'Approved' ? 'text-emerald-400 border-emerald-500/50' : 
            o.status === 'Shipped' ? 'text-blue-400 border-blue-500/50' : 
            o.status === 'Cancelled' ? 'text-rose-400 border-rose-500/50' : 'text-amber-400 border-amber-500/50'
          }">
            <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
            <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
            <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
            <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
          </select>
        </form>
      </td>
      <td class="p-3 text-xs text-slate-400">${new Date(o.created_at).toLocaleString('bn-BD')}</td>
    </tr>
  `).join('');

  const productRows = (products || []).map(p => `
    <tr class="border-b border-slate-700/50 hover:bg-slate-800/40 transition">
      <td class="p-3 font-semibold text-slate-400">#${p.id}</td>
      <td class="p-3 font-bold text-sky-300">${p.name}</td>
      <td class="p-3 text-slate-300 text-sm">${p.fabric || '-'}</td>
      <td class="p-3 font-bold text-emerald-400">৳${p.price}</td>
      <td class="p-3 text-slate-300 text-sm">${p.sizes || '৫০-৫৬'}</td>
      <td class="p-3">
        <form method="POST" action="/api/products/${p.id}/toggle-stock" class="inline">
          <input type="hidden" name="in_stock" value="${!p.in_stock}">
          <button type="submit" class="px-2.5 py-1 text-xs font-bold rounded-full cursor-pointer transition ${
            p.in_stock ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
          }">
            ${p.in_stock ? '● In Stock' : '○ Out of Stock'}
          </button>
        </form>
      </td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>AutoDokan Commerce OS - Control Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body class="bg-[#0b1120] text-slate-100 min-h-screen">
      <!-- Navbar -->
      <header class="bg-slate-900/80 backdrop-blur border-b border-slate-800 sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-sky-500/30">
            AD
          </div>
          <div>
            <h1 class="font-bold text-lg leading-tight flex items-center gap-2">
              AutoDokan <span class="text-xs bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-semibold">OS v1.0</span>
            </h1>
            <p class="text-xs text-slate-400">সেলার কন্ট্রোল প্যানেল &amp; অটোমেশন ড্যাশবোর্ড</p>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/80 text-xs">
            <span class="w-2.5 h-2.5 rounded-full ${connectedNumber ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}"></span>
            <span class="font-medium text-slate-300">${connectedNumber ? '+' + connectedNumber : 'WhatsApp Disconnected'}</span>
          </div>
          <a href="/qr" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-md font-medium border border-slate-700 transition">
            QR স্ক্যান
          </a>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <!-- Metric Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-slate-800/60 p-5 rounded-xl border border-slate-700/60 shadow-sm">
            <div class="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>মোট অর্ডার / কাস্টমার</span>
              <span class="text-sky-400">📦</span>
            </div>
            <div class="text-3xl font-extrabold mt-2 text-white">${totalOrders}</div>
          </div>
          <div class="bg-slate-800/60 p-5 rounded-xl border border-slate-700/60 shadow-sm">
            <div class="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>পেন্ডিং অর্ডার (Pending)</span>
              <span class="text-amber-400">⏳</span>
            </div>
            <div class="text-3xl font-extrabold mt-2 text-amber-400">${pendingOrders}</div>
          </div>
          <div class="bg-slate-800/60 p-5 rounded-xl border border-slate-700/60 shadow-sm">
            <div class="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>কনফার্মড অর্ডার (Approved)</span>
              <span class="text-emerald-400">✅</span>
            </div>
            <div class="text-3xl font-extrabold mt-2 text-emerald-400">${approvedOrders}</div>
          </div>
          <div class="bg-slate-800/60 p-5 rounded-xl border border-slate-700/60 shadow-sm">
            <div class="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>সক্রিয় প্রোডাক্ট সংখ্যা</span>
              <span class="text-indigo-400">👗</span>
            </div>
            <div class="text-3xl font-extrabold mt-2 text-indigo-400">${totalProducts}</div>
          </div>
        </div>

        <!-- Google Sheet Integration Highlight Banner -->
        <div class="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-900 p-6 rounded-2xl border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div class="space-y-1">
            <div class="inline-flex items-center gap-2 text-emerald-400 text-xs font-bold tracking-wide uppercase">
              <span>⚡ Google Sheets লাইভ সিঙ্ক</span>
            </div>
            <h2 class="text-lg font-bold text-white">গুগল শিটে রিয়েল-টাইম সব অর্ডার নিয়ে যান</h2>
            <p class="text-xs text-slate-300 max-w-2xl leading-relaxed">
              আপনার গুগল শিটের <b>A1</b> ঘরে নিচের ফর্মুলাটি পেস্ট করলেই সব অর্ডার স্বয়ংক্রিয়ভাবে লাইভ সাজিয়ে যাবে, কোনো এপিআই কি লাগবে না:
            </p>
            <div class="flex items-center gap-2 pt-2">
              <code class="bg-slate-950 px-3 py-1.5 rounded-lg text-emerald-300 text-xs font-mono border border-slate-800 select-all" id="sheetFormula">
                =IMPORTDATA("https://autodokan-engine.onrender.com/api/export-csv")
              </code>
              <button onclick="navigator.clipboard.writeText(document.getElementById('sheetFormula').innerText.trim()); alert('ফর্মুলা কপি হয়েছে! এবার গুগল শিটে পেস্ট করুন।')" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg font-bold transition">
                কপি করুন
              </button>
            </div>
          </div>
          <a href="/api/export-csv" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition whitespace-nowrap shadow-sm">
            📥 CSV এক্সপোর্ট ডাউনলোড
          </a>
        </div>

        <!-- Section: Live Orders -->
        <div class="bg-slate-900/60 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
          <div class="p-5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 class="font-bold text-lg text-white flex items-center gap-2">
                <span>📦 লাইভ কাস্টমার অর্ডার তালিকা</span>
              </h2>
              <p class="text-xs text-slate-400">হোয়াটসঅ্যাপ চ্যাট থেকে স্বয়ংক্রিয়ভাবে সংরক্ষিত রিয়েল-টাইম অর্ডারসমূহ</p>
            </div>
            <button onclick="window.location.reload()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition">
              🔄 রিফ্রেশ করুন
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th class="p-3">ID</th>
                  <th class="p-3">কাস্টমার নাম ও ফোন</th>
                  <th class="p-3">ডেলিভারি ঠিকানা</th>
                  <th class="p-3">প্রোডাক্ট ও সাইজ</th>
                  <th class="p-3">টাকা ও পেমেন্ট</th>
                  <th class="p-3">অর্ডার স্ট্যাটাস</th>
                  <th class="p-3">তারিখ ও সময়</th>
                </tr>
              </thead>
              <tbody>
                ${orderRows || '<tr><td colspan="7" class="text-center py-8 text-slate-500">এখনও কোনো অর্ডার আসেনি। WhatsApp-এ টেস্ট মেসেজ পাঠান!</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section: Product Management -->
        <div id="products" class="bg-slate-900/60 rounded-2xl border border-slate-800 p-6 space-y-6 shadow-xl">
          <div>
            <h2 class="font-bold text-lg text-white flex items-center gap-2">
              <span>👗 বোরকা ক্যাটালগ ও মূল্য তালিকা</span>
            </h2>
            <p class="text-xs text-slate-400">এই প্রোডাক্ট ও দামগুলোর ভিত্তিতে AI কাস্টমারদের সাথে রিয়েল-টাইমে কথা বলবে</p>
          </div>

          <!-- Add Product Form -->
          <form method="POST" action="/api/add-product" class="bg-slate-950/50 p-5 rounded-xl border border-slate-800/80 space-y-4">
            <h3 class="text-sm font-bold text-sky-400">+ নতুন বোরকা বা মডেল যুক্ত করুন</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label class="block text-xs text-slate-400 mb-1">বোরকার নাম ও কালার</label>
                <input type="text" name="name" placeholder="যেমন: কুইন আবায়া (মেরুন)" required class="w-full bg-slate-900 border border-slate-700 text-white text-xs p-2.5 rounded-lg focus:outline-none focus:border-sky-500">
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">কাপড় / ফেব্রিক</label>
                <input type="text" name="fabric" placeholder="যেমন: প্রিমিয়াম দুবাই চেরি" required class="w-full bg-slate-900 border border-slate-700 text-white text-xs p-2.5 rounded-lg focus:outline-none focus:border-sky-500">
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">ফিক্সড মূল্য (টাকা)</label>
                <input type="number" name="price" placeholder="যেমন: ২২০০" required class="w-full bg-slate-900 border border-slate-700 text-white text-xs p-2.5 rounded-lg focus:outline-none focus:border-sky-500">
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">ঝুল সাইজ</label>
                <input type="text" name="sizes" value="৫০, ৫২, ৫৪, ৫৬" class="w-full bg-slate-900 border border-slate-700 text-white text-xs p-2.5 rounded-lg focus:outline-none focus:border-sky-500">
              </div>
            </div>
            <div class="text-right">
              <button type="submit" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-md shadow-sky-600/30">
                + প্রোডাক্ট সেভ করুন
              </button>
            </div>
          </form>

          <!-- Product Table -->
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th class="p-3">ID</th>
                  <th class="p-3">মডেলের নাম</th>
                  <th class="p-3">কাপড়</th>
                  <th class="p-3">মূল্য</th>
                  <th class="p-3">সাইজ</th>
                  <th class="p-3">স্টক স্ট্যাটাস</th>
                </tr>
              </thead>
              <tbody>
                ${productRows}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </body>
    </html>
  `);
});

// Beautiful QR Code Web UI (NO blinking, smooth polling)
app.get('/qr', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>AutoDokan - WhatsApp Connect</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
        .card { background: #1e293b; padding: 2.25rem; border-radius: 1.25rem; text-align: center; max-width: 440px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
        .qr-box { background: white; padding: 1rem; border-radius: 1rem; margin: 1.5rem auto; width: 280px; height: 280px; display: flex; align-items: center; justify-content: center; }
        .qr-box img { width: 100%; height: 100%; display: block; border-radius: 0.5rem; }
        .badge { background: #10b981; color: white; padding: 0.5rem 1.25rem; border-radius: 9999px; font-weight: bold; font-size: 0.875rem; display: inline-block; margin-bottom: 1rem; }
        h1 { margin: 0; font-size: 1.4rem; }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0; }
        .steps { text-align: left; background: #0f172a; padding: 1rem; border-radius: 0.75rem; margin-top: 1.25rem; font-size: 0.85rem; color: #cbd5e1; }
        .steps ol { margin: 0; padding-left: 1.25rem; }
        .steps li { margin-bottom: 0.4rem; }
      </style>
    </head>
    <body>
      <div class="card" id="mainCard">
        <h1 id="titleText">WhatsApp কানেক্ট করুন</h1>
        <p id="subText">আপনার ফোন দিয়ে নিচের কিউআর কোডটি স্ক্যান করুন:</p>
        
        <div class="qr-box" id="qrContainer">
          <span style="color: #64748b; font-size: 0.9rem;">QR লোড হচ্ছে...</span>
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
                <div class="badge">Active & Ready</div>
                <h1>WhatsApp Connected!</h1>
                <div style="font-size: 1.35rem; color: #38bdf8; font-weight: bold; margin: 1.25rem 0;">+\${data.number || 'Active'}</div>
                <p>আপনার বোরকা শপের WhatsApp AI বট সম্পূর্ণ সচল আছে।</p>
                <div style="margin-top: 1.5rem;">
                  <a href="/dashboard" style="background: #2563eb; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold; display: inline-block;">মাস্টার ড্যাশবোর্ডে যান ➔</a>
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

    // 5. Realistic human typing duration
    const typingDuration = Math.min(Math.max(replyText.length * 35, 2500), 5500);
    await new Promise(r => setTimeout(r, typingDuration));

    // 6. Send message
    if (sock) {
      await sock.sendMessage(remoteJid, { text: replyText });
      await sock.sendPresenceUpdate('available', remoteJid);
      console.log(`[WhatsApp Outbound Done] To: ${remoteJid}`);
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

      const messageContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!messageContent.trim()) return;

      console.log(`[WhatsApp Received Fragment] From: ${remoteJid} | "${messageContent}"`);

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

app.listen(PORT, () => {
  console.log(`[AutoDokan Engine] Server listening on port ${PORT}`);
  connectToWhatsApp();
});
