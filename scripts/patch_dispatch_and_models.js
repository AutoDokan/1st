const fs = require('fs');
const path = require('path');

// 1. Patch commerce_brain.js
let cb = fs.readFileSync('commerce_brain.js', 'utf8');

const oldCandidateBlock = `  const candidateModels = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
  ];`;

const newCandidateBlock = `  const candidateModels = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ];`;

if (cb.includes(oldCandidateBlock)) {
  cb = cb.replace(oldCandidateBlock, newCandidateBlock);
  console.log('[1/3] candidateModels in commerce_brain.js replaced');
} else {
  console.warn('[1/3] candidateModels block not found');
}

const oldExtractModels = `for (const m of ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'])`;
const newExtractModels = `for (const m of ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'])`;
if (cb.includes(oldExtractModels)) {
  cb = cb.replace(oldExtractModels, newExtractModels);
  console.log('[2/3] extract models in commerce_brain.js replaced');
} else {
  console.warn('[2/3] extract models not found');
}

fs.writeFileSync('commerce_brain.js', cb, 'utf8');

// 2. Patch server.js to implement dispatchWhatsAppReplyAndMedia
let srv = fs.readFileSync('server.js', 'utf8');

const dispatchFunctionCode = `
// ==========================================
// TENANT-AWARE WHATSAPP OUTBOUND DISPATCHER
// Dispatches Text + Dynamic Photos / Albums
// ==========================================
async function dispatchWhatsAppReplyAndMedia(targetSock, remoteJid, replyText, targetSellerId) {
  if (!targetSock || !replyText) return;

  // 1. Detect and extract all image tags (with complete whitespace & format resilience)
  const catalogOverviewRegex = /\\[\\s*SEND_CATALOG_OVERVIEW\\s*\\]/gi;
  const allImagesRegex = /\\[\\s*SEND_ALL_IMAGES\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\]/gi;
  const hijabRegex = /\\[\\s*SEND_HIJAB_IMAGE\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\]/gi;
  const detailRegex = /\\[\\s*SEND_DETAIL_IMAGE\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\]/gi;
  const flareRegex = /\\[\\s*SEND_FLARE_IMAGE\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\]/gi;
  const realRegex = /\\[\\s*SEND_REAL_IMAGE\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\]/gi;
  const mainImageRegex = /\\[\\s*SEND_IMAGE\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\]/gi;

  const hasCatalogOverview = catalogOverviewRegex.test(replyText);
  const allMatches = [...replyText.matchAll(allImagesRegex)];
  const hijabMatches = [...replyText.matchAll(hijabRegex)];
  const detailMatches = [...replyText.matchAll(detailRegex)];
  const flareMatches = [...replyText.matchAll(flareRegex)];
  const realMatches = [...replyText.matchAll(realRegex)];
  const mainMatches = [...replyText.matchAll(mainImageRegex)];

  // 2. Aggressively clean ALL send tags, leaked prompt codes & apply Clean Human Formatting Sanitizer
  let rawCleanReply = replyText
    .replace(/\\[\\s*SEND_[A-Za-z0-9_:\\s-]+\\s*\\]/gi, '')
    .replace(/\\(?(?:send|showing)\\s*hi[zj]ab\\s*(?:image|pic|photo)?\\)?/gi, '')
    .replace(/\\[?\\s*(?:send|showing)\\s*[a-z_]*hi[zj]ab[a-z_]*\\s*[^\\n\\]]*\\]?/gi, '')
    .replace(/\\[\\s*[A-Z_]+(?::[A-Za-z0-9_-]+)?\\s*\\]/g, '')
    .trim();

  const cleanReplyText = typeof cleanHumanFormatting === 'function'
    ? cleanHumanFormatting(rawCleanReply)
    : rawCleanReply;

  // 3. Multi-Bubble & 5-Second Typing Simulation (Human Balanced Speed)
  if (cleanReplyText) {
    const rawParagraphs = cleanReplyText.split(/\\n\\n+/).map(p => p.trim()).filter(Boolean);
    if (rawParagraphs.length >= 2 && cleanReplyText.length > 120) {
      const firstBubble = rawParagraphs[0];
      const secondBubble = rawParagraphs.slice(1).join('\\n\\n');

      await targetSock.sendPresenceUpdate('composing', remoteJid);
      await new Promise(r => setTimeout(r, 3000));
      const sent1 = await targetSock.sendMessage(remoteJid, { text: firstBubble });
      if (sent1?.key?.id) botSentMessageIds.add(sent1.key.id);
      incrementStats('messages_out');

      await targetSock.sendPresenceUpdate('composing', remoteJid);
      await new Promise(r => setTimeout(r, 2000));
      const sent2 = await targetSock.sendMessage(remoteJid, { text: secondBubble });
      if (sent2?.key?.id) botSentMessageIds.add(sent2.key.id);
      await targetSock.sendPresenceUpdate('paused', remoteJid);
      incrementStats('messages_out');
    } else {
      await targetSock.sendPresenceUpdate('composing', remoteJid);
      await new Promise(r => setTimeout(r, 5000));
      const sentMsg = await targetSock.sendMessage(remoteJid, { text: cleanReplyText });
      if (sentMsg?.key?.id) botSentMessageIds.add(sentMsg.key.id);
      await targetSock.sendPresenceUpdate('paused', remoteJid);
      incrementStats('messages_out');
    }
    if (typeof incrementSellerMessageUsage === 'function') {
      incrementSellerMessageUsage(targetSellerId);
    }
    console.log(\`[WhatsApp Outbound Done] Seller: \${targetSellerId} | To: \${remoteJid} | Length: \${cleanReplyText.length}\`);
  }

  // 4. Tenant-Safe Product Resolvers
  function findTenantProd(code) {
    let p = (typeof getProductByCode === 'function') ? getProductByCode(code, targetSellerId) : null;
    if (!p) {
      const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts(targetSellerId) : [];
      p = allProds.find(item => item.model_code && item.model_code.toUpperCase().trim() === code.toUpperCase().trim());
    }
    return p;
  }

  function resolveImagePayload(url) {
    if (!url) return null;
    const cleanPath = url.replace(/^https?:\\/\\/[^\\/]+/, '').replace(/^[/\\\\]+/, '').split(/[/\\\\]+/).join(path.sep);
    const localFile = path.join(__dirname, 'public', cleanPath);
    if (fs.existsSync(localFile)) {
      return fs.readFileSync(localFile);
    }
    return { url: url };
  }

  async function sendTenantWaPhoto(url, caption) {
    if (!targetSock || !url) return false;
    try {
      await targetSock.sendPresenceUpdate('composing', remoteJid);
      await new Promise(r => setTimeout(r, 1200));
      const payload = resolveImagePayload(url);
      const sentPhoto = await targetSock.sendMessage(remoteJid, {
        image: payload,
        caption: caption || ''
      });
      if (sentPhoto?.key?.id) {
        botSentMessageIds.add(sentPhoto.key.id);
        botSentMediaTracking.set(sentPhoto.key.id, {
          seller_id: targetSellerId
        });
      }
      await targetSock.sendPresenceUpdate('paused', remoteJid);
      incrementStats('messages_out');
      console.log(\`[WhatsApp Photo Sent] Seller: \${targetSellerId} | To: \${remoteJid}\`);
      return true;
    } catch (err) {
      console.error(\`[WhatsApp Photo Error] Seller: \${targetSellerId}:\`, err.message);
      return false;
    }
  }

  async function sendTenantProductAlbum(p) {
    if (!targetSock || !p) return false;
    try {
      const photoUrls = (typeof getProductImageUrls === 'function')
        ? getProductImageUrls(p)
        : [p.image_url, p.detail_image_url, p.hijab_image_url, p.flare_image_url, p.real_image_url].filter(Boolean);

      if (photoUrls.length === 0) return false;

      const code = p.model_code || 'PROD';
      const price = p.price ? \` | ৳\${p.price}\` : '';
      const masterCaption = \`\${code} : \${p.name || ''}\${price}\`;

      for (let i = 0; i < photoUrls.length; i++) {
        const url = photoUrls[i];
        const payload = resolveImagePayload(url);
        const msgOptions = {
          image: payload,
          ...(i === 0 ? { caption: masterCaption } : {})
        };

        const sentAlbum = await targetSock.sendMessage(remoteJid, msgOptions);
        if (sentAlbum?.key?.id) {
          botSentMessageIds.add(sentAlbum.key.id);
          botSentMediaTracking.set(sentAlbum.key.id, {
            seller_id: targetSellerId,
            product_id: p.id,
            model_code: p.model_code,
            name: p.name,
            price: p.price
          });
        }
        incrementStats('messages_out');

        if (i < photoUrls.length - 1) {
          await new Promise(r => setTimeout(r, 250));
        }
      }
      await targetSock.sendPresenceUpdate('paused', remoteJid);
      console.log(\`[WhatsApp Album Sent] Seller: \${targetSellerId} | To: \${remoteJid} | Model: \${p.model_code} | Count: \${photoUrls.length}\`);
      return true;
    } catch (err) {
      console.error(\`[WhatsApp Album Send Error] Seller: \${targetSellerId}:\`, err.message);
      return false;
    }
  }

  async function sendTenantCatalogOverview() {
    if (!targetSock) return false;
    try {
      const allProds = (typeof getAllCachedProducts === 'function') ? getAllCachedProducts(targetSellerId) : [];
      if (allProds.length === 0) return false;

      for (let i = 0; i < allProds.length; i++) {
        const p = allProds[i];
        if (!p || !p.image_url) continue;

        const payload = resolveImagePayload(p.image_url);
        const sentCat = await targetSock.sendMessage(remoteJid, {
          image: payload,
          caption: \`\${p.model_code || 'PROD'} : \${p.name || ''} | ৳\${p.price || ''}\`
        });
        if (sentCat?.key?.id) {
          botSentMessageIds.add(sentCat.key.id);
          botSentMediaTracking.set(sentCat.key.id, {
            seller_id: targetSellerId,
            product_id: p.id,
            model_code: p.model_code,
            name: p.name,
            price: p.price
          });
        }
        incrementStats('messages_out');

        if (i < allProds.length - 1) {
          await new Promise(r => setTimeout(r, 280));
        }
      }
      await targetSock.sendPresenceUpdate('paused', remoteJid);
      console.log(\`[WhatsApp Catalog Overview Sent] Seller: \${targetSellerId} | To: \${remoteJid} | Total: \${allProds.length}\`);
      return true;
    } catch (err) {
      console.error(\`[WhatsApp Catalog Overview Error] Seller: \${targetSellerId}:\`, err.message);
      return false;
    }
  }

  // 5. Dispatch images with natural delay
  const hasImagesToSend = hasCatalogOverview || allMatches.length > 0 || hijabMatches.length > 0 || detailMatches.length > 0 || flareMatches.length > 0 || realMatches.length > 0 || mainMatches.length > 0;
  if (hasImagesToSend) {
    await new Promise(r => setTimeout(r, 1200));
  }

  // Strict Safety: If browsing catalog or multiple models outputted -> send Catalog Overview (1 photo per model)
  if (hasCatalogOverview || allMatches.length > 1) {
    await sendTenantCatalogOverview();
  } else if (allMatches.length === 1) {
    const code = allMatches[0][1].toUpperCase().trim();
    const p = findTenantProd(code);
    if (p) await sendTenantProductAlbum(p);
  }

  for (const match of hijabMatches) {
    const code = match[1].toUpperCase().trim();
    const p = findTenantProd(code);
    if (p) {
      const url = p.hijab_image_url || p.image_url;
      if (url) await sendTenantWaPhoto(url, \`🧕 *\${p.name} - ম্যাচিং প্রিমিয়াম হিজাব*\`);
    }
  }

  for (const match of detailMatches) {
    const code = match[1].toUpperCase().trim();
    const p = findTenantProd(code);
    if (p) {
      const url = p.detail_image_url || p.image_url;
      if (url) await sendTenantWaPhoto(url, \`🔍 *\${p.name} - নিখুঁত কারচুপি ও কাপড়ের ক্লোজ-আপ ভিউ*\`);
    }
  }

  for (const match of flareMatches) {
    const code = match[1].toUpperCase().trim();
    const p = findTenantProd(code);
    if (p) {
      const url = p.flare_image_url || p.image_url;
      if (url) await sendTenantWaPhoto(url, \`✨ *\${p.name} - ঘের ও সাইড অ্যাঙ্গেল ভিউ*\`);
    }
  }

  for (const match of realMatches) {
    const code = match[1].toUpperCase().trim();
    const p = findTenantProd(code);
    if (p) {
      const url = p.real_image_url || p.image_url;
      if (url) await sendTenantWaPhoto(url, \`📸 *\${p.name} - স্বাভাবিক আলোর আনফিল্টার্ড রিয়েল ছবি*\`);
    }
  }

  for (const match of mainMatches) {
    const code = match[1].toUpperCase().trim();
    if (allMatches.some(m => m[1].toUpperCase().trim() === code)) continue;
    const p = findTenantProd(code);
    if (p && p.image_url) {
      await sendTenantWaPhoto(p.image_url, \`\${p.model_code || 'PROD'} : \${p.name || ''}\`);
    }
  }
}
`;

