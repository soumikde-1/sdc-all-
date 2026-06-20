import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import type { Database, Student, Video, Topic } from "./src/types";

// --- FIREBASE SYNC INTEGRATION ---
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCVUenkAaORlottQB2JfHztBpprBHE43vs",
  authDomain: "savefolders-f37ae.firebaseapp.com",
  projectId: "savefolders-f37ae",
  storageBucket: "savefolders-f37ae.firebasestorage.app",
  messagingSenderId: "823511819961",
  appId: "1:823511819961:web:29dbc2d82ecb6089e11d68",
  measurementId: "G-098EBPSNYM"
};
const firebaseApp = initializeApp(firebaseConfig);
const firestoreDbHandler = getFirestore(firebaseApp);

async function pullDbFromFirestore() {
  try {
    const snap = await getDoc(doc(firestoreDbHandler, 'system', 'database'));
    if (snap.exists()) {
      const db = snap.data();
      fs.writeFileSync('database.json', JSON.stringify(db, null, 2));
      console.log('Successfully pulled database from Firestore.');
    } else {
      console.log('No database found in Firestore, retaining defaults.');
    }
  } catch (err) {
    console.error('Failed to pull from Firestore:', err);
  }
}

async function pushDbToFirestore(db: Database) {
  try {
    await setDoc(doc(firestoreDbHandler, 'system', 'database'), db);
  } catch (err) {
    console.error('Failed to push to Firestore:', err);
  }
}
// ---------------------------------


const app = express();
const PORT = 3000;

app.use(express.json());

const DB_FILE = path.join(process.cwd(), "database.json");

// Initialize Database if not exists
if (!fs.existsSync(DB_FILE)) {
  const initialDb: Database = {
    students: [],
    videos: [],
    subjects: ["Mathematics", "Science", "History", "English"],
    topics: [
      { name: "Algebra", subject: "Mathematics" },
      { name: "Physics", subject: "Science" },
      { name: "World War II", subject: "History" },
      { name: "Grammar", subject: "English" }
    ],
    classes: ["Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10"],
    materials: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
}

function getDb(): Database {
  const data = fs.readFileSync(DB_FILE, "utf-8");
  const db = JSON.parse(data);
  let needsSave = false;

  if (!db.classes) {
    db.classes = ["Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10"];
    needsSave = true;
  }

  if (!db.materials) {
    db.materials = [];
    needsSave = true;
  }

  if (!db.topics) {
    db.topics = [];
    needsSave = true;
  }

  // Migrate string topics to object topics
  if (db.topics && db.topics.length > 0 && typeof db.topics[0] === 'string') {
    const firstSubject = db.subjects?.[0] || "Mathematics";
    db.topics = db.topics.map((t: any) => ({
      name: typeof t === 'string' ? t : t.name,
      subject: typeof t === 'string' ? firstSubject : (t.subject || firstSubject)
    }));
    needsSave = true;
  }

  if (needsSave) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
  return db;
}

function saveDb(db: Database) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  pushDbToFirestore(db).catch(console.error);
}

// Generate unique session token
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Middleware to verify session
const verifySession = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (token === "admin-session-token-hardcoded") {
    (req as any).user = { role: "admin" };
    return next();
  }

  const db = getDb();
  const student = db.students.find(s => s.sessionToken === token);
  
  if (!student) {
    return res.status(401).json({ error: "You have been logged out because your account was accessed from another device." });
  }
  
  (req as any).user = { role: "student", id: student.id, className: student.className, email: student.email };
  next();
};

// API: Auth / Login
app.post("/api/login", (req, res) => {
  const { email, password, name } = req.body;

  // Admin login
  if (email === "desoumikde.2005@gmail.com" && password === "SOUMIKDEY2005") {
    return res.json({ token: "admin-session-token-hardcoded", role: "admin" });
  }

  // Student Login
  if (!email || !name) {
    return res.status(400).json({ error: "Please enter both your Gmail and exact Whitelisted Name." });
  }

  const db = getDb();
  
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim().toLowerCase();

  // Find any student by exact email
  const studentWithEmail = db.students.find(s => s.email.trim().toLowerCase() === trimmedEmail);

  if (studentWithEmail) {
    // If student exists but name does not match
    if (studentWithEmail.name.trim().toLowerCase() !== trimmedName) {
      return res.status(403).json({ error: "please write your admition time name" });
    }
  } else {
    // If the email is not found at all
    return res.status(403).json({ error: "Access Denied. Ensure your Gmail is whitelisted by SDC." });
  }

  const student = studentWithEmail;

  // Found student. Recreate session token for strict single-device limit.
  const token = generateToken();
  student.sessionToken = token;
  
  saveDb(db);
  
  res.json({ token, role: "student", name: student.name, email: student.email, className: student.className, userId: student.id });
});

