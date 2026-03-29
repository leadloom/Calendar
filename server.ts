import express from "express";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("bookings.db");

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    phone TEXT,
    interest TEXT,
    project_details TEXT,
    start_time TEXT,
    end_time TEXT,
    event_id TEXT,
    status TEXT DEFAULT 'confirmed',
    reminder_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add missing columns if table already existed without them
const tableInfo = db.prepare("PRAGMA table_info(bookings)").all() as any[];
const columnNames = tableInfo.map(info => info.name);

if (!columnNames.includes("phone")) {
  db.exec("ALTER TABLE bookings ADD COLUMN phone TEXT;");
}
if (!columnNames.includes("interest")) {
  db.exec("ALTER TABLE bookings ADD COLUMN interest TEXT;");
}
if (!columnNames.includes("status")) {
  db.exec("ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'confirmed';");
}
if (!columnNames.includes("reminder_sent")) {
  db.exec("ALTER TABLE bookings ADD COLUMN reminder_sent INTEGER DEFAULT 0;");
}

const app = express();
app.set("trust proxy", 1);
const PORT = 3000;

app.set('trust proxy', true);

// Logging middleware (Top level)
app.use((req, res, next) => {
  if (req.url.startsWith("/api")) {
    console.log(`[INCOMING] ${req.method} ${req.url}`);
  }
  next();
});

app.use(express.json());
app.use(cookieParser());

app.get("/api/ping", (req, res) => {
  res.json({ success: true, message: "pong", time: new Date().toISOString() });
});

app.use(
  cookieSession({
    name: "lead_loom_session",
    keys: ["lead-loom-secret-v3"], // Stable key
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: true,
    sameSite: "none",
    httpOnly: true,
    path: "/",
    overwrite: true,
    signed: true,
  })
);

// Debug Routes (Early)
app.get("/api/debug/session", (req, res) => {
  console.log("Debug Route Hit: /api/debug/session");
  res.json({ 
    sessionExists: !!req.session,
    isAdmin: (req.session as any)?.isAdmin,
    userEmail: (req.session as any)?.userEmail,
    cookie: req.headers.cookie ? "Present" : "Missing",
    userAgent: req.headers["user-agent"],
    sessionData: req.session
  });
});

// DANGEROUS: Only for debugging login issues
app.get("/api/debug/force-admin", (req, res) => {
  console.log("Debug Route Hit: /api/debug/force-admin");
  console.log("Current Session before force:", req.session);

  if (req.session) {
    (req.session as any).isAdmin = true;
    (req.session as any).userEmail = "forced-admin@debug.local";
    (req.session as any).lastUpdate = new Date().toISOString();
    
    console.log("Session forced to admin successfully. New Session:", req.session);
    
    res.cookie("isAdmin", "true", { 
      maxAge: 30 * 24 * 60 * 60 * 1000, 
      secure: true, 
      sameSite: "none", 
      httpOnly: false // Allow client to see it for debugging
    });

    res.json({ 
      success: true, 
      message: "Session forced to admin. PLEASE REFRESH THE PAGE.",
      isAdmin: (req.session as any).isAdmin,
      userEmail: (req.session as any).userEmail
    });
  } else {
    console.error("No session object found in request!");
    res.status(500).json({ success: false, message: "No session object found. Check middleware configuration." });
  }
});

app.get("/api/debug/test-session", (req, res) => {
  console.log("Debug Route Hit: /api/debug/test-session");
  if (req.session) {
    (req.session as any).testValue = ( (req.session as any).testValue || 0 ) + 1;
    console.log("Session test value incremented:", (req.session as any).testValue);
    res.json({ success: true, message: `Value is now ${(req.session as any).testValue}` });
  } else {
    res.status(500).json({ success: false, message: "No session" });
  }
});

app.get("/api/debug/env", (req, res) => {
  res.json({ 
    adminEmailSet: !!process.env.ADMIN_EMAIL,
    adminEmail: process.env.ADMIN_EMAIL,
    nodeEnv: process.env.NODE_ENV,
    appUrl: process.env.APP_URL
  });
});

const getRedirectUri = () => {
  const baseUrl = process.env.APP_URL?.replace(/\/$/, "");
  return `${baseUrl}/auth/callback`;
};

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  getRedirectUri()
);

