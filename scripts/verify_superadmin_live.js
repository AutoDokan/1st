const BASE_URL = 'https://autodokan-engine.onrender.com';

async function runLiveVerification() {
  console.log('--- 1. Testing Super Admin Multi-Identifier Login ---');
  const loginRes = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ identifier: 'admin', password: '01613129192' }),
    redirect: 'manual'
  });

  const cookie = loginRes.headers.get('set-cookie');
  console.log('Login Status:', loginRes.status);
  console.log('Auth Cookie Set:', !!cookie && cookie.includes('autodokan_admin_session'));

  if (!cookie) {
    console.error('Failed to obtain auth cookie');
    return;
  }

  console.log('\n--- 2. Testing Super Admin Deep-Calm Dashboard (/dashboard) ---');
  const dashRes = await fetch(`${BASE_URL}/dashboard`, {
    headers: { 'Cookie': cookie }
  });
  const dashHtml = await dashRes.text();
  console.log('Dashboard Status:', dashRes.status);
  console.log('Contains AutoDokan Engine OS?', dashHtml.includes('AutoDokan Engine OS'));
  console.log('Contains Deep Calm Palette #0d1117?', dashHtml.includes('#0d1117'));
  console.log('Contains stab-shops (Fleet Monitor)?', dashHtml.includes('id="stab-shops"'));
  console.log('Contains stab-orders (Global Orders Pipeline)?', dashHtml.includes('id="stab-orders"'));
  console.log('Contains stab-chats (Live AI Inspector)?', dashHtml.includes('id="stab-chats"'));
  console.log('Contains stab-settings (Store Settings)?', dashHtml.includes('id="stab-settings"'));
  console.log('Has addProductModal (should be false)?', dashHtml.includes('addProductModal'));
  console.log('WhatsApp QR in Super Admin Header?', dashHtml.includes('/qr') || dashHtml.includes('WhatsApp Connect'));

  console.log('\n--- 3. Testing Tenant Portal Isolation ---');
  // Dawah Fashion
  const dawahRes = await fetch(`${BASE_URL}/portal?token=inv_dawah_fashion`);
  const dawahHtml = await dawahRes.text();
  const dawahHasAbaya = dawahHtml.includes('NWT 402') || dawahHtml.includes('DF-104');
  const dawahHasJuta = dawahHtml.includes('BJ-101') || dawahHtml.includes('Bangla Juta');
  console.log('Dawah Fashion Portal 200?', dawahRes.status === 200);
  console.log('Dawah Fashion has Abayas?', dawahHasAbaya);
  console.log('Dawah Fashion leaked Shoes?', dawahHasJuta);

  // Bangla Juta
  const jutaRes = await fetch(`${BASE_URL}/portal?token=inv_2f1d6100eb71`);
  const jutaHtml = await jutaRes.text();
  const jutaHasJuta = jutaHtml.includes('BJ-101') || jutaHtml.includes('অরিজিনাল লেদার লোফার');
  const jutaHasAbaya = jutaHtml.includes('NWT 402') || jutaHtml.includes('Dawah Fashion');
  console.log('Bangla Juta Portal 200?', jutaRes.status === 200);
  console.log('Bangla Juta has Shoes?', jutaHasJuta);
  console.log('Bangla Juta leaked Abayas?', jutaHasAbaya);

  console.log('\n--- ALL VERIFICATIONS COMPLETE ---');
}

runLiveVerification().catch(console.error);
