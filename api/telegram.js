const express = require('express');
const router = express.Router();

// Telegram integration for MFI Store.
// Required environment variables:
// TELEGRAM_BOT_TOKEN
// TELEGRAM_ALLOWED_CHAT_IDS (comma-separated chat IDs)
// TELEGRAM_WEBHOOK_SECRET (optional; if set, must be sent as X-Telegram-Bot-Api-Secret-Token)

const sessions = new Map();
router.use((req, res, next) => { router._app = req.app; next(); });
const MAX_SESSION_MS = 15 * 60 * 1000;

function token() { return String(process.env.TELEGRAM_BOT_TOKEN || '').trim(); }
function allowed(chatId) {
  const raw = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').trim();
  if (!raw) return false;
  return raw.split(',').map(x => x.trim()).filter(Boolean).includes(String(chatId));
}
function clean(v) { return String(v ?? '').trim(); }
function rupiah(v) {
  const digits = clean(v).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}
function formatRp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function today() { return new Date().toISOString().slice(0, 10); }
function displayDate(v) {
  const s = clean(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  return s;
}
function db() { return router._app?.locals?.getDb?.() || null; }

async function tg(method, body = {}) {
  const t = token();
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN belum diatur');
  const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data.result;
}

function keyboard(rows) { return { inline_keyboard: rows }; }
function mainMenu() {
  return keyboard([
    [{ text: '➕ Tambah Akun', callback_data: 'add:start' }],
    [{ text: '📋 Jenis Akun', callback_data: 'show:jenis' }, { text: '💳 Metode Beli', callback_data: 'show:metode' }],
    [{ text: '❌ Batal', callback_data: 'flow:cancel' }]
  ]);
}
async function settings(type) {
  const d = db();
  if (!d) throw new Error('Database belum tersedia');
  const r = await d.query('SELECT id,nama,prefix,potongan,garansi FROM settings WHERE type=$1 ORDER BY id', [type]);
  return r.rows;
}
async function begin(chatId, user) {
  sessions.set(String(chatId), { step: 'jenis', data: {}, updated: Date.now() });
  const items = await settings('jenis');
  if (!items.length) return tg('sendMessage', { chat_id: chatId, text: 'Belum ada Jenis Akun di Pengaturan.' });
  const rows = items.map(x => [{ text: x.nama, callback_data: `jenis:${x.id}` }]);
  rows.push([{ text: '❌ Batal', callback_data: 'flow:cancel' }]);
  await tg('sendMessage', { chat_id: chatId, text: '➕ *Tambah Akun*\n\nPilih *Jenis Akun*:', parse_mode: 'Markdown', reply_markup: keyboard(rows) });
}
function promptFor(step) {
  const map = {
    kode: 'Masukkan *Kode Akun*:',
    tanggal_beli: 'Masukkan *Tanggal Beli* (YYYY-MM-DD):',
    harga_beli: 'Masukkan *Harga Beli* (contoh: 150000):',
    info: 'Masukkan *Informasi Akun* (email/password/dll).\n\nJika kosong, ketik `-`.',
    kode_cadangan: 'Masukkan *Kode Cadangan*.\n\nBoleh lebih dari satu, pisahkan dengan spasi/koma. Setiap kode harus 8 digit.\nJika tidak ada, ketik `-`.',
    metode_beli: 'Pilih *Metode Pembelian*:'
  };
  return map[step] || '';
}
async function askMethod(chatId) {
  const items = await settings('metode_beli');
  if (!items.length) return tg('sendMessage', { chat_id: chatId, text: 'Belum ada Metode Pembelian di Pengaturan.' });
  const rows = items.map(x => [{ text: x.nama, callback_data: `metode:${x.id}` }]);
  rows.push([{ text: '❌ Batal', callback_data: 'flow:cancel' }]);
  await tg('sendMessage', { chat_id: chatId, text: promptFor('metode_beli'), parse_mode: 'Markdown', reply_markup: keyboard(rows) });
}
async function confirm(chatId, s) {
  const d = s.data;
  const text = [
    '🧾 *KONFIRMASI TAMBAH AKUN*', '',
    `Jenis Akun: *${d.jenisNama}*`,
    `Kode Akun: *${d.kode}*`,
    `Tanggal Beli: *${displayDate(d.tanggal_beli)}*`,
    `Harga Beli: *${formatRp(d.harga_beli)}*`,
    `Informasi: ${d.info === '-' ? '-' : d.info}`,
    `Kode Cadangan: ${d.kode_cadangan.length ? d.kode_cadangan.join(', ') : '-'}`,
    `Metode Beli: *${d.metode_beliNama}*`, '',
    'Simpan data ini?'
  ].join('\n');
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: keyboard([
    [{ text: '✅ SIMPAN', callback_data: 'flow:save' }, { text: '❌ BATAL', callback_data: 'flow:cancel' }]
  ]) });
}
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function validCodes(v) {
  if (v === '-') return [];
  return v.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
}
async function save(chatId, s) {
  const d = db();
  if (!d) throw new Error('Database belum tersedia');
  for (const c of s.data.kode_cadangan) if (!/^\d{8}$/.test(c)) throw new Error(`Kode cadangan ${c} harus tepat 8 digit`);
  if (s.data.kode_cadangan.length > 10) throw new Error('Maksimal 10 kode cadangan');
  const r = await d.query(`INSERT INTO sales(kode,tanggal_beli,jenis,harga_beli,info,kode_cadangan,metode_beli) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`, [
    s.data.kode, s.data.tanggal_beli, s.data.jenisNama, s.data.harga_beli, s.data.info === '-' ? '' : s.data.info,
    JSON.stringify(s.data.kode_cadangan), s.data.metode_beliNama
  ]);
  return r.rows[0].id;
}
async function textStep(chatId, text) {
  const s = sessions.get(String(chatId));
  if (!s || Date.now() - s.updated > MAX_SESSION_MS) {
    sessions.delete(String(chatId));
    return tg('sendMessage', { chat_id: chatId, text: 'Sesi sudah berakhir. Ketik /tambahakun untuk mulai lagi.' });
  }
  s.updated = Date.now();
  const v = clean(text);
  try {
    if (s.step === 'kode') {
      if (!v) throw new Error('Kode Akun tidak boleh kosong.');
      s.data.kode = v; s.step = 'tanggal_beli';
      return tg('sendMessage', { chat_id: chatId, text: promptFor(s.step), parse_mode: 'Markdown' });
    }
    if (s.step === 'tanggal_beli') {
      if (!validDate(v)) throw new Error('Format tanggal harus YYYY-MM-DD.');
      s.data.tanggal_beli = v; s.step = 'harga_beli';
      return tg('sendMessage', { chat_id: chatId, text: promptFor(s.step), parse_mode: 'Markdown' });
    }
    if (s.step === 'harga_beli') {
      const n = rupiah(v); if (!n) throw new Error('Harga Beli harus berupa angka lebih dari 0.');
      s.data.harga_beli = n; s.step = 'info';
      return tg('sendMessage', { chat_id: chatId, text: promptFor(s.step), parse_mode: 'Markdown' });
    }
    if (s.step === 'info') {
      s.data.info = v || '-'; s.step = 'kode_cadangan';
      return tg('sendMessage', { chat_id: chatId, text: promptFor(s.step), parse_mode: 'Markdown' });
    }
    if (s.step === 'kode_cadangan') {
      const codes = validCodes(v); if (codes.length > 10) throw new Error('Maksimal 10 kode cadangan.');
      for (const c of codes) if (!/^\d{8}$/.test(c)) throw new Error(`Kode ${c} harus tepat 8 digit angka.`);
      s.data.kode_cadangan = codes; s.step = 'metode_beli';
      return askMethod(chatId);
    }
    return tg('sendMessage', { chat_id: chatId, text: 'Silakan gunakan tombol yang tersedia.' });
  } catch (e) {
    return tg('sendMessage', { chat_id: chatId, text: `❌ ${e.message}` });
  }
}

