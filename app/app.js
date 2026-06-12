import { auth, db, fb, col, ref } from './firebase-service.js';
import { $, $$, money, tsMs, formatDate, escapeHtml, toast } from './utils.js';
import { gerarPedidoPDF } from './pdf.js';

const state = {
  user: null,
  profile: null,
  role: null,
  page: 'carteira',
  unsubs: [],
  pedidos: [],
  produtos: [],
  clientes: [],
  cart: {},
  pedidoClienteId: '',
  pedidoObs: '',
  pedidoFiltro: 'todos',
  clienteFiltro: ''
};

const STATUS = {
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  faturado: 'Faturado',
  rejeitado: 'Rejeitado',
  cancelado: 'Cancelado'
};
const ADMIN_NAV = [['pedidos','📋','Pedidos'], ['clientes','👥','Clientes'], ['produtos','📦','Produtos']];
const VEND_NAV = [['carteira','👥','Carteira'], ['catalogo','📦','Catálogo'], ['meus','📋','Pedidos']];

function isAdmin() { return state.role === 'admin'; }
function isVend() { return state.role === 'vendedor'; }
function navItems() { return isAdmin() ? ADMIN_NAV : VEND_NAV; }
function vendedorNome() { return state.profile?.nome || state.user?.email || 'Vendedor'; }
function ownClientes() { return state.clientes.filter(c => c.vendedorId === state.user?.uid); }
function ownPedidos() { return state.pedidos.filter(p => p.vendedorId === state.user?.uid); }
function activeProducts() { return state.produtos.filter(p => p.ativo !== false && p.status !== 'inativo'); }
function byCreatedDesc(a, b) { return tsMs(b.criadoEm || b.enviadoEm || b.atualizadoEm) - tsMs(a.criadoEm || a.enviadoEm || a.atualizadoEm); }
function byName(a, b) { return (a.nome || a.razaoSocial || '').localeCompare(b.nome || b.razaoSocial || ''); }
function productCode(p) { return p.codigo || p.ref || p.id; }
function cartTotal() { return Object.values(state.cart).reduce((sum, item) => sum + Number(item.subtotal || 0), 0); }
function statusHistory(status) { return { status, at: new Date().toISOString(), by: state.user?.uid || '', byName: vendedorNome() }; }

function resetSessionState() {
  state.unsubs.forEach(unsub => unsub());
  state.unsubs = [];
  state.user = null;
  state.profile = null;
  state.role = null;
  state.page = 'carteira';
  state.pedidos = [];
  state.produtos = [];
  state.clientes = [];
  state.cart = {};
  state.pedidoClienteId = '';
  state.pedidoObs = '';
  state.pedidoFiltro = 'todos';
  state.clienteFiltro = '';
  $('#content').innerHTML = '';
  $('#main-nav').innerHTML = '';
  $('#bottom-nav').innerHTML = '';
}

function showLogin(message = '') {
  document.body.classList.remove('with-sidebar');
  $('#sidebar')?.classList.remove('open');
  $('#sidebar-backdrop')?.classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#login-button').textContent = 'Entrar';
  $('#login-button').disabled = false;
  $('#auth-error').textContent = message;
  $('#auth-error').classList.toggle('hidden', !message);
  setLoading(true);
}

function hideProtectedUi() {
  $('#app').classList.add('hidden');
  $('#auth').classList.add('hidden');
  document.body.classList.remove('with-sidebar');
  $('#sidebar')?.classList.remove('open');
  $('#sidebar-backdrop')?.classList.add('hidden');
}

function setLoading(done = true) {
  $('#splash')?.classList.toggle('hide', done);
  setTimeout(() => $('#splash')?.classList.add('hidden'), 420);
}

function isDesktopNav() { return window.matchMedia('(min-width: 760px)').matches; }
function syncSidebarForViewport() {
  const desktop = isDesktopNav();
  document.body.classList.toggle('with-sidebar', desktop && !!state.user);
  $('#sidebar')?.classList.toggle('open', desktop);
  $('#sidebar-backdrop')?.classList.add('hidden');
}
function openMenu() {
  $('#sidebar').classList.add('open');
  if (!isDesktopNav()) $('#sidebar-backdrop').classList.remove('hidden');
}
function closeMenu() {
  if (isDesktopNav()) { syncSidebarForViewport(); return; }
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.add('hidden');
}

