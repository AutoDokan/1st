const fs = require('fs');
const path = require('path');

const envLines = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n');
let geminiKey = '';
for (const line of envLines) {
  if (line.startsWith('GEMINI_API_KEY=')) {
    geminiKey = line.split('=')[1].trim();
  }
}

async function testThinking() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Tahole dam kom rakhen' }] }],
      generationConfig: {
        temperature: 0.38,
        maxOutputTokens: 1500
      }
    })
  });

  const data = await res.json();
  console.log("Response:\n", JSON.stringify(data, null, 2));
}
testThinking();
