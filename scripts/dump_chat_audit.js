const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data: sessions } = await sb.from("chat_sessions").select("customer_identifier, updated_at, messages");
  console.log("Total sessions:", sessions.length);
  for (const s of sessions) {
    const msgs = s.messages || [];
    for (let i = 0; i < msgs.length; i++) {
      const text = msgs[i].text || msgs[i].content || '';
      if (text.includes('১টাই') || text.includes('একটাই ছবি') || text.includes('একটাই পিক') || text.includes('1টাই') || text.includes('১ টি ছবি') || text.includes('একটা ছবি')) {
        console.log(`MATCH [${s.customer_identifier}]: ${text}`);
      }
    }
  }
}
run();