// API: Logout
app.post("/api/logout", verifySession, (req, res) => {
  const user = (req as any).user;
  if (user.role === "student") {
    const db = getDb();
    const student = db.students.find(s => s.id === user.id);
    if (student) {
      delete student.sessionToken;
      saveDb(db);
    }
  }
  res.json({ success: true });
});

// API: Admin endpoints
app.get("/api/admin/data", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const db = getDb();
  res.json({
    students: db.students.map(s => ({ ...s, sessionToken: undefined })), // hide token
    videos: db.videos,
    subjects: db.subjects,
    topics: db.topics,
    classes: db.classes || [],
    materials: db.materials || [],
  });
});

// Create Whitelisted Student
app.post("/api/admin/students", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { email, name, className } = req.body;
  const db = getDb();
  
  if (db.students.find(s => s.email.trim().toLowerCase() === email.trim().toLowerCase())) {
    return res.status(400).json({ error: "Student email is already whitelisted" });
  }
  
  db.students.push({ id: crypto.randomUUID(), email: email.trim(), name: name.trim(), className });
  saveDb(db);
  res.json({ success: true });
});


// Add Material
app.post("/api/admin/materials", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { title, link, className, subject, topic } = req.body;
  const db = getDb();
  
  db.materials.push({ id: crypto.randomUUID(), title, link, className, subject, topic });
  saveDb(db);
  res.json({ success: true });
});

// Delete Material
app.delete("/api/admin/materials/:id", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const db = getDb();
  db.materials = db.materials.filter((m: any) => m.id !== req.params.id);
  saveDb(db);
  res.json({ success: true });
});

// Update Material
app.put("/api/admin/materials/:id", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const db = getDb();
  const index = db.materials.findIndex((m: any) => m.id === req.params.id);
  if (index !== -1) {
    db.materials[index] = { ...db.materials[index], ...req.body };
    saveDb(db);
  }
  res.json({ success: true });
});

// Edit whitelisted student
app.put("/api/admin/students/:id", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { email, name, className } = req.body;
  const db = getDb();
  const index = db.students.findIndex(s => s.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Student not found" });
  }

  const emailLower = email.trim().toLowerCase();
  const dup = db.students.find(s => s.id !== req.params.id && s.email.trim().toLowerCase() === emailLower);
  if (dup) {
    return res.status(400).json({ error: "Another student is already whitelisted with this email." });
  }

  db.students[index] = {
    ...db.students[index],
    email: email.trim(),
    name: name.trim(),
    className
  };

  saveDb(db);
  res.json({ success: true });
});

// Delete whitelisted student
app.delete("/api/admin/students/:id", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const db = getDb();
  db.students = db.students.filter(s => s.id !== req.params.id);
  saveDb(db);
  res.json({ success: true });
});

// Create Video / Lesson
app.post("/api/admin/videos", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { ytEmbedCode, title, className, subject, topic } = req.body;
  const db = getDb();

  if (!ytEmbedCode) {
    return res.status(400).json({ error: "YouTube HTML embed code or video link is required" });
  }

  let ytId: string | null = null;
  const cleanInput = ytEmbedCode.trim();

  // Parse exact 11-char Video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanInput)) {
    ytId = cleanInput;
  } else {
    const match = cleanInput.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|youtube-nocookie\.com\/embed\/|shorts\/))([\w-]{11})/);
    if (match && match[1]) {
      ytId = match[1];
    }
  }

  if (!ytId || ytId.length !== 11) {
    return res.status(400).json({ error: "Could not locate a valid 11-character YouTube Video ID in the pasted embed code or link." });
  }

  db.videos.push({ id: crypto.randomUUID(), ytId, title: title.trim(), className, subject, topic });
  saveDb(db);
  
  // NOTE: Android Studio FCM Backend Push Notification System
  // When this is pushed to a real production environment with Firebase Admin SDK configured,
  // we would fire off a push notification targeting the topic for the class:
  // e.g. admin.messaging().send({ topic: `class_${className.replace(/\s+/g, '_')}`, notification: { title: "New Video", body: title } });
  console.log(`[PUSH NOTIFICATION SYSTEM] -> Triggering push to topic 'class_${className.replace(/\s+/g, '_')}' for New Video: ${title}`);
  
  res.json({ success: true });
});

