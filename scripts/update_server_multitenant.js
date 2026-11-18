const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let src = fs.readFileSync(serverPath, 'utf8');

console.log('Original length:', src.length);

// 1. Update /api/settings/update to handle seller_id
const oldSettingsUpdate = `  const updatePayload = {
    id: 1,
    seller_id: CURRENT_SELLER_ID,
    inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
    outside_dhaka_fee: Number(outside_dhaka_fee) || 120,
    bkash_number: (bkash_number || '01613-129192').trim(),
    nagad_number: (nagad_number || '01677-557292').trim(),
    promo_offer: (promo_offer !== undefined ? promo_offer : '').trim(),
    extra_config: currentExtra,
    updated_at: new Date().toISOString()
  };

  if (shop_name !== undefined) updatePayload.shop_name = shop_name.trim();
  if (return_policy !== undefined) updatePayload.return_policy = return_policy.trim();
  if (free_delivery_min_amount !== undefined) updatePayload.free_delivery_min_amount = Number(free_delivery_min_amount) || 0;

  await supabase.from('store_settings').upsert(updatePayload);
  await refreshSettingsFromDB();
  await refreshProductsFromDB();`;

const newSettingsUpdate = `  const targetSeller = req.body.seller_id || CURRENT_SELLER_ID;
  const updatePayload = {
    seller_id: targetSeller,
    inside_dhaka_fee: Number(inside_dhaka_fee) || 80,
    outside_dhaka_fee: Number(outside_dhaka_fee) || 120,
    bkash_number: (bkash_number || '01613-129192').trim(),
    nagad_number: (nagad_number || '01677-557292').trim(),
    promo_offer: (promo_offer !== undefined ? promo_offer : '').trim(),
    extra_config: currentExtra,
    updated_at: new Date().toISOString()
  };

  if (shop_name !== undefined) updatePayload.shop_name = shop_name.trim();
  if (return_policy !== undefined) updatePayload.return_policy = return_policy.trim();
  if (free_delivery_min_amount !== undefined) updatePayload.free_delivery_min_amount = Number(free_delivery_min_amount) || 0;

  const { data: existSetting } = await supabase.from('store_settings').select('id').eq('seller_id', targetSeller).maybeSingle();
  if (existSetting?.id) {
    updatePayload.id = existSetting.id;
    await supabase.from('store_settings').update(updatePayload).eq('id', existSetting.id);
  } else {
    await supabase.from('store_settings').insert(updatePayload);
  }
  await refreshSettingsFromDB(targetSeller);
  await refreshProductsFromDB(targetSeller);`;

if (!src.includes(oldSettingsUpdate)) {
  console.error('ERROR: oldSettingsUpdate not found');
  process.exit(1);
}
src = src.replace(oldSettingsUpdate, newSettingsUpdate);
console.log('✓ /api/settings/update updated');

// 2. Update /api/add-product to support seller_id
const oldAddProduct = `    const { data, error } = await supabase.from('products').insert({
      seller_id: CURRENT_SELLER_ID,
      model_code: cleanCode,
      name: name.trim(),
      fabric: fabric || 'দুবাই চেরি',
      price: discPrice || parsedPrice,
      regular_price: regPrice,
      discount_price: discPrice,
      stock_quantity: stockQty,
      colors: colors ? colors.trim() : null,
      search_keywords: search_keywords ? search_keywords.trim() : null,
      short_description: short_description ? short_description.trim() : null,
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === true || hijab_included === 'true',
      image_url: image_url ? image_url.trim() : null,
      hijab_image_url: hijab_image_url ? hijab_image_url.trim() : null,
      detail_image_url: detail_image_url ? detail_image_url.trim() : null,
      flare_image_url: flare_image_url ? flare_image_url.trim() : null,
      real_image_url: real_image_url ? real_image_url.trim() : null,
      in_stock: in_stock === undefined ? true : (in_stock === true || in_stock === 'true')
    }).select();
    if (!error && data && data.length > 0) insertedItem = data[0];
    await refreshProductsFromDB();`;

