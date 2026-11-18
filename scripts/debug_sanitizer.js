const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const { handleIncomingMessage, refreshProductsFromDB, cleanHumanFormatting } = require("../commerce_brain");

async function checkSanitizer() {
  await refreshProductsFromDB("autodokan_seller_1");
  const testId = "debug_sanitizer_" + Date.now();
  
  await handleIncomingMessage(testId, "Discount den");
  await handleIncomingMessage(testId, "Delivery kivabe and kotodin lagbe");
  await handleIncomingMessage(testId, "Akkahs\nGram kalibapa , dakghor nutbedi . Solonga . Sirajganj");
  
  const r4 = await handleIncomingMessage(testId, "Tahole dam kom rakhen");
  console.log("Returned r4:", JSON.stringify(r4));
}
checkSanitizer();