async function callback(chatId, data, callbackId) {
  const s = sessions.get(String(chatId));
  if (data === 'add:start') { await tg('answerCallbackQuery', { callback_query_id: callbackId }); return begin(chatId); }
  if (data === 'flow:cancel') {
    sessions.delete(String(chatId));
    await tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Dibatalkan' });
    return tg('sendMessage', { chat_id: chatId, text: '❌ Proses dibatalkan.' });
  }
  if (data === 'show:jenis' || data === 'show:metode') {
    const type = data === 'show:jenis' ? 'jenis' : 'metode_beli';
    const items = await settings(type);
    await tg('answerCallbackQuery', { callback_query_id: callbackId });
    return tg('sendMessage', { chat_id: chatId, text: items.length ? items.map((x,i) => `${i+1}. ${x.nama}${x.prefix ? ` (${x.prefix})` : ''}`).join('\n') : 'Belum ada data.' });
  }
  if (data.startsWith('jenis:')) {
    if (!s) return tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Sesi berakhir. /tambahakun' });
    const id = Number(data.split(':')[1]); const items = await settings('jenis'); const x = items.find(a => Number(a.id) === id);
    if (!x) return tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Jenis Akun tidak ditemukan' });
    s.data.jenisNama = x.nama; s.data.jenisPrefix = x.prefix || ''; s.step = 'kode'; s.updated = Date.now();
    await tg('answerCallbackQuery', { callback_query_id: callbackId, text: x.nama });
    return tg('sendMessage', { chat_id: chatId, text: `${promptFor('kode')}\nPrefix: *${x.prefix || '-'}*`, parse_mode: 'Markdown' });
  }
  if (data.startsWith('metode:')) {
    if (!s) return tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Sesi berakhir. /tambahakun' });
    const id = Number(data.split(':')[1]); const items = await settings('metode_beli'); const x = items.find(a => Number(a.id) === id);
    if (!x) return tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Metode tidak ditemukan' });
    s.data.metode_beliNama = x.nama; s.step = 'confirm'; s.updated = Date.now();
    await tg('answerCallbackQuery', { callback_query_id: callbackId, text: x.nama });
    return confirm(chatId, s);
  }
  if (data === 'flow:save') {
    if (!s) return tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Sesi berakhir' });
    try {
      const id = await save(chatId, s); sessions.delete(String(chatId));
      await tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Tersimpan' });
      return tg('sendMessage', { chat_id: chatId, text: `✅ *Akun berhasil disimpan.*\nID: ${id}\n\nData sudah masuk ke website MFI Store.`, parse_mode: 'Markdown', reply_markup: mainMenu() });
    } catch (e) {
      return tg('answerCallbackQuery', { callback_query_id: callbackId, text: 'Gagal menyimpan' }).then(() => tg('sendMessage', { chat_id: chatId, text: `❌ Gagal menyimpan: ${e.message}` }));
    }
  }
  await tg('answerCallbackQuery', { callback_query_id: callbackId });
}

