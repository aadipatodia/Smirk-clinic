# 🦷 Smirk Dental Clinic — Full-Stack Website

**Dr. Mehak Gupta | BDS | Vasant Kunj, Delhi**

Premium multi-page dental website with Node.js + Express + MongoDB appointment booking backend.

---

## 📁 Project Structure

```
smirk-dental/
├── frontend/
│   ├── index.html              ← Homepage (2-3 screens)
│   ├── css/
│   │   └── style.css           ← Global premium styles
│   ├── js/
│   │   └── shared.js           ← Nav, animations, utilities
│   └── pages/
│       ├── services.html       ← Full services with pricing
│       ├── gallery.html        ← Before/after gallery
│       ├── doctor.html         ← Dr. Mehak Gupta profile
│       ├── appointment.html    ← Live booking with slot UI
│       └── contact.html        ← Map + intake form
│
└── backend/
    ├── server.js               ← Express app entry point
    ├── package.json
    ├── .env.example            ← Copy to .env
    ├── models/
    │   └── Appointment.js      ← Mongoose schema
    └── routes/
        └── appointments.js     ← GET slots + POST booking
```

---

## 🚀 Quick Start

### 1. Backend Setup

```bash
cd backend
npm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env → add your MongoDB URI
```

### 2. Configure `.env`

```env
PORT=5000
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/smirk_dental
FRONTEND_URL=http://localhost:5500
```

### 3. Start the server

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 4. Serve the frontend

Any static server works:
```bash
# Option A: VS Code Live Server (port 5500)
# Option B: npx serve frontend
npx serve frontend -p 5500
# Option C: nginx / any web host
```

---

## 🗄️ MongoDB Atlas Setup (Free Tier)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create a free cluster (M0 Sandbox)
3. Database Access → Add user with password
4. Network Access → Add `0.0.0.0/0` (or your server IP)
5. Connect → Drivers → Copy connection string
6. Paste into `.env` as `MONGODB_URI`

### Database Schema

```json
Collection: appointments
{
  "_id": "ObjectId",
  "name": "Priya Sharma",
  "phone": "+91 98765 43210",
  "date": "2025-06-15",
  "time": "10:30 AM",
  "status": "confirmed",
  "createdAt": "2025-06-10T08:30:00.000Z",
  "updatedAt": "2025-06-10T08:30:00.000Z"
}
```

### API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/appointments?date=2025-06-15` | Returns booked slots for a date |
| `POST` | `/appointments` | Book an appointment |
| `DELETE` | `/appointments/:id` | Cancel an appointment |
| `GET` | `/health` | Server health check |

**GET Response:**
```json
{
  "success": true,
  "date": "2025-06-15",
  "bookedSlots": ["10:30 AM", "02:15 PM"],
  "availableSlots": ["09:00 AM", "09:30 AM", ...],
  "available": 18
}
```

**POST Body:**
```json
{
  "name": "Priya Sharma",
  "phone": "+91 98765 43210",
  "date": "2025-06-15",
  "time": "10:30 AM"
}
```

---

## ⭐ Google Reviews Integration

### ❌ NEVER generate fake reviews

### ✅ Option A — Elfsight (Recommended, Free Plan)

1. Sign up at [elfsight.com](https://elfsight.com)
2. Create → **Google Reviews** widget
3. Connect your Google Business Profile
4. Copy the embed code:
   ```html
   <script src="https://static.elfsight.com/platform/platform.js" defer></script>
   <div class="elfsight-app-XXXXXXXX" data-elfsight-app-lazy></div>
   ```
5. Paste into `frontend/index.html` → replace the `reviews-cards` section

### ✅ Option B — Trustindex (Also Free)

1. [trustindex.io](https://trustindex.io) → Google Reviews widget
2. Free plan available → embed code

### ✅ Google Review Redirect Button

Replace `REPLACE_WITH_GOOGLE_PLACE_ID` in ALL HTML files with your actual Place ID.

**How to find your Place ID:**
1. Go to [Google Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id)
2. Search "Smirk Dental Clinic Vasant Kunj Delhi"
3. Copy the Place ID (starts with `ChIJ...`)

**Review link format:**
```
https://g.page/r/YOUR_PLACE_ID/review
```

---

## 📱 Practo Integration

Profile URL (update if different):
```
https://www.practo.com/delhi/doctor/dr-mehak-gupta/recommended
```

Used in: `index.html`, `doctor.html`

---

## 🗺️ Google Maps Embed

1. Go to [Google Maps](https://maps.google.com)
2. Search "C6/7 Vasant Kunj Delhi" (or Smirk Dental Clinic)
3. Share → Embed a map → Copy `<iframe>` HTML
4. Paste into `pages/contact.html` → replace the existing iframe `src`

---

## 🚢 Deployment Options

### Frontend — Netlify (Free)
```bash
# Drag & drop the /frontend folder to netlify.com/drop
# Or use Netlify CLI:
npm i -g netlify-cli
netlify deploy --dir=frontend --prod
```

### Backend — Railway (Free Tier)
1. [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Add environment variables in Railway dashboard
3. Railway auto-detects Node.js via package.json

### Backend — Render (Free Tier)
1. [render.com](https://render.com) → New Web Service
2. Set Build Command: `npm install`
3. Set Start Command: `npm start`
4. Add env variables

After deployment, update `API_BASE` in `pages/appointment.html`:
```javascript
const API_BASE = 'https://your-railway-app.up.railway.app';
```

---

## 📧 Email Notifications (Optional)

Uncomment in `routes/appointments.js` and configure Nodemailer:

```javascript
// In .env:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password  // Gmail App Password (not your login password)
CLINIC_EMAIL=mehak@smirkdental.in
```

Gmail App Password: Google Account → Security → 2FA → App Passwords

---

## ✅ Checklist Before Going Live

- [ ] Replace all `REPLACE_WITH_GOOGLE_PLACE_ID` with real Place ID
- [ ] Update Google Maps embed src in `contact.html`
- [ ] Add real Elfsight/Trustindex widget to reviews section
- [ ] Set `MONGODB_URI` in `.env`
- [ ] Set `FRONTEND_URL` in `.env` to your domain
- [ ] Update `API_BASE` in `appointment.html` to your backend URL
- [ ] Test appointment booking end-to-end
- [ ] Add real doctor photo (replace SVG illustration)
- [ ] Add real before/after patient photos in `gallery.html`
- [ ] Update Practo URL if slug differs
- [ ] Configure SMTP for email notifications (optional)

---

## 🛡️ Security Features

- **Helmet.js** — HTTP security headers
- **Rate limiting** — 100 req/15min general, 5 bookings/hr per IP
- **CORS** — only your frontend domain
- **Express-validator** — input validation on all endpoints
- **MongoDB unique index** — prevents double booking at DB level
- **Race condition safe** — MongoDB `code 11000` duplicate key catch

---

**Built for Smirk Dental Clinic & Implant Centre | Dr. Mehak Gupta, BDS | Vasant Kunj, Delhi**
