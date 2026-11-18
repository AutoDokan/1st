const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const productColors = [
  { model_code: 'DF-101', colors: 'জেট ব্ল্যাক (গোল্ডেন কারচুপি কোটি)' },
  { model_code: 'DF-102', colors: 'জেট ব্ল্যাক' },
  { model_code: 'DF-103', colors: 'কফি, সি-গ্রিন' },
  { model_code: 'DF-104', colors: 'নেভি ব্লু' },
  { model_code: 'DF-105', colors: 'রয়েল ব্লু, মেরুন' }
];

async function updateColors() {
  console.log("Updating product colors in Supabase...");
  for (const p of productColors) {
    const { data, error } = await sb
      .from("products")
      .update({ colors: p.colors })
      .eq("model_code", p.model_code)
      .select("model_code, name, colors");

    if (error) {
      console.error(`Failed to update ${p.model_code}:`, error.message);
    } else {
      console.log(`[SUCCESS] ${p.model_code}:`, data[0]?.colors);
    }
  }

  // Verify
  const { data: allProds } = await sb
    .from("products")
    .select("model_code, name, colors")
    .order("model_code");
  console.log("\nVerified Products in Supabase:\n", JSON.stringify(allProds, null, 2));
}
updateColors();
