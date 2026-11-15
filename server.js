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
    
    // CSV Header row with distinct Model Code column
    let csv = '\uFEFFOrder ID,Date Time,Model Code,Phone Number,Customer Name,Address,Product Details,Size/Length,Total BDT,Payment Mode,TrxID/Last4,Status\r\n';
    
    (orders || []).forEach(o => {
      const cleanDetails = (o.product_details || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      const cleanAddress = (o.address || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      const cleanName = (o.customer_name || '').replace(/"/g, '""');
      const dateStr = new Date(o.created_at).toLocaleString('en-GB');

      csv += `"#${o.id}","${dateStr}","${o.model_code || ''}","${o.customer_phone || ''}","${cleanName}","${cleanAddress}","${cleanDetails}","${o.length_size || ''}","${o.total_bdt || ''}","${o.payment_method || 'COD'}","${o.trx_id_or_last4 || ''}","${o.status || 'Pending'}"\r\n`;
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
  const { model_code, name, fabric, price, sizes, hijab_included } = req.body;
  if (name && price) {
    await supabase.from('products').insert({
      model_code: model_code ? model_code.toUpperCase().trim() : 'DF-' + Math.floor(Math.random() * 899 + 100),
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included !== 'false',
      in_stock: true
    });
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Update Existing Product API
app.post('/api/products/:id/update', async (req, res) => {
  const { id } = req.params;
  const { model_code, name, fabric, price, sizes, hijab_included } = req.body;
  if (id && name && price) {
    await supabase.from('products').update({
      model_code: model_code ? model_code.toUpperCase().trim() : undefined,
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === 'true' || hijab_included === true
    }).eq('id', id);
    await refreshProductsFromDB();
  }
  res.redirect('/dashboard#products');
});

// Delete Product API
app.post('/api/products/:id/delete', async (req, res) => {
  const { id } = req.params;
  if (id) {
    await supabase.from('products').delete().eq('id', id);
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

// Unified Master Dashboard (Executive F-Commerce Command Center for Dawah Fashion)
app.get('/dashboard', async (req, res) => {
  const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false });
  const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });

  const totalOrders = orders ? orders.length : 0;
  const pendingOrders = orders ? orders.filter(o => o.status === 'Pending').length : 0;
  const approvedOrders = orders ? orders.filter(o => o.status === 'Approved').length : 0;
  const shippedOrders = orders ? orders.filter(o => o.status === 'Shipped').length : 0;
  const cancelledOrders = orders ? orders.filter(o => o.status === 'Cancelled').length : 0;
  const totalProducts = products ? products.length : 0;
  const inStockProducts = products ? products.filter(p => p.in_stock).length : 0;
  const totalRevenue = (orders || []).filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + (Number(o.total_bdt) || 2200), 0);

  const orderRows = (orders || []).map(o => {
    const courierData = `কাস্টমার: ${o.customer_name || 'কাস্টমার'}\\nফোন: ${o.customer_phone || ''}\\nঠিকানা: ${o.address || ''}\\nপ্রোডাক্ট: ${o.product_details || ''} (সাইজ: ${o.length_size || 'স্ট্যান্ডার্ড'})\\nকালেকশন: ৳${o.total_bdt || 2200}\\nপেমেন্ট: ${o.payment_method || 'COD'}`;
    const searchMeta = `${o.id} ${o.customer_name || ''} ${o.customer_phone || ''} ${o.address || ''} ${o.product_details || ''}`.toLowerCase();

    return `
    <tr class="order-table-row border-b border-stone-100 hover:bg-amber-50/30 transition" data-status="${o.status || 'Pending'}" data-search="${searchMeta}">
      <td class="p-3.5 font-bold text-stone-400 text-xs">#${o.id}</td>
      <td class="p-3.5">
        <div class="font-extrabold text-stone-900 text-sm">${o.customer_name || 'কাস্টমার'}</div>
        <div class="flex items-center gap-2 mt-1">
          <a href="https://wa.me/${o.customer_phone}" target="_blank" class="text-xs text-amber-800 hover:text-amber-900 hover:underline inline-flex items-center gap-1 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
            <span>+${o.customer_phone}</span>
            <svg class="w-3 h-3 text-emerald-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z"/></svg>
          </a>
          <button onclick="copyCourierData('${courierData}')" title="স্টেডফাস্ট বা পাঠাও কুরিয়ারের জন্য কপি করুন" class="text-[11px] bg-stone-100 hover:bg-stone-200 text-stone-700 px-2 py-0.5 rounded border border-stone-300 font-semibold transition cursor-pointer">
            📋 কুরিয়ার কপি
          </button>
        </div>
      </td>
      <td class="p-3.5 text-stone-600 text-xs max-w-xs leading-relaxed">
        ${o.address ? `<div class="bg-stone-50/80 p-2 rounded-lg border border-stone-200">${o.address}</div>` : '<span class="text-stone-400 italic">ঠিকানা এখনও পাওয়া যায়নি</span>'}
      </td>
      <td class="p-3.5 text-stone-800 text-xs">
        <div class="flex items-center gap-1.5 mb-1 flex-wrap">
          ${o.model_code ? `<span class="bg-amber-100 text-amber-950 font-mono font-extrabold text-[11px] px-2 py-0.5 rounded border border-amber-300 shadow-2xs">${o.model_code}</span>` : '<span class="bg-stone-100 text-stone-500 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-stone-200">SKU N/A</span>'}
          <span class="font-extrabold text-stone-900">${o.product_details || '-'}</span>
        </div>
        ${o.length_size ? `<div class="text-[11px] text-stone-600">সাইজ: <span class="font-extrabold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-300">${o.length_size}</span></div>` : ''}
      </td>
      <td class="p-3.5 text-xs">
        <div class="font-black text-amber-900 text-sm">৳${o.total_bdt || 2200}</div>
        <div class="text-[11px] text-stone-500 font-semibold">${o.payment_method || 'COD'}${o.trx_id_or_last4 ? ` (${o.trx_id_or_last4})` : ''}</div>
      </td>
      <td class="p-3.5">
        <form method="POST" action="/api/orders/${o.id}/status" class="inline">
          <select name="status" onchange="this.form.submit()" class="text-xs px-2.5 py-1.5 rounded-lg border font-black cursor-pointer transition shadow-xs outline-none ${
            o.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 
            o.status === 'Shipped' ? 'bg-sky-50 text-sky-800 border-sky-300' : 
            o.status === 'Cancelled' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-300'
          }">
            <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
            <option value="Approved" ${o.status === 'Approved' ? 'selected' : ''}>✅ Approved</option>
            <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 Shipped</option>
            <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ Cancelled</option>
          </select>
        </form>
      </td>
      <td class="p-3.5 text-xs text-stone-400 font-medium whitespace-nowrap">${new Date(o.created_at).toLocaleString('bn-BD')}</td>
    </tr>
    `;
  }).join('');

  const productRows = (products || []).map(p => `
    <tr class="border-b border-stone-100 hover:bg-amber-50/20 transition">
      <td class="p-3.5">
        <span class="font-mono font-black text-xs px-2.5 py-1 rounded-md bg-stone-100 text-stone-900 border border-stone-300 shadow-2xs">
          ${p.model_code || 'DF-' + p.id}
        </span>
      </td>
      <td class="p-3.5">
        <div class="font-extrabold text-stone-900 text-sm">${p.name}</div>
        ${p.hijab_included ? '<span class="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full font-bold">ম্যাচিং হিজাব ফ্রি</span>' : ''}
      </td>
      <td class="p-3.5 text-stone-600 text-xs font-medium">${p.fabric || '-'}</td>
      <td class="p-3.5 font-black text-amber-900 text-sm">৳${p.price}</td>
      <td class="p-3.5 text-stone-600 text-xs">
        <span class="bg-stone-100 px-2.5 py-1 rounded-md border border-stone-200 font-semibold">${p.sizes || '৫০-৫৬'}</span>
      </td>
      <td class="p-3.5">
        <form method="POST" action="/api/products/${p.id}/toggle-stock" class="inline">
          <input type="hidden" name="in_stock" value="${!p.in_stock}">
          <button type="submit" class="px-3 py-1 text-xs font-extrabold rounded-full cursor-pointer transition shadow-xs ${
            p.in_stock ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100' : 'bg-rose-50 text-rose-800 border border-rose-300 hover:bg-rose-100'
          }">
            ${p.in_stock ? '● In Stock' : '○ Out of Stock'}
          </button>
        </form>
      </td>
      <td class="p-3.5 text-right space-x-2">
        <button onclick="toggleProductEdit(${p.id})" class="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-bold text-xs px-3 py-1.5 rounded-lg transition shadow-xs cursor-pointer">
          ✏️ এডিট করুন
        </button>
      </td>
    </tr>
    <!-- Collapsible Edit Drawer for Product #${p.id} -->
    <tr id="edit-product-${p.id}" class="hidden bg-[#fdfbf7] border-b border-amber-200">
      <td colspan="7" class="p-5">
        <div class="bg-white p-5 rounded-2xl border border-amber-300 shadow-md space-y-4">
          <div class="flex items-center justify-between border-b border-stone-100 pb-3">
            <h4 class="font-extrabold text-sm text-stone-800 flex items-center gap-2">
              <span>✏️ মডেল কোড (SKU), নাম, কাপড় ও মূল্য আপডেট করুন (ID: #${p.id})</span>
            </h4>
            <button onclick="toggleProductEdit(${p.id})" class="text-xs text-stone-500 hover:text-stone-800 font-bold cursor-pointer">✕ বন্ধ করুন</button>
          </div>
          <form method="POST" action="/api/products/${p.id}/update" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড (SKU)</label>
              <input type="text" name="model_code" value="${p.model_code || 'DF-' + p.id}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 font-mono font-bold text-xs p-2.5 rounded-lg focus:border-amber-500 focus:bg-white focus:outline-none transition">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">মডেলের নাম</label>
              <input type="text" name="name" value="${p.name}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:border-amber-500 focus:bg-white focus:outline-none transition">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">কাপড় / ফেব্রিক</label>
              <input type="text" name="fabric" value="${p.fabric || 'দুবাই চেরি'}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:border-amber-500 focus:bg-white focus:outline-none transition">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">মূল্য (টাকা)</label>
              <input type="number" name="price" value="${p.price}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:border-amber-500 focus:bg-white focus:outline-none transition">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">ঝুল ও বডি সাইজ</label>
              <input type="text" name="sizes" value="${p.sizes || '৫০, ৫২, ৫৪, ৫৬'}" required class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:border-amber-500 focus:bg-white focus:outline-none transition">
            </div>
            <div>
              <label class="block text-xs font-bold text-stone-700 mb-1">হিজাব ফ্রি?</label>
              <select name="hijab_included" class="w-full bg-[#fcfaf7] border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:border-amber-500 focus:bg-white focus:outline-none transition">
                <option value="true" ${p.hijab_included ? 'selected' : ''}>হ্যাঁ, হিজাব ফ্রি</option>
                <option value="false" ${!p.hijab_included ? 'selected' : ''}>না, হিজাব ছাড়া</option>
              </select>
            </div>
            <div class="sm:col-span-2 lg:col-span-6 flex items-center justify-between pt-2">
              <div class="text-xs text-stone-500 font-medium">
                * মডেল কোড বা মূল্য সেভ করার সাথে সাথে AI সেলস অ্যাসিস্ট্যান্ট রিয়েল-টাইমে আপডেট হয়ে যাবে।
              </div>
              <div class="flex items-center gap-2">
                <button type="button" onclick="toggleProductEdit(${p.id})" class="px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-100 rounded-lg transition cursor-pointer">
                  বাতিল
                </button>
                <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-5 py-2 rounded-lg shadow-sm transition cursor-pointer">
                  💾 পরিবর্তন সেভ করুন
                </button>
              </div>
            </div>
          </form>
          <!-- Delete Form -->
          <div class="border-t border-stone-100 pt-3 flex justify-end">
            <form method="POST" action="/api/products/${p.id}/delete" onsubmit="return confirm('আপনি কি নিশ্চিত এই মডেলটি মুছে ফেলতে চান?');" class="inline">
              <button type="submit" class="text-xs text-rose-600 hover:text-rose-800 font-bold hover:underline cursor-pointer">
                🗑️ এই প্রোডাক্টটি ডিলিট করুন
              </button>
            </form>
          </div>
        </div>
      </td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Dawah Fashion — Official Commerce OS</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      </style>
    </head>
    <body class="bg-[#faf7f2] text-stone-800 min-h-screen pb-16">
      <!-- Top Warm Navbar -->
      <header class="bg-white/95 backdrop-blur border-b border-[#ece5da] sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-xs">
        <div class="flex items-center gap-3.5">
          <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-600 via-orange-500 to-rose-500 flex items-center justify-center font-black text-white shadow-md shadow-amber-500/20 text-base tracking-wider">
            DF
          </div>
          <div>
            <h1 class="font-black text-xl leading-tight text-stone-900 flex items-center gap-2">
              Dawah Fashion <span class="text-[11px] bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full font-extrabold tracking-wide">Commerce OS</span>
            </h1>
            <p class="text-xs text-stone-500 font-semibold flex items-center gap-2">
              <span>দাওয়াহ ফ্যাশন • Dress with Purpose • মিরপুর, ঢাকা</span>
              <span class="text-stone-300">•</span>
              <a href="https://www.facebook.com/people/Dawah-Fashion/61574185184555/" target="_blank" class="text-amber-800 hover:underline flex items-center gap-1 font-bold">
                <svg class="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M9 8H6v4h3v12h5V12h3.642L18 8h-4V6.333C14 5.374 14.5 5 15.667 5H18V0h-3.808C10.597 0 9 1.582 9 4.615V8z"/></svg>
                <span>অফিশিয়াল FB পেজ</span>
              </a>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 bg-[#fcfaf7] px-4 py-2 rounded-full border border-[#e5dcd0] text-xs font-bold text-stone-700 shadow-2xs">
            <span class="w-2.5 h-2.5 rounded-full ${connectedNumber ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}"></span>
            <span>${connectedNumber ? '+' + connectedNumber : 'WhatsApp Disconnected'}</span>
          </div>
          <a href="/qr" class="text-xs bg-stone-900 hover:bg-black text-white px-4 py-2 rounded-xl font-bold transition shadow-xs">
            📱 QR স্ক্যান
          </a>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <!-- 5 Warm Executive Metric Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div class="bg-white p-5 rounded-2xl border border-[#ede6db] shadow-xs hover:shadow-md transition">
            <div class="flex items-center justify-between text-stone-500 text-xs font-extrabold uppercase tracking-wider">
              <span>মোট কাস্টমার / লিড</span>
              <span class="text-base">📦</span>
            </div>
            <div class="text-3xl font-black mt-2 text-stone-900">${totalOrders}</div>
          </div>
          <div class="bg-white p-5 rounded-2xl border border-[#ede6db] shadow-xs hover:shadow-md transition">
            <div class="flex items-center justify-between text-amber-800 text-xs font-extrabold uppercase tracking-wider">
              <span>পেন্ডিং অর্ডার (Pending)</span>
              <span class="text-base">⏳</span>
            </div>
            <div class="text-3xl font-black mt-2 text-amber-700">${pendingOrders}</div>
          </div>
          <div class="bg-white p-5 rounded-2xl border border-[#ede6db] shadow-xs hover:shadow-md transition">
            <div class="flex items-center justify-between text-emerald-800 text-xs font-extrabold uppercase tracking-wider">
              <span>কনফার্মড (Approved)</span>
              <span class="text-base">✅</span>
            </div>
            <div class="text-3xl font-black mt-2 text-emerald-700">${approvedOrders}</div>
          </div>
          <div class="bg-white p-5 rounded-2xl border border-[#ede6db] shadow-xs hover:shadow-md transition">
            <div class="flex items-center justify-between text-indigo-800 text-xs font-extrabold uppercase tracking-wider">
              <span>সম্ভাব্য সেলস রেভিনিউ</span>
              <span class="text-base">💰</span>
            </div>
            <div class="text-3xl font-black mt-2 text-indigo-900">৳${totalRevenue.toLocaleString('en-IN')}</div>
          </div>
          <div class="bg-white p-5 rounded-2xl border border-[#ede6db] shadow-xs hover:shadow-md transition">
            <div class="flex items-center justify-between text-rose-800 text-xs font-extrabold uppercase tracking-wider">
              <span>লাইভ স্টকে কালেকশন</span>
              <span class="text-base">👗</span>
            </div>
            <div class="text-3xl font-black mt-2 text-rose-700">${inStockProducts} / ${totalProducts}</div>
          </div>
        </div>

        <!-- Google Sheets™ Enterprise Live Sync Hub -->
        <div class="bg-gradient-to-br from-white via-[#fcfaf6] to-amber-50/60 p-6 md:p-7 rounded-2xl border border-amber-200/90 shadow-xs relative overflow-hidden">
          <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div class="space-y-2.5 max-w-3xl">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-300 px-3 py-1 rounded-full text-[11px] font-black tracking-wide uppercase shadow-2xs">
                  <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Enterprise Live Sync Active
                </span>
                <span class="text-xs font-bold text-stone-400">|</span>
                <span class="text-xs font-bold text-amber-900 bg-amber-100/70 border border-amber-300 px-2.5 py-0.5 rounded-md">
                  Google Sheets™ Live Data Stream
                </span>
              </div>
              <h2 class="text-xl font-black text-stone-900 tracking-tight">
                গুগল স্প্রেডশিটে প্রতিটি অর্ডার স্বয়ংক্রিয় রিয়েল-টাইম সিঙ্ক
              </h2>
              <p class="text-xs md:text-sm text-stone-600 leading-relaxed font-medium">
                আপনার যেকোনো গুগল স্প্রেডশিটের প্রথম ঘর <b>(Cell A1)</b> এ নিচের সিকিউর সিঙ্ক ফর্মুলাটি পেস্ট করুন। ফর্মুলাটি যুক্ত করার সাথে সাথেই আপনার স্টোরের প্রতিটি নতুন কাস্টমার অর্ডার, মডেল কোড (SKU), সাইজ, মোবাইল নম্বর ও ডেলিভারি ঠিকানা স্বয়ংক্রিয়ভাবে লাইভ শিটে সাজিয়ে যাবে। কোনো ম্যানুয়াল ডেটা এন্ট্রি প্রয়োজন নেই।
              </p>

              <!-- 3-Step Setup Guide Badges -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
                <div class="bg-white/90 border border-stone-200 p-2.5 rounded-xl flex items-center gap-2.5 shadow-2xs">
                  <span class="w-6 h-6 rounded-lg bg-amber-100 text-amber-900 font-black flex items-center justify-center text-xs shrink-0">১</span>
                  <span class="text-stone-700 font-bold">নতুন গুগল শিট খুলুন</span>
                </div>
                <div class="bg-white/90 border border-stone-200 p-2.5 rounded-xl flex items-center gap-2.5 shadow-2xs">
                  <span class="w-6 h-6 rounded-lg bg-amber-100 text-amber-900 font-black flex items-center justify-center text-xs shrink-0">২</span>
                  <span class="text-stone-700 font-bold">প্রথম সেল (A1) সিলেক্ট করুন</span>
                </div>
                <div class="bg-white/90 border border-stone-200 p-2.5 rounded-xl flex items-center gap-2.5 shadow-2xs">
                  <span class="w-6 h-6 rounded-lg bg-amber-100 text-amber-900 font-black flex items-center justify-center text-xs shrink-0">৩</span>
                  <span class="text-stone-700 font-bold">পেস্ট করে Enter চাপুন</span>
                </div>
              </div>

              <!-- Formula Box -->
              <div class="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div class="relative flex-1">
                  <code class="block w-full bg-white px-4 py-3 rounded-xl text-stone-900 text-xs md:text-sm font-mono border-2 border-amber-300/80 shadow-inner select-all overflow-x-auto whitespace-nowrap" id="sheetFormula">=IMPORTDATA("https://autodokan-engine.onrender.com/api/export-csv")</code>
                </div>
                <button onclick="navigator.clipboard.writeText(document.getElementById('sheetFormula').innerText.trim()); showToast('✅ ফর্মুলা কপি হয়েছে! গুগল শিটের A1 সেলে পেস্ট করুন।')" class="bg-stone-900 hover:bg-black text-white text-xs md:text-sm px-5 py-3 rounded-xl font-black transition shadow-md hover:shadow-lg cursor-pointer flex items-center justify-center gap-2 shrink-0">
                  <span>📋 ফর্মুলা কপি করুন</span>
                </button>
              </div>
            </div>

            <!-- Side Actions / Manual CSV -->
            <div class="flex flex-col sm:flex-row lg:flex-col gap-3 w-full lg:w-auto shrink-0 pt-2 lg:pt-0">
              <a href="/api/export-csv" class="bg-white hover:bg-stone-50 text-stone-800 border border-stone-300 px-5 py-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 transition shadow-xs">
                <span>📥 অফলাইন CSV ফাইল ডাউনলোড</span>
              </a>
              <div class="text-[11px] text-stone-500 font-medium text-center space-y-1">
                <div>⚡ লাইভ অটো-রিফ্রেশ: প্রতি ঘন্টায় গুগল ড্রাইভ অটো-আপডেট করে</div>
                <div class="text-stone-400">এক্সেল ও কুরিয়ার পোর্টালের সাথে ১০০% কম্প্যাটিবল</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Section: Live Orders with Instant Search & Status Tabs -->
        <div class="bg-white rounded-2xl border border-[#ede6db] shadow-xs overflow-hidden">
          <div class="p-5 border-b border-stone-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 class="font-black text-lg text-stone-900 flex items-center gap-2">
                <span>📦 লাইভ কাস্টমার অর্ডার ও ডেলিভারি তালিকা</span>
              </h2>
              <p class="text-xs text-stone-500 font-semibold">হোয়াটসঅ্যাপ থেকে স্বয়ংক্রিয়ভাবে ক্যাপচার করা রিয়েল-টাইম অর্ডারসমূহ</p>
            </div>
            <!-- Search & Actions -->
            <div class="flex items-center gap-3 w-full md:w-auto">
              <input type="text" id="orderSearchInput" onkeyup="filterOrders()" placeholder="🔍 নাম, ফোন বা ঠিকানা দিয়ে খুঁজুন..." class="bg-[#fcfaf7] border border-stone-300 text-stone-800 text-xs px-3.5 py-2 rounded-xl w-full md:w-64 focus:outline-none focus:border-amber-500 focus:bg-white transition">
              <button onclick="window.location.reload()" class="text-xs bg-[#fbf9f5] hover:bg-stone-100 text-stone-700 font-bold px-3.5 py-2 rounded-xl border border-stone-300 transition cursor-pointer whitespace-nowrap">
                🔄 রিফ্রেশ
              </button>
            </div>
          </div>

          <!-- Status Filter Tabs -->
          <div class="bg-[#fcfaf7] px-5 py-2.5 border-b border-stone-200 flex items-center gap-2 overflow-x-auto text-xs font-bold">
            <button onclick="setFilter('ALL')" id="tab-ALL" class="filter-tab px-3 py-1 rounded-lg bg-stone-900 text-white transition cursor-pointer">
              সবগুলো (${totalOrders})
            </button>
            <button onclick="setFilter('Pending')" id="tab-Pending" class="filter-tab px-3 py-1 rounded-lg bg-white border border-stone-300 text-amber-800 hover:bg-amber-50 transition cursor-pointer">
              ⏳ পেন্ডিং (${pendingOrders})
            </button>
            <button onclick="setFilter('Approved')" id="tab-Approved" class="filter-tab px-3 py-1 rounded-lg bg-white border border-stone-300 text-emerald-800 hover:bg-emerald-50 transition cursor-pointer">
              ✅ কনফার্মড (${approvedOrders})
            </button>
            <button onclick="setFilter('Shipped')" id="tab-Shipped" class="filter-tab px-3 py-1 rounded-lg bg-white border border-stone-300 text-sky-800 hover:bg-sky-50 transition cursor-pointer">
              🚚 শিপড (${shippedOrders})
            </button>
            <button onclick="setFilter('Cancelled')" id="tab-Cancelled" class="filter-tab px-3 py-1 rounded-lg bg-white border border-stone-300 text-rose-800 hover:bg-rose-50 transition cursor-pointer">
              ❌ বাতিল (${cancelledOrders})
            </button>
          </div>

          <!-- Table -->
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm" id="ordersTable">
              <thead class="bg-[#fbf9f5] text-stone-500 text-xs uppercase font-extrabold tracking-wider border-b border-stone-200">
                <tr>
                  <th class="p-3.5">ID</th>
                  <th class="p-3.5">কাস্টমার নাম ও ফোন</th>
                  <th class="p-3.5">ডেলিভারি ঠিকানা</th>
                  <th class="p-3.5">মডেল কোড (SKU) ও বিবরণ</th>
                  <th class="p-3.5">টাকা ও পেমেন্ট</th>
                  <th class="p-3.5">অর্ডার স্ট্যাটাস</th>
                  <th class="p-3.5">তারিখ ও সময়</th>
                </tr>
              </thead>
              <tbody id="ordersTableBody">
                ${orderRows || '<tr><td colspan="7" class="text-center py-10 text-stone-400 font-medium">এখনও কোনো অর্ডার আসেনি। WhatsApp-এ টেস্ট মেসেজ পাঠান!</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section: Product Management with Edit & Add -->
        <div id="products" class="bg-white rounded-2xl border border-[#ede6db] p-6 space-y-6 shadow-xs">
          <div class="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 class="font-black text-lg text-stone-900 flex items-center gap-2">
                <span>👗 Dawah Fashion বোরকা ও আবায়া ক্যাটালগ (${totalProducts} টি মডেল)</span>
              </h2>
              <p class="text-xs text-stone-500 font-semibold">এই মডেল ও ফিক্সড দামগুলোর ভিত্তিতে AI কাস্টমারদের সাথে রিয়েল-টাইমে সেলস সম্পন্ন করে</p>
            </div>
            <button onclick="document.getElementById('addProductCard').classList.toggle('hidden')" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-4 py-2.5 rounded-xl transition shadow-xs cursor-pointer">
              + নতুন মডেল যুক্ত করুন
            </button>
          </div>

          <!-- Add Product Form (Collapsible/Warm) -->
          <div id="addProductCard" class="hidden bg-[#fcfaf7] p-5 rounded-2xl border border-amber-200 shadow-2xs space-y-4">
            <div class="flex items-center justify-between border-b border-amber-200/60 pb-2">
              <h3 class="text-sm font-black text-amber-900">+ নতুন বোরকা বা আবায়া মডেল যুক্ত করুন</h3>
              <button onclick="document.getElementById('addProductCard').classList.add('hidden')" class="text-xs text-stone-400 hover:text-stone-700 font-bold cursor-pointer">✕ বন্ধ করুন</button>
            </div>
            <form method="POST" action="/api/add-product" class="space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label class="block text-xs font-bold text-stone-700 mb-1">মডেল কোড (SKU)</label>
                  <input type="text" name="model_code" placeholder="যেমন: DF-107" required class="w-full bg-white border border-stone-300 text-stone-900 font-mono font-bold text-xs p-2.5 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                </div>
                <div>
                  <label class="block text-xs font-bold text-stone-700 mb-1">মডেলের নাম ও কালার</label>
                  <input type="text" name="name" placeholder="যেমন: ৩-পিস নূর আবায়া (কালো)" required class="w-full bg-white border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                </div>
                <div>
                  <label class="block text-xs font-bold text-stone-700 mb-1">কাপড় / ফেব্রিক</label>
                  <input type="text" name="fabric" placeholder="যেমন: প্রিমিয়াম দুবাই চেরি" required class="w-full bg-white border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                </div>
                <div>
                  <label class="block text-xs font-bold text-stone-700 mb-1">ফিক্সড মূল্য (টাকা)</label>
                  <input type="number" name="price" placeholder="যেমন: ২৪৫০" required class="w-full bg-white border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                </div>
                <div>
                  <label class="block text-xs font-bold text-stone-700 mb-1">ঝুল ও বডি সাইজ</label>
                  <input type="text" name="sizes" value="৫০, ৫২, ৫৪, ৫৬ (বডি ৩৬-৪৬)" class="w-full bg-white border border-stone-300 text-stone-900 text-xs p-2.5 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                </div>
              </div>
              <div class="flex items-center justify-between pt-2">
                <label class="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer">
                  <input type="checkbox" name="hijab_included" value="true" checked class="rounded text-amber-600 focus:ring-amber-500">
                  <span>ম্যাচিং হিজাব সাথে একদম ফ্রি থাকবে</span>
                </label>
                <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-5 py-2.5 rounded-xl transition shadow-xs cursor-pointer">
                  + প্রোডাক্ট সেভ করুন
                </button>
              </div>
            </form>
          </div>

          <!-- Product Table with In-line Edit Support -->
          <div class="overflow-x-auto rounded-xl border border-stone-200">
            <table class="w-full text-left text-sm">
              <thead class="bg-[#fbf9f5] text-stone-500 text-xs uppercase font-extrabold tracking-wider border-b border-stone-200">
                <tr>
                  <th class="p-3.5">মডেল কোড (SKU)</th>
                  <th class="p-3.5">মডেলের নাম</th>
                  <th class="p-3.5">কাপড়</th>
                  <th class="p-3.5">মূল্য</th>
                  <th class="p-3.5">সাইজ</th>
                  <th class="p-3.5">স্টক স্ট্যাটাস</th>
                  <th class="p-3.5 text-right">একশন</th>
                </tr>
              </thead>
              <tbody>
                ${productRows}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <!-- Toast Notification Component -->
      <div id="toast" class="fixed bottom-6 right-6 bg-stone-900 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg transform translate-y-16 opacity-0 transition-all duration-300 pointer-events-none z-50"></div>

      <script>
        function toggleProductEdit(id) {
          const row = document.getElementById('edit-product-' + id);
          if (row) {
            row.classList.toggle('hidden');
          }
        }

        function showToast(msg) {
          const t = document.getElementById('toast');
          t.innerText = msg;
          t.classList.remove('translate-y-16', 'opacity-0');
          setTimeout(() => {
            t.classList.add('translate-y-16', 'opacity-0');
          }, 3000);
        }

        function copyCourierData(text) {
          navigator.clipboard.writeText(text);
          showToast('📋 কুরিয়ার এড্রেস কপি হয়েছে!');
        }

        let currentFilter = 'ALL';

        function setFilter(status) {
          currentFilter = status;
          document.querySelectorAll('.filter-tab').forEach(b => {
            b.classList.remove('bg-stone-900', 'text-white');
            b.classList.add('bg-white', 'border', 'border-stone-300');
          });
          const activeBtn = document.getElementById('tab-' + status);
          if (activeBtn) {
            activeBtn.classList.remove('bg-white', 'border', 'border-stone-300');
            activeBtn.classList.add('bg-stone-900', 'text-white');
          }
          filterOrders();
        }

        function filterOrders() {
          const query = (document.getElementById('orderSearchInput').value || '').toLowerCase().trim();
          const rows = document.querySelectorAll('.order-table-row');

          rows.forEach(r => {
            const status = r.getAttribute('data-status');
            const search = r.getAttribute('data-search') || '';

            const matchesStatus = (currentFilter === 'ALL' || status === currentFilter);
            const matchesQuery = (!query || search.includes(query));

            if (matchesStatus && matchesQuery) {
              r.style.display = '';
            } else {
              r.style.display = 'none';
            }
          });
        }
      </script>
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
                <div class="badge">● Active & Connected</div>
                <h1>WhatsApp Connected!</h1>
                <div style="font-size: 1.4rem; color: #b45309; font-weight: 800; margin: 1.25rem 0;">+\${data.number || 'Active'}</div>
                <p>আপনার বোরকা শপের WhatsApp AI বট সম্পূর্ণ সচল আছে।</p>
                <div style="margin-top: 1.5rem;">
                  <a href="/dashboard" style="background: #d97706; color: white; padding: 0.75rem 1.5rem; border-radius: 0.75rem; text-decoration: none; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(217, 119, 6, 0.2);">মাস্টার ড্যাশবোর্ডে যান ➔</a>
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