function setPage(page) {
  if (page === 'carteira') state.clienteFiltro = '';
  state.page = page;
  $('#page-subtitle').textContent = navItems().find(item => item[0] === page)?.[2] || 'Prime Sales';
  renderNav();
  renderPage();
  if (!isDesktopNav()) closeMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderNav() {
  const html = navItems().map(([key, icon, label]) => `<button type="button" data-page="${key}" class="${state.page === key ? 'active' : ''}"><b>${icon}</b><span>${label}</span></button>`).join('');
  $('#main-nav').innerHTML = html;
  $('#bottom-nav').innerHTML = html;
  $$('#main-nav button,#bottom-nav button').forEach(btn => btn.onclick = () => setPage(btn.dataset.page));
}

function listen(source, callback) {
  const unsub = fb.onSnapshot(source, snap => callback(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))), err => toast(`Erro ao carregar dados: ${err.message}`));
  state.unsubs.push(unsub);
}

function startListeners() {
  state.unsubs.forEach(unsub => unsub());
  state.unsubs = [];
  const uid = state.user.uid;
  const pedidosQuery = isAdmin() ? fb.query(col('pedidos'), fb.orderBy('criadoEm', 'desc')) : fb.query(col('pedidos'), fb.where('vendedorId', '==', uid));
  const clientesQuery = isAdmin() ? col('clientes') : fb.query(col('clientes'), fb.where('vendedorId', '==', uid));
  listen(pedidosQuery, docs => { state.pedidos = docs.filter(p => p.status !== 'rascunho').sort(byCreatedDesc); rerender(); });
  listen(clientesQuery, docs => { state.clientes = docs.sort(byName); rerender(); });
  listen(col('produtos'), docs => { state.produtos = docs.sort((a, b) => (a.nome || '').localeCompare(b.nome || '')); rerender(); });
}

function rerender() {
  if (!state.user) return;
  renderNav();
  renderPage();
}

function head(title, subtitle = '') {
  return `<div class="page-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div>`;
}
function stat(label, value, cls = '') {
  return `<div class="stat ${cls}"><small>${label}</small><strong>${value}</strong></div>`;
}

function renderPage() {
  const pages = {
    pedidos: renderAdminPedidos,
    clientes: renderAdminClientes,
    produtos: renderAdminProdutos,
    carteira: renderCarteira,
    catalogo: renderCatalogo,
    meus: renderMeusPedidos
  };
  const render = pages[state.page] || (isAdmin() ? renderAdminPedidos : renderCarteira);
  $('#content').innerHTML = render();
  bindPageEvents();
}

