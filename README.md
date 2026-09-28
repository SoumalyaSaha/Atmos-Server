# Atmos AI Backend 🌍🤖

AI-Powered Carbon Footprint Tracking & Behavioral Optimization Platform — High-Availability Backend API.

Atmos AI is the core engine behind a gamified sustainability ecosystem. It translates raw individual consumption telemetry logs into custom, context-aware mitigation actions, utilizing advanced multi-LLM orchestration layer failovers to achieve zero-downtime execution.

## 🛠️ Tech Stack
* **Runtime Environment:** Node.js + Express
* **Primary AI Engine:** Google Gemini 2.5 Flash API (4-Key Intelligent Rotation Array)
* **Secondary AI Engine:** Groq API Gateway (3-Key High-Speed Fallback Array)
* **Data Persistence:** MongoDB Atlas (Mongoose ODM)
* **Security & Auth:** Google OAuth 2.0 Identity handshake verification
* **Hosting Pipeline:** Render Web Services (Production-grade automatic dynamic port binding)

---

## 🔑 Key Architectural Highlights

### ⚡ 7-Key Hybrid Load Balancing & Fault Tolerance
To circumvent standard upstream rate limits and scale computational resilience without incurring platform runtime costs, the engine operates an automated load-balancing rotation mechanism:
1. **Primary Track:** Requests cycle natively across **4 distinct Gemini API keys** concurrently.
2. **Secondary Track:** If the Gemini keys encounter transaction exhaustion boundaries, the middleware seamlessly shifts traffic across **3 independent Groq API keys** to handle low-latency generation.
3. **Safe Out-of-Quota State:** If all 7 upstream keys are completely exhausted, the system fires a graceful JSON exception payload rather than breaking the application pipeline.

### 💾 Robust Database Persistence
Unlike standard volatile hackathon backends, Atmos AI relies on a production-ready **MongoDB Atlas** connection layer. Even if downstream LLM gateways are exhausted, all critical tracking data (user streaks, accrued eco-points, custom badge inventories, and historical CO₂ reduction graphs) remains securely intact and completely preserved.

---

## 🚀 Deployment Pipeline on Render

### Step 1: Push Local Directory to GitHub
Ensure your local backend source repository is safely pushed to your remote Git gateway:
```bash
git init
git add .
git commit -m "Deployment: migrated core backend framework over to Render"
git branch -M main
git remote add origin https://github.com/SoumalyaSaha/Atmos-Server.git
git push -u origin main
```

### Step 2: Configure the Render Web Service
1. Access your primary [Render Dashboard](https://render.com).
2. Instantiate a **New +** → **Web Service** container.
3. Connect your active GitHub repository link (`Atmos-Server`).
4. Apply the following environmental properties:
   * **Runtime Environment:** `Node`
   * **Build Script:** `npm install`
   * **Start Execution Script:** `npm start` (or your root routing file e.g., `node server.js`)
5. Open the **Environment Variables** panel and securely inject your 7-Key array and MongoDB connection vectors.

---

## ⚙️ Core Environment Matrix

Configure these keys inside your hosting dashboard environment or local `.env` setup:

| Variable Identifier | Required | Functional Parameter |
|---|---|---|
| `GEMINI_API_KEY_1` | **Yes** | Primary Google Gemini 2.5 Flash Token |
| `GEMINI_API_KEY_2` | **Yes** | Rotational Google Gemini Key #2 |
| `GEMINI_API_KEY_3` | **Yes** | Rotational Google Gemini Key #3 |
| `GEMINI_API_KEY_4` | **Yes** | Rotational Google Gemini Key #4 |
| `GROQ_API_KEY_1` | **Yes** | High-Speed Groq Processing Key #1 |
| `GROQ_API_KEY_2` | **Yes** | High-Speed Groq Processing Key #2 |
| `GROQ_API_KEY_3` | **Yes** | High-Speed Groq Processing Key #3 |
| `MONGODB_URI` | **Yes** | Remote MongoDB Atlas Connection String |
| `NODE_ENV` | No | Target environment setting (`production`) |
| `FRONTEND_URL` | No | Configured target client URL for CORS matching |

> **Note on Ports:** Do not hardcode explicit ports in your entry files. Render maps ports dynamically. Ensure your root server initializes via `const PORT = process.env.PORT || 10000;`.

---

## 🛰️ Production API Endpoints

| Protocol | Route Mapping | Functional Domain Purpose |
|---|---|---|
| **GET** | `/` | Root router operational status & validation |
| **GET** | `/api/health` | Service availability handshake + LLM status monitoring |
| **POST**| `/api/carbon/calculate`| Computes telemetry footprints across user activity categories |
| **POST**| `/api/ai/insights` | Extracts tailored climate optimization strategies |
| **POST**| `/api/ai/chat` | Main socket/route routing for the Atmos Assistant chatbot |
| **GET** | `/api/challenges` | Queries active gamified daily sustainability missions |
| **POST**| `/api/carbon/savings` | Evaluates user prospective offset benchmarks |
| **GET** | `/api/leaderboard` | Extracts regional community podium rankings |
| **GET** | `/api/user/profile` | Pulls core identity metrics, levels, and user indicators |
| **PATCH**| `/api/user/profile`| Modifies profile details and user notification flags |
| **GET** | `/api/user/data` | Fetches historical database-persisted timeline metrics |
| **GET** | `/api/notifications`| Pulls live operational alert and reward queues |
| **GET** | `/api/health/mock-data`| Provides baseline device telemetry statistics |

---

## 🛑 Out-of-Quota API Response
If the combined 7-Key load balancer triggers complete upstream quota limits, the endpoint responds cleanly with a `200` series graceful exception container, preserving state:

```json
{
  "success": false,
  "error": "DAILY_LIMIT_EXHAUSTED",
  "message": "You have used the daily limit of Atmos AI. Please wait for the next day for reset.",
  "resetTime": "2026-08-04T00:00:00.000Z",
  "preservedData": {
    "totalCo2Saved": 98,
    "totalEcoPoints": 7200,
    "streak": 12,
    "badges": ["New Leaf", "First Week", "Savings Star"]
  }
}
```
