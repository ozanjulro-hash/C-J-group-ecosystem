require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
const PORT = process.env.PORT || 3000;
const clients = new Set();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS bookings (id BIGSERIAL PRIMARY KEY, reference TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, department TEXT NOT NULL CHECK (department IN ('Hospital','Hotel','Gym')), service TEXT NOT NULL, preferred_date DATE, preferred_time TEXT, guests INTEGER, message TEXT, status TEXT NOT NULL DEFAULT 'New', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS income (id BIGSERIAL PRIMARY KEY, department TEXT NOT NULL CHECK (department IN ('Hospital','Hotel','Gym')), amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0), entry_date DATE NOT NULL DEFAULT CURRENT_DATE, note TEXT, created_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS staff (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, role TEXT, department TEXT, phone TEXT, pay NUMERIC(12,2) DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'Unpaid', payment_date DATE, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS bookings_created_idx ON bookings(created_at DESC);
    CREATE INDEX IF NOT EXISTS income_date_idx ON income(entry_date DESC);
  `);
}
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  try { const decoded = jwt.verify(token, process.env.JWT_SECRET); req.user = decoded; next(); }
  catch { return res.status(401).json({error:'Please sign in again.'}); }
}
function owner(req,res,next) { if(req.user.role !== 'owner') return res.status(403).json({error:'Owner access required.'}); next(); }
function notifyClients(event, data) { const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const res of clients) res.write(payload); }
async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  try { await fetch('https://api.resend.com/emails', { method:'POST', headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({from:process.env.EMAIL_FROM,to:[process.env.OWNER_EMAIL || 'ozanjulro@gmail.com'],subject,html}) }); }
  catch(e) { console.error('Email notification failed:',e.message); }
}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'C&J Group API'}));
app.post('/api/setup/owner', async (req,res)=>{
  try {
    if (!process.env.BOOTSTRAP_SECRET || req.body.bootstrapSecret !== process.env.BOOTSTRAP_SECRET) return res.status(403).json({error:'Invalid setup key.'});
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='owner'");
    if(count.rows[0].n) return res.status(409).json({error:'Owner account has already been created.'});
    const {name,email,password}=req.body;
    if(!name || !email || !password || password.length < 10) return res.status(400).json({error:'Enter your name, email and a password of at least 10 characters.'});
    const hash=await bcrypt.hash(password,12);
    const result=await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,LOWER($2),$3,'owner') RETURNING id,name,email,role",[name,email,hash]);
    res.status(201).json({user:result.rows[0]});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not create owner account.'}); }
});
app.post('/api/auth/login', async(req,res)=>{
  const {email,password}=req.body;
  const q=await pool.query('SELECT * FROM users WHERE email=LOWER($1) AND active=true',[email||'']);
  if(!q.rows[0] || !await bcrypt.compare(password||'',q.rows[0].password_hash)) return res.status(401).json({error:'Email or password is incorrect.'});
  const u=q.rows[0], token=jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role},process.env.JWT_SECRET,{expiresIn:'12h'});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
});
app.post('/api/bookings', async(req,res)=>{
  try {
    const {name,email,phone,department,service,date,time,guests,message}=req.body;
    if(!name||!email||!phone||!department||!service) return res.status(400).json({error:'Please complete all required fields.'});
    if(!['Hospital','Hotel','Gym'].includes(department)) return res.status(400).json({error:'Choose a valid department.'});
    const reference='CJ-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
    const q=await pool.query(`INSERT INTO bookings(reference,customer_name,email,phone,department,service,preferred_date,preferred_time,guests,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[reference,name,email,phone,department,service,date||null,time||null,guests||null,message||null]);
    const b=q.rows[0];
    notifyClients('booking',b);
    sendEmail(`New C&J ${department} booking — ${reference}`,`<h2>New booking received</h2><p><b>Reference:</b> ${reference}</p><p><b>Customer:</b> ${escapeHtml(name)}</p><p><b>Email:</b> ${escapeHtml(email)}</p><p><b>Phone:</b> ${escapeHtml(phone)}</p><p><b>Department:</b> ${department}</p><p><b>Service:</b> ${escapeHtml(service)}</p><p><b>Date/time:</b> ${date||'Not specified'} ${time||''}</p><p><b>Message:</b> ${escapeHtml(message||'—')}</p>`);
    res.status(201).json({ok:true,reference,message:'Your request has been received.'});
  } catch(e){ console.error(e); res.status(500).json({error:'Booking could not be submitted. Please try again.'}); }
});
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
app.get('/api/admin/events',(req,res)=>{
  try { req.user = jwt.verify(req.query.token || '', process.env.JWT_SECRET); } catch { return res.status(401).end(); }
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();res.write('event: connected\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res));
});
app.get('/api/admin/bookings',auth,async(req,res)=>{const q=await pool.query('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500');res.json(q.rows);});
app.patch('/api/admin/bookings/:id',auth,async(req,res)=>{const {status}=req.body;if(!['New','Confirmed','Completed','Cancelled'].includes(status))return res.status(400).json({error:'Invalid status.'});const q=await pool.query('UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,req.params.id]);if(!q.rows[0])return res.status(404).json({error:'Booking not found.'});notifyClients('booking-update',q.rows[0]);res.json(q.rows[0]);});
app.get('/api/admin/income',auth,async(req,res)=>{const q=await pool.query('SELECT i.*,u.name AS entered_by FROM income i LEFT JOIN users u ON u.id=i.created_by ORDER BY entry_date DESC, id DESC LIMIT 1000');res.json(q.rows);});
app.post('/api/admin/income',auth,async(req,res)=>{const {department,amount,date,note}=req.body;if(!['Hospital','Hotel','Gym'].includes(department)||!Number.isFinite(Number(amount))||Number(amount)<0)return res.status(400).json({error:'Enter a valid department and amount.'});const q=await pool.query('INSERT INTO income(department,amount,entry_date,note,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[department,amount,date||new Date().toISOString().slice(0,10),note||'',req.user.id]);res.status(201).json(q.rows[0]);});
app.get('/api/admin/staff',auth,async(req,res)=>{const q=await pool.query('SELECT * FROM staff ORDER BY name');res.json(q.rows);});
app.post('/api/admin/staff',auth,async(req,res)=>{const {name,role,department,phone,pay,payment_status,payment_date}=req.body;if(!name)return res.status(400).json({error:'Staff name is required.'});const q=await pool.query('INSERT INTO staff(name,role,department,phone,pay,payment_status,payment_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[name,role||'',department||'',phone||'',Number(pay)||0,payment_status||'Unpaid',payment_date||null]);res.status(201).json(q.rows[0]);});
app.patch('/api/admin/staff/:id',auth,async(req,res)=>{const {payment_status,payment_date}=req.body;if(!['Paid','Unpaid'].includes(payment_status))return res.status(400).json({error:'Invalid payment status.'});const q=await pool.query('UPDATE staff SET payment_status=$1,payment_date=$2 WHERE id=$3 RETURNING *',[payment_status,payment_date||null,req.params.id]);if(!q.rows[0])return res.status(404).json({error:'Staff member not found.'});res.json(q.rows[0]);});
app.post('/api/admin/users',auth,owner,async(req,res)=>{const {name,email,password,role}=req.body;if(!name||!email||!password||password.length<10||!['staff','owner'].includes(role||'staff'))return res.status(400).json({error:'Provide name, email, a 10+ character password and valid role.'});try{const hash=await bcrypt.hash(password,12);const q=await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,LOWER($2),$3,$4) RETURNING id,name,email,role',[name,email,hash,role||'staff']);res.status(201).json(q.rows[0]);}catch(e){res.status(409).json({error:'That email may already have an account.'});}});
app.get('/api/admin/summary',auth,async(req,res)=>{const [income,counts,staff]=await Promise.all([pool.query("SELECT department,COALESCE(SUM(amount),0) AS total FROM income WHERE entry_date=CURRENT_DATE GROUP BY department"),pool.query("SELECT status,COUNT(*)::int AS count FROM bookings GROUP BY status"),pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE payment_status='Unpaid')::int AS unpaid FROM staff")]);res.json({income:income.rows,bookings:counts.rows,staff:staff.rows[0]||{total:0,unpaid:0}});});
app.use('/manage',express.static(path.join(__dirname,'../management')));
app.use(express.static(path.join(__dirname,'../public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
initDb().then(()=>app.listen(PORT,()=>console.log(`C&J apps listening on ${PORT}`))).catch(e=>{console.error('Database startup failed',e);process.exit(1)});
