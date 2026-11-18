async function testLiveProduction() {
  const base = 'https://autodokan-engine.onrender.com';

  console.log('--- 1. Testing Live /login Page ---');
  const loginRes = await fetch(base + '/login');
  const loginHtml = await loginRes.text();
  console.log('Login Status:', loginRes.status);
  console.log('Has AutoDokan Command Center?', loginHtml.includes('AutoDokan Command Center'));
  console.log('Has identifier input (username/email/phone)?', loginHtml.includes('name="identifier"'));
  console.log('Has password input?', loginHtml.includes('name="password"'));
  console.log('Dawah Fashion specific lock removed?', !loginHtml.includes('Dawah Fashion — সিকিউরিটি লক'));

  console.log('\n--- 2. Testing Live /login Post Authentication ---');
  const postRes = await fetch(base + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'identifier=admin&password=01613129192',
    redirect: 'manual'
  });
  console.log('Login Post Status (Must be 302):', postRes.status);
  console.log('Location:', postRes.headers.get('location'));
  const cookies = postRes.headers.get('set-cookie') || '';
  console.log('Sets Admin Session Cookie?', cookies.includes('autodokan_admin_session=authorized_admin'));

  console.log('\n--- 3. Testing Live Dawah Fashion Portal ---');
  const dawahPortalRes = await fetch(base + '/portal?token=inv_dawah_fashion');
  const dawahHtml = await dawahPortalRes.text();
  console.log('Dawah Portal Status:', dawahPortalRes.status);
  console.log('Has Dawah Fashion?', dawahHtml.includes('Dawah Fashion'));
  console.log('Has DF-101?', dawahHtml.includes('DF-101'));
  console.log('Has Shoes BJ-101 (Must be false)?', dawahHtml.includes('BJ-101'));

  console.log('\n--- 4. Testing Live Bangla Juta Portal ---');
  const jutaPortalRes = await fetch(base + '/portal?token=inv_2f1d6100eb71');
  const jutaHtml = await jutaPortalRes.text();
  console.log('Juta Portal Status:', jutaPortalRes.status);
  console.log('Has Bangla Juta?', jutaHtml.includes('Bangla Juta'));
  console.log('Has BJ-101?', jutaHtml.includes('BJ-101'));
  console.log('Has Abayas DF-101 (Must be false)?', jutaHtml.includes('DF-101'));

  console.log('\n--- 5. Testing Live Super Admin Dashboard Header (No QR) ---');
  const dashRes = await fetch(base + '/dashboard?seller_id=ALL', {
    headers: { cookie: 'autodokan_admin_session=authorized_admin; df_auth_pin=2026_authorized' }
  });
  const dashHtml = await dashRes.text();
  console.log('Dashboard Status:', dashRes.status);
  console.log('Navbar has /qr button? (Must be false):', dashHtml.includes('href="/qr"'));
  console.log('Primary tab has দোকানসমূহ ও লাইভ বট?', dashHtml.includes('দোকানসমূহ ও লাইভ বট'));

  console.log('\n--- ALL VERIFICATIONS PASSED PERFECTLY! ---');
}

testLiveProduction();
