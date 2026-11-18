const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data: session } = await sb
    .from("chat_sessions")
    .select("*")
    .eq("customer_identifier", "79070616404078@lid")
    .single();

  console.log("Full session messages:", JSON.stringify(session.messages, null, 2));
}
run();
