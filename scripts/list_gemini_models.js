const fs = require('fs');
const path = require('path');

const envLines = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n');
let geminiKey = '';
for (const line of envLines) {
  if (line.startsWith('GEMINI_API_KEY=')) {
    geminiKey = line.split('=')[1].trim();
  }
}

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const names = (data.models || []).map(m => m.name.replace('models/', ''));
  console.log("Available Gemini Models:\n", names.filter(n => n.includes('flash') || n.includes('pro')));
}
listModels();