function renderAdminPedidos() {
  const statuses = ['todos', 'enviado', 'aprovado', 'faturado', 'rejeitado', 'cancelado'];
  const list = state.pedidoFiltro === 'todos' ? state.pedidos : state.pedidos.filter(p => p.status === state.pedidoFiltro);
  return head('Pedidos', 'Aprove, rejeite, fature e gere PDF dos pedidos enviados.') +
    `<div class="grid four">${stat('Enviados', state.pedidos.filter(p => p.status === 'enviado').length, 'gold')}${stat('Aprovados', state.pedidos.filter(p => p.status === 'aprovado').length)}${stat('Faturados', state.pedidos.filter(p => p.status === 'faturado').length)}${stat('Total faturado', money(state.pedidos.filter(p => p.status === 'faturado').reduce((s, p) => s + Number(p.total || 0), 0)))}</div>` +
    `<div class="filters">${statuses.map(s => `<button type="button" class="btn small ${state.pedidoFiltro === s ? 'primary' : ''}" data-filter-ped="${s}">${s === 'todos' ? 'Todos' : STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function renderAdminClientes() {
  return head('Clientes', 'Carteiras atribuídas aos vendedores.') + clientesList(state.clientes, true);
}

function renderAdminProdutos() {
  return head('Produtos', 'Produtos ativos disponíveis no catálogo.') + productList(activeProducts(), true);
}

function renderCarteira() {
  const term = state.clienteFiltro.toLowerCase();
  const list = ownClientes().filter(c => !term || (c.nome || c.razaoSocial || '').toLowerCase().includes(term) || (c.doc || c.cnpj || '').toLowerCase().includes(term));
  return head('Minha Carteira', 'Somente clientes com vendedorId igual ao seu UID.') +
    `<section class="card"><label>Pesquisar cliente<input id="cliente-search" placeholder="Nome ou CNPJ" value="${escapeHtml(state.clienteFiltro)}"></label></section>` + clientesList(list, false);
}

function renderCatalogo() {
  const clientes = ownClientes();
  const products = activeProducts();
  const itemCount = Object.values(state.cart).filter(item => Number(item.qty || 0) > 0).length;
  return head('Catálogo', 'Produtos ativos, desconto fixo em 0%.') +
    `<section class="card"><label>Cliente<select id="pedido-cliente"><option value="">Selecione cliente da carteira</option>${clientes.map(c => `<option value="${c.id}" ${state.pedidoClienteId === c.id ? 'selected' : ''}>${escapeHtml(c.nome || c.razaoSocial || 'Cliente')}</option>`).join('')}</select></label><label>Observação comercial<textarea id="pedido-obs" placeholder="Prazo, frete, condição comercial...">${escapeHtml(state.pedidoObs)}</textarea></label></section>` +
    productList(products, false) + `<div class="cart-bar"><div><strong>${money(cartTotal())}</strong><div>${itemCount} item(ns) no pedido</div></div><button type="button" class="btn" data-send-order>Enviar para aprovação</button></div>`;
}

function renderMeusPedidos() {
  const statuses = ['todos', 'enviado', 'aprovado', 'faturado', 'rejeitado', 'cancelado'];
  const mine = ownPedidos();
  const list = state.pedidoFiltro === 'todos' ? mine : mine.filter(p => p.status === state.pedidoFiltro);
  return head('Meus Pedidos', 'Acompanhe os pedidos enviados ao admin.') +
    `<div class="filters">${statuses.map(s => `<button type="button" class="btn small ${state.pedidoFiltro === s ? 'primary' : ''}" data-filter-ped="${s}">${s === 'todos' ? 'Todos' : STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function clientesList(list, admin) {
  if (!list.length) return '<div class="empty">Nenhum cliente encontrado.</div>';
  return `<div class="list">${list.map(c => `<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(c.nome || c.razaoSocial || 'Cliente')}</div><div class="row-sub">${escapeHtml(c.doc || c.cnpj || '')} · ${escapeHtml(c.tel || c.telefone || '')}</div><div class="row-sub">${escapeHtml(c.cidade || '')} ${escapeHtml(c.estado || '')}</div></div><span class="badge ${c.status === 'inativo' ? 'rejeitado' : 'faturado'}">${escapeHtml(c.status || 'ativo')}</span></div><div class="row-sub">vendedorId: ${escapeHtml(c.vendedorId || 'sem vendedor')}</div>${admin ? '' : `<div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-start-order="${c.id}">Iniciar Pedido</button></div>`}</article>`).join('')}</div>`;
}

function productList(list, admin) {
  if (!list.length) return '<div class="empty">Nenhum produto ativo encontrado.</div>';
  return `<div class="list">${list.map(p => productCard(p, admin)).join('')}</div>`;
}

function productCard(p, admin) {
  const id = p.id;
  const qty = state.cart[id]?.qty || 0;
  const price = Number(p.preco || 0);
  const subtotal = price * qty;
  return `<article class="product-card"><div><div class="row-top"><div><div class="product-name">${escapeHtml(p.nome || 'Sem nome')}</div><div class="product-meta">${escapeHtml(productCode(p))} · ${escapeHtml(p.marca || 'Sem marca')} · Estoque ${Number(p.estoque || 0)}</div></div><div class="price">${money(price)}</div></div>${p.descricao ? `<div class="row-sub">${escapeHtml(p.descricao)}</div>` : ''}</div>${admin ? '' : `<div><div class="qty"><button type="button" data-qty="${id}" data-delta="-1">−</button><span>${qty}</span><button type="button" data-qty="${id}" data-delta="1">+</button></div><div class="row-sub">Desconto fixo: 0%</div><div class="row-top"><span class="row-sub">Subtotal</span><strong>${money(subtotal)}</strong></div></div>`}</article>`;
}

function orderList(list) {
  if (!list.length) return '<div class="empty">Nenhum pedido encontrado.</div>';
  return `<div class="list">${list.map(orderCard).join('')}</div>`;
}

function orderCard(p) {
  const actions = [`<button type="button" class="btn small" data-pdf="${p.id}">PDF</button>`];
  if (isAdmin() && p.status === 'enviado') actions.push(`<button type="button" class="btn green small" data-approve="${p.id}">Aprovar</button><button type="button" class="btn red small" data-reject="${p.id}">Rejeitar</button>`);
  if (isAdmin() && p.status === 'aprovado') actions.push(`<button type="button" class="btn blue small" data-bill="${p.id}">Marcar como faturado</button>`);
  const itens = (p.itens || []).map(item => `<div class="row-sub">${escapeHtml(item.codigo || '')} · ${escapeHtml(item.nome || '')} · ${escapeHtml(item.marca || '')} · ${item.qty}x · desc. ${item.descontoPct || 0}% · ${money(item.subtotal)}</div>`).join('');
  return `<article class="row-card"><div class="row-top"><div><div class="row-title">#${escapeHtml(String(p.numero || p.id).slice(-8).toUpperCase())} · ${escapeHtml(p.cliente?.nome || p.clienteNome || 'Cliente')}</div><div class="row-sub">${escapeHtml(p.vendedorNome || '')} · ${formatDate(p.enviadoEm || p.criadoEm)}</div></div><span class="badge ${p.status}">${STATUS[p.status] || p.status}</span></div>${itens}<div class="row-top" style="margin-top:10px"><strong>${money(p.total || 0)}</strong><div class="actions">${actions.join('')}</div></div>${p.observacoes ? `<div class="row-sub">Obs.: ${escapeHtml(p.observacoes)}</div>` : ''}</article>`;
}

function bindPageEvents() {
  $$('[data-page-jump]').forEach(btn => btn.onclick = () => setPage(btn.dataset.pageJump));
  $$('[data-filter-ped]').forEach(btn => btn.onclick = () => { state.pedidoFiltro = btn.dataset.filterPed; renderPage(); });
  $$('[data-start-order]').forEach(btn => btn.onclick = () => { state.pedidoClienteId = btn.dataset.startOrder; state.cart = {}; setPage('catalogo'); });
  $$('[data-qty]').forEach(btn => btn.onclick = () => updateQty(btn.dataset.qty, Number(btn.dataset.delta)));
  $('#pedido-cliente')?.addEventListener('change', e => { state.pedidoClienteId = e.target.value; });
  $('#pedido-obs')?.addEventListener('input', e => { state.pedidoObs = e.target.value; });
  $('#cliente-search')?.addEventListener('input', e => { state.clienteFiltro = e.target.value; renderPage(); });
  $('[data-send-order]')?.addEventListener('click', sendOrder);
  $$('[data-approve]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.approve, 'aprovado'));
  $$('[data-reject]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.reject, 'rejeitado'));
  $$('[data-bill]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.bill, 'faturado'));
  $$('[data-pdf]').forEach(btn => btn.onclick = () => gerarPedidoPDF(state.pedidos.find(p => p.id === btn.dataset.pdf)));
}

function updateQty(id, delta) {
  const p = state.produtos.find(prod => prod.id === id);
  if (!p) return;
  const qty = Math.max(0, Math.min(Number(p.estoque || 9999), Number(state.cart[id]?.qty || 0) + delta));
  if (!qty) { delete state.cart[id]; renderPage(); return; }
  const price = Number(p.preco || 0);
  state.cart[id] = {
    prodId: id,
    codigo: productCode(p),
    nome: p.nome || '',
    marca: p.marca || '',
    precoOriginal: price,
    precoFinal: price,
    descontoPct: 0,
    qty,
    subtotal: price * qty
  };
  renderPage();
}

async function sendOrder() {
  if (!isVend()) return toast('Somente vendedores enviam pedidos.');
  const cliente = state.clientes.find(c => c.id === state.pedidoClienteId && c.vendedorId === state.user.uid);
  const itens = Object.values(state.cart).filter(item => Number(item.qty || 0) > 0);
  if (!cliente) return toast('Selecione um cliente da sua carteira.');
  if (!itens.length) return toast('Adicione produtos ao pedido.');
  const numero = `PS-${Date.now().toString(36).toUpperCase()}`;
  await fb.addDoc(col('pedidos'), {
    numero,
    vendedorId: state.user.uid,
    vendedorNome: vendedorNome(),
    clienteId: cliente.id,
    cliente: { id: cliente.id, nome: cliente.nome || cliente.razaoSocial, doc: cliente.doc || cliente.cnpj, telefone: cliente.tel || cliente.telefone, cidade: cliente.cidade, estado: cliente.estado },
    itens,
    observacoes: state.pedidoObs.trim(),
    total: cartTotal(),
    status: 'enviado',
    historico: [statusHistory('enviado')],
    enviadoEm: fb.serverTimestamp(),
    criadoEm: fb.serverTimestamp(),
    atualizadoEm: fb.serverTimestamp()
  });
  state.cart = {};
  state.pedidoClienteId = '';
  state.pedidoObs = '';
  toast('Pedido enviado para aprovação.');
  setPage('meus');
}

async function changeOrderStatus(id, status) {
  if (!isAdmin()) return toast('Somente admin altera status.');
  const pedido = state.pedidos.find(p => p.id === id);
  if (!pedido) return;
  const allowed = { enviado: ['aprovado', 'rejeitado'], aprovado: ['faturado'] };
  if (!allowed[pedido.status]?.includes(status)) return toast(`Transição inválida: ${STATUS[pedido.status] || pedido.status} → ${STATUS[status] || status}.`);
  const update = { status, atualizadoEm: fb.serverTimestamp(), historico: [...(pedido.historico || []), statusHistory(status)] };
  if (status === 'aprovado') { update.aprovadoEm = fb.serverTimestamp(); await baixarEstoqueDoPedido(pedido); update.estoqueBaixado = true; }
  if (status === 'rejeitado') update.rejeitadoEm = fb.serverTimestamp();
  if (status === 'faturado') update.faturadoEm = fb.serverTimestamp();
  await fb.updateDoc(ref('pedidos', id), update);
  toast(`Pedido ${STATUS[status].toLowerCase()}.`);
}

async function baixarEstoqueDoPedido(pedido) {
  if (pedido.estoqueBaixado) return;
  const batch = fb.writeBatch(db);
  (pedido.itens || []).forEach(item => {
    const produto = state.produtos.find(p => p.id === item.prodId);
    if (!produto) return;
    batch.update(ref('produtos', item.prodId), { estoque: Math.max(0, Number(produto.estoque || 0) - Number(item.qty || 0)), atualizadoEm: fb.serverTimestamp() });
  });
  await batch.commit();
}

async function boot() {
  $('#login-button').onclick = login;
  $('#login-password').onkeydown = e => { if (e.key === 'Enter') login(); };
  $('#logout-button').onclick = logout;
  $('#menu-button').onclick = openMenu;
  $('#sidebar-backdrop').onclick = closeMenu;
  $('#install-button').style.display = 'none';
  window.addEventListener('resize', syncSidebarForViewport);
  fb.onAuthStateChanged(auth, onAuth);
}

async function login() {
  $('#auth-error').classList.add('hidden');
  $('#login-button').textContent = 'Entrando...';
  $('#login-button').disabled = true;
  fb.signInWithEmailAndPassword(auth, $('#login-email').value.trim(), $('#login-password').value).catch(err => {
    console.error(err);
    $('#auth-error').textContent = 'E-mail ou senha inválidos.';
    $('#auth-error').classList.remove('hidden');
    $('#login-button').textContent = 'Entrar';
    $('#login-button').disabled = false;
  });
}

async function logout() {
  resetSessionState();
  showLogin();
  await fb.signOut(auth);
}

async function onAuth(user) {
  resetSessionState();
  if (!user) { showLogin(); return; }
  hideProtectedUi();
  try {
    const snap = await fb.getDoc(ref('users', user.uid));
    if (!snap.exists()) { await fb.signOut(auth); showLogin('Usuário sem cadastro no sistema.'); return; }
    const profile = { id: user.uid, ...snap.data() };
    if (profile.bloqueado) { await fb.signOut(auth); showLogin('Acesso bloqueado. Fale com o administrador.'); return; }
    state.user = user;
    state.profile = profile;
    state.role = profile.role || 'vendedor';
    state.page = isAdmin() ? 'pedidos' : 'carteira';
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    syncSidebarForViewport();
    $('#role-pill').textContent = isAdmin() ? 'ADMIN' : 'VENDEDOR';
    $('#role-pill').className = `role-pill ${state.role}`;
    $('#user-name').textContent = state.profile.nome || user.email;
    startListeners();
    renderNav();
    renderPage();
    setLoading(true);
    toast('Conectado com sucesso.');
  } catch (err) {
    console.error(err);
    await fb.signOut(auth);
    showLogin('Não foi possível validar sua sessão. Faça login novamente.');
  }
}

boot();
