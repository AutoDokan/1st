# AutoDokan OS — Project Status & Master Handover

> **Single Source of Truth for Fazle Rabbi & Antigravity AI**
> Last Verified & Live: 2026-11-16 (Post-Latency Optimization & Seller Group Insights)

---

## 1. Project Overview & Core Mission
**AutoDokan OS** is an enterprise-grade autonomous conversational commerce operating system designed for Bangladeshi F-Commerce & E-Commerce merchants.
Currently powering: **Dawah Fashion (দাওয়া ফ্যাশন)** — Modest wear / Abaya brand.
Scalable to: Multi-tenant, multi-category stores (Panjabi, Saree, Shoes, Cosmetics, Tech Gadgets).

---

## 2. Live Cloud Infrastructure
- **Live Production URL:** `https://autodokan-engine.onrender.com`
- **Merchant Dashboard:** `https://autodokan-engine.onrender.com/dashboard`
  - **Security PIN:** `2026` (Protected via HTTP-only cookie authentication `df_auth_pin`)
- **GitHub Repository:** `https://github.com/AutoDokan/1st.git` (Branch: `main`)
- **Database (Supabase PostgreSQL):** `https://wqzdkredzdpqxvfrzjue.supabase.co`
- **Connected WhatsApp Number:** `+8801968718838` (Persistent session authenticated in Supabase `whatsapp_sessions`)
- **Cloud Assets / Credits Bank:**
  - AWS: **$100 USD Credit** available (Reserved for 4GB/8GB VPS migration).
  - Google Cloud Platform (GCP): **$300 USD Credit** available (via $50 promo, reserved for Gemini Flash / Vertex AI).

---

## 3. Architecture & Core Modules
| File | Responsibility |
| :--- | :--- |
| `server.js` | Express server, Baileys WhatsApp MD socket, dashboard endpoints, digital cash memo API, ghosting auto-recovery. |
| `borkha_brain.js` | 11ms Fast-Path rule engine, 15+ competitor objection handlers, 7 seller-group chat scenarios, height-to-length formula. |
| `supabase_adapter.js` | Zero-latency multi-session WhatsApp credential & encryption key storage in Supabase PostgreSQL (`whatsapp_sessions`). |
| `public/` | Live dashboard assets, product photo catalog (DF-101 to DF-105), badges, receipts. |

---

## 4. Key Rules & Behavioral Safeguards (Permanently Locked)
1. **100% Height-to-Length Formula (Zero Sizing Taboo):**
   - Strictly forbidden to ask for chest, bust, or body measurements.
   - Body is free-size (38-46). Height dictates length: 5'0"-5'1" = 50", 5'2"-5'3" = 52", 5'4"-5'5" = 54", 5'6"+ = 56".
   - High heels trigger automated +1 size bump (e.g. 52 -> 54 inches).
2. **100% Gender-Neutral & Respectful Bengali Tone:**
   - Strictly banned: "আপু", "ভাইয়া", or "আপু/ভাইয়া".
   - Standard polite pronouns only: "আপনি", "আপনার", "জি", "অবশ্যই".
3. **Financial Protection (Zero Fraud Advance):**
   - Advance payment is strictly the delivery fee: ৳80 (Inside Dhaka) or ৳150 (Outside Dhaka).
   - Burqa/dress price is 100% Cash on Delivery (COD) after checking in front of delivery rider.
4. **11ms Local Fast-Path Latency:**
   - 85% of standard questions (Price, Photos, Delivery Days, Sizing, Hijab, Exchange, Couriers, Rider issues) resolve locally in 11ms at $0 API cost.
   - Complex open-ended queries fallback to Groq / Gemini.
5. **Smart Non-Text Media Handling:**
   - Photos sent by customer are welcomed: asks for height and product confirmation.
   - Voice notes / audio messages are politely acknowledged.

---

## 5. Security & Anti-Hacking Guardrails
- **Row Level Security (RLS):** Supabase database separates seller data at the database engine level.
- **Environment Secrets:** API keys and service tokens live in environment variables, never committed to git.
- **Git Immutability:** Any accidental prompt modification or bad commit can be reverted in 5 seconds via `git revert`.
- **Human Takeover Switch:** When a seller messages a customer from their phone, AI auto-pauses for 15 minutes.

---

## 6. Multi-Tenant Roadmap (1-5 Sellers ➜ 10 Sellers ➜ 100 Sellers)
- **Phase 1 (Immediate Pilot):** Run 1 to 5 sellers on current Render setup with zero cash expense.
- **Phase 2 (AWS Migration):** Spin up AWS Lightsail (4GB RAM) using $100 credit. Enable multi-session Baileys pool.
- **Phase 3 (GCP & Omnichannel):** Activate GCP $300 credit. Integrate Gemini Flash + Facebook Messenger + Instagram DM + Steadfast Courier API.
