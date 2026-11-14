const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage, refreshProductsFromDB } = require('./borkha_brain');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

let currentQR = null;
let connectionStatus = 'initializing';
let connectedNumber = null;
let sock = null;

// User message buffer for smart human-like debouncing (combining multiple rapid messages)
const userMessageBuffers = new Map();
const DEBOUNCE_DELAY_MS = 4000; // 4 seconds debounce window for follow-up texts

// Health Endpoint for UptimeRobot (Keeps Render awake 24/7)
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

// Raw QR Image endpoint for smooth background updates without page reloads
app.get('/api/qr-image', async (req, res) => {
  if (!currentQR) {
    return res.status(404).send('No QR available yet');
  }
  try {
    const qrBuffer = await qrcode.toBuffer(currentQR, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Beautiful QR Code Web UI (NO blinking, NO full page reloads, smooth polling)
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
        .status-text { font-size: 0.85rem; color: #38bdf8; margin-top: 1rem; font-weight: 500; }
      </style>
    </head>
    <body>
      <div class="card" id="mainCard">
        <h1 id="titleText">WhatsApp কানেক্ট করুন</h1>
        <p id="subText">আপনার ফোন দিয়ে নিচের কিউআর কোডটি স্ক্যান করুন:</p>
        
        <div class="qr-box" id="qrContainer">
          <span style="color: #64748b; font-size: 0.9rem;">QR লোড হচ্ছে...</span>
        </div>

        <div class="status-text" id="statusMessage">সার্ভার সচল আছে, স্ক্যান করার জন্য প্রস্তুত</div>

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
        let lastQR = '';

        async function checkStatus() {
          try {
            const res = await fetch('/status');
            const data = await res.json();

            if (data.connection === 'connected') {
              document.getElementById('mainCard').innerHTML = \`
                <div class="badge">Active & Ready</div>
                <h1>WhatsApp Connected!</h1>
                <div style="font-size: 1.35rem; color: #38bdf8; font-weight: bold; margin: 1.25rem 0;">+\${data.number || 'Active'}</div>
                <p>আপনার বোরকা শপের WhatsApp AI বট সম্পূর্ণ সচল আছে। এখন কাস্টমাররা মেসেজ দিলে অটোমেটিক উত্তর এবং অর্ডার প্রসেস হবে।</p>
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

app.get('/status', (req, res) => {
  res.json({
    connection: connectionStatus,
    number: connectedNumber,
    has_qr: !!currentQR,
    supabase: !!SUPABASE_URL
  });
});

// Products Management Dashboard (Simple Web UI for friend to add/edit products)
app.get('/products', async (req, res) => {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: products } = await sb.from('products').select('*').order('id', { ascending: true });

  const productRows = (products || []).map(p => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #334155;">#${p.id}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155; font-weight: bold; color: #38bdf8;">${p.name}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155;">${p.fabric || '-'}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155; color: #10b981; font-weight: bold;">৳${p.price}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155;">${p.sizes || '৫০-৫৬'}</td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>AutoDokan - Product Management</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: white; padding: 2rem; margin: 0; }
        .container { max-width: 900px; margin: 0 auto; }
        .card { background: #1e293b; padding: 1.5rem; border-radius: 1rem; border: 1px solid #334155; margin-bottom: 2rem; }
        h1 { margin-top: 0; font-size: 1.5rem; color: #38bdf8; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { padding: 10px; background: #0f172a; color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 1rem; }
        input { background: #0f172a; border: 1px solid #334155; color: white; padding: 0.75rem; border-radius: 0.5rem; font-size: 0.9rem; }
        button { background: #2563eb; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: bold; cursor: pointer; }
        button:hover { background: #1d4ed8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h1>👗 বোরকা ক্যাটালগ ও মূল্য তালিকা</h1>
          <a href="/orders" style="color: #38bdf8; text-decoration: none; font-weight: bold;">📦 লাইভ অর্ডার দেখুন ➔</a>
        </div>

        <div class="card">
          <h2 style="font-size: 1.1rem; margin-top: 0;">নতুন বোরকা যুক্ত করুন:</h2>
          <form method="POST" action="/api/add-product">
            <div class="form-grid">
              <input type="text" name="name" placeholder="বোরকার নাম" required>
              <input type="text" name="fabric" placeholder="কাপড় (যেমন: দুবাই চেরি)" required>
              <input type="number" name="price" placeholder="মূল্য (টাকা)" required>
              <input type="text" name="sizes" placeholder="ঝুল সাইজ (যেমন: ৫০, ৫২, ৫৪)" value="৫০, ৫২, ৫৪, ৫৬">
            </div>
            <div style="margin-top: 1rem; text-align: right;">
              <button type="submit">+ সেভ করুন</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2 style="font-size: 1.1rem; margin-top: 0;">বর্তমান সক্রিয় পণ্যসমূহ:</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>বোরকার নাম</th>
                <th>কাপড় / ফেব্রিক</th>
                <th>ফিক্সড মূল্য</th>
                <th>ঝুল সাইজ</th>
              </tr>
            </thead>
            <tbody>
              ${productRows || '<tr><td colspan="5" style="text-align: center; padding: 1rem; color: #64748b;">কোনো পণ্য পাওয়া যায়নি</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/api/add-product', express.urlencoded({ extended: true }), async (req, res) => {
  const { name, fabric, price, sizes } = req.body;
  if (name && price) {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    await sb.from('products').insert({
      name,
      fabric: fabric || 'দুবাই চেরি',
      price: parseFloat(price),
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: true,
      in_stock: true
    });
    await refreshProductsFromDB();
  }
  res.redirect('/products');
});

// Live Orders Dashboard
app.get('/orders', async (req, res) => {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: orders } = await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(50);

  const orderRows = (orders || []).map(o => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #334155;">#${o.id}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155; color: #38bdf8; font-weight: bold;">${o.customer_phone}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155;">${o.product_details || '-'}</td>
      <td style="padding: 10px; border-bottom: 1px solid #334155;"><span style="background: #334155; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem;">${o.status}</span></td>
      <td style="padding: 10px; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 0.8rem;">${new Date(o.created_at).toLocaleString('bn-BD')}</td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="refresh" content="15">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>AutoDokan - Live Orders</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: white; padding: 2rem; margin: 0; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: #1e293b; padding: 1.5rem; border-radius: 1rem; border: 1px solid #334155; }
        h1 { margin-top: 0; font-size: 1.5rem; color: #10b981; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { padding: 10px; background: #0f172a; color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; }
      </style>
    </head>
    <body>
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h1>📦 লাইভ কাস্টমার অর্ডার ও লিড</h1>
          <a href="/products" style="color: #38bdf8; text-decoration: none; font-weight: bold;">👗 বোরকা ক্যাটালগ ➔</a>
        </div>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>ফোন নাম্বার</th>
                <th>কাস্টমারের মেসেজ / ডিটেইলস</th>
                <th>স্ট্যাটাস</th>
                <th>সময়</th>
              </tr>
            </thead>
            <tbody>
              ${orderRows || '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #64748b;">এখনও কোনো অর্ডার আসেনি</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

async function processBufferedUserMessages(remoteJid) {
  const userData = userMessageBuffers.get(remoteJid);
  if (!userData || !userData.messages.length) return;

  const combinedText = userData.messages.join(' \n ');
  const lastKey = userData.lastKey;
  userMessageBuffers.delete(remoteJid);

  console.log(`[WhatsApp Processing Combined] From: ${remoteJid} | Combined: "${combinedText}"`);

  try {
    // 1. Mark as read (Blue tick)
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

    // 5. Realistic human typing duration based on response length
    const typingDuration = Math.min(Math.max(replyText.length * 35, 2500), 5500);
    console.log(`[WhatsApp Human Delay] Simulating typing for ${(typingDuration / 1000).toFixed(1)}s...`);
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

      // Debounce logic: Buffer multiple messages from same user
      let userData = userMessageBuffers.get(remoteJid);
      if (!userData) {
        userData = { messages: [], timer: null, lastKey: msg.key };
        userMessageBuffers.set(remoteJid, userData);
      } else {
        clearTimeout(userData.timer);
        userData.lastKey = msg.key;
      }

      userData.messages.push(messageContent);

      // Wait 4 seconds for user to finish typing follow-ups before responding
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