async function handleUpdate(update) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (chatId == null || !allowed(chatId)) return;
  await router._app.locals.initDatabase();
  if (cb) return callback(chatId, clean(cb.data), cb.id);
  const text = clean(msg.text);
  if (text === '/start' || text === '/menu') return tg('sendMessage', { chat_id: chatId, text: '🤖 *MFI Store Bot*\n\nPilih menu:', parse_mode: 'Markdown', reply_markup: mainMenu() });
  if (text === '/tambahakun') return begin(chatId);
  if (text === '/batal') { sessions.delete(String(chatId)); return tg('sendMessage', { chat_id: chatId, text: '❌ Proses dibatalkan.' }); }
  if (sessions.has(String(chatId))) return textStep(chatId, text);
  return tg('sendMessage', { chat_id: chatId, text: 'Perintah tidak dikenali. Gunakan /tambahakun atau /menu.' });
}

router.post('/', async (req, res) => {
  try {
    const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (secret && req.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return res.status(401).json({ error: 'Unauthorized' });
    res.status(200).json({ ok: true });
    await handleUpdate(req.body || {});
  } catch (e) { console.error('Telegram webhook:', e); }
});

router.get('/', (req, res) => res.json({ ok: true, service: 'mfi-telegram', configured: Boolean(token()) }));

module.exports = router;