// Edit Video / Lesson
app.put("/api/admin/videos/:id", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { ytEmbedCode, title, className, subject, topic } = req.body;
  const db = getDb();
  const index = db.videos.findIndex(v => v.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Video not found" });
  }

  let ytId = db.videos[index].ytId;
  if (ytEmbedCode) {
    const cleanInput = ytEmbedCode.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanInput)) {
      ytId = cleanInput;
    } else {
      const match = cleanInput.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|youtube-nocookie\.com\/embed\/|shorts\/))([\w-]{11})/);
      if (match && match[1]) {
        ytId = match[1];
      } else if (cleanInput !== "") {
        return res.status(400).json({ error: "Failed to extract active YouTube Video ID from the input." });
      }
    }
  }

  db.videos[index] = {
    ...db.videos[index],
    ytId,
    title: title.trim(),
    className,
    subject,
    topic
  };

  saveDb(db);
  res.json({ success: true });
});

// Delete Video / Lesson
app.delete("/api/admin/videos/:id", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const db = getDb();
  db.videos = db.videos.filter(v => v.id !== req.params.id);
  saveDb(db);
  res.json({ success: true });
});

// Custom Classes API Add/Edit/Delete
app.post("/api/admin/classes", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { action, name, oldName } = req.body;
  const db = getDb();
  if (action === 'add') {
    if (!db.classes.includes(name.trim())) db.classes.push(name.trim());
  } else if (action === 'edit' && oldName) {
    db.classes = db.classes.map(c => c === oldName ? name.trim() : c);
    db.students = db.students.map(s => s.className === oldName ? { ...s, className: name.trim() } : s);
    db.videos = db.videos.map(v => v.className === oldName ? { ...v, className: name.trim() } : v);
  } else if (action === 'delete') {
    db.classes = db.classes.filter(c => c !== name);
    db.students = db.students.filter(s => s.className !== name);
    db.videos = db.videos.filter(v => v.className !== name);
  }
  saveDb(db);
  res.json({ success: true });
});

// Custom Subjects API Add/Edit/Delete
app.post("/api/admin/subjects", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { action, name, oldName } = req.body;
  const db = getDb();
  if (action === 'add') {
    if (!db.subjects.includes(name.trim())) db.subjects.push(name.trim());
  } else if (action === 'edit' && oldName) {
    db.subjects = db.subjects.map(s => s === oldName ? name.trim() : s);
    db.videos = db.videos.map(v => v.subject === oldName ? { ...v, subject: name.trim() } : v);
    db.topics = db.topics.map(t => t.subject === oldName ? { ...t, subject: name.trim() } : t);
  } else if (action === 'delete') {
    db.subjects = db.subjects.filter(s => s !== name);
    db.topics = db.topics.filter(t => t.subject !== name);
    db.videos = db.videos.filter(v => v.subject !== name);
  }
  saveDb(db);
  res.json({ success: true });
});

// Custom Topics API (linked under Subjects) Add/Edit/Delete
app.post("/api/admin/topics", verifySession, (req, res) => {
  if ((req as any).user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { action, name, oldName, subject, oldSubject } = req.body;
  const db = getDb();

  if (action === 'add') {
    const exists = db.topics.some(t => t.name.toLowerCase() === name.trim().toLowerCase() && t.subject === subject);
    if (!exists) {
      db.topics.push({ name: name.trim(), subject });
    }
  } else if (action === 'edit' && oldName && oldSubject) {
    db.topics = db.topics.map(t => (t.name === oldName && t.subject === oldSubject) ? { name: name.trim(), subject } : t);
    db.videos = db.videos.map(v => (v.topic === oldName && v.subject === oldSubject) ? { ...v, topic: name.trim(), subject: subject } : v);
  } else if (action === 'delete') {
    db.topics = db.topics.filter(t => !(t.name === name && t.subject === subject));
    db.videos = db.videos.filter(v => !(v.topic === name && v.subject === subject));
  }
  saveDb(db);
  res.json({ success: true });
});

// API: Student endpoints
app.get("/api/student/videos", verifySession, (req, res) => {
  const user = (req as any).user;
  if (user.role !== "student") return res.status(403).json({ error: "Forbidden" });
  
  const db = getDb();
  const myVideos = db.videos.filter(v => v.className === user.className);
  const myMaterials = db.materials ? db.materials.filter(m => m.className === user.className) : [];
  
  res.json({ videos: myVideos, subjects: db.subjects, topics: db.topics, materials: myMaterials });
});


// Vite middleware for development or Serve static files in production
async function startServer() {
  await pullDbFromFirestore();
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
