const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const path = require('path');

const https = require('https');

// ================= TELEGRAM BOT (USER TERBATAS) =================
// Fitur ini sengaja dibuat sebagai tambahan terisolasi agar fungsi website lama tetap berjalan.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(x=>x.trim()).filter(Boolean);
const TG_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : '';

function tgWibDate(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
function tgRequest(method, payload={}){
  return new Promise((resolve,reject)=>{
    if(!TG_API) return reject(new Error('TELEGRAM_BOT_TOKEN belum diatur'));
    const u=new URL(TG_API+'/'+method);
    const body=JSON.stringify(payload);
    const req=https.request(u,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{
      let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);if(!j.ok)return reject(new Error(j.description||'Telegram API error'));resolve(j.result);}catch(e){reject(e);}});
    });
    req.on('error',reject);req.write(body);req.end();
  });
}
function tgIsAdmin(id){return TELEGRAM_ADMIN_IDS.includes(String(id));}
async function tgAllowed(id){
  if(tgIsAdmin(id)) return true;
  const r=await pool.query('SELECT 1 FROM telegram_users WHERE telegram_id=$1 AND active=TRUE',[String(id)]);
  return !!r.rowCount;
}
async function tgSend(chatId,text,extra={}){return tgRequest('sendMessage',{chat_id:chatId,text,...extra});}
function tgKeyboard(rows){return {keyboard:rows,resize_keyboard:true,one_time_keyboard:false};}
function tgRemoveKeyboard(){return {remove_keyboard:true};}
async function tgEnsureTables(){
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_users(id SERIAL PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL, display_name TEXT DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_sessions(telegram_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'idle', data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ DEFAULT NOW())`);
}
async function tgSession(id){const r=await pool.query('SELECT state,data FROM telegram_sessions WHERE telegram_id=$1',[String(id)]);return r.rowCount?r.rows[0]:{state:'idle',data:{}};}
async function tgSetSession(id,state,data){await pool.query(`INSERT INTO telegram_sessions(telegram_id,state,data,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(telegram_id) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data,updated_at=NOW()`,[String(id),state,JSON.stringify(data||{})]);}
async function tgClearSession(id){await pool.query('DELETE FROM telegram_sessions WHERE telegram_id=$1',[String(id)]);}
async function tgNextCode(jenis){
  const st=await settingsObj(); const j=st.jenis.find(x=>x.nama===jenis); const prefix=j?.prefix||'ACC-';
  const r=await pool.query(`SELECT kode FROM sales WHERE kode LIKE $1`,[prefix+'%']);
  let max=0; for(const x of r.rows){const m=String(x.kode||'').match(/(\d+)$/);if(m)max=Math.max(max,Number(m[1]));}
  return prefix+(max+1);
}
function tgMenu(){return tgKeyboard([[{text:'➕ Tambah Akun'}],[{text:'👤 Kelola User'}],[{text:'🆔 ID Saya'}]]);}
async function tgStart(chatId,user){
  const id=user.id;
  if(!(await tgAllowed(id))){await tgSend(chatId,`❌ Akses ditolak.\n\nTelegram ID Anda: ${id}\n\nMinta Admin menambahkan ID ini ke daftar user yang diizinkan.`);return;}
  await tgClearSession(id);
  await tgSend(chatId,'Selamat datang di bot MFI Store. Pilih menu:',{reply_markup:tgMenu()});
}
async function tgJenis(chatId,id){
  const st=await settingsObj();
  const rows=st.jenis.map(x=>[{text:x.nama,callback_data:`tg:jenis:${x.id}`}]);
  rows.push([{text:'❌ Batal',callback_data:'tg:cancel'}]);
  await tgSend(chatId,'Pilih **Jenis Akun**:',{parse_mode:'Markdown',reply_markup:{inline_keyboard:rows}});
}
async function tgBeginAdd(chatId,id){
  await tgSetSession(id,'wait_jenis',{}); await tgJenis(chatId,id);
}
async function tgAsk(chatId,text){await tgSend(chatId,text,{reply_markup:tgRemoveKeyboard()});}
async function tgHandleText(msg){
  const chatId=msg.chat.id,id=msg.from.id,text=String(msg.text||'').trim();
  if(text==='/id'||text==='🆔 ID Saya'){await tgSend(chatId,`🆔 Telegram ID Anda: ${id}`);return;}
  if(!(await tgAllowed(id))){await tgSend(chatId,`❌ Akses ditolak. Telegram ID Anda: ${id}`);return;}
  if(text==='/start'||text==='Menu')return tgStart(chatId,msg.from);
  if(text==='➕ Tambah Akun'||text==='/tambahakun')return tgBeginAdd(chatId,id);
  if(text==='👤 Kelola User'){
    if(!tgIsAdmin(id)) return tgSend(chatId,'❌ Menu ini hanya untuk Admin.');
    return tgSend(chatId,'Kelola user Telegram:',{reply_markup:tgKeyboard([[{text:'➕ Tambah User'},{text:'📋 Daftar User'}],[{text:'➖ Nonaktifkan User'}],[{text:'🔙 Menu Utama'}]])});
  }
  if(text==='🔙 Menu Utama')return tgStart(chatId,msg.from);
  if(text==='➕ Tambah User'&&tgIsAdmin(id)){await tgSetSession(id,'admin_add_user',{});return tgAsk(chatId,'Kirim **Telegram ID** user yang ingin diizinkan.\n\nContoh: `123456789`',);}
  if(text==='📋 Daftar User'&&tgIsAdmin(id)){const r=await pool.query('SELECT telegram_id,display_name,active FROM telegram_users ORDER BY id');if(!r.rowCount)return tgSend(chatId,'Belum ada user tambahan.');return tgSend(chatId,'👥 User Telegram:\n\n'+r.rows.map(x=>`${x.active?'🟢':'🔴'} ${x.telegram_id}${x.display_name?' — '+x.display_name:''}`).join('\n'));}
  if(text==='➖ Nonaktifkan User'&&tgIsAdmin(id)){await tgSetSession(id,'admin_remove_user',{});return tgAsk(chatId,'Kirim Telegram ID user yang ingin dinonaktifkan.');}
  const sess=await tgSession(id);
  if(sess.state==='admin_add_user'&&tgIsAdmin(id)){
    if(!/^\d+$/.test(text))return tgSend(chatId,'❌ Telegram ID harus berupa angka.');
    await pool.query(`INSERT INTO telegram_users(telegram_id,display_name,active) VALUES($1,$2,TRUE) ON CONFLICT(telegram_id) DO UPDATE SET active=TRUE,display_name=EXCLUDED.display_name`,[text,'']);
    await tgClearSession(id);return tgSend(chatId,`✅ User ${text} sekarang diizinkan menggunakan bot.`,{reply_markup:tgMenu()});
  }
  if(sess.state==='admin_remove_user'&&tgIsAdmin(id)){
    if(!/^\d+$/.test(text))return tgSend(chatId,'❌ Telegram ID harus berupa angka.');
    const r=await pool.query('UPDATE telegram_users SET active=FALSE WHERE telegram_id=$1 RETURNING telegram_id',[text]);
    await tgClearSession(id);return tgSend(chatId,r.rowCount?`✅ User ${text} dinonaktifkan.`:`❌ User ${text} tidak ditemukan.`,{reply_markup:tgMenu()});
  }
  if(sess.state==='wait_kode'){
    const expected=String(sess.data.kode||'');
    if(text!==expected)return tgSend(chatId,`Kode akun otomatis adalah **${expected}**. Jika benar, kirim: ${expected}`,{parse_mode:'Markdown'});
  }
  if(sess.state==='wait_harga'){
    const n=rupiahNumber(text);if(!n)return tgSend(chatId,'❌ Harga beli harus berupa angka. Contoh: 150000');
    const d={...sess.data,harga_beli:n};await tgSetSession(id,'wait_info',d);return tgAsk(chatId,'Masukkan **Info Akun**.\n\nContoh: Login Google, Login Moonton, dll.');
  }
  if(sess.state==='wait_info'){
    const d={...sess.data,info:text};await tgSetSession(id,'wait_cadangan',d);return tgAsk(chatId,'Masukkan **Kode Cadangan** 8 digit.\n\nJika lebih dari satu, kirim satu per baris atau pisahkan spasi.');
  }
  if(sess.state==='wait_cadangan'){
    const codes=text.split(/[\s,]+/).map(x=>x.replace(/\s+/g,'')).filter(Boolean);if(!codes.length||codes.some(x=>!/^\d{8}$/.test(x))||codes.length>10)return tgSend(chatId,'❌ Setiap kode cadangan harus tepat 8 digit dan maksimal 10 kode.');
    const d={...sess.data,kode_cadangan:codes};const st=await settingsObj();const rows=st.metode_beli.map(x=>[{text:x.nama,callback_data:`tg:beli:${x.id}`}]);rows.push([{text:'❌ Batal',callback_data:'tg:cancel'}]);await tgSetSession(id,'wait_beli',d);return tgSend(chatId,'Pilih **Metode Pembelian**:',{parse_mode:'Markdown',reply_markup:{inline_keyboard:rows}});
  }
  await tgSend(chatId,'Silakan pilih menu yang tersedia.',{reply_markup:tgMenu()});
}
async function tgHandleCallback(q){
  const id=q.from.id,chatId=q.message.chat.id,data=String(q.data||''); await tgRequest('answerCallbackQuery',{callback_query_id:q.id});
  if(!(await tgAllowed(id))){return tgSend(chatId,`❌ Akses ditolak. Telegram ID Anda: ${id}`);}
  if(data==='tg:cancel'){await tgClearSession(id);return tgSend(chatId,'❌ Input dibatalkan.',{reply_markup:tgMenu()});}
  const sess=await tgSession(id); const st=await settingsObj();
  if(data.startsWith('tg:jenis:')){
    const jid=Number(data.split(':')[2]),j=st.jenis.find(x=>x.id===jid);if(!j)return tgSend(chatId,'Jenis akun tidak ditemukan.');
    const kode=await tgNextCode(j.nama);const d={jenis:j.nama,kode};await tgSetSession(id,'wait_harga',d);return tgAsk(chatId,`✅ Jenis: ${j.nama}\n🔢 Kode akun otomatis: **${kode}**\n📅 Tanggal beli otomatis: **${tgWibDate()}**\n\nMasukkan **Harga Beli**:`,);
  }
  if(data.startsWith('tg:beli:')){
    const mid=Number(data.split(':')[2]),m=st.metode_beli.find(x=>x.id===mid);if(!m)return tgSend(chatId,'Metode pembelian tidak ditemukan.');
    const d={...sess.data,metode_beli:m.nama,tanggal_beli:tgWibDate()};
    const summary=`📋 **KONFIRMASI AKUN**\n\nKode: ${d.kode}\nJenis: ${d.jenis}\nTanggal Beli: ${d.tanggal_beli}\nHarga Beli: Rp${Number(d.harga_beli).toLocaleString('id-ID')}\nInfo: ${d.info}\nKode Cadangan: ${d.kode_cadangan.join(' | ')}\nMetode Pembelian: ${d.metode_beli}`;
    await tgSetSession(id,'confirm',d);return tgSend(chatId,summary,{parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'✅ Simpan',callback_data:'tg:save'},{text:'❌ Batal',callback_data:'tg:cancel'}]]}});
  }
  if(data==='tg:save'){
    if(sess.state!=='confirm')return tgSend(chatId,'Sesi input sudah tidak aktif.');
    const d=sess.data;await pool.query(`INSERT INTO sales(kode,tanggal_beli,jenis,harga_beli,info,kode_cadangan,metode_beli) VALUES($1,$2,$3,$4,$5,$6,$7)`,[d.kode,d.tanggal_beli,d.jenis,d.harga_beli,d.info,JSON.stringify(d.kode_cadangan),d.metode_beli]);
    await tgClearSession(id);return tgSend(chatId,`✅ Akun berhasil disimpan.\n\nKode: ${d.kode}\nJenis: ${d.jenis}\nTanggal: ${d.tanggal_beli}`,{reply_markup:tgMenu()});
  }
}
async function telegramWebhook(req,res){
  try{
    if(TELEGRAM_WEBHOOK_SECRET && String(req.headers['x-telegram-bot-api-secret-token']||'')!==TELEGRAM_WEBHOOK_SECRET)return res.status(403).json({ok:false,error:'Webhook secret tidak valid'});
    await init(); await tgEnsureTables();
    const u=req.body||{};
    if(u.callback_query) await tgHandleCallback(u.callback_query); else if(u.message) await tgHandleText(u.message);
    res.json({ok:true});
  }catch(e){console.error('Telegram webhook:',e);res.status(500).json({ok:false,error:e.message});}
}

app.post('/api/telegram',telegramWebhook);
app.post('/api/itemku/telegram',telegramWebhook);
app.get('/api/telegram/set-webhook',async(req,res)=>{
  try{await init();await tgEnsureTables();const secret=String(req.query.secret||'');if(!TELEGRAM_WEBHOOK_SECRET||secret!==TELEGRAM_WEBHOOK_SECRET)return res.status(403).json({error:'Secret tidak valid'});const base=`${req.protocol}://${req.get('host')}`;const result=await tgRequest('setWebhook',{url:`${base}/api/telegram`,secret_token:TELEGRAM_WEBHOOK_SECRET});res.json({ok:true,result});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
// ================= END TELEGRAM BOT =================

const app = express();
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) console.warn('DATABASE_URL belum diatur.');
let pool = new Pool({connectionString:DATABASE_URL, ssl:DATABASE_URL ? {rejectUnauthorized:false} : false, max:5});
const BOOTSTRAP_DATABASE_URL = DATABASE_URL;
let activeDatabaseUrl = DATABASE_URL;
const DB_CONFIG_SECRET = process.env.DB_CONFIG_SECRET || process.env.SESSION_SECRET || 'change-this-secret';

const DEFAULT_SETTINGS={
  jenis:[{id:1,nama:'Mobile Legend',prefix:'ML-'},{id:2,nama:'Clash of Clans',prefix:'COC-'},{id:3,nama:'Free Fire',prefix:'FF-'},{id:4,nama:'Honor of Kings',prefix:'HOK-'},{id:5,nama:'Lainnya',prefix:'ACC-'}],
  tempat:[{id:1,nama:'Itemku',potongan:10},{id:2,nama:'Tokoku',potongan:0},{id:3,nama:'G2G',potongan:0},{id:4,nama:'Facebook',potongan:0},{id:5,nama:'Lainnya',potongan:0}],
  metode_beli:[{id:1,nama:'Seabank'},{id:2,nama:'Dana'},{id:3,nama:'Transfer'},{id:4,nama:'Saldo'},{id:5,nama:'Lainnya'}],
  metode_bayar:[{id:1,nama:'Saldo Itemku',garansi:30},{id:2,nama:'Dana',garansi:0},{id:3,nama:'Transfer',garansi:0},{id:4,nama:'Seabank',garansi:0},{id:5,nama:'Lainnya',garansi:0}]
};

let initPromise;
let bootstrapPromise;
function encryptDbUrl(url){const iv=crypto.randomBytes(12);const key=crypto.createHash('sha256').update(DB_CONFIG_SECRET).digest();const c=crypto.createCipheriv('aes-256-gcm',key,iv);const enc=Buffer.concat([c.update(url,'utf8'),c.final()]);return [iv.toString('base64url'),c.getAuthTag().toString('base64url'),enc.toString('base64url')].join('.');}
function decryptDbUrl(blob){const [ivB,tagB,dataB]=String(blob||'').split('.');if(!ivB||!tagB||!dataB)throw new Error('Konfigurasi database rusak');const key=crypto.createHash('sha256').update(DB_CONFIG_SECRET).digest();const d=crypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(Buffer.from(tagB,'base64url'));return Buffer.concat([d.update(Buffer.from(dataB,'base64url')),d.final()]).toString('utf8');}
async function bootstrap(){
  if(bootstrapPromise) return bootstrapPromise;
  bootstrapPromise=(async()=>{
    if(!BOOTSTRAP_DATABASE_URL) throw new Error('DATABASE_URL belum diatur di Vercel.');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_db_config(id INTEGER PRIMARY KEY CHECK(id=1), encrypted_url TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());`);
    const r=await pool.query('SELECT encrypted_url FROM app_db_config WHERE id=1');
    if(r.rowCount){
      try{const configured=decryptDbUrl(r.rows[0].encrypted_url); if(configured && configured!==activeDatabaseUrl){const np=new Pool({connectionString:configured,ssl:{rejectUnauthorized:false},max:5});await np.query('SELECT 1');const old=pool;pool=np;activeDatabaseUrl=configured;await old.end().catch(()=>{});}}catch(e){console.warn('Konfigurasi DB tersimpan tidak dapat dipakai, memakai DATABASE_URL:',e.message);}
    }
  })();
  return bootstrapPromise;
}
async function ensureSchema(){
    await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`);
    await pool.query(`UPDATE users SET role='admin' WHERE username='admin' AND (role IS NULL OR role='staff');`);
    await pool.query(`CREATE TABLE IF NOT EXISTS settings(id SERIAL PRIMARY KEY, type TEXT NOT NULL, nama TEXT NOT NULL, prefix TEXT, potongan NUMERIC DEFAULT 0, garansi INTEGER DEFAULT 0, UNIQUE(type,nama));`);
    await pool.query(`CREATE TABLE IF NOT EXISTS stores(id SERIAL PRIMARY KEY, nama TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sales(id SERIAL PRIMARY KEY, kode TEXT, tanggal_beli TEXT, jenis TEXT, harga_beli BIGINT DEFAULT 0, info TEXT, kode_cadangan JSONB DEFAULT '[]'::jsonb, metode_beli TEXT, tempat TEXT, tanggal_jual TEXT, tanggal_konfirmasi TEXT, metode_bayar TEXT, garansi INTEGER DEFAULT 0, pembeli TEXT, pesanan TEXT, harga_jual BIGINT DEFAULT 0, potongan BIGINT DEFAULT 0, diterima BIGINT DEFAULT 0, keuntungan BIGINT DEFAULT 0, hackback BOOLEAN DEFAULT FALSE, tanggal_hackback TEXT, bukti_status TEXT DEFAULT 'belum', created_at TIMESTAMPTZ DEFAULT NOW());`);
    await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS toko TEXT DEFAULT '';`);
    await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS bukti_status TEXT DEFAULT 'belum';`);
    await pool.query(`UPDATE sales SET bukti_status='belum' WHERE bukti_status IS NULL OR bukti_status='' OR bukti_status NOT IN ('belum','screenshot','upload');`);
    await pool.query(`CREATE TABLE IF NOT EXISTS expenses(id SERIAL PRIMARY KEY, tanggal TEXT NOT NULL, jenis TEXT NOT NULL, keterangan TEXT DEFAULT '', jumlah BIGINT NOT NULL, toko TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());`);
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS toko TEXT DEFAULT '';`);
    const u=await pool.query('SELECT id FROM users WHERE username=$1',['admin']);
    if(!u.rowCount) await pool.query('INSERT INTO users(username,password) VALUES($1,$2)',['admin','admin123']);
    const c=await pool.query('SELECT COUNT(*)::int n FROM settings');
    if(c.rows[0].n===0){ for(const [type,items] of Object.entries(DEFAULT_SETTINGS)) for(const x of items) await pool.query('INSERT INTO settings(type,nama,prefix,potongan,garansi) VALUES($1,$2,$3,$4,$5)',[type,x.nama,x.prefix||null,x.potongan||0,x.garansi||0]); }
}
async function init(){
  if(initPromise) return initPromise;
  initPromise=(async()=>{await bootstrap(); await ensureSchema(); if(TELEGRAM_BOT_TOKEN) await tgEnsureTables();})();
  return initPromise;
}

function parseCookies(req){const out={};String(req.headers.cookie||'').split(';').forEach(p=>{const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));});return out;}
function sign(value){return crypto.createHmac('sha256',process.env.SESSION_SECRET||'change-this-secret').update(value).digest('base64url');}
function setSession(res,user){const payload=Buffer.from(JSON.stringify({id:user.id,username:user.username,role:user.role||'staff',exp:Date.now()+1000*60*60*24*7})).toString('base64url');const token=payload+'.'+sign(payload);res.setHeader('Set-Cookie',`session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure`);}
function getSession(req){try{const t=parseCookies(req).session||'';const [p,s]=t.split('.');if(!p||!s||s!==sign(p))return null;const x=JSON.parse(Buffer.from(p,'base64url').toString());if(x.exp<Date.now())return null;return x;}catch{return null;}}
async function auth(req,res,next){const u=getSession(req);if(!u)return res.status(401).json({error:'Belum login'});try{await init();const r=await pool.query('SELECT id,username,role,active FROM users WHERE id=$1',[u.id]);if(!r.rowCount||!r.rows[0].active)return res.status(401).json({error:'Sesi tidak aktif'});req.user=r.rows[0];next();}catch(e){res.status(500).json({error:e.message});}}
function rupiahNumber(v){const s=String(v??'').replace(/[^0-9]/g,'');return s?Number(s):0;}
function cleanCodes(v){let a=Array.isArray(v)?v:(v?[v]:[]);a=a.map(x=>String(x||'').replace(/\s+/g,'')).filter(Boolean);if(a.length>10)throw new Error('Maksimal 10 kode cadangan');for(const c of a)if(!/^\d{8}$/.test(c))throw new Error('Setiap kode cadangan harus tepat 8 digit angka');return a;}
async function settingsObj(){const r=await pool.query('SELECT * FROM settings ORDER BY id');const o={jenis:[],tempat:[],metode_beli:[],metode_bayar:[]};for(const x of r.rows){if(!o[x.type])o[x.type]=[];o[x.type].push({id:x.id,nama:x.nama,prefix:x.prefix,potongan:Number(x.potongan)||0,garansi:Number(x.garansi)||0});}return o;}

function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');const key=crypto.scryptSync(String(password),salt,64).toString('hex');return `scrypt$${salt}$${key}`;}
function verifyPassword(password,stored){const s=String(stored||'');if(s.startsWith('scrypt$')){const [,salt,key]=s.split('$');try{const actual=crypto.scryptSync(String(password),salt,64).toString('hex');return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(key,'hex'));}catch{return false;}}return s===String(password);}
function adminOnly(req,res,next){if(req.user?.role!=='admin')return res.status(403).json({error:'Akses khusus Admin'});next();}
app.post('/api/login',async(req,res)=>{try{await init();const username=String(req.body.username||'').trim();const password=String(req.body.password||'');const r=await pool.query('SELECT id,username,password,role,active FROM users WHERE username=$1',[username]);if(!r.rowCount||!r.rows[0].active||!verifyPassword(password,r.rows[0].password))return res.status(401).json({error:'Username atau password salah'});const u=r.rows[0];if(!String(u.password).startsWith('scrypt$')){await pool.query('UPDATE users SET password=$1 WHERE id=$2',[hashPassword(password),u.id]);u.password=hashPassword(password);}setSession(res,u);res.json({ok:true,username:u.username,role:u.role});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');res.json({ok:true});});
app.get('/api/me',async(req,res)=>{const u=getSession(req);if(!u)return res.json({loggedIn:false,user:null});try{await init();const r=await pool.query('SELECT id,username,role,active FROM users WHERE id=$1',[u.id]);if(!r.rowCount||!r.rows[0].active)return res.json({loggedIn:false,user:null});res.json({loggedIn:true,user:r.rows[0]});}catch(e){res.json({loggedIn:false,user:null});}});
app.get('/api/db/status',auth,adminOnly,async(req,res)=>{try{await init();const r=await pool.query('SELECT current_database() AS database, version() AS version');res.json({ok:true,connected:true,database:r.rows[0].database,server:r.rows[0].version.split(' on ')[0],activeIsBootstrap:activeDatabaseUrl===BOOTSTRAP_DATABASE_URL});}catch(e){res.status(500).json({connected:false,error:e.message});}});
app.post('/api/db/test',auth,adminOnly,async(req,res)=>{let p;try{const url=String(req.body.database_url||'').trim();if(!url)return res.status(400).json({error:'DATABASE_URL wajib diisi'});p=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:8000});const r=await p.query('SELECT current_database() AS database, NOW() AS now');res.json({ok:true,database:r.rows[0].database,now:r.rows[0].now});}catch(e){res.status(400).json({ok:false,error:e.message});}finally{if(p)await p.end().catch(()=>{});}});
app.post('/api/db/save',auth,adminOnly,async(req,res)=>{let np;try{const url=String(req.body.database_url||'').trim();if(!url)return res.status(400).json({error:'DATABASE_URL wajib diisi'});np=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:5,connectionTimeoutMillis:8000});await np.query('SELECT 1');const b=new Pool({connectionString:BOOTSTRAP_DATABASE_URL,ssl:{rejectUnauthorized:false},max:1});await b.query(`CREATE TABLE IF NOT EXISTS app_db_config(id INTEGER PRIMARY KEY CHECK(id=1), encrypted_url TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());`);await b.query('INSERT INTO app_db_config(id,encrypted_url,updated_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET encrypted_url=EXCLUDED.encrypted_url,updated_at=NOW()',[encryptDbUrl(url)]);await b.end();const old=pool;pool=np;activeDatabaseUrl=url;initPromise=null;await ensureSchema();res.json({ok:true,message:'Database berhasil disimpan dan diaktifkan. DATABASE_URL bootstrap tetap diperlukan di Vercel agar konfigurasi ini dipulihkan setelah redeploy.'});}catch(e){if(np)await np.end().catch(()=>{});res.status(400).json({ok:false,error:e.message});}});
app.post('/api/db/use-bootstrap',auth,adminOnly,async(req,res)=>{try{if(!BOOTSTRAP_DATABASE_URL)return res.status(400).json({error:'DATABASE_URL bootstrap tidak tersedia'});const np=new Pool({connectionString:BOOTSTRAP_DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});await np.query('SELECT 1');const old=pool;pool=np;activeDatabaseUrl=BOOTSTRAP_DATABASE_URL;initPromise=null;await ensureSchema();await old.end().catch(()=>{});res.json({ok:true,message:'Kembali ke DATABASE_URL bootstrap.'});}catch(e){res.status(500).json({error:e.message});}});


app.get('/api/users',auth,adminOnly,async(req,res)=>{try{await init();const r=await pool.query('SELECT id,username,role,active,created_at FROM users ORDER BY id');res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/users',auth,adminOnly,async(req,res)=>{try{await init();const username=String(req.body.username||'').trim();const password=String(req.body.password||'');const role=req.body.role==='admin'?'admin':'staff';if(!/^[A-Za-z0-9._-]{3,40}$/.test(username))return res.status(400).json({error:'Username 3-40 karakter: huruf, angka, titik, garis bawah atau strip'});if(password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});const r=await pool.query('INSERT INTO users(username,password,role,active) VALUES($1,$2,$3,TRUE) RETURNING id,username,role,active,created_at',[username,hashPassword(password),role]);res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.code==='23505'?'Username sudah digunakan':e.message});}});
app.put('/api/users/:id',auth,adminOnly,async(req,res)=>{try{await init();const id=Number(req.params.id);const r0=await pool.query('SELECT id,username,role,active FROM users WHERE id=$1',[id]);if(!r0.rowCount)return res.status(404).json({error:'User tidak ditemukan'});const current=r0.rows[0];const role=req.body.role==='admin'?'admin':'staff';const active=req.body.active!==false;const password=String(req.body.password||'');if(current.role==='admin' && (role!=='admin'||!active)){const c=await pool.query("SELECT COUNT(*)::int n FROM users WHERE role='admin' AND active=TRUE AND id<>$1",[id]);if(c.rows[0].n<1)return res.status(400).json({error:'Minimal harus ada satu Admin aktif'});}if(password && password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});let q='UPDATE users SET role=$1,active=$2';let vals=[role,active];if(password){q+=',password=$3';vals.push(hashPassword(password));}q+=' WHERE id=$'+(vals.length+1)+' RETURNING id,username,role,active,created_at';vals.push(id);const r=await pool.query(q,vals);res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.message});}});
app.delete('/api/users/:id',auth,adminOnly,async(req,res)=>{try{await init();const id=Number(req.params.id);if(id===Number(req.user.id))return res.status(400).json({error:'Tidak dapat menghapus akun yang sedang digunakan'});const r0=await pool.query('SELECT role FROM users WHERE id=$1',[id]);if(!r0.rowCount)return res.status(404).json({error:'User tidak ditemukan'});if(r0.rows[0].role==='admin'){const c=await pool.query("SELECT COUNT(*)::int n FROM users WHERE role='admin' AND active=TRUE");if(c.rows[0].n<=1)return res.status(400).json({error:'Admin terakhir tidak boleh dihapus'});}await pool.query('DELETE FROM users WHERE id=$1',[id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/settings',auth,async(req,res)=>{try{await init();res.json(await settingsObj());}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/settings/:type',auth,adminOnly,async(req,res)=>{try{await init();const type=String(req.params.type),allowed=['jenis','tempat','metode_beli','metode_bayar'];if(!allowed.includes(type))return res.status(400).json({error:'Jenis pengaturan tidak valid'});const nama=String(req.body.nama||'').trim();if(!nama)return res.status(400).json({error:'Nama wajib diisi'});let prefix=null,pot=0,gar=0;if(type==='jenis'){prefix=String(req.body.prefix||'ACC-').trim().toUpperCase();if(!/^[A-Z0-9_-]+-$/.test(prefix))return res.status(400).json({error:'Prefix harus diakhiri tanda -'});}if(type==='tempat')pot=Math.max(0,Math.min(100,Number(req.body.potongan)||0));if(type==='metode_bayar')gar=Math.max(0,Number(req.body.garansi)||0);const r=await pool.query('INSERT INTO settings(type,nama,prefix,potongan,garansi) VALUES($1,$2,$3,$4,$5) RETURNING *',[type,nama,prefix,pot,gar]);res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.code==='23505'?'Nama sudah ada':e.message});}});
app.put('/api/settings/:type/:id',auth,adminOnly,async(req,res)=>{try{await init();const type=String(req.params.type),id=Number(req.params.id),nama=String(req.body.nama||'').trim();if(!nama)return res.status(400).json({error:'Nama wajib diisi'});let prefix=null,pot=0,gar=0;if(type==='jenis'){prefix=String(req.body.prefix||'ACC-').trim().toUpperCase();if(!/^[A-Z0-9_-]+-$/.test(prefix))return res.status(400).json({error:'Prefix harus diakhiri tanda -'});}if(type==='tempat')pot=Math.max(0,Math.min(100,Number(req.body.potongan)||0));if(type==='metode_bayar')gar=Math.max(0,Number(req.body.garansi)||0);const r=await pool.query('UPDATE settings SET nama=$1,prefix=$2,potongan=$3,garansi=$4 WHERE id=$5 AND type=$6 RETURNING *',[nama,prefix,pot,gar,id,type]);if(!r.rowCount)return res.status(404).json({error:'Data pengaturan tidak ditemukan'});res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.code==='23505'?'Nama sudah ada':e.message});}});
app.delete('/api/settings/:type/:id',auth,adminOnly,async(req,res)=>{try{await init();await pool.query('DELETE FROM settings WHERE id=$1 AND type=$2',[Number(req.params.id),String(req.params.type)]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/expenses',auth,async(req,res)=>{try{await init();const from=String(req.query.from||''),to=String(req.query.to||''),q=String(req.query.q||'').toLowerCase(),toko=String(req.query.toko||'');const r=await pool.query('SELECT * FROM expenses ORDER BY id DESC');res.json(r.rows.filter(x=>(!from||x.tanggal>=from)&&(!to||x.tanggal<=to)&&(!toko||String(x.toko||'')===toko)&&(!q||[x.jenis,x.keterangan,x.toko].join(' ').toLowerCase().includes(q))).map(x=>({...x,id:Number(x.id),jumlah:Number(x.jumlah),toko:String(x.toko||'')})));}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/expenses',auth,async(req,res)=>{try{await init();const jenis=String(req.body.jenis||'').trim(),keterangan=String(req.body.keterangan||'').trim(),tanggal=String(req.body.tanggal||''),toko=String(req.body.toko||'').trim(),jumlah=rupiahNumber(req.body.jumlah);if(!jenis||!tanggal||!toko||jumlah<=0)return res.status(400).json({error:'Tanggal, toko, jenis biaya, dan jumlah wajib diisi'});const r=await pool.query('INSERT INTO expenses(tanggal,jenis,keterangan,jumlah,toko) VALUES($1,$2,$3,$4,$5) RETURNING *',[tanggal,jenis,keterangan,jumlah,toko]);res.json({id:Number(r.rows[0].id)});}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/expenses/:id',auth,async(req,res)=>{try{await init();const jenis=String(req.body.jenis||'').trim(),keterangan=String(req.body.keterangan||'').trim(),tanggal=String(req.body.tanggal||''),toko=String(req.body.toko||'').trim(),jumlah=rupiahNumber(req.body.jumlah);if(!jenis||!tanggal||!toko||jumlah<=0)return res.status(400).json({error:'Tanggal, toko, jenis biaya, dan jumlah wajib diisi'});const r=await pool.query('UPDATE expenses SET tanggal=$1,jenis=$2,keterangan=$3,jumlah=$4,toko=$5 WHERE id=$6 RETURNING id',[tanggal,jenis,keterangan,jumlah,toko,Number(req.params.id)]);if(!r.rowCount)return res.status(404).json({error:'Biaya tidak ditemukan'});res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/expenses/:id',auth,async(req,res)=>{try{await init();await pool.query('DELETE FROM expenses WHERE id=$1',[Number(req.params.id)]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/toko',auth,async(req,res)=>{try{await init();const r=await pool.query('SELECT id,nama FROM stores ORDER BY id');res.json(r.rows.map(x=>({id:Number(x.id),nama:x.nama})));}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/toko',auth,async(req,res)=>{try{await init();const nama=String(req.body.nama||'').trim();if(!nama)return res.status(400).json({error:'Nama toko wajib diisi'});const r=await pool.query('INSERT INTO stores(nama) VALUES($1) RETURNING id,nama',[nama]);res.json({id:Number(r.rows[0].id),nama:r.rows[0].nama});}catch(e){res.status(400).json({error:e.code==='23505'?'Nama toko sudah ada':e.message});}});
app.put('/api/toko/:id',auth,async(req,res)=>{try{await init();const nama=String(req.body.nama||'').trim();if(!nama)return res.status(400).json({error:'Nama toko wajib diisi'});const r=await pool.query('UPDATE stores SET nama=$1 WHERE id=$2 RETURNING id,nama',[nama,Number(req.params.id)]);if(!r.rowCount)return res.status(404).json({error:'Toko tidak ditemukan'});res.json({id:Number(r.rows[0].id),nama:r.rows[0].nama});}catch(e){res.status(400).json({error:e.code==='23505'?'Nama toko sudah ada':e.message});}});
app.delete('/api/toko/:id',auth,async(req,res)=>{try{await init();await pool.query('DELETE FROM stores WHERE id=$1',[Number(req.params.id)]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

function mapSale(x){const bs=['belum','screenshot','upload'].includes(String(x.bukti_status))?String(x.bukti_status):'belum';return {...x,id:Number(x.id),toko:String(x.toko||''),harga_beli:Number(x.harga_beli)||0,harga_jual:Number(x.harga_jual)||0,potongan:Number(x.potongan)||0,diterima:Number(x.diterima)||0,keuntungan:Number(x.keuntungan)||0,garansi:Number(x.garansi)||0,bukti_status:bs,kode_cadangan:Array.isArray(x.kode_cadangan)?x.kode_cadangan:[]};}
app.get('/api/sales',auth,async(req,res)=>{try{await init();const r=await pool.query('SELECT * FROM sales ORDER BY id DESC');const q=String(req.query.q||'').toLowerCase(),status=String(req.query.status||''),jenis=String(req.query.jenis||''),tempat=String(req.query.tempat||''),toko=String(req.query.toko||''),bukti=String(req.query.bukti||''),from=String(req.query.from||''),to=String(req.query.to||'');const rows=r.rows.map(mapSale).filter(x=>{const hay=[x.kode,x.jenis,x.info,...x.kode_cadangan,x.pembeli,x.pesanan,x.tempat,x.toko].join(' ').toLowerCase();const st=x.hackback?'HB':(x.tanggal_jual?'Sold':'Available');const d=x.hackback?(x.tanggal_hackback||x.tanggal_jual||''):(x.tanggal_jual||'');return(!q||hay.includes(q))&&(!status||status===st)&&(!jenis||jenis===x.jenis)&&(!tempat||tempat===x.tempat)&&(!toko||toko===x.toko)&&(!bukti||bukti===x.bukti_status)&&(!from||d>=from)&&(!to||d<=to);});res.json(rows);}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/sales',auth,async(req,res)=>{try{await init();const codes=cleanCodes(req.body.kode_cadangan),r=await pool.query(`INSERT INTO sales(kode,tanggal_beli,jenis,harga_beli,info,kode_cadangan,metode_beli) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[String(req.body.kode||''),String(req.body.tanggal_beli||''),String(req.body.jenis||''),rupiahNumber(req.body.harga_beli),String(req.body.info||''),JSON.stringify(codes),String(req.body.metode_beli||'')]);res.json({id:Number(r.rows[0].id)});}catch(e){res.status(400).json({error:e.message});}});
app.put('/api/sales/:id/account',auth,async(req,res)=>{try{await init();const codes=cleanCodes(req.body.kode_cadangan);const id=Number(req.params.id),r=await pool.query(`UPDATE sales SET kode=$1,tanggal_beli=$2,jenis=$3,harga_beli=$4,info=$5,kode_cadangan=$6,metode_beli=$7,keuntungan=GREATEST(0,diterima-$4) WHERE id=$8 RETURNING id`,[String(req.body.kode||''),String(req.body.tanggal_beli||''),String(req.body.jenis||''),rupiahNumber(req.body.harga_beli),String(req.body.info||''),JSON.stringify(codes),String(req.body.metode_beli||''),id]);if(!r.rowCount)return res.status(404).json({error:'Data tidak ditemukan'});res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.put('/api/sales/:id/penjualan',auth,async(req,res)=>{try{await init();const id=Number(req.params.id),s=(await pool.query('SELECT harga_beli FROM sales WHERE id=$1',[id])).rows[0];if(!s)return res.status(404).json({error:'Data tidak ditemukan'});const st=await settingsObj(),tempat=String(req.body.tempat||''),toko=String(req.body.toko||''),bayar=String(req.body.metode_bayar||''),tc=st.tempat.find(x=>x.nama===tempat),bc=st.metode_bayar.find(x=>x.nama===bayar),jual=rupiahNumber(req.body.harga_jual),pot=Math.round(jual*(Number(tc?.potongan)||0)/100),gar=Number(bc?.garansi)||0,dit=Math.max(0,jual-pot),unt=Math.max(0,dit-Number(s.harga_beli));await pool.query(`UPDATE sales SET tempat=$1,toko=$2,tanggal_jual=$3,tanggal_konfirmasi=$4,metode_bayar=$5,garansi=$6,pembeli=$7,pesanan=$8,harga_jual=$9,potongan=$10,diterima=$11,keuntungan=$12 WHERE id=$13`,[tempat,toko,String(req.body.tanggal_jual||''),String(req.body.tanggal_konfirmasi||''),bayar,gar,String(req.body.pembeli||''),String(req.body.pesanan||''),jual,pot,dit,unt,id]);res.json({ok:true,potongan:pot,garansi:gar});}catch(e){res.status(400).json({error:e.message});}});
app.put('/api/sales/:id/bukti',auth,async(req,res)=>{try{await init();const id=Number(req.params.id),bukti=String(req.body.bukti_status||'belum');if(!['belum','screenshot','upload'].includes(bukti))return res.status(400).json({error:'Status bukti tidak valid'});const r=await pool.query('UPDATE sales SET bukti_status=$1 WHERE id=$2 RETURNING *',[bukti,id]);if(!r.rowCount)return res.status(404).json({error:'Data tidak ditemukan'});res.json({ok:true,bukti_status:bukti});}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/sales/:id/hackback',auth,async(req,res)=>{try{await init();const id=Number(req.params.id),enabled=Boolean(req.body.enabled);const d=enabled?(String(req.body.tanggal_hackback||'')||new Date().toISOString().slice(0,10)):'';const r=await pool.query('UPDATE sales SET hackback=$1,tanggal_hackback=$2 WHERE id=$3 RETURNING id',[enabled,d,id]);if(!r.rowCount)return res.status(404).json({error:'Data tidak ditemukan'});res.json({ok:true,hackback:enabled});}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/sales/:id/reset-penjualan',auth,async(req,res)=>{try{await init();const id=Number(req.params.id);const r=await pool.query(`UPDATE sales SET tempat='',toko='',tanggal_jual='',tanggal_konfirmasi='',metode_bayar='',garansi=0,pembeli='',pesanan='',harga_jual=0,potongan=0,diterima=0,keuntungan=0,hackback=FALSE,tanggal_hackback='' WHERE id=$1 RETURNING id`,[id]);if(!r.rowCount)return res.status(404).json({error:'Data tidak ditemukan'});res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/sales/:id',auth,async(req,res)=>{try{await init();await pool.query('DELETE FROM sales WHERE id=$1',[Number(req.params.id)]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/account-summary',auth,async(req,res)=>{try{await init();const jenis=String(req.query.jenis||''),toko=String(req.query.toko||''),from=String(req.query.from||''),to=String(req.query.to||'');const rows=(await pool.query('SELECT * FROM sales')).rows.map(mapSale).filter(x=>(!jenis||x.jenis===jenis)&&(!toko||x.toko===toko));const available=rows.filter(x=>!x.tanggal_jual&&!x.hackback).length;const hackback=rows.filter(x=>x.hackback).length;const sold=rows.filter(x=>x.tanggal_jual&&!x.hackback&&(!from||x.tanggal_jual>=from)&&(!to||x.tanggal_jual<=to)).length;res.json({available,hackback,sold});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats',auth,async(req,res)=>{try{await init();const from=String(req.query.from||''),to=String(req.query.to||''),jenis=String(req.query.jenis||''),tempat=String(req.query.tempat||''),toko=String(req.query.toko||'');const all=(await pool.query('SELECT * FROM sales')).rows.map(mapSale).filter(x=>(!jenis||x.jenis===jenis)&&(!tempat||x.tempat===tempat)&&(!toko||x.toko===toko)),expenses=(await pool.query('SELECT * FROM expenses')).rows.map(x=>({...x,id:Number(x.id),jumlah:Number(x.jumlah),toko:String(x.toko||'')}));const availableAccounts=all.filter(x=>!x.tanggal_jual&&!x.hackback).length,hackbackAccounts=all.filter(x=>x.hackback&&(!from||x.tanggal_hackback>=from)&&(!to||x.tanggal_hackback<=to)).length,sold=all.filter(x=>x.tanggal_jual&&!x.hackback&&(!from||x.tanggal_jual>=from)&&(!to||x.tanggal_jual<=to)),hb=all.filter(x=>x.hackback&&(!from||x.tanggal_hackback>=from)&&(!to||x.tanggal_hackback<=to)),ex=expenses.filter(x=>(!from||x.tanggal>=from)&&(!to||x.tanggal<=to)&&(!toko||x.toko===toko));const omzet=sold.reduce((a,x)=>a+x.harga_jual,0),potongan=sold.reduce((a,x)=>a+x.potongan,0),diterima=sold.reduce((a,x)=>a+x.diterima,0),modal=sold.reduce((a,x)=>a+x.harga_beli,0),biayaLain=ex.reduce((a,x)=>a+x.jumlah,0),hackbackLoss=hb.reduce((a,x)=>a+x.harga_beli,0),untungKotor=omzet-potongan,untungBersihSold=diterima-modal,untungBersihAkhir=untungBersihSold-biayaLain-hackbackLoss;const monthlyMap={};sold.forEach(x=>{const b=x.tanggal_jual.slice(0,7);if(!monthlyMap[b])monthlyMap[b]={bulan:b,jumlah:0,modal:0,omzet:0,potongan:0,kotor:0,bersih:0,biaya:0};monthlyMap[b].jumlah++;monthlyMap[b].modal+=x.harga_beli;monthlyMap[b].omzet+=x.harga_jual;monthlyMap[b].potongan+=x.potongan;monthlyMap[b].kotor+=x.harga_jual-x.potongan;monthlyMap[b].bersih+=x.keuntungan;});ex.forEach(x=>{const b=x.tanggal.slice(0,7);if(!monthlyMap[b])monthlyMap[b]={bulan:b,jumlah:0,modal:0,omzet:0,potongan:0,kotor:0,bersih:0,biaya:0};monthlyMap[b].biaya+=x.jumlah;monthlyMap[b].bersih-=x.jumlah;});const monthly=Object.values(monthlyMap).sort((a,b)=>b.bulan.localeCompare(a.bulan)).slice(0,12);const detail=sold.map(x=>({...x,status:'Sold'}));res.json({total:all.filter(x=>(x.tanggal_jual||'')&&(!from||x.tanggal_jual>=from)&&(!to||x.tanggal_jual<=to)).length,sold:sold.length,hackback:hb.length,availableAccounts,hackbackAccounts,hackbackLoss,beli:modal,omzet,potongan,diterima,biayaLain,untungBersihSold,untungKotor,untungBersih:untungBersihAkhir,untungBersihAkhir,monthly,detail,expenses:ex});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/export',auth,async(req,res)=>{try{await init();const rows=(await pool.query('SELECT * FROM sales ORDER BY id')).rows.map(mapSale);const headers=['Kode Akun','Status','Tanggal Beli','Jenis','Harga Beli','Informasi Akun','Kode Cadangan 8 Digit','Metode Pembelian','Toko','Tempat Penjualan','Tanggal Terjual','Tanggal Konfirmasi','Metode Pembayaran','Garansi','Nama Pembeli','Nomor Pesanan','Harga Terjual','Potongan','Diterima Bersih','Keuntungan','Bukti'];const data=rows.map(x=>[x.kode,x.hackback?'HB':(x.tanggal_jual?'Sold':'Available'),x.tanggal_beli,x.jenis,x.harga_beli,x.info,x.kode_cadangan.join(' | '),x.metode_beli,x.toko,x.tempat,x.tanggal_jual,x.tanggal_konfirmasi,x.metode_bayar,x.garansi,x.pembeli,x.pesanan,x.harga_jual,x.potongan,x.diterima,x.keuntungan,x.bukti_status]);const csv=[headers,...data].map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="laporan-penjualan.csv"');res.send('\ufeff'+csv);}catch(e){res.status(500).json({error:e.message});}});

app.get('*',(req,res)=>res.sendFile(path.join(process.cwd(),'public','index.html')));
module.exports=app;
