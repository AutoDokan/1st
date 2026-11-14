const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { useSupabaseAuthState } = require('./supabase_adapter');
const { handleIncomingMessage } = require('./borkha_brain');

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

// Beautiful QR Code Web UI for easy mobile scanning
app.get('/qr', async (req, res) => {
  if (connectionStatus === 'connected') {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>AutoDokan - Connected</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; text-align: center; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
          .badge { background: #10b981; color: white; padding: 0.5rem 1rem; border-radius: 9999px; font-weight: bold; font-size: 0.875rem; display: inline-block; margin-bottom: 1rem; }
          h1 { margin: 0.5rem 0; font-size: 1.5rem; }
          p { color: #94a3b8; line-height: 1.5; }
          .num { font-size: 1.25rem; color: #38bdf8; font-weight: bold; margin: 1rem 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">Active & Ready</div>
          <h1>WhatsApp Connected!</h1>
          <div class="num">${connectedNumber ? '+' + connectedNumber : 'Active'}</div>
          <p>আপনার বোরকা শপের WhatsApp AI বট সম্পূর্ণ সচল আছে। কাস্টমারদের সব মেসেজে অটোমেটিক উত্তর এবং অর্ডার নেওয়া হচ্ছে।</p>
        </div>
      </body>
      </html>
    `);
  }

  if (!currentQR) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="refresh" content="3">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>AutoDokan - Loading QR</title>
        <style>
          body { font-family: sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>QR কোড জেনারেট হচ্ছে...</h2>
          <p>দয়া করে ৩ সেকেন্ড অপেক্ষা করুন (পেজ নিজে থেকেই রিফ্রেশ হবে)।</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const qrImage = await qrcode.toDataURL(currentQR);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="refresh" content="20">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>AutoDokan - Scan WhatsApp QR</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
          .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; max-width: 440px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
          .qr-img { background: white; padding: 1rem; border-radius: 0.75rem; margin: 1.5rem auto; width: 260px; height: 260px; display: block; }
          h1 { margin: 0; font-size: 1.35rem; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          .steps { text-align: left; background: #0f172a; padding: 1rem; border-radius: 0.5rem; margin-top: 1rem; font-size: 0.85rem; color: #cbd5e1; }
          .steps ol { margin: 0; padding-left: 1.25rem; }
          .steps li { margin-bottom: 0.35rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>WhatsApp কানেক্ট করুন</h1>
          <p>আপনার ফোন দিয়ে নিচের কিউআর কোডটি স্ক্যান করুন:</p>
          <img class="qr-img" src="${qrImage}" alt="WhatsApp QR Code">
          <div class="steps">
            <ol>
              <li>ফোনে <b>WhatsApp</b> অ্যাপ ওপেন করুন</li>
              <li>উপরে ৩ ডট (মেনু) ➔ <b>Linked Devices</b> এ যান</li>
              <li><b>Link a Device</b> বাটনে চাপ দিয়ে এই QR স্ক্যান করুন</li>
            </ol>
          </div>
          <p style="font-size: 0.8rem; margin-top: 1rem; color: #64748b;">(কোডটি প্রতি ২০ সেকেন্ডে অটো রিফ্রেশ হবে)</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error rendering QR code: ' + err.message);
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
    // 1. Mark as read (Blue tick)
    if (lastKey && sock) {
      await sock.readMessages([lastKey]);
    }

    // 2. Initial human reading pause (1.5 to 2.5 seconds)
    await new Promise(r => setTimeout(r, 1800));

    // 3. Show "typing..." presence
    if (sock) {
      await sock.sendPresenceUpdate('composing', remoteJid);
    }

    // 4. Generate AI reply
    const replyText = await handleIncomingMessage(remoteJid, combinedText);

    // 5. Realistic human typing duration based on response length
    // Longer text takes a few more seconds to type
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
      browser: ['AutoDokan Commerce', 'Chrome', '120.0.0']
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
