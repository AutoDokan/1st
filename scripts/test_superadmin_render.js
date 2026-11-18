const { createClient } = require('@supabase/supabase-js');
const { createSuperAdminRouter } = require('../superadmin_dashboard');
const express = require('express');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(express.json());

const router = createSuperAdminRouter({
  supabase,
  sellerStatuses: new Map(),
  sellerNumbers: new Map(),
  sellerSockets: new Map(),
  sellerQRs: new Map(),
  startSellerSession: async () => {},
  refreshProductsFromDB: async () => {},
  refreshSettingsFromDB: async () => {},
  getSellerWhatsAppInfo: () => ({ status: 'CONNECTED', number: '+8801968718838' })
});

app.use('/', router);

const server = app.listen(4899, async () => {
  try {
    const res = await fetch('http://localhost:4899/dashboard');
    const html = await res.text();
    console.log('Status code:', res.status);
    console.log('Contains AutoDokan Engine OS?', html.includes('AutoDokan Engine OS'));
    console.log('Contains deep soothing background #0d1117?', html.includes('#0d1117'));
    console.log('Contains stab-shops?', html.includes('id="stab-shops"'));
    console.log('Contains stab-orders?', html.includes('id="stab-orders"'));
    console.log('Contains stab-chats?', html.includes('id="stab-chats"'));
    console.log('Contains stab-settings?', html.includes('id="stab-settings"'));
    console.log('Contains addProductModal (should be false)?', html.includes('addProductModal'));
    console.log('Contains Dawah Fashion?', html.includes('Dawah Fashion'));
    console.log('Contains Bangla Juta?', html.includes('Bangla Juta'));
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    server.close();
    process.exit(1);
  }
});
