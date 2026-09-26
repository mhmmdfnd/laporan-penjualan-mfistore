
const $=id=>document.getElementById(id), rp=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n)||0);
function moneyValue(v){const s=String(v??'').replace(/[^0-9]/g,'');return s?Number(s):0}
function formatRupiahInput(v){const n=moneyValue(v);return n?('Rp '+new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(n)):'Rp 0'}
function formatMoneyField(el){el.value=formatRupiahInput(el.value)}
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
async function api(url,opt={}){const r=await fetch(url,opt);if(r.status===401){showLogin();throw Error("login")};if(!r.ok)throw Error(await r.text());return r.json()}
async function check(){const x=await fetch('/api/me').then(r=>r.json());if(x.loggedIn)showApp();else showLogin()}
function showLogin(){$('login').classList.remove('hidden');$('app').classList.add('hidden')}
function showApp(){$('login').classList.add('hidden');$('app').classList.remove('hidden');load();stats()}
async function login(e){e.preventDefault();$('lerr').textContent='';try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('lu').value,password:$('lp').value})});showApp()}catch(x){$('lerr').textContent='Login gagal'}}
async function logout(){await api('/api/logout',{method:'POST'});showLogin()}
function tab(t){
if(t==='input'){openInputModal();return;}
const pages=['data','report','settings','toko','expenses','database'];
pages.forEach(x=>$(x).classList.toggle('hidden',x!==t));
const buttons={data:'td',report:'tr',settings:'ts',toko:'ttoko',expenses:'te',database:'tdb'};
Object.values(buttons).forEach(id=>$(id).classList.remove('active'));
$(buttons[t]).classList.add('active');
if(t==='report')loadReport();if(t==='settings')loadSettings();if(t==='toko')loadToko();if(t==='expenses')loadExpenses();if(t==='database')loadDbStatus();
}
function buktiSelect(x){const v=['belum','screenshot','upload'].includes(x.bukti_status)?x.bukti_status:'belum';const labels={belum:'🔴 Belum',screenshot:'🟡 Screenshot',upload:'🟢 Upload'};return `<select class="bukti-select ${v}" onchange="ubahBukti(${x.id},this)"><option value="belum" ${v==='belum'?'selected':''}>🔴 Belum</option><option value="screenshot" ${v==='screenshot'?'selected':''}>🟡 Screenshot</option><option value="upload" ${v==='upload'?'selected':''}>🟢 Upload</option></select>`}
async function ubahBukti(id,el){const old=el.value;try{await api('/api/sales/'+id+'/bukti',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({bukti_status:old})});el.className='bukti-select '+old;if(!$('fb')||!$('fb').value||$('fb').value===old){}else{await load()}}catch(e){alert(e.message||'Gagal menyimpan status bukti');await load()}}
async function load(){let p=new URLSearchParams({q:$('q').value,status:$('fs').value,jenis:$('fj').value,tempat:$('ftempat')?.value||'',toko:$('ftoko')?.value||'',bukti:$('fb')?.value||'',from:$('dateFrom').value,to:$('dateTo').value});let rows=await api('/api/sales?'+p);$('filterText').textContent=($('dateFrom').value||$('dateTo').value)?(($('dateFrom').value||'awal')+' s/d '+($('dateTo').value||'akhir')):'Semua tanggal';$('count').textContent=rows.length+' data';$('tbody').innerHTML=rows.length?rows.map((x,i)=>`<tr>
<td>${i+1}</td><td><span class="status ${x.hackback?'hb':(x.tanggal_jual?'sold':'avail')}">${x.hackback?'HB':(x.tanggal_jual?'Sold':'Available')}</span></td><td>${buktiSelect(x)}</td><td><b>${esc(x.kode)}</b></td><td>${esc(x.tanggal_beli)}</td><td>${esc(x.jenis)}</td><td class="money">${x.hackback?'-':''}${rp(x.harga_beli)}</td><td style="white-space:pre-line;min-width:250px">${esc(x.info)}</td><td class="backup-codes-cell">${(Array.isArray(x.kode_cadangan)?x.kode_cadangan:[x.kode_cadangan||'']).filter(Boolean).map((c,n)=>`<div><span>${n+1}.</span> <b>${esc(c)}</b></div>`).join('')||'-'}</td><td>${esc(x.metode_beli)}</td><td>${esc(x.toko||'-')}</td><td>${esc(x.tempat)}</td><td>${esc(x.tanggal_jual||'-')}</td><td>${esc(x.tanggal_konfirmasi||'-')}</td><td>${esc(x.metode_bayar)}</td><td>${x.garansi} hari</td><td>${esc(x.pembeli||'-')}</td><td>${esc(x.pesanan||'-')}</td><td class="money">${rp(x.harga_jual)}</td><td class="money">${rp(x.potongan)}</td><td class="money"><b>${rp(x.diterima)}</b></td><td class="money"><b style="color:${x.keuntungan>=0?'#15803d':'#dc2626'}">${rp(x.keuntungan)}</b></td><td><button class="btn blue mini" onclick='editAccount(${JSON.stringify(x)})'>Edit</button> <button class="btn green mini" onclick='openSale(${JSON.stringify(x)})'>Penjualan</button> <label class="hackback-action" title="Tandai akun sebagai Hackback"><input type="checkbox" ${x.hackback?'checked':''} onchange="toggleHackback(${x.id},this.checked)"> HB</label> <button class="btn red mini" onclick="del(${x.id})">Hapus</button></td></tr>`).join(''):'<tr><td colspan="22" style="text-align:center;padding:30px">Belum ada data</td></tr>'}
async function stats(){try{let p=new URLSearchParams({from:$('dateFrom')?.value||'',to:$('dateTo')?.value||'',toko:$('ftoko')?.value||''});let x=await api('/api/stats?'+p);const set=(id,v)=>{const el=$(id);if(el)el.textContent=v};set('stTotal',x.total);set('stSold',x.sold);set('stOmzet',rp(x.omzet));set('stPotongan',rp(x.potongan));set('stKotor',rp(x.untungKotor));set('stProfit',rp(x.untungBersih))}catch(e){console.warn('Statistik ringkas dilewati:',e.message||e)}}
function calc(){let j=moneyValue($('harga_jual').value),p=moneyValue($('potongan').value),b=moneyValue($('harga_beli').value);$('diterima').value=formatRupiahInput(Math.max(0,j-p));$('keuntungan').value=formatRupiahInput(Math.max(0,j-p)-b)}
let SETTINGS={jenis:[],tempat:[],metode_beli:[],metode_bayar:[]};
function kodePrefixFor(jenis){const x=SETTINGS.jenis.find(v=>v.nama===jenis);return x?.prefix||'ACC-'}
function updateKodePrefix(){const p=kodePrefixFor($('jenis').value);$('kodePrefix').textContent=p;updateKode()}
function updateKode(){const p=kodePrefixFor($('jenis').value);const n=String($('kode_nomor').value||'').replace(/\D/g,'');$('kode_nomor').value=n;$('kode').value=p+n}
function cleanBackupText(){const lines=$('kode_cadangan').value.split(/\r?\n/).map(v=>v.replace(/\s+/g,''));$('kode_cadangan').value=lines.join('\n');return lines.map(v=>v.trim()).filter(Boolean)}
function cleanBackupTextarea(){cleanBackupText()}
function populateSelect(id,items,selected=''){const el=$(id);if(!el)return;el.innerHTML=items.map(x=>`<option value="${esc(x.nama)}">${esc(x.nama)}</option>`).join('');if(selected && items.some(x=>x.nama===selected))el.value=selected}
async function loadDbStatus(){try{const x=await api('/api/db/status');$('dbStatusBox').innerHTML=`<b style="color:#15803d">● TERHUBUNG</b><br>Database: <b>${esc(x.database||'-')}</b><br>Server: ${esc(x.server||'-')}<br>Mode: ${x.activeIsBootstrap?'DATABASE_URL Vercel':'Database dari konfigurasi dashboard'}`;}catch(e){$('dbStatusBox').innerHTML=`<b style="color:#dc2626">● GAGAL</b><br>${esc(e.message||'Koneksi database gagal')}`}}
async function testDbConnection(){const url=$('dbUrl').value.trim();if(!url){alert('Isi DATABASE_URL terlebih dahulu');return}try{const x=await api('/api/db/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({database_url:url})});alert('Koneksi berhasil! Database: '+x.database)}catch(e){alert('Test koneksi gagal: '+(e.message||'Error'))}}
async function saveDbConnection(){const url=$('dbUrl').value.trim();if(!url){alert('Isi DATABASE_URL terlebih dahulu');return}if(!confirm('Aktifkan koneksi database ini? Data aplikasi berikutnya akan menggunakan database tersebut.'))return;try{const x=await api('/api/db/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({database_url:url})});alert(x.message||'Database berhasil diaktifkan');$('dbUrl').value='';await loadDbStatus();await load();await stats()}catch(e){alert('Gagal menyimpan database: '+(e.message||'Error'))}}
async function useBootstrapDb(){if(!confirm('Kembali menggunakan DATABASE_URL dari Vercel?'))return;try{const x=await api('/api/db/use-bootstrap',{method:'POST'});alert(x.message||'Berhasil');await loadDbStatus();await load();await stats()}catch(e){alert(e.message||'Gagal mengganti database')}}
async function loadSettings(){SETTINGS=await api('/api/settings');
  populateSelect('jenis',SETTINGS.jenis,$('jenis')?.value);populateSelect('metode_beli',SETTINGS.metode_beli,$('metode_beli')?.value);populateSelect('tempat',SETTINGS.tempat,$('tempat')?.value);populateSelect('metode_bayar',SETTINGS.metode_bayar,$('metode_bayar')?.value);updateKodePrefix();renderSettings();applySaleRules();await loadToko()}
let TOKO=[];
async function loadToko(){
  const box=$('tokoSettings');
  const err=$('tokoError');
  if(box) box.innerHTML='<div style="padding:20px;color:#64748b">Memuat daftar toko...</div>';
  if(err){err.style.display='none';err.textContent='';}
  try{
    TOKO=await api('/api/toko');
    const current=$('ftoko')?.value||'', reportCurrent=$('reportToko')?.value||'', saleCurrent=$('tokoPenjualan')?.value||'';
    if($('ftoko')){$('ftoko').innerHTML='<option value="">Semua Toko</option>'+TOKO.map(x=>`<option value="${esc(x.nama)}">${esc(x.nama)}</option>`).join('');$('ftoko').value=current;}
    if($('reportToko')){$('reportToko').innerHTML='<option value="">Semua Toko</option>'+TOKO.map(x=>`<option value="${esc(x.nama)}">${esc(x.nama)}</option>`).join('');$('reportToko').value=reportCurrent;}
    if($('tokoPenjualan')){$('tokoPenjualan').innerHTML='<option value="">Pilih toko</option>'+TOKO.map(x=>`<option value="${esc(x.nama)}">${esc(x.nama)}</option>`).join('');if(saleCurrent&&TOKO.some(x=>x.nama===saleCurrent))$('tokoPenjualan').value=saleCurrent;}
    if(box){
      box.innerHTML=TOKO.length?`<table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:12px;text-align:left;background:#f8fafc;border-bottom:1px solid #e5e7eb">No</th><th style="padding:12px;text-align:left;background:#f8fafc;border-bottom:1px solid #e5e7eb">Nama Toko</th><th style="padding:12px;text-align:left;background:#f8fafc;border-bottom:1px solid #e5e7eb">Aksi</th></tr></thead><tbody>${TOKO.map((x,i)=>`<tr><td style="padding:12px;border-bottom:1px solid #edf1f5">${i+1}</td><td style="padding:12px;border-bottom:1px solid #edf1f5"><input id="tkn${x.id}" value="${esc(x.nama)}" style="width:min(420px,100%);height:38px;padding:0 10px;border:1px solid #cbd5e1;border-radius:7px"></td><td style="padding:12px;border-bottom:1px solid #edf1f5;white-space:nowrap"><button class="btn green mini" type="button" onclick="saveToko(${x.id})">💾 Simpan</button> <button class="btn red mini" type="button" onclick="deleteToko(${x.id})">🗑️ Hapus</button></td></tr>`).join('')}</tbody></table>`:'<div style="padding:25px;text-align:center;color:#64748b">Belum ada toko. Silakan masukkan nama toko di atas.</div>';
    }
  }catch(e){
    console.error(e);
    if(box) box.innerHTML='<div style="padding:20px;color:#b91c1c;font-weight:700">Gagal memuat daftar toko.</div>';
    if(err){err.textContent='Error: '+(e.message||'Gagal terhubung ke server');err.style.display='block';}
  }
}
async function addToko(){const nama=$('newTokoNama').value.trim();if(!nama){alert('Nama toko wajib diisi');return}try{await api('/api/toko',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nama})});$('newTokoNama').value='';await loadToko();alert('Toko berhasil ditambahkan')}catch(e){console.error(e);if($('tokoError')){$('tokoError').textContent=e.message||'Gagal menambah toko';$('tokoError').style.display='block';}else alert(e.message||'Gagal menambah toko')}}
async function saveToko(id){const nama=$('tkn'+id).value.trim();if(!nama){alert('Nama toko wajib diisi');return}try{await api('/api/toko/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nama})});await loadToko();alert('Toko berhasil disimpan')}catch(e){alert(e.message||'Gagal menyimpan toko')}}
async function deleteToko(id){if(!confirm('Hapus toko ini? Data penjualan yang sudah memakai nama toko tidak akan terhapus, tetapi pilihan toko tersebut tidak tersedia lagi.'))return;try{await api('/api/toko/'+id,{method:'DELETE'});await loadToko();alert('Toko berhasil dihapus')}catch(e){alert(e.message||'Gagal menghapus toko')}}

function renderSettings(){
$('jenisSettings').innerHTML=`<table class="settings-table"><tr><th>Nama</th><th>Prefix</th><th>Aksi</th></tr>${SETTINGS.jenis.map(x=>`<tr><td><input id="jn${x.id}" value="${esc(x.nama)}"></td><td><input id="jp${x.id}" value="${esc(x.prefix)}"></td><td><button class="btn green mini" onclick="saveSetting('jenis',${x.id})">Simpan</button> <button class="btn red mini" onclick="deleteSetting('jenis',${x.id})">Hapus</button></td></tr>`).join('')}</table>`;
$('tempatSettings').innerHTML=`<table class="settings-table"><tr><th>Nama</th><th>Potongan %</th><th>Aksi</th></tr>${SETTINGS.tempat.map(x=>`<tr><td><input id="tn${x.id}" value="${esc(x.nama)}"></td><td><input id="tp${x.id}" type="number" min="0" max="100" step="0.01" value="${Number(x.potongan)||0}"></td><td><button class="btn green mini" onclick="saveSetting('tempat',${x.id})">Simpan</button> <button class="btn red mini" onclick="deleteSetting('tempat',${x.id})">Hapus</button></td></tr>`).join('')}</table>`;
$('beliSettings').innerHTML=`<table class="settings-table"><tr><th>Nama</th><th>Aksi</th></tr>${SETTINGS.metode_beli.map(x=>`<tr><td><input id="bn${x.id}" value="${esc(x.nama)}"></td><td><button class="btn green mini" onclick="saveSetting('metode_beli',${x.id})">Simpan</button> <button class="btn red mini" onclick="deleteSetting('metode_beli',${x.id})">Hapus</button></td></tr>`).join('')}</table>`;
$('bayarSettings').innerHTML=`<table class="settings-table"><tr><th>Nama</th><th>Garansi (hari)</th><th>Aksi</th></tr>${SETTINGS.metode_bayar.map(x=>`<tr><td><input id="yn${x.id}" value="${esc(x.nama)}"></td><td><input id="yg${x.id}" type="number" min="0" value="${Number(x.garansi)||0}"></td><td><button class="btn green mini" onclick="saveSetting('metode_bayar',${x.id})">Simpan</button> <button class="btn red mini" onclick="deleteSetting('metode_bayar',${x.id})">Hapus</button></td></tr>`).join('')}</table>`;
}
function settingPayload(type,id){if(type==='jenis')return {nama:$('jn'+id).value,prefix:$('jp'+id).value};if(type==='tempat')return {nama:$('tn'+id).value,potongan:$('tp'+id).value};if(type==='metode_beli')return {nama:$('bn'+id).value};return {nama:$('yn'+id).value,garansi:$('yg'+id).value}}
async function saveSetting(type,id){try{await api(`/api/settings/${type}/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settingPayload(type,id))});await loadSettings();alert('Pengaturan berhasil disimpan')}catch(e){alert(e.message||'Gagal menyimpan pengaturan')}}
async function deleteSetting(type,id){if(!confirm('Hapus pengaturan ini?'))return;try{await api(`/api/settings/${type}/${id}`,{method:'DELETE'});await loadSettings();alert('Pengaturan berhasil dihapus')}catch(e){alert(e.message||'Gagal menghapus pengaturan')}}
async function addSetting(type){let body={};if(type==='jenis')body={nama:$('newJenisNama').value,prefix:$('newJenisPrefix').value};if(type==='tempat')body={nama:$('newTempatNama').value,potongan:$('newTempatPot').value};if(type==='metode_beli')body={nama:$('newBeliNama').value};if(type==='metode_bayar')body={nama:$('newBayarNama').value,garansi:$('newBayarGaransi').value};try{await api('/api/settings/'+type,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await loadSettings();alert('Data berhasil ditambahkan')}catch(e){alert(e.message||'Gagal menambah data')}}
function applySaleRules(){if(!$('tempat')||!SETTINGS.tempat.length)return;const t=SETTINGS.tempat.find(x=>x.nama===$('tempat').value),b=SETTINGS.metode_bayar.find(x=>x.nama===$('metode_bayar').value),harga=moneyValue($('harga_jual').value),pct=Number(t?.potongan)||0;$('potongan').value=formatRupiahInput(Math.round(harga*pct/100));$('garansi').value=Number(b?.garansi)||0;calc()}
async function saveForm(e){e.preventDefault();
  const kodeCadangan=cleanBackupText($('kode_cadangan').value);
  updateKode();
  const kode=$('kode').value;
  if(kodeCadangan.length>10){alert('Maksimal 10 kode cadangan.');$('kode_cadangan').focus();return;}
  if(kodeCadangan.some(v=>!/^[0-9]{8}$/.test(v))){alert('Setiap kode cadangan harus tepat 8 digit angka, satu kode per baris.');$('kode_cadangan').focus();return;}
  const o={kode,tanggal_beli:$('tanggal_beli').value,jenis:$('jenis').value,harga_beli:moneyValue($('harga_beli').value),info:$('info').value,kode_cadangan:kodeCadangan,metode_beli:$('metode_beli').value};
  let id=$('id').value;
  try{await api(id?'/api/sales/'+id+'/account':'/api/sales',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)});alert('Data akun berhasil disimpan')}catch(err){alert(err.message||'Gagal menyimpan data');return;}
  resetForm();closeInputModal();await load();await stats();tab('data')
}
function editAccount(x){$('id').value=x.id;['tanggal_beli','jenis','harga_beli','info','metode_beli'].forEach(k=>{if($(k))$(k).value=x[k]??''});updateKodePrefix();$('harga_beli').value=formatRupiahInput(x.harga_beli);const prefix=kodePrefixFor(x.jenis);let nomor=String(x.kode||'');if(nomor.toUpperCase().startsWith(prefix))nomor=nomor.slice(prefix.length);else nomor=nomor.replace(/[^0-9]/g,'');$('kode_nomor').value=nomor.replace(/\D/g,'');updateKode();$('kode_cadangan').value=Array.isArray(x.kode_cadangan)?x.kode_cadangan.join('\n'):(x.kode_cadangan||'');cleanBackupTextarea();$('ft').textContent='EDIT DATA AKUN: '+x.kode;openInputModal(true);}
function openSale(x){$('sale_id').value=x.id;$('saleAccountInfo').innerHTML=`<b>${esc(x.kode)}</b> · ${esc(x.jenis)} · Harga beli ${rp(x.harga_beli)}`;['toko','tempat','tanggal_jual','tanggal_konfirmasi','metode_bayar','pembeli','pesanan'].forEach(k=>{if($(k))$(k).value=x[k]??''});$('harga_jual').value=formatRupiahInput(x.harga_jual);applySaleRules();$('saleModal').classList.remove('hidden');document.body.style.overflow='hidden'}
async function saveSale(e){e.preventDefault();applySaleRules();if(!$('tokoPenjualan').value){alert('Pilih toko penjualan terlebih dahulu');return;}const o={toko:$('tokoPenjualan').value,tempat:$('tempat').value,tanggal_jual:$('tanggal_jual').value,tanggal_konfirmasi:$('tanggal_konfirmasi').value,metode_bayar:$('metode_bayar').value,pembeli:$('pembeli').value,pesanan:$('pesanan').value,harga_jual:moneyValue($('harga_jual').value)};try{await api('/api/sales/'+$('sale_id').value+'/penjualan',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)});alert('Data penjualan berhasil disimpan');closeSaleModal();await load();await stats()}catch(err){alert(err.message||'Gagal menyimpan penjualan')}}
async function toggleHackback(id,enabled){
  if(enabled && !confirm('Tandai akun ini sebagai HACKBACK (HB)? Modal pembelian akan dihitung sebagai kerugian.')){load();return;}
  if(!enabled && !confirm('Batalkan status HACKBACK dan kembalikan status berdasarkan penjualan?')){load();return;}
  try{await api('/api/sales/'+id+'/hackback',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});await load();await stats();if(!$('report').classList.contains('hidden'))await loadReport();}catch(e){alert(e.message||'Gagal mengubah status Hackback');load();}
}
async function del(id){if(confirm('Hapus data ini?')){await api('/api/sales/'+id,{method:'DELETE'});load();stats()}}
function openInputModal(editMode=false){if(!editMode)resetForm();$('input').classList.remove('hidden');document.body.style.overflow='hidden';}
function closeInputModal(){$('input').classList.add('hidden');document.body.style.overflow='';}
function resetForm(){$('dataForm').reset();$('id').value='';$('kode_nomor').value='';$('kode_cadangan').value='';$('harga_beli').value='';updateKodePrefix();updateKode();$('ft').textContent='INPUT DATA AKUN'}
function closeSaleModal(){$('saleModal').classList.add('hidden');document.body.style.overflow=''}
function setDefaultReportDates(){
  const now=new Date();
  const today=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const first=new Date(now.getFullYear(),now.getMonth(),1);
  const firstStr=new Date(first.getTime()-first.getTimezoneOffset()*60000).toISOString().slice(0,10);
  if(!$('reportFrom').value) $('reportFrom').value=firstStr;
  if(!$('reportTo').value) $('reportTo').value=today;
}
let expenseEditId='';
async function loadExpenses(){
  try{const p=new URLSearchParams({q:$('expenseSearch')?.value||'',from:$('expenseFrom')?.value||'',to:$('expenseTo')?.value||''});const rows=await api('/api/expenses?'+p);const total=rows.reduce((a,x)=>a+(Number(x.jumlah)||0),0);$('expenseTotal').textContent=rp(total);$('expenseRows').innerHTML=rows.length?rows.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.tanggal)}</td><td><b>${esc(x.jenis)}</b></td><td>${esc(x.keterangan||'-')}</td><td class="money"><b>${rp(x.jumlah)}</b></td><td><button class="btn green mini" onclick='editExpense(${JSON.stringify(x)})'>Edit</button> <button class="btn red mini" onclick='deleteExpense(${x.id})'>Hapus</button></td></tr>`).join(''):'<tr><td colspan="6" style="text-align:center;padding:25px">Belum ada biaya lain-lain</td></tr>'}catch(e){console.error(e)}}
function editExpense(x){expenseEditId=x.id;$('expenseTanggal').value=x.tanggal||'';$('expenseJenis').value=x.jenis||'';$('expenseKeterangan').value=x.keterangan||'';$('expenseJumlah').value=formatRupiahInput(x.jumlah);$('expenses').scrollIntoView({behavior:'smooth',block:'start'})}
function resetExpenseForm(){expenseEditId='';$('expenseTanggal').value='';$('expenseJenis').value='';$('expenseKeterangan').value='';$('expenseJumlah').value=''}
async function saveExpense(){const o={tanggal:$('expenseTanggal').value,jenis:$('expenseJenis').value,keterangan:$('expenseKeterangan').value,jumlah:moneyValue($('expenseJumlah').value)};try{await api(expenseEditId?'/api/expenses/'+expenseEditId:'/api/expenses',{method:expenseEditId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)});alert('Biaya berhasil disimpan');resetExpenseForm();await loadExpenses();if(!$('report').classList.contains('hidden'))await loadReport()}catch(e){alert(e.message||'Gagal menyimpan biaya')}}
async function deleteExpense(id){if(!confirm('Hapus biaya ini?'))return;try{await api('/api/expenses/'+id,{method:'DELETE'});await loadExpenses();if(!$('report').classList.contains('hidden'))await loadReport()}catch(e){alert(e.message||'Gagal menghapus biaya')}}
function buktiLabel(v){return v==='upload'?'🟢 Upload':v==='screenshot'?'🟡 Screenshot':'🔴 Belum'}
async function loadReport(){
  setDefaultReportDates();
  const from=$('reportFrom').value,to=$('reportTo').value,jenis=$('reportJenis').value,toko=$('reportToko').value;
  $('reportJenis').innerHTML='<option value="">Semua Jenis Akun</option>'+SETTINGS.jenis.map(j=>`<option value="${esc(j.nama)}">${esc(j.nama)}</option>`).join('');$('reportJenis').value=jenis;const p=new URLSearchParams({from,to,jenis,toko});
  const x=await api('/api/stats?'+p);
  $('rModal').textContent=rp(x.beli);
  $('rPotongan').textContent=rp(x.potongan);
  $('rOmzet').textContent=rp(x.omzet);
  $('rKotor').textContent=rp(x.untungKotor);
  $('rBersihSold').textContent=rp(x.untungBersihSold||0);$('rBersihAkhir').textContent=rp(x.untungBersihAkhir??x.untungBersih??0);$('rBiaya').textContent=rp(x.biayaLain||0);
  $('rHackback').textContent=rp(x.hackbackLoss||0);
  $('reportHB').textContent=(x.hackback||0)+' HB';
  $('reportPeriod').textContent='Periode: '+(from||'awal')+' s/d '+(to||'akhir');
  $('reportCount').textContent=x.sold+' transaksi terjual';
  $('reportDetails').innerHTML=x.detail.length?x.detail.map((d,i)=>`<tr><td>${i+1}</td><td><b>${esc(d.kode)}</b></td><td>${esc(d.tanggal_beli||'-')}</td><td>${esc(d.jenis||'-')}</td><td>${buktiLabel(d.bukti_status)}</td><td class="money">${rp(d.harga_beli)}</td><td class="info-cell">${esc(d.info||'-')}</td><td class="codes">${d.kode_cadangan.map((c,n)=>(n+1)+'. '+esc(c)).join('\n')||'-'}</td><td>${esc(d.metode_beli||'-')}</td><td>${esc(d.toko||'-')}</td><td>${esc(d.tempat||'-')}</td><td>${esc(d.tanggal_jual||'-')}</td><td>${esc(d.tanggal_konfirmasi||'-')}</td><td>${esc(d.metode_bayar||'-')}</td><td>${d.garansi||0} hari</td><td>${esc(d.pembeli||'-')}</td><td>${esc(d.pesanan||'-')}</td><td class="money">${rp(d.harga_jual)}</td><td class="money">${rp(d.potongan)}</td><td class="money"><b>${rp(d.diterima)}</b></td><td class="money"><b>${rp(d.keuntungan)}</b></td></tr>`).join(''):'<tr><td colspan="20" style="text-align:center;padding:25px">Belum ada data akun/penjualan pada periode ini</td></tr>';
  $('months').innerHTML=x.monthly.length?x.monthly.map(m=>`<tr><td>${m.bulan}</td><td>${m.jumlah}</td><td>${rp(m.modal||0)}</td><td>${rp(m.potongan)}</td><td>${rp(m.omzet)}</td><td>${rp(m.kotor)}</td><td>${rp(m.biaya||0)}</td><td>${rp(m.bersih)}</td></tr>`).join(''):'<tr><td colspan="8" style="text-align:center">Belum ada data pada periode ini</td></tr>';
}
function resetReport(){
  $('reportFrom').value='';$('reportTo').value='';loadReport();
}
function clearDateFilter(){$('dateFrom').value='';$('dateTo').value='';load();stats()}loadSettings().then(()=>{updateKodePrefix();$('potongan').value='Rp 0';check()}).catch(e=>{console.error(e);check()});
