const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data: sessions, error } = await sb
    .from("chat_sessions")
    .select("customer_identifier, updated_at, messages")
    .order("updated_at", { ascending: false })
    .limit(15);

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${sessions.length} sessions`);
  for (const s of sessions) {
    if (s.customer_identifier.includes('test_')) continue;
    console.log(`\n========================================`);
    console.log(`Customer: ${s.customer_identifier} | Updated: ${s.updated_at}`);
    console.log(`========================================`);
    const msgs = (s.messages || []);
    for (const m of msgs) {
      console.log(`[${m.role || 'unknown'}]: ${m.content || m.text}`);
    }
  }
}
run();