const newAddProduct = `    const targetSeller = req.body.seller_id || CURRENT_SELLER_ID;
    const { data, error } = await supabase.from('products').insert({
      seller_id: targetSeller,
      model_code: cleanCode,
      name: name.trim(),
      fabric: fabric || 'দুবাই চেরি',
      price: discPrice || parsedPrice,
      regular_price: regPrice,
      discount_price: discPrice,
      stock_quantity: stockQty,
      colors: colors ? colors.trim() : null,
      search_keywords: search_keywords ? search_keywords.trim() : null,
      short_description: short_description ? short_description.trim() : null,
      sizes: sizes || '৫০, ৫২, ৫৪, ৫৬',
      hijab_included: hijab_included === true || hijab_included === 'true',
      image_url: image_url ? image_url.trim() : null,
      hijab_image_url: hijab_image_url ? hijab_image_url.trim() : null,
      detail_image_url: detail_image_url ? detail_image_url.trim() : null,
      flare_image_url: flare_image_url ? flare_image_url.trim() : null,
      real_image_url: real_image_url ? real_image_url.trim() : null,
      in_stock: in_stock === undefined ? true : (in_stock === true || in_stock === 'true')
    }).select();
    if (!error && data && data.length > 0) insertedItem = data[0];
    await refreshProductsFromDB(targetSeller);`;

if (!src.includes(oldAddProduct)) {
  console.error('ERROR: oldAddProduct not found');
  process.exit(1);
}
src = src.replace(oldAddProduct, newAddProduct);
console.log('✓ /api/add-product updated');

// 3. Update /connect redirect check
const oldConnectRoute = `app.get('/connect', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send('<h3>ইনভাইট টোকেন পাওয়া যায়নি। দয়া করে সঠিক লিংক ব্যবহার করুন।</h3>');
  }

  const { data: inv, error } = await supabase
    .from('seller_invites')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !inv) {
    return res.status(404).send('<h3>ইনভাইটেশন লিংকটি সঠিক নয় বা মেয়াদোত্তীর্ণ হয়েছে।</h3>');
  }

  // Auto-start session if not active
  if (!sellerSockets.has(inv.seller_id)) {
    startSellerSession(inv.seller_id);
  }`;

const newConnectRoute = `app.get('/connect', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send('<h3>ইনভাইট টোকেন পাওয়া যায়নি। দয়া করে সঠিক লিংক ব্যবহার করুন।</h3>');
  }

  const { data: inv, error } = await supabase
    .from('seller_invites')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !inv) {
    return res.status(404).send('<h3>ইনভাইটেশন লিংকটি সঠিক নয় বা মেয়াদোত্তীর্ণ হয়েছে।</h3>');
  }

  // 1-Time Invite Flow: If already connected, immediately redirect to Dedicated Merchant Portal
  const isAlreadyConnected = sellerStatuses.get(inv.seller_id) === 'connected' || inv.status === 'CONNECTED';
  if (isAlreadyConnected) {
    return res.redirect('/portal?token=' + encodeURIComponent(token));
  }

  // Auto-start session if not active
  if (!sellerSockets.has(inv.seller_id)) {
    startSellerSession(inv.seller_id);
  }`;

if (!src.includes(oldConnectRoute)) {
  console.error('ERROR: oldConnectRoute not found');
  process.exit(1);
}
src = src.replace(oldConnectRoute, newConnectRoute);
console.log('✓ /connect 1-time redirect added');

// 4. Update connect client script to redirect to /portal after connected
const oldConnectClientScript = `        if (curStatus === 'connected') {
          const numDisplay = data.number ? (data.number.startsWith('+') ? data.number : '+' + data.number) : '';
          const rawNum = (data.number || '').replace(/[^0-9]/g, '');

          banner.className = 'bg-emerald-50 border border-emerald-300 text-emerald-900 p-3.5 rounded-2xl text-xs font-black flex items-center justify-center gap-2';
          statusText.innerText = '🎉 হোয়াটসঅ্যাপ সফলভাবে কানেক্ট হয়েছে! নম্বর: ' + numDisplay;`;

const newConnectClientScript = `        if (curStatus === 'connected') {
          const numDisplay = data.number ? (data.number.startsWith('+') ? data.number : '+' + data.number) : '';
          const rawNum = (data.number || '').replace(/[^0-9]/g, '');

          banner.className = 'bg-emerald-50 border border-emerald-300 text-emerald-900 p-3.5 rounded-2xl text-xs font-black flex items-center justify-center gap-2';
          statusText.innerText = '🎉 হোয়াটসঅ্যাপ সফলভাবে কানেক্ট হয়েছে! নম্বর: ' + numDisplay + ' (মার্চেন্ট পোর্টালে নিয়ে যাওয়া হচ্ছে...)';
          setTimeout(function() {
            window.location.href = '/portal?token=' + encodeURIComponent(token);
          }, 2000);`;

if (!src.includes(oldConnectClientScript)) {
  console.error('ERROR: oldConnectClientScript not found');
  process.exit(1);
}
src = src.replace(oldConnectClientScript, newConnectClientScript);
console.log('✓ /connect client auto-redirect updated');

fs.writeFileSync(serverPath, src, 'utf8');
console.log('Wrote partial updates. Testing syntax...');