// Insert dispatchWhatsAppReplyAndMedia right before startSellerSession
if (!srv.includes('function dispatchWhatsAppReplyAndMedia')) {
  srv = srv.replace(
    'async function startSellerSession(sellerId) {',
    `${dispatchFunctionCode}\nasync function startSellerSession(sellerId) {`
  );
  console.log('[3/3] dispatchWhatsAppReplyAndMedia added to server.js');
} else {
  console.log('[3/3] dispatchWhatsAppReplyAndMedia already in server.js');
}

// Replace the bare sendMessage inside startSellerSession
const oldStartSessionSend = `          const replyText = await handleIncomingMessage(remoteJid, combined, sellerId);
          const cleanReply = typeof cleanHumanFormatting === 'function' ? cleanHumanFormatting(replyText) : replyText;

          // Strictly 5-second human typing simulation
          await sSock.sendPresenceUpdate('composing', remoteJid);
          await new Promise(r => setTimeout(r, 5000));
          await sSock.sendMessage(remoteJid, { text: cleanReply });
          await sSock.sendPresenceUpdate('paused', remoteJid);`;

const newStartSessionSend = `          const replyText = await handleIncomingMessage(remoteJid, combined, sellerId);
          await dispatchWhatsAppReplyAndMedia(sSock, remoteJid, replyText, sellerId);`;

if (srv.includes(oldStartSessionSend)) {
  srv = srv.replace(oldStartSessionSend, newStartSessionSend);
  console.log('[4/4] hooked dispatchWhatsAppReplyAndMedia into startSellerSession');
} else {
  console.warn('[4/4] oldStartSessionSend block not found');
}

fs.writeFileSync('server.js', srv, 'utf8');
console.log('Done applying updates!');
