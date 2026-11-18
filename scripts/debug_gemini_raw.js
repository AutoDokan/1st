const fs = require('fs');
const path = require('path');

// Read env
const envLines = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n');
let geminiKey = '';
for (const line of envLines) {
  if (line.startsWith('GEMINI_API_KEY=')) {
    geminiKey = line.split('=')[1].trim();
  }
}

async function debugRaw() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`;
  
  const contents = [
    { role: 'user', parts: [{ text: 'Tahole dam kom rakhen' }] }
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      generationConfig: {
        temperature: 0.38,
        maxOutputTokens: 1200
      }
    })
  });

  const data = await res.json();
  console.log("Raw Response with no system prompt:\n", JSON.stringify(data, null, 2));
}
debugRaw();
