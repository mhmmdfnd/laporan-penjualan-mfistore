const TELEGRAM_API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function tg(method, payload) {
  const r = await fetch(`${TELEGRAM_API()}/${method}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(payload || {})
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.description || `Telegram API ${r.status}`);
  return data.result;
}

function allowed(chatId) {
  const raw = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
  return raw.length === 0 || raw.includes(String(chatId));
}

function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
}

function money(v) {
  return 'Rp' + Number(v || 0).toLocaleString('id-ID');
}

function cleanBackupCodes(v) {
  // Samakan format Telegram dengan website: satu kode = satu item array.
  // Bisa dipisahkan dengan baris baru, spasi, koma, atau titik koma.
  const raw = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  const codes = raw.map(x => String(x || '').trim()).filter(Boolean);
  if (codes.length > 10) throw new Error('Maksimal 10 kode cadangan.');
  for (const code of codes) {
    if (!/^\d{8}$/.test(code)) {
      throw new Error('Setiap kode cadangan harus tepat 8 digit angka.');
    }
  }
  return codes;
}

function formatBackupCodes(codes) {
  const arr = Array.isArray(codes) ? codes : [];
  return arr.length ? arr.map((c,i) => `${i+1}. ${c}`).join('\n') : '-';
}

async function ensureTelegramSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS telegram_sessions(
    chat_id TEXT PRIMARY KEY,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function getSession(pool, chatId) {
  const r = await pool.query('SELECT state FROM telegram_sessions WHERE chat_id=$1', [String(chatId)]);
  return r.rowCount ? (r.rows[0].state || {}) : {};
}

async function setSession(pool, chatId, state) {
  await pool.query(`INSERT INTO telegram_sessions(chat_id,state,updated_at) VALUES($1,$2,NOW())
    ON CONFLICT(chat_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()`, [String(chatId), JSON.stringify(state || {})]);
}

async function clearSession(pool, chatId) {
  await pool.query('DELETE FROM telegram_sessions WHERE chat_id=$1', [String(chatId)]);
}

async function nextAccountNumber(pool) {
  // Nomor ditentukan dari kode TERBESAR yang masih ada. Jika kode terbesar dihapus,
  // nomor tersebut dapat dipakai lagi. Contoh ML-898 -> FF-899; hapus FF-899 -> berikutnya kembali 899.
  const r = await pool.query(`
    SELECT COALESCE(MAX((m[1])::BIGINT),0) AS max_no
    FROM sales s
    CROSS JOIN LATERAL regexp_matches(COALESCE(s.kode,''), '([0-9]+)$') AS m
  `);
  return Number(r.rows[0]?.max_no || 0) + 1;
}

function mainMenu() {
  return {
    keyboard: [
      [{ text: '➕ Tambah Akun' }],
      [{ text: '❌ Batal' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

async function sendStart(chatId) {
  await tg('sendMessage', {chat_id:chatId, text:
`🤖 MFI STORE BOT\n\nSilakan pilih menu di bawah.\n\n➕ Tambah Akun: menambahkan akun baru\n❌ Batal: membatalkan proses yang sedang berjalan`, reply_markup: mainMenu()});
}

async function sendJenis(chatId, settings) {
  const jenis = settings.jenis || [];
  if (!jenis.length) return tg('sendMessage',{chat_id:chatId,text:'❌ Belum ada Jenis Akun di Pengaturan website.'});
  const keyboard = jenis.map(x => [{text:`${x.nama}${x.prefix ? ` (${x.prefix})` : ''}`, callback_data:`jenis:${x.id}`}]);
  return tg('sendMessage',{chat_id:chatId,text:'📂 Pilih Jenis Akun:',reply_markup:{inline_keyboard:keyboard}});
}

async function sendMetode(chatId, settings) {
  const items = settings.metode_beli || [];
  if (!items.length) return tg('sendMessage',{chat_id:chatId,text:'❌ Belum ada Metode Pembelian di Pengaturan website.'});
  const keyboard = items.map(x => [{text:x.nama, callback_data:`metode:${x.id}`}]);
  return tg('sendMessage',{chat_id:chatId,text:'🛒 Pilih Metode Pembelian:',reply_markup:{inline_keyboard:keyboard}});
}

async function handleCallback(update, deps) {
  const q = update.callback_query;
  const chatId = q.message?.chat?.id;
  if (!chatId || !allowed(chatId)) return tg('answerCallbackQuery',{callback_query_id:q.id,text:'Akses ditolak.'});
  const pool = deps.getPool(); await deps.init(); await ensureTelegramSchema(pool);
  await tg('answerCallbackQuery',{callback_query_id:q.id});
  const data = String(q.data || '');
  const state = await getSession(pool, chatId);
  const settings = await deps.settingsObj();

  if (data.startsWith('jenis:')) {
    const id = Number(data.slice(6));
    const j = (settings.jenis||[]).find(x=>Number(x.id)===id);
    if (!j) return tg('sendMessage',{chat_id:chatId,text:'❌ Jenis Akun tidak ditemukan.'});
    const no = await nextAccountNumber(pool);
    const kode = `${j.prefix || ''}${no}`;
    const next = {step:'harga',jenis:j.nama,prefix:j.prefix||'',kode,tanggal_beli:todayWIB()};
    await setSession(pool,chatId,next);
    return tg('sendMessage',{chat_id:chatId,text:
`✅ Jenis Akun: ${j.nama}\n🔢 Kode otomatis: ${kode}\n📅 Tanggal Beli: ${next.tanggal_beli}\n\nMasukkan Harga Beli (contoh: 150000):`});
  }

  if (data.startsWith('metode:')) {
    const id = Number(data.slice(7));
    const m = (settings.metode_beli||[]).find(x=>Number(x.id)===id);
    if (!m) return tg('sendMessage',{chat_id:chatId,text:'❌ Metode Pembelian tidak ditemukan.'});
    state.metode_beli = m.nama;
    state.step = 'confirm';
    await setSession(pool,chatId,state);
    return tg('sendMessage',{chat_id:chatId,text:
`📋 KONFIRMASI DATA\n\nJenis Akun: ${state.jenis}\nKode: ${state.kode}\nTanggal Beli: ${state.tanggal_beli}\nHarga Beli: ${money(state.harga_beli)}\nInformasi: ${state.info || '-'}\nKode Cadangan:\n${formatBackupCodes(state.kode_cadangan)}\nMetode Pembelian: ${state.metode_beli}\n\nSimpan data ini?`,reply_markup:{inline_keyboard:[[{text:'✅ SIMPAN',callback_data:'save'},{text:'❌ BATAL',callback_data:'cancel'}]]}});
  }

  if (data === 'save') {
    if (state.step !== 'confirm') return tg('sendMessage',{chat_id:chatId,text:'Tidak ada data yang siap disimpan. Gunakan /tambahakun.'});
    const codes = cleanBackupCodes(state.kode_cadangan || []);
    const r = await pool.query(`INSERT INTO sales(kode,tanggal_beli,jenis,harga_beli,info,kode_cadangan,metode_beli)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,kode`, [state.kode,state.tanggal_beli,state.jenis,Number(state.harga_beli)||0,state.info||'',JSON.stringify(codes),state.metode_beli||'']);
    await clearSession(pool,chatId);
    return tg('sendMessage',{chat_id:chatId,text:`✅ AKUN BERHASIL DISIMPAN\n\nKode: ${r.rows[0].kode}\nJenis: ${state.jenis}\nHarga Beli: ${money(state.harga_beli)}\nTanggal Beli: ${state.tanggal_beli}\nMetode: ${state.metode_beli}`, reply_markup:mainMenu()});
  }
  if (data === 'cancel') {
    await clearSession(pool,chatId);
    return tg('sendMessage',{chat_id:chatId,text:'❌ Penambahan akun dibatalkan.'});
  }
}

async function handler(req,res,deps) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && String(req.headers['x-telegram-bot-api-secret-token'] || '') !== secret) return res.status(401).json({error:'Unauthorized'});
  const update = req.body || {};
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  if (!chatId || !allowed(chatId)) return res.status(200).json({ok:true,ignored:true});
  try {
    await deps.init();
    const pool = deps.getPool();
    await ensureTelegramSchema(pool);
    if (update.callback_query) {
      await handleCallback(update,deps);
      return res.status(200).json({ok:true});
    }
    const msg = update.message;
    if (!msg) return res.status(200).json({ok:true});
    const text = String(msg.text || '').trim();
    if (text === '/start') { await clearSession(pool,chatId); await sendStart(chatId); return res.json({ok:true}); }
    if (text === '/batal' || text === '❌ Batal') { await clearSession(pool,chatId); await tg('sendMessage',{chat_id:chatId,text:'❌ Proses dibatalkan.',reply_markup:mainMenu()}); return res.json({ok:true}); }
    if (text === '/tambahakun' || text === '➕ Tambah Akun') { await clearSession(pool,chatId); await sendJenis(chatId,await deps.settingsObj()); return res.json({ok:true}); }

    const state = await getSession(pool,chatId);
    if (!state.step) { await tg('sendMessage',{chat_id:chatId,text:'Silakan pilih menu di bawah untuk melanjutkan.',reply_markup:mainMenu()}); return res.json({ok:true}); }
    if (state.step === 'harga') {
      const n = Number(String(text).replace(/[^0-9]/g,''));
      if (!n) { await tg('sendMessage',{chat_id:chatId,text:'❌ Harga tidak valid. Masukkan angka, contoh: 150000'}); return res.json({ok:true}); }
      state.harga_beli=n; state.step='info'; await setSession(pool,chatId,state);
      await tg('sendMessage',{chat_id:chatId,text:'📝 Masukkan Informasi Akun (email/password/dll).'}); return res.json({ok:true});
    }
    if (state.step === 'info') {
      state.info=text; state.step='kode_cadangan'; await setSession(pool,chatId,state);
      await tg('sendMessage',{chat_id:chatId,text:'🔐 Masukkan Kode Cadangan.\n\n• Setiap kode harus 8 digit angka\n• Bisa masukkan beberapa kode, satu per baris\n• Maksimal 10 kode\n\nContoh:\n35367231\n69086580\n68677661\n\nJika tidak ada, ketik -'}); return res.json({ok:true});
    }
    if (state.step === 'kode_cadangan') {
      try {
        state.kode_cadangan = text === '-' ? [] : cleanBackupCodes(text);
      } catch (e) {
        await tg('sendMessage',{chat_id:chatId,text:`❌ ${e.message}\n\nSilakan masukkan ulang kode cadangan.`});
        return res.json({ok:true});
      }
      state.step='metode'; await setSession(pool,chatId,state);
      await sendMetode(chatId,await deps.settingsObj()); return res.json({ok:true});
    }
    await tg('sendMessage',{chat_id:chatId,text:'Pilih tombol yang tersedia atau gunakan /batal.'});
    return res.json({ok:true});
  } catch (e) {
    console.error('Telegram webhook error:',e);
    try { await tg('sendMessage',{chat_id:chatId,text:`❌ Terjadi kesalahan: ${e.message}`}); } catch {}
    return res.status(200).json({ok:true});
  }
}

module.exports = handler;
