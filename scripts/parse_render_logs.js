const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/Fazle Rabbi/.gemini/antigravity/brain/ab8e31e2-0052-42cf-a962-d8d9f331be09/.system_generated/steps/11243/output.txt', 'utf8'));
const logs = data.logs || [];
for (const l of logs) {
  if (l.message && (l.message.includes('pic') || l.message.includes('ছবি') || l.message.includes('SEND_IMAGE') || l.message.includes('SEND_ALL_IMAGES') || l.message.includes('একটাই') || l.message.includes('১টি') || l.message.includes('১টাই'))) {
    console.log(`${l.timestamp} | ${l.message}`);
  }
}
