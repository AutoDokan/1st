const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');
srv = srv.replace(/\r\n/g, '\n');

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
  fs.writeFileSync('server.js', srv, 'utf8');
  console.log('Successfully hooked dispatchWhatsAppReplyAndMedia into startSellerSession!');
} else {
  console.error('Could not find oldStartSessionSend block after CRLF normalization');
}
