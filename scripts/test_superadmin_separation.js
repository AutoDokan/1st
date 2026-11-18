const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testSuperAdmin() {
  console.log('--- TEST 1: All registered shops in seller_invites ---');
  const { data: invites } = await supabase.from('seller_invites').select('*').order('id', { ascending: true });
  console.log('Total Invites:', invites.length);
  invites.forEach(inv => {
    console.log(`- Shop: ${inv.shop_name} | Seller ID: ${inv.seller_id} | Token: ${inv.invite_token} | Phone: ${inv.phone} | Status: ${inv.status}`);
  });

  console.log('\n--- TEST 2: Products distribution per seller ---');
  const { data: prods } = await supabase.from('products').select('id, model_code, seller_id');
  const dawahProds = prods.filter(p => p.seller_id === 'autodokan_seller_1');
  const jutaProds = prods.filter(p => p.seller_id === 'seller_124a11f7');

  console.log('Dawah Fashion Products:', dawahProds.map(p => p.model_code));
  console.log('Bangla Juta Products:', jutaProds.map(p => p.model_code));

  console.log('\n--- TEST 3: Login Authentication Simulation ---');
  const DASHBOARD_PIN = '2026';
  const ADMIN_PASSWORD = '01613129192';

  function simulateLogin(identifier, password) {
    const id = (identifier || '').trim().toLowerCase();
    const pw = (password || '').trim();
    const validUsernames = ['admin', 'superadmin', 'fazle', 'owner', '01613129192', '01968718838', 'owner@dawahfashion.com'];
    const validPasswords = ['01613129192', '2026', 'admin123', ADMIN_PASSWORD, DASHBOARD_PIN].filter(Boolean);

    const isUserValid = validUsernames.includes(id) || id.includes('@') || /^[0-9+]{10,15}$/.test(id);
    const isPassValid = validPasswords.includes(pw);
    return isUserValid && isPassValid;
  }

  console.log('admin + 01613129192:', simulateLogin('admin', '01613129192'));
  console.log('admin + 2026:', simulateLogin('admin', '2026'));
  console.log('owner@dawahfashion.com + 01613129192:', simulateLogin('owner@dawahfashion.com', '01613129192'));
  console.log('01968718838 + 01613129192:', simulateLogin('01968718838', '01613129192'));
  console.log('fazle + wrong_pass:', simulateLogin('fazle', 'wrong'));
}

testSuperAdmin();
