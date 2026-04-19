# EcoLens — Full Stack Implementation

**BSE4203 — Software Engineering Standards and Ethics**
**Group 6**: Aine Levi (22/U/2903/EVE), Tusiime Emmanuel, Ssentongo Henry

---

## Project Structure

```
ecolens/
├── backend/                  # Node.js REST API
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── disposal.controller.js
│   │   │   └── airtime.controller.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   ├── models/
│   │   │   └── index.js
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── disposal.routes.js
│   │   │   └── airtime.routes.js
│   │   ├── app.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
│
├── mobile/                   # React Native (Expo) App
│   ├── src/
│   │   ├── context/
│   │   │   └── AuthContext.js
│   │   ├── navigation/
│   │   │   └── AppNavigator.js
│   │   ├── screens/
│   │   │   ├── LoginScreen.js
│   │   │   ├── RegisterScreen.js
│   │   │   ├── DashboardScreen.js
│   │   │   ├── HistoryScreen.js
│   │   │   ├── RedeemScreen.js
│   │   │   └── ProfileScreen.js
│   │   └── services/
│   │       └── api.js
│   ├── App.js
│   └── package.json
│
└── README.md
```

---

## Part 1: Backend Setup

### Prerequisites

- Node.js 18+ installed
- PostgreSQL installed and running
- A terminal / command prompt

### Step 1 — Create the database

```bash
# Open PostgreSQL shell
psql -U postgres

# Create the database
CREATE DATABASE ecolens_dev;
\q
```

### Step 2 — Configure environment variables

```bash
cd backend
cp .env.example .env
```

Edit `.env` and update `DATABASE_URL` with your PostgreSQL credentials:
```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/ecolens_dev
```

### Step 3 — Install dependencies and start

```bash
npm install
npm run dev
```

You should see:
```
✅ Database connected
✅ Models synchronized
🚀 EcoLens API running on http://localhost:3000
```

### Step 4 — Test the API

```bash
# Health check
curl http://localhost:3000/health

# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Levy","email":"levy@test.com","password":"123456","phone":"+256771222333"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"levy@test.com","password":"123456"}'
```

---

## Part 2: Mobile App Setup

### Prerequisites

- Node.js 18+ installed
- Expo CLI: `npm install -g expo-cli`
- Expo Go app on your phone (from App Store / Play Store)

### Step 1 — Install dependencies

```bash
cd mobile
npm install
```

### Step 2 — Configure the API URL

Edit `src/services/api.js` and change `API_BASE` to match your setup:

```javascript
// If running on a physical phone + backend on your computer:
const API_BASE = 'http://YOUR_COMPUTER_IP:3000';

// If using Android emulator:
const API_BASE = 'http://10.0.2.2:3000';

// If using iOS simulator:
const API_BASE = 'http://localhost:3000';
```

To find your computer's IP:
- **Windows**: `ipconfig` → look for IPv4 Address
- **Mac/Linux**: `ifconfig` or `ip addr` → look for your Wi-Fi IP

### Step 3 — Start the app

```bash
npx expo start
```

Scan the QR code with Expo Go on your phone, or press `a` for Android emulator / `i` for iOS simulator.

---

## API Endpoints Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | No | Register new user |
| POST | /api/auth/login | No | Login, returns JWT |
| GET | /api/auth/profile | JWT | Get profile + balance |
| PUT | /api/auth/phone | JWT | Update phone number |

### Disposal (from RPi or simulated)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/disposal/sessions/start | No* | Start session by userCode |
| POST | /api/disposal/events | No* | Record classification event |
| POST | /api/disposal/sessions/end | No* | End session |
| GET | /api/disposal/history | JWT | Get user's disposal history |
| GET | /api/disposal/stats | JWT | Get user's statistics |

*RPi endpoints use userCode validation, not JWT.

### Airtime
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/airtime/redeem | JWT | Redeem points for airtime |
| GET | /api/airtime/history | JWT | Get redemption history |
| POST | /api/airtime/callbacks/status | No | AT status webhook |

---

## Simulating Disposal Events (No Hardware)

Since you don't have the RPi hardware yet, you can simulate disposal events using curl or Postman:

```bash
# 1. Start a session with a user code (get the code from registration response)
curl -X POST http://localhost:3000/api/disposal/sessions/start \
  -H "Content-Type: application/json" \
  -d '{"userCode":"EC_YOUR_CODE"}'

# Copy the session ID from the response, then:

# 2. Simulate a valid plastic item
curl -X POST http://localhost:3000/api/disposal/events \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID_HERE","classifiedAs":"plastic_bottle","confidence":0.95,"isPlastic":true}'

# 3. Simulate an invalid item
curl -X POST http://localhost:3000/api/disposal/events \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID_HERE","classifiedAs":"unknown","confidence":0.45,"isPlastic":false}'

# 4. End the session
curl -X POST http://localhost:3000/api/disposal/sessions/end \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID_HERE"}'
```

After simulating events, open the mobile app and check the Dashboard — you'll see updated points, history, and stats.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile App | React Native (Expo) |
| Backend API | Node.js + Express.js |
| Database | PostgreSQL + Sequelize ORM |
| Auth | JWT (jsonwebtoken + bcryptjs) |
| Airtime | Africa's Talking Airtime API |
| AI Model | MobileNetV3-Small + TensorFlow Lite (RPi) |

---

## Mobile App Screens

1. **Login** — Email + password authentication
2. **Register** — Name, email, phone, password
3. **Dashboard** — User code, points, airtime value, stats, quick actions
4. **Disposal History** — Paginated list of all disposal events with status
5. **Redeem Airtime** — Points input, conversion preview, confirmation flow
6. **Profile** — Account info, phone edit, redemption history, logout