// Helper to get stored tokens
function getStoredTokens() {
  return db.prepare("SELECT * FROM tokens WHERE id = 1").get() as any;
}

// Helper to save tokens
function saveTokens(tokens: any) {
  const existing = getStoredTokens();
  if (existing) {
    db.prepare(
      "UPDATE tokens SET access_token = ?, refresh_token = ?, expiry_date = ? WHERE id = 1"
    ).run(tokens.access_token, tokens.refresh_token || existing.refresh_token, tokens.expiry_date);
  } else {
    db.prepare(
      "INSERT INTO tokens (id, access_token, refresh_token, expiry_date) VALUES (1, ?, ?, ?)"
    ).run(tokens.access_token, tokens.refresh_token, tokens.expiry_date);
  }
}

// Helper to get the correct redirect URI based on the request
const getRequestRedirectUri = (req: express.Request) => {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["host"];
  return `${protocol}://${host}/auth/callback`;
};

// Auth Routes
app.get("/api/auth/url", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "Google OAuth credentials are not configured in Secrets." });
  }

  // Use the origin passed from the frontend, or fallback to the env var
  const clientOrigin = req.query.origin as string;
  const redirectUri = clientOrigin 
    ? `${clientOrigin.replace(/\/$/, "")}/auth/callback`
    : getRedirectUri();

  // Store the redirectUri in the session so we use the EXACT same one in the callback
  (req.session as any).authRedirectUri = redirectUri;

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    prompt: "consent",
    redirect_uri: redirectUri,
  });
  res.json({ url });
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  console.log(`Auth Callback: Started for session ${req.sessionID}`);
  
  // Retrieve the EXACT redirectUri used to generate the auth URL
  const redirectUri = (req.session as any).authRedirectUri || getRedirectUri();
  console.log(`Auth Callback: Using redirectUri: ${redirectUri}`);

  try {
    const { tokens } = await oauth2Client.getToken({
      code: code as string,
      redirect_uri: redirectUri,
    });
    saveTokens(tokens);
    
    // Get user info to verify admin
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    console.log(`Auth Callback: User Info Received:`, {
      email: userInfo.data.email,
      id: userInfo.data.id,
      verified: userInfo.data.verified_email
    });
    
    const userEmail = userInfo.data.email?.toLowerCase().trim();
    const rawAdminEmail = process.env.ADMIN_EMAIL || "omar@leadloom.io";
    const adminEmail = rawAdminEmail.toLowerCase().trim();
    
    console.log(`Auth Callback: Comparison Details:`, {
      userEmail,
      adminEmail,
      rawAdminEmail,
      userEmailLength: userEmail?.length,
      adminEmailLength: adminEmail?.length,
      match: userEmail === adminEmail,
      sessionAvailable: !!req.session
    });
    
    if (userEmail && adminEmail && userEmail === adminEmail) {
      console.log("Auth Callback: Admin verified successfully.");
      (req.session as any).isAdmin = true;
      (req.session as any).userEmail = userEmail;
    } else {
      console.log(`Auth Callback: Admin verification failed. ${userEmail} !== ${adminEmail}`);
      (req.session as any).isAdmin = false;
      (req.session as any).userEmail = userEmail;
    }

    res.send(`
      <html>
        <body>
          <script>
            console.log("Popup: Auth callback reached, sending message...");
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              console.log("Popup: Message sent, closing in 500ms...");
              setTimeout(() => {
                window.close();
              }, 500);
            } else {
              console.log("Popup: No opener found, redirecting to /");
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).send("Authentication failed");
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// Test Cookie Routes
app.get("/api/debug/set-cookie", (req, res) => {
  console.log("Debug Route Hit: /api/debug/set-cookie");
  res.cookie("test_cookie", "works", {
    secure: true,
    sameSite: "none",
    httpOnly: true,
    maxAge: 3600000,
    path: "/"
  });
  res.json({ success: true, message: "Test cookie set. Check now." });
});

app.get("/api/debug/check-cookie", (req, res) => {
  console.log("Debug Route Hit: /api/debug/check-cookie");
  const cookies = req.headers.cookie || "";
  console.log("Current Cookies:", cookies);
  res.json({ 
    cookies: cookies || "NONE",
    testCookie: cookies.includes("test_cookie") ? "FOUND" : "NOT FOUND"
  });
});

app.use((req, res, next) => {
  next();
});

app.get("/api/auth/status", (req, res) => {
  const tokens = getStoredTokens();
  const isAdmin = (req.session as any)?.isAdmin || req.cookies?.isAdmin === "true";
  res.json({ 
    connected: !!tokens,
    isAdmin: isAdmin
  });
});

// Availability Route
app.get("/api/availability", async (req, res) => {
  const tokens = getStoredTokens();
  if (!tokens) return res.status(401).json({ error: "Not connected" });

  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    const now = new Date();
    const end = new Date();
    end.setDate(now.getDate() + 7); // Next 7 days

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: "primary" }],
      },
    });

    res.json(response.data.calendars?.primary?.busy || []);
  } catch (error) {
    console.error("Availability error:", error);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

// Email Template Helper
const getEmailTemplate = (name: string, startTime: string, meetLink: string, bookingId: number, type: 'confirmation' | 'reminder', recipientName?: string) => {
  const dateStr = new Date(startTime).toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    timeZoneName: 'short'
  });
  
  const baseUrl = process.env.APP_URL?.replace(/\/$/, "");
  const cancelUrl = `${baseUrl}/cancel?id=${bookingId}`;
  const rescheduleUrl = `${baseUrl}/reschedule?id=${bookingId}`;

  const title = type === 'confirmation' ? 'Meeting Confirmed' : 'Meeting Reminder';
  const displayRecipient = recipientName || name;
  const subtitle = type === 'confirmation' 
    ? `Hi ${displayRecipient}, your session with Omar Alahmadi is locked in.` 
    : `Hi ${displayRecipient}, this is a reminder for your upcoming session with Omar Alahmadi.`;

  return `
    <div style="background-color: #0A0F1C; color: #FFFFFF; padding: 40px; font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #1A1F2C;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #00CFFF; font-family: 'Space Grotesk', sans-serif; margin: 0; font-size: 28px; letter-spacing: -0.02em;">${title}</h1>
        <p style="opacity: 0.6; font-size: 14px; margin-top: 8px;">${subtitle}</p>
      </div>
      
      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(0, 207, 255, 0.2); border-radius: 16px; padding: 24px; margin-bottom: 30px;">
        <div style="margin-bottom: 16px;">
          <p style="text-transform: uppercase; font-size: 10px; letter-spacing: 0.1em; opacity: 0.4; margin: 0 0 4px 0;">Date & Time</p>
          <p style="font-size: 16px; margin: 0; font-weight: 500;">${dateStr}</p>
        </div>
        
        <div style="margin-bottom: 24px;">
          <p style="text-transform: uppercase; font-size: 10px; letter-spacing: 0.1em; opacity: 0.4; margin: 0 0 4px 0;">Location</p>
          <a href="${meetLink}" style="color: #00CFFF; text-decoration: none; font-size: 16px; font-weight: 500;">Join Google Meet →</a>
        </div>

        <div style="display: flex; gap: 12px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 20px;">
          <a href="${rescheduleUrl}" style="background: #A020F0; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;">Reschedule</a>
          <a href="${cancelUrl}" style="background: rgba(255, 79, 224, 0.1); color: #FF4FE0; border: 1px solid rgba(255, 79, 224, 0.3); text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-left: 10px;">Cancel Meeting</a>
        </div>
      </div>

      <div style="text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 30px;">
        <p style="opacity: 0.4; font-size: 12px; margin: 0;">Omar Alahmadi • Lead Loom Engineering</p>
        <p style="opacity: 0.3; font-size: 10px; margin-top: 4px;">This is an automated message. Please do not reply.</p>
      </div>
    </div>
  `;
};

// Booking Route
app.post("/api/book", async (req, res) => {
  const { name, email, phone, interest, projectDetails, startTime, endTime } = req.body;
  const tokens = getStoredTokens();
  if (!tokens) return res.status(401).json({ error: "Not connected" });

  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    // 1. Create Calendar Event
    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Lead Loom [${interest}]: ${name}`,
        description: `Client: ${name}\nEmail: ${email}\nPhone: ${phone}\nInterest: ${interest}\n\nProject Details: ${projectDetails}\n\nBooked via Lead Loom.`,
        start: { dateTime: startTime },
        end: { dateTime: endTime },
        attendees: [{ email }, { email: process.env.ADMIN_EMAIL || 'Omar@leadloom.io' }],
        conferenceData: {
          createRequest: {
            requestId: `lead-loom-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    const meetLink = event.data.hangoutLink;

    // 2. Save to DB
    const result = db.prepare(
      "INSERT INTO bookings (name, email, phone, interest, project_details, start_time, end_time, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(name, email, phone, interest, projectDetails, startTime, endTime, event.data.id);

    const bookingId = result.lastInsertRowid as number;

    // 3. Send Confirmation Emails
    const sendEmail = async (to: string, subject: string, recipientName?: string) => {
      const emailContent = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        getEmailTemplate(name, startTime, meetLink!, bookingId, 'confirmation', recipientName)
      ].join("\n");

      const encodedEmail = Buffer.from(emailContent)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedEmail },
      });
    };

    // Send to user
    await sendEmail(email, "Omar Alahmadi - Meeting Confirmation");
    // Send to admin
    if (process.env.ADMIN_EMAIL && email !== process.env.ADMIN_EMAIL) {
      await sendEmail(process.env.ADMIN_EMAIL, `New Booking: ${name}`, "Omar Alahmadi");
    }

    res.json({ success: true, meetLink });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ error: "Booking failed" });
  }
});

// Cancel Route
app.post("/api/cancel", async (req, res) => {
  const { id } = req.body;
  const tokens = getStoredTokens();
  if (!tokens) return res.status(401).json({ error: "Not connected" });

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get() as any;
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    if (booking.event_id) {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: booking.event_id,
      });
    }

    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (error) {
    console.error("Cancel error:", error);
    res.status(500).json({ error: "Failed to cancel" });
  }
});

// Reminder Logic (Run every 15 minutes)
setInterval(async () => {
  const tokens = getStoredTokens();
  if (!tokens) return;

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowPlus15 = new Date(tomorrow.getTime() + 15 * 60 * 1000);

  const dueReminders = db.prepare(`
    SELECT * FROM bookings 
    WHERE status = 'confirmed' 
    AND reminder_sent = 0 
    AND start_time BETWEEN ? AND ?
  `).all(tomorrow.toISOString(), tomorrowPlus15.toISOString()) as any[];

  if (dueReminders.length === 0) return;

  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  for (const booking of dueReminders) {
    try {
      const event = await calendar.events.get({
        calendarId: "primary",
        eventId: booking.event_id,
      });

      const emailContent = [
        `To: ${booking.email}`,
        `Subject: Reminder: Your meeting with Omar Alahmadi is in 24 hours`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        getEmailTemplate(booking.name, booking.start_time, event.data.hangoutLink!, booking.id, 'reminder')
      ].join("\n");

      const encodedEmail = Buffer.from(emailContent)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedEmail },
      });

      db.prepare("UPDATE bookings SET reminder_sent = 1 WHERE id = ?").run(booking.id);
      console.log(`Reminder sent to ${booking.email}`);
    } catch (err) {
      console.error(`Failed to send reminder for booking ${booking.id}`, err);
    }
  }
}, 15 * 60 * 1000);

// Admin Stats
app.get("/api/admin/stats", (req, res) => {
  if (!(req.session as any)?.isAdmin) return res.status(403).json({ error: "Forbidden" });

  const total = db.prepare("SELECT COUNT(*) as count FROM bookings").get() as any;
  const cancelled = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'cancelled'").get() as any;
  const rescheduled = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'rescheduled'").get() as any;
  const recent = db.prepare("SELECT * FROM bookings ORDER BY created_at DESC LIMIT 50").all();
  
  res.json({
    total: total.count,
    cancelled: cancelled.count,
    rescheduled: rescheduled.count,
    recent: recent
  });
});

// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/admin", (req, res) => {
  res.redirect("/?view=admin");
});

// Vite Middleware
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
