const fs = require('fs');
const path = require('path');

const envLines = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n');
let geminiKey = '';
for (const line of envLines) {
  if (line.startsWith('GEMINI_API_KEY=')) {
    geminiKey = line.split('=')[1].trim();
  }
}

async function testModels() {
  for (const m of ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hello, are you available?' }] }],
          generationConfig: { maxOutputTokens: 100 }
        })
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`[SUCCESS] ${m}: ${data.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 50)}`);
      } else {
        console.log(`[FAILED] ${m} (${res.status}): ${data.error?.message?.substring(0, 80)}`);
      }
    } catch (e) {
      console.log(`[ERR] ${m}:`, e.message);
    }
  }
}
testModels();
