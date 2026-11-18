const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = 'https://wqzdkredzdpqxvfrzjue.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxemRrcmVkemRwcXh2ZnJ6anVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODE2MzAsImV4cCI6MjExMDI1NzYzMH0.kzQAm9E4QKccOiAZ93GFvqmSelcktHrVmc412qz6eik';

const { handleIncomingMessage, refreshProductsFromDB } = require("../commerce_brain");

async function reproduce() {
  await refreshProductsFromDB("autodokan_seller_1");
  const testId = "reproduce_test_" + Date.now();
  
  // Message 1: Discount den
  console.log("--- Test 1: Discount den ---");
  const r1 = await handleIncomingMessage(testId, "Discount den");
  console.log("R1:", r1);

  // Message 2: Delivery kivabe and kotodin lagbe
  console.log("\n--- Test 2: Delivery kivabe and kotodin lagbe ---");
  const r2 = await handleIncomingMessage(testId, "Delivery kivabe and kotodin lagbe");
  console.log("R2:", r2);

  // Message 3: Akkahs \n Gram kalibapa...
  console.log("\n--- Test 3: Address ---");
  const r3 = await handleIncomingMessage(testId, "Akkahs\nGram kalibapa , dakghor nutbedi . Solonga . Sirajganj");
  console.log("R3:", r3);

  // Message 4: Tahole dam kom rakhen
  console.log("\n--- Test 4: Tahole dam kom rakhen ---");
  const r4 = await handleIncomingMessage(testId, "Tahole dam kom rakhen");
  console.log("R4:", r4);
}
reproduce();
