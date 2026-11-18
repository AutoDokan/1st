const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const { handleIncomingMessage, refreshProductsFromDB } = require("../commerce_brain");

async function test() {
  await refreshProductsFromDB("autodokan_seller_1");
  const testId = "test_truncation_check_" + Date.now();
  console.log("Sending: Tahole dam kom rakhen");
  const reply1 = await handleIncomingMessage(testId, "Tahole dam kom rakhen");
  console.log("REPLY 1:\n", reply1);

  console.log("\nSending: Theme jaw kno and makhe majhe ansre daw na kno");
  const reply2 = await handleIncomingMessage(testId, "Theme jaw kno and makhe majhe ansre daw na kno");
  console.log("REPLY 2:\n", reply2);
}
test();
