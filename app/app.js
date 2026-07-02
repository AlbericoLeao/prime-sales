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
  vendedores: [],
  cart: {},
  pedidoClienteId: '',
  pedidoObs: '',
  pedidoFiltro: 'todos',
  clienteFiltro: '',
  catalogoBusca: '',
  adminProdutoBusca: '',
  adminClienteBusca: '',
  productEditId: '',
  clientEditId: '',
  sellerEditId: '',
  accessBlocked: false
};

const STATUS = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  faturado: 'Faturado',
  rejeitado: 'Rejeitado',
  cancelado: 'Cancelado'
};
const ADMIN_EMAILS = ['albericoprestes2014@gmail.com'];
const ADMIN_NAV = [['pedidos','📋','Pedidos'], ['vendedores','👤','Vendedores'], ['clientes','👥','Clientes'], ['produtos','📦','Produtos']];
const VEND_NAV = [['carteira','👥','Carteira'], ['catalogo','📦','Catálogo'], ['meus','📋','Pedidos']];

function roleOf(user) {
  const explicitRole = userType(user);
  if (explicitRole) return explicitRole;
  const email = String(user?.email || '').trim().toLowerCase();
  return ADMIN_EMAILS.includes(email) ? 'admin' : '';
}
function isAdmin() { return state.role === 'admin'; }
function isVend() { return state.role === 'vendedor'; }
function navItems() { return isAdmin() ? ADMIN_NAV : VEND_NAV; }
function vendedorNome() { return state.profile?.nome || state.user?.email || 'Vendedor'; }
function currentUserEmail() { return String(state.user?.email || '').trim().toLowerCase(); }
function userType(user) { return String(user?.role || user?.perfil || user?.tipo || '').trim().toLowerCase(); }
function isSellerUser(user) { return !!sellerEmail(user) && !ADMIN_EMAILS.includes(sellerEmail(user)); }
function sellerEmail(user) { return String(user?.email || user?.id || '').trim().toLowerCase(); }
function sellerName(user) { return user?.nome || user?.email || user?.id || 'Vendedor'; }
function sellerBlocked(user) {
  const status = String(user?.status || '').trim().toLowerCase();
  if (status) return status === 'bloqueado';
  return user?.ativo === false || user?.bloqueado === true;
}
function cleanUid(value) { return String(value || '').trim(); }
function ownClientes() { const email = currentUserEmail(); return state.clientes.filter(c => sellerEmail({ email: c.vendedorEmail }) === email); }
function ownPedidos() { const email = currentUserEmail(); return state.pedidos.filter(p => sellerEmail({ email: p.vendedorEmail }) === email); }
function activeProducts() { return state.produtos.filter(p => p.ativo !== false && !isInactiveStatus(p.status)); }
function byCreatedDesc(a, b) { return tsMs(b.criadoEm || b.enviadoEm || b.atualizadoEm) - tsMs(a.criadoEm || a.enviadoEm || a.atualizadoEm); }
function byName(a, b) { return (a.nome || a.razaoSocial || a.email || a.id || '').localeCompare(b.nome || b.razaoSocial || b.email || b.id || ''); }
function productCode(p) { return p.codigo || p.ref || p.id; }
function normalizeProductCode(code) { return String(code || '').trim().replace(/\s+/g, '').toLowerCase(); }
function findProductByCode(code) {
  const normalized = normalizeProductCode(code);
  if (!normalized) return null;
  return state.produtos.find(p => normalizeProductCode(p.codigo || p.ref) === normalized) || null;
}
function productIdFromCode(code, name = '') {
  return (code || name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}
function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}
function isInactiveStatus(value) {
  return normalizeStatus(value) === 'inativo';
}
function cartTotal() { return Object.values(state.cart).reduce((sum, item) => sum + Number(item.subtotal || 0), 0); }
function statusHistory(status) { return { status, at: new Date().toISOString(), by: currentUserEmail(), byName: vendedorNome() }; }
function sellerAccessBlocked(profile = state.profile) { return roleOf(profile) === 'vendedor' && sellerBlocked(profile); }

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
  state.vendedores = [];
  state.cart = {};
  state.pedidoClienteId = '';
  state.pedidoObs = '';
  state.pedidoFiltro = 'todos';
  state.clienteFiltro = '';
  state.catalogoBusca = '';
  state.adminProdutoBusca = '';
  state.adminClienteBusca = '';
  state.productEditId = '';
  state.clientEditId = '';
  state.sellerEditId = '';
  state.accessBlocked = false;
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

function renderBlockedAccess() {
  return head('Acesso bloqueado', 'Seu acesso foi bloqueado. Fale com o administrador.') +
    '<section class="card"><div class="empty">Seu acesso foi bloqueado. Fale com o administrador.</div><div class="actions" style="margin-top:12px"><button type="button" class="btn primary" data-blocked-logout>Sair</button></div></section>';
}

function showBlockedAccess() {
  state.accessBlocked = true;
  state.unsubs.forEach(unsub => unsub());
  state.unsubs = [];
  state.pedidos = [];
  state.produtos = [];
  state.clientes = [];
  state.vendedores = [];
  state.cart = {};
  state.pedidoClienteId = '';
  state.pedidoObs = '';
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#main-nav').innerHTML = '';
  $('#bottom-nav').innerHTML = '';
  $('#page-subtitle').textContent = 'Acesso bloqueado';
  $('#role-pill').textContent = 'VENDEDOR';
  $('#role-pill').className = 'role-pill vendedor';
  $('#user-name').textContent = state.profile?.nome || state.user?.email || 'Vendedor';
  $('#content').innerHTML = renderBlockedAccess();
  $('[data-blocked-logout]')?.addEventListener('click', logout);
  syncSidebarForViewport();
  setLoading(true);
}

function ensureSellerAccess() {
  if (!sellerAccessBlocked()) return true;
  showBlockedAccess();
  return false;
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
  if (state.accessBlocked) { showBlockedAccess(); return; }
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

function listenDoc(source, callback) {
  const unsub = fb.onSnapshot(source, snap => { if (snap.exists()) callback({ id: snap.id, ...snap.data() }); }, err => toast(`Erro ao carregar dados: ${err.message}`));
  state.unsubs.push(unsub);
}

function startListeners() {
  state.unsubs.forEach(unsub => unsub());
  state.unsubs = [];
  if (!state.user || !state.profile || !state.role || sellerAccessBlocked(state.profile) || state.profile.bloqueado) {
    showBlockedAccess();
    return;
  }
  if (isAdmin()) {
    listen(fb.query(col('pedidos'), fb.orderBy('criadoEm', 'desc')), docs => { state.pedidos = docs.filter(p => p.status !== 'rascunho').sort(byCreatedDesc); rerender(); });
    listen(col('clientes'), docs => { state.clientes = docs.sort(byName); rerender(); });
    listen(col('produtos'), docs => { state.produtos = docs.sort((a, b) => (a.nome || '').localeCompare(b.nome || '')); rerender(); });
    listen(col('vendedores'), docs => { state.vendedores = docs.filter(isSellerUser).sort(byName); rerender(); });
    return;
  }
  if (!isVend()) return;
  const email = currentUserEmail();
  listen(fb.query(col('pedidos'), fb.where('vendedorEmail', '==', email)), docs => { state.pedidos = docs.filter(p => p.status !== 'rascunho').sort(byCreatedDesc); rerender(); });
  listen(fb.query(col('clientes'), fb.where('vendedorEmail', '==', email)), docs => { state.clientes = docs.sort(byName); rerender(); });
  listen(fb.query(col('produtos'), fb.where('ativo', '==', true)), docs => {
    state.produtos = docs.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    rerender();
  });
  listenDoc(ref('vendedores', email), doc => {
    state.profile = doc;
    state.role = roleOf(doc) || state.role;
    if (sellerAccessBlocked(doc) || doc.bloqueado) { showBlockedAccess(); return; }
    $('#user-name').textContent = state.profile.nome || state.user.email;
    rerender();
  });
}

function rerender() {
  if (!state.user) return;
  if (state.accessBlocked) { showBlockedAccess(); return; }
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
  if (state.accessBlocked) { showBlockedAccess(); return; }
  const pages = {
    pedidos: renderAdminPedidos,
    vendedores: renderAdminVendedores,
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
  const statuses = ['todos', 'pendente', 'aprovado', 'faturado', 'rejeitado', 'cancelado'];
  const list = state.pedidoFiltro === 'todos' ? state.pedidos : state.pedidos.filter(p => p.status === state.pedidoFiltro);
  return head('Pedidos', 'Aprove, rejeite, fature e gere PDF dos pedidos enviados.') +
    `<div class="grid four">${stat('Pendentes', state.pedidos.filter(p => p.status === 'pendente').length, 'gold')}${stat('Aprovados', state.pedidos.filter(p => p.status === 'aprovado').length)}${stat('Faturados', state.pedidos.filter(p => p.status === 'faturado').length)}${stat('Total faturado', money(state.pedidos.filter(p => p.status === 'faturado').reduce((s, p) => s + Number(p.total || 0), 0)))}</div>` +
    `<div class="filters">${statuses.map(s => `<button type="button" class="btn small ${state.pedidoFiltro === s ? 'primary' : ''}" data-filter-ped="${s}">${s === 'todos' ? 'Todos' : STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function renderAdminClientes() {
  return head('Clientes', 'Cadastre clientes e atribua a um vendedor ativo.') + clienteForm() +
    `<section class="card"><label>Buscar cliente<input id="admin-client-search" placeholder="Nome, CNPJ, telefone, cidade, estado ou vendedor" value="${escapeHtml(state.adminClienteBusca)}"></label><div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-clear-admin-client-search>Limpar busca</button></div></section>` +
    `<div id="admin-client-list">${clientesList(filteredAdminClients(), true)}</div>`;
}

function renderAdminVendedores() {
  return head('Vendedores', 'Cadastre, edite, ative ou bloqueie vendedores.') + vendedorForm() + vendedoresList();
}

function renderAdminProdutos() {
  return head('Produtos', 'Produtos ativos disponíveis no catálogo.') + produtoForm() +
    `<section class="card"><label>Buscar produto<input id="admin-product-search" placeholder="Código, nome, descrição, marca ou status" value="${escapeHtml(state.adminProdutoBusca)}"></label><div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-clear-admin-product-search>Limpar busca</button></div></section>` +
    `<div id="admin-product-list">${productList(filteredAdminProducts(), true)}</div>`;
}

function renderCarteira() {
  const term = state.clienteFiltro.toLowerCase();
  const list = ownClientes().filter(c => !term || (c.nome || c.razaoSocial || '').toLowerCase().includes(term) || (c.doc || c.cnpj || '').toLowerCase().includes(term));
  return head('Minha Carteira', 'Somente clientes atribuidos a voce.') +
    `<section class="card"><label>Pesquisar cliente<input id="cliente-search" placeholder="Nome ou CNPJ" value="${escapeHtml(state.clienteFiltro)}"></label></section><div id="cliente-list">${clientesList(list, false)}</div>`;
}

function sellerForClient(client) {
  const email = sellerEmail({ email: client?.vendedorEmail });
  if (!email) return null;
  return state.vendedores.find(v => sellerEmail(v) === email) || null;
}

function clientSellerStatus(client) {
  const vendedor = sellerForClient(client);
  return { label: 'Vendedor responsavel', detail: vendedor ? sellerName(vendedor) : 'Selecione um vendedor', badge: vendedor ? 'faturado' : 'destaque' };
}

function vendedorForm() {
  const v = state.sellerEditId ? state.vendedores.find(seller => seller.id === state.sellerEditId) || {} : {};
  const editing = !!v.id;
  return `<section class="card"><div class="card-title"><h3>${editing ? 'Editar vendedor' : 'Novo vendedor'}</h3></div><input type="hidden" id="seller-id" value="${escapeHtml(v.id || '')}"><label>Nome<input id="seller-nome" value="${escapeHtml(v.nome || '')}"></label><div class="form-row"><label>E-mail<input id="seller-email" type="email" value="${escapeHtml(v.email || v.id || '')}" ${editing ? 'disabled' : ''}></label><label>Status<select id="seller-status"><option value="ativo" ${sellerBlocked(v) ? '' : 'selected'}>Ativo</option><option value="bloqueado" ${sellerBlocked(v) ? 'selected' : ''}>Bloqueado</option></select></label></div><div class="actions"><button type="button" class="btn primary" data-save-seller>Salvar vendedor</button>${editing ? '<button type="button" class="btn" data-new-seller>Novo vendedor</button>' : ''}</div></section>`;
}

function vendedoresList() {
  if (!state.vendedores.length) return '<div class="empty">Nenhum vendedor cadastrado.</div>';
  return `<div class="list">${state.vendedores.map(v => {
    const blocked = sellerBlocked(v);
    const status = blocked ? '<span class="badge rejeitado">Bloqueado</span>' : '<span class="badge faturado">Ativo</span>';
    const accessAction = blocked
      ? `<button type="button" class="btn small green" data-reactivate-seller="${v.id}">Ativar</button>`
      : `<button type="button" class="btn small red" data-block-seller="${v.id}">Bloquear</button>`;
    return `<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(sellerName(v))}</div><div class="row-sub">${escapeHtml(v.email || v.id)}</div>${v.motivoBloqueio ? `<div class="row-sub">Motivo: ${escapeHtml(v.motivoBloqueio)}</div>` : ''}</div>${status}</div><div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-edit-seller="${v.id}">Editar</button>${accessAction}</div></article>`;
  }).join('')}</div>`;
}

function renderCatalogo() {
  const clientes = ownClientes();
  const products = searchedProducts();
  const itemCount = Object.values(state.cart).filter(item => Number(item.qty || 0) > 0).length;
  return head('Catálogo', 'Produtos ativos, desconto fixo em 0%.') +
    `<section class="card"><label>Cliente<select id="pedido-cliente"><option value="">Selecione cliente da carteira</option>${clientes.map(c => `<option value="${c.id}" ${state.pedidoClienteId === c.id ? 'selected' : ''}>${escapeHtml(c.nome || c.razaoSocial || 'Cliente')}</option>`).join('')}</select></label><label>Observação comercial<textarea id="pedido-obs" placeholder="Prazo, frete, condição comercial...">${escapeHtml(state.pedidoObs)}</textarea></label></section>` +
    `<section class="card"><label>Buscar produto<input id="catalogo-search" placeholder="Nome, código, referência, marca ou descrição" value="${escapeHtml(state.catalogoBusca)}"></label></section>` +
    `<div id="catalogo-product-list">${productList(products, false)}</div>` +
    `<div class="cart-bar"><div><strong>${money(cartTotal())}</strong><div>${itemCount} item(ns) no pedido</div></div><button type="button" class="btn" data-send-order>Enviar para aprovação</button></div>`;
}

function renderMeusPedidos() {
  const statuses = ['todos', 'pendente', 'aprovado', 'faturado', 'rejeitado', 'cancelado'];
  const mine = ownPedidos();
  const list = state.pedidoFiltro === 'todos' ? mine : mine.filter(p => p.status === state.pedidoFiltro);
  return head('Meus Pedidos', 'Acompanhe os pedidos enviados ao admin.') +
    `<div class="filters">${statuses.map(s => `<button type="button" class="btn small ${state.pedidoFiltro === s ? 'primary' : ''}" data-filter-ped="${s}">${s === 'todos' ? 'Todos' : STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function clientesList(list, admin) {
  if (!list.length) return '<div class="empty">Nenhum cliente encontrado.</div>';
  return `<div class="list">${list.map(c => {
    const sellerStatus = clientSellerStatus(c);
    return `<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(c.nome || c.razaoSocial || 'Cliente')}</div><div class="row-sub">${escapeHtml(c.doc || c.cnpj || '')} · ${escapeHtml(c.tel || c.telefone || '')}</div><div class="row-sub">${escapeHtml(c.cidade || '')} ${escapeHtml(c.estado || '')}</div></div><span class="badge ${c.status === 'inativo' ? 'rejeitado' : 'faturado'}">${escapeHtml(c.status || 'ativo')}</span></div>${admin ? `<div class="row-sub"><span class="badge ${sellerStatus.badge}">${escapeHtml(sellerStatus.label)}</span> ${escapeHtml(sellerStatus.detail)}</div>` : ''}${admin ? `<div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-edit-client="${c.id}">Editar</button></div>` : `<div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-start-order="${c.id}">Iniciar Pedido</button></div>`}</article>`;
  }).join('')}</div>`;
}

function productList(list, admin) {
  if (!list.length) return `<div class="empty">${admin ? 'Nenhum produto encontrado.' : 'Nenhum produto ativo encontrado.'}</div>`;
  return `<div class="list">${list.map(p => productCard(p, admin)).join('')}</div>`;
}

function filteredAdminProducts() {
  const term = normalizeSearch(state.adminProdutoBusca);
  if (!term) return state.produtos;
  return state.produtos.filter(p => {
    const status = p.ativo === false || isInactiveStatus(p.status) ? 'inativo' : 'ativo';
    return [p.codigo, p.ref, p.nome, p.descricao, p.marca, status].some(value => normalizeSearch(value).includes(term));
  });
}

function filteredAdminClients() {
  const term = normalizeSearch(state.adminClienteBusca);
  if (!term) return state.clientes;
  return state.clientes.filter(c => {
    const vendedor = sellerForClient(c) || {};
    const sellerStatus = clientSellerStatus(c);
    return [
      c.nome,
      c.razaoSocial,
      c.fantasia,
      c.nomeFantasia,
      c.cnpj,
      c.doc,
      c.telefone,
      c.tel,
      c.cidade,
      c.estado,
      c.vendedorNome,
      c.vendedorEmail,
      sellerStatus.label,
      sellerStatus.detail,
      vendedor.nome,
      vendedor.email,
      vendedor.id
    ].some(value => normalizeSearch(value).includes(term));
  });
}

function searchedProducts() {
  const term = state.catalogoBusca.trim().toLowerCase();
  const products = activeProducts();
  if (!term) return products;
  return products.filter(p => [p.nome, p.codigo, p.ref, p.marca, p.descricao].some(value => String(value || '').toLowerCase().includes(term)));
}

function productCard(p, admin) {
  const id = p.id;
  const qty = state.cart[id]?.qty || 0;
  const price = Number(p.preco || 0);
  const subtotal = price * qty;
  return `<article class="product-card"><div><div class="row-top"><div><div class="product-name">${escapeHtml(p.nome || 'Sem nome')}</div><div class="product-meta">${escapeHtml(productCode(p))} · ${escapeHtml(p.marca || 'Sem marca')} · Estoque ${Number(p.estoque || 0)}</div></div><div class="price">${money(price)}</div></div>${p.descricao ? `<div class="row-sub">${escapeHtml(p.descricao)}</div>` : ''}</div>${admin ? `<div class="actions"><button type="button" class="btn small" data-edit-product="${id}">Editar</button></div>` : `<div><div class="qty"><button type="button" data-qty="${id}" data-delta="-1">−</button><span>${qty}</span><button type="button" data-qty="${id}" data-delta="1">+</button></div><div class="row-sub">Desconto fixo: 0%</div><div class="row-top"><span class="row-sub">Subtotal</span><strong>${money(subtotal)}</strong></div></div>`}</article>`;
}

function produtoForm() {
  const p = state.productEditId ? state.produtos.find(prod => prod.id === state.productEditId) || {} : {};
  return `<section class="card"><div class="card-title"><h3>${p.id ? 'Editar produto' : 'Novo produto'}</h3></div><input type="hidden" id="prod-id" value="${escapeHtml(p.id || '')}"><div class="form-row"><label>Código<input id="prod-codigo" value="${escapeHtml(p.codigo || p.ref || '')}"></label><label>Nome<input id="prod-nome" value="${escapeHtml(p.nome || '')}"></label></div><div class="form-row"><label>Marca<input id="prod-marca" value="${escapeHtml(p.marca || '')}"></label><label>Preço<input id="prod-preco" type="number" min="0" step="0.01" value="${Number(p.preco || 0)}"></label></div><div class="form-row"><label>Estoque<input id="prod-estoque" type="number" min="0" value="${Number(p.estoque || 0)}"></label><label>Status<select id="prod-status"><option value="ativo" ${p.ativo === false || isInactiveStatus(p.status) ? '' : 'selected'}>Ativo</option><option value="inativo" ${p.ativo === false || isInactiveStatus(p.status) ? 'selected' : ''}>Inativo</option></select></label></div><div class="actions"><button type="button" class="btn primary" data-save-product>Salvar produto</button>${p.id ? '<button type="button" class="btn" data-new-product>Novo produto</button>' : ''}</div></section>`;
}

function clienteForm() {
  const c = state.clientEditId ? state.clientes.find(cli => cli.id === state.clientEditId) || {} : {};
  const currentSellerEmail = sellerEmail({ email: c.vendedorEmail });
  const vendedorOptions = state.vendedores.map(v => {
    const email = sellerEmail(v);
    return `<option value="${escapeHtml(email)}" ${currentSellerEmail === email ? 'selected' : ''}>${escapeHtml(`${sellerName(v)} (${email})`)}</option>`;
  }).join('');
  const sellerStatus = clientSellerStatus(c);
  const assignmentStatus = c.id ? `<div class="row-sub"><span class="badge ${sellerStatus.badge}">${escapeHtml(sellerStatus.label)}</span> ${escapeHtml(sellerStatus.detail)}</div>` : '';
  return `<section class="card"><div class="card-title"><h3>${c.id ? 'Editar cliente' : 'Novo cliente'}</h3></div>${assignmentStatus}<input type="hidden" id="cliente-id" value="${escapeHtml(c.id || '')}"><label>Razao social / Nome<input id="cliente-nome" value="${escapeHtml(c.nome || c.razaoSocial || '')}"></label><div class="form-row"><label>CNPJ<input id="cliente-cnpj" value="${escapeHtml(c.cnpj || c.doc || '')}"></label><label>Telefone<input id="cliente-telefone" value="${escapeHtml(c.telefone || c.tel || '')}"></label></div><div class="form-row"><label>Cidade<input id="cliente-cidade" value="${escapeHtml(c.cidade || '')}"></label><label>Estado<input id="cliente-estado" maxlength="2" value="${escapeHtml(c.estado || '')}"></label></div><div class="form-row"><label>Vendedor responsavel<select id="cliente-vendedor"><option value="">Selecione um vendedor</option>${vendedorOptions}</select></label><label>Status<select id="cliente-status"><option value="ativo" ${c.status === 'inativo' ? '' : 'selected'}>Ativo</option><option value="inativo" ${c.status === 'inativo' ? 'selected' : ''}>Inativo</option></select></label></div><div class="actions"><button type="button" class="btn primary" data-save-client>Salvar cliente</button>${c.id ? '<button type="button" class="btn" data-new-client>Novo cliente</button>' : ''}</div></section>`;
}

function orderList(list) {
  if (!list.length) return '<div class="empty">Nenhum pedido encontrado.</div>';
  return `<div class="list">${list.map(orderCard).join('')}</div>`;
}

function orderCard(p) {
  const actions = [`<button type="button" class="btn small" data-pdf="${p.id}">PDF</button>`];
  if (isAdmin() && p.status === 'pendente') actions.push(`<button type="button" class="btn green small" data-approve="${p.id}">Aprovar</button><button type="button" class="btn red small" data-reject="${p.id}">Rejeitar</button>`);
  const itens = (p.itens || []).map(item => `<div class="row-sub">${escapeHtml(item.codigo || '')} · ${escapeHtml(item.nome || '')} · ${escapeHtml(item.marca || '')} · ${item.qty}x · desc. ${item.descontoPct || 0}% · ${money(item.subtotal)}</div>`).join('');
  return `<article class="row-card"><div class="row-top"><div><div class="row-title">#${escapeHtml(String(p.numero || p.id).slice(-8).toUpperCase())} · ${escapeHtml(p.cliente?.nome || p.clienteNome || 'Cliente')}</div><div class="row-sub">${escapeHtml(p.vendedorNome || '')} · ${formatDate(p.enviadoEm || p.criadoEm)}</div></div><span class="badge ${p.status}">${STATUS[p.status] || p.status}</span></div>${itens}<div class="row-top" style="margin-top:10px"><strong>${money(p.total || 0)}</strong><div class="actions">${actions.join('')}</div></div>${p.observacoes ? `<div class="row-sub">Obs.: ${escapeHtml(p.observacoes)}</div>` : ''}</article>`;
}

function bindPageEvents() {
  $$('[data-page-jump]').forEach(btn => btn.onclick = () => setPage(btn.dataset.pageJump));
  $$('[data-filter-ped]').forEach(btn => btn.onclick = () => { state.pedidoFiltro = btn.dataset.filterPed; renderPage(); });
  bindStartOrderButtons();
  bindQtyButtons();
  $('#pedido-cliente')?.addEventListener('change', e => { state.pedidoClienteId = e.target.value; });
  $('#pedido-obs')?.addEventListener('input', e => { state.pedidoObs = e.target.value; });
  $('#cliente-search')?.addEventListener('input', e => {
    state.clienteFiltro = e.target.value;
    renderClienteList();
  });
  $('#catalogo-search')?.addEventListener('input', e => {
    state.catalogoBusca = e.target.value;
    renderCatalogoProductList();
  });
  $('#admin-product-search')?.addEventListener('input', e => {
    state.adminProdutoBusca = e.target.value;
    renderAdminProductList();
  });
  $('[data-clear-admin-product-search]')?.addEventListener('click', () => {
    state.adminProdutoBusca = '';
    const input = $('#admin-product-search');
    if (input) input.value = '';
    renderAdminProductList();
    input?.focus();
  });
  $('#admin-client-search')?.addEventListener('input', e => {
    state.adminClienteBusca = e.target.value;
    renderAdminClientList();
  });
  $('[data-clear-admin-client-search]')?.addEventListener('click', () => {
    state.adminClienteBusca = '';
    const input = $('#admin-client-search');
    if (input) input.value = '';
    renderAdminClientList();
    input?.focus();
  });
  $('[data-send-order]')?.addEventListener('click', e => sendOrder(e.currentTarget));
  $$('[data-approve]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.approve, 'aprovado'));
  $$('[data-reject]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.reject, 'rejeitado'));
  $$('[data-pdf]').forEach(btn => btn.onclick = () => gerarPedidoPDF(state.pedidos.find(p => p.id === btn.dataset.pdf)));
  $$('[data-edit-product]').forEach(btn => btn.onclick = () => { state.productEditId = btn.dataset.editProduct; renderPage(); });
  $('[data-new-product]')?.addEventListener('click', () => { state.productEditId = ''; renderPage(); });
  $('[data-save-product]')?.addEventListener('click', saveProduct);
  $$('[data-edit-client]').forEach(btn => btn.onclick = () => { state.clientEditId = btn.dataset.editClient; renderPage(); });
  $('[data-new-client]')?.addEventListener('click', () => { state.clientEditId = ''; renderPage(); });
  $('[data-save-client]')?.addEventListener('click', saveClient);
  $$('[data-edit-seller]').forEach(btn => btn.onclick = () => { state.sellerEditId = btn.dataset.editSeller; renderPage(); });
  $('[data-new-seller]')?.addEventListener('click', () => { state.sellerEditId = ''; renderPage(); });
  $('[data-save-seller]')?.addEventListener('click', saveSeller);
  $$('[data-block-seller]').forEach(btn => btn.onclick = () => blockSellerAccess(btn.dataset.blockSeller));
  $$('[data-reactivate-seller]').forEach(btn => btn.onclick = () => reactivateSellerAccess(btn.dataset.reactivateSeller));
}

function bindStartOrderButtons() {
  $$('[data-start-order]').forEach(btn => btn.onclick = () => {
    if (!ensureSellerAccess()) return;
    state.pedidoClienteId = btn.dataset.startOrder;
    state.cart = {};
    setPage('catalogo');
  });
}

function bindQtyButtons() {
  $$('[data-qty]').forEach(btn => btn.onclick = () => updateQty(btn.dataset.qty, Number(btn.dataset.delta)));
}

function renderClienteList() {
  const target = $('#cliente-list');
  if (!target) return;
  const term = state.clienteFiltro.toLowerCase();
  const list = ownClientes().filter(c => !term || (c.nome || c.razaoSocial || '').toLowerCase().includes(term) || (c.doc || c.cnpj || '').toLowerCase().includes(term));
  target.innerHTML = clientesList(list, false);
  bindStartOrderButtons();
}

function bindAdminProductButtons() {
  $$('[data-edit-product]').forEach(btn => btn.onclick = () => { state.productEditId = btn.dataset.editProduct; renderPage(); });
}

function bindAdminClientButtons() {
  $$('[data-edit-client]').forEach(btn => btn.onclick = () => { state.clientEditId = btn.dataset.editClient; renderPage(); });
}

function renderAdminProductList() {
  const target = $('#admin-product-list');
  if (!target) return;
  target.innerHTML = productList(filteredAdminProducts(), true);
  bindAdminProductButtons();
}

function renderAdminClientList() {
  const target = $('#admin-client-list');
  if (!target) return;
  target.innerHTML = clientesList(filteredAdminClients(), true);
  bindAdminClientButtons();
}

function renderCatalogoProductList() {
  const target = $('#catalogo-product-list');
  if (!target) return;
  target.innerHTML = productList(searchedProducts(), false);
  bindQtyButtons();
}

function updateQty(id, delta) {
  if (!ensureSellerAccess()) return;
  const p = state.produtos.find(prod => prod.id === id);
  if (!p) return;
  const qty = Math.max(0, Math.min(Number(p.estoque || 9999), Number(state.cart[id]?.qty || 0) + delta));
  if (!qty) { delete state.cart[id]; renderPage(); return; }
  const price = Number(p.preco || 0);
  const subtotal = price * qty;
  state.cart[id] = {
    prodId: id,
    codigo: p.codigo || p.ref || p.id || '',
    nome: p.nome || '',
    marca: p.marca || '',
    preco: price,
    precoOriginal: price,
    precoFinal: price,
    descontoPct: 0,
    qty: Number(qty || 0),
    subtotal: Number(subtotal || 0)
  };
  renderPage();
}

function sellerIncompleteMessage() {
  return 'Cadastro do vendedor incompleto. Peça ao administrador para revisar seu acesso.';
}

function sellerProfileReady(profile) {
  return sellerEmail(profile) === currentUserEmail() && !sellerBlocked(profile);
}

async function loadCurrentSellerProfile() {
  const snap = await fb.getDoc(ref('vendedores', currentUserEmail()));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

async function sendOrder(button) {
  if (!isVend()) return toast('Somente vendedores enviam pedidos.');
  if (!ensureSellerAccess()) return;
  const currentProfile = await loadCurrentSellerProfile();
  if (!currentProfile || !sellerProfileReady(currentProfile)) return toast(sellerIncompleteMessage());
  state.profile = currentProfile;
  state.role = 'vendedor';
  if (sellerAccessBlocked(currentProfile) || currentProfile.bloqueado) { showBlockedAccess(); return; }
  const email = currentUserEmail();
  const cliente = state.clientes.find(c => c.id === state.pedidoClienteId && sellerEmail({ email: c.vendedorEmail }) === email);
  const itens = Object.values(state.cart).filter(item => Number(item.qty || 0) > 0);
  if (!cliente) return toast('Selecione um cliente da sua carteira.');
  if (!itens.length) return toast('Adicione produtos ao pedido.');
  const numero = `PS-${Date.now().toString(36).toUpperCase()}`;
  if (button) button.disabled = true;
  try {
    await fb.addDoc(col('pedidos'), {
      numero,
      vendedorEmail: email,
      vendedorNome: vendedorNome(),
      clienteId: cliente.id,
      cliente: {
        id: cliente.id || '',
        nome: cliente.nome || '',
        fantasia: cliente.fantasia || '',
        cnpj: cliente.cnpj || '',
        telefone: cliente.telefone || '',
        cidade: cliente.cidade || '',
        estado: cliente.estado || ''
      },
      itens,
      observacoes: state.pedidoObs.trim(),
      total: cartTotal(),
      status: 'pendente',
      historico: [statusHistory('pendente')],
      enviadoEm: fb.serverTimestamp(),
      criadoEm: fb.serverTimestamp(),
      atualizadoEm: fb.serverTimestamp()
    });
    state.cart = {};
    state.pedidoClienteId = '';
    state.pedidoObs = '';
    toast('Pedido enviado para aprovação.');
    setPage('meus');
  } catch (err) {
    console.error(err);
    const message = String(err?.message || '');
    if (message.includes('permission') || message.includes('permiss')) {
      toast(sellerIncompleteMessage());
    } else {
      toast(`Erro ao enviar pedido: ${err.message}`);
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveSellerDoc(email, data, isNewDoc) {
  await fb.setDoc(ref('vendedores', email), {
    ...data,
    atualizadoEm: fb.serverTimestamp(),
    ...(isNewDoc ? { criadoEm: fb.serverTimestamp() } : {})
  }, { merge: true });
}

async function saveSeller() {
  if (!isAdmin()) return toast('Somente admin salva vendedores.');
  const id = ($('#seller-id')?.value || '').trim().toLowerCase();
  const nome = ($('#seller-nome')?.value || '').trim();
  const email = (id || $('#seller-email')?.value || '').trim().toLowerCase();
  const blocked = $('#seller-status')?.value === 'bloqueado';
  if (!nome) return toast('Informe o nome do vendedor.');
  if (!email) return toast('Informe o e-mail do vendedor.');

  try {
    await saveSellerDoc(email, {
      nome,
      email,
      status: blocked ? 'bloqueado' : 'ativo'
    }, !id);
    state.sellerEditId = email;
    toast('Vendedor salvo.');
  } catch (err) {
    console.error(err);
    toast(`Erro ao salvar vendedor: ${err.message}`);
  }
}

async function saveProduct() {
  if (!isAdmin()) return toast('Somente admin salva produtos.');
  const codigo = ($('#prod-codigo')?.value || '').trim();
  const nome = ($('#prod-nome')?.value || '').trim();
  const currentId = $('#prod-id')?.value || '';
  const id = currentId || productIdFromCode(codigo, nome);
  if (!id || !codigo || !nome) return toast('Informe código e nome do produto.');
  const existing = findProductByCode(codigo);
  if (existing && existing.id !== currentId) return toast('Produto já cadastrado. Edite o item existente para alterar preço ou estoque.');
  const status = $('#prod-status')?.value === 'inativo' ? 'inativo' : 'ativo';
  await saveProductDoc(id, {
    codigo,
    ref: codigo,
    nome,
    marca: ($('#prod-marca')?.value || '').trim(),
    preco: Number($('#prod-preco')?.value || 0),
    estoque: Number($('#prod-estoque')?.value || 0),
    ativo: status === 'ativo',
    status
  });
  state.productEditId = id;
  toast('Produto salvo.');
}

async function upsertProductByCode(data) {
  const codigo = (data.codigo || data.ref || '').trim();
  const nome = (data.nome || '').trim();
  const existing = findProductByCode(codigo);
  const id = existing?.id || productIdFromCode(codigo, nome);
  if (!id || !codigo || !nome) return null;
  await saveProductDoc(id, { ...data, codigo, ref: codigo, nome });
  return id;
}

async function saveProductDoc(id, data) {
  await fb.setDoc(ref('produtos', id), {
    ...data,
    atualizadoEm: fb.serverTimestamp()
  }, { merge: true });
}

async function saveClient() {
  if (!isAdmin()) return toast('Somente admin salva clientes.');
  const id = $('#cliente-id')?.value || '';
  const nome = ($('#cliente-nome')?.value || '').trim();
  if (!nome) return toast('Informe razao social / nome do cliente.');
  const vendedorEmail = ($('#cliente-vendedor')?.value || '').trim().toLowerCase();
  const vendedor = state.vendedores.find(v => sellerEmail(v) === vendedorEmail);
  if (!vendedor) return toast('Selecione um vendedor existente para o cliente.');
  const data = {
    nome,
    razaoSocial: nome,
    cnpj: ($('#cliente-cnpj')?.value || '').trim(),
    doc: ($('#cliente-cnpj')?.value || '').trim(),
    telefone: ($('#cliente-telefone')?.value || '').trim(),
    tel: ($('#cliente-telefone')?.value || '').trim(),
    cidade: ($('#cliente-cidade')?.value || '').trim(),
    estado: ($('#cliente-estado')?.value || '').trim().toUpperCase(),
    vendedorEmail,
    vendedorNome: vendedor ? sellerName(vendedor) : '',
    status: $('#cliente-status')?.value === 'inativo' ? 'inativo' : 'ativo',
    atualizadoEm: fb.serverTimestamp()
  };
  if (id) {
    await fb.setDoc(ref('clientes', id), data, { merge: true });
    state.clientEditId = id;
  } else {
    const docRef = await fb.addDoc(col('clientes'), { ...data, criadoEm: fb.serverTimestamp() });
    state.clientEditId = docRef.id;
  }
  toast('Cliente salvo.');
}

async function blockSellerAccess(id) {
  if (!isAdmin()) return toast('Somente admin bloqueia vendedores.');
  const vendedor = state.vendedores.find(v => v.id === id);
  if (!vendedor) return toast('Selecione um vendedor valido.');
  if (!window.confirm(`Bloquear acesso de ${sellerName(vendedor)}?`)) return;
  const motivo = (window.prompt('Motivo do bloqueio (opcional):', vendedor.motivoBloqueio || '') || '').trim();
  const update = {
    status: 'bloqueado',
    bloqueadoEm: fb.serverTimestamp(),
    bloqueadoPor: currentUserEmail(),
    atualizadoEm: fb.serverTimestamp()
  };
  if (motivo) update.motivoBloqueio = motivo;
  await fb.setDoc(ref('vendedores', id), update, { merge: true });
  toast('Acesso do vendedor bloqueado.');
}

async function reactivateSellerAccess(id) {
  if (!isAdmin()) return toast('Somente admin reativa vendedores.');
  const vendedor = state.vendedores.find(v => v.id === id);
  if (!vendedor) return toast('Selecione um vendedor valido.');
  if (!window.confirm(`Reativar acesso de ${sellerName(vendedor)}?`)) return;
  await fb.setDoc(ref('vendedores', id), {
    status: 'ativo',
    motivoBloqueio: '',
    reativadoEm: fb.serverTimestamp(),
    reativadoPor: currentUserEmail(),
    atualizadoEm: fb.serverTimestamp()
  }, { merge: true });
  toast('Acesso do vendedor reativado.');
}

async function changeOrderStatus(id, status) {
  if (!isAdmin()) return toast('Somente admin altera status.');
  const pedido = state.pedidos.find(p => p.id === id);
  if (!pedido) return;
  const allowed = { pendente: ['aprovado', 'rejeitado'] };
  if (!allowed[pedido.status]?.includes(status)) return toast(`Transição inválida: ${STATUS[pedido.status] || pedido.status} → ${STATUS[status] || status}.`);
  const update = { status, atualizadoEm: fb.serverTimestamp(), historico: [...(pedido.historico || []), statusHistory(status)] };
  if (status === 'aprovado') { update.aprovadoEm = fb.serverTimestamp(); await baixarEstoqueDoPedido(pedido); update.estoqueBaixado = true; }
  if (status === 'rejeitado') update.rejeitadoEm = fb.serverTimestamp();
  if (status === 'faturado') update.faturadoEm = fb.serverTimestamp();
  if (status === 'cancelado') update.canceladoEm = fb.serverTimestamp();
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
    const authEmail = String(user.email || '').trim().toLowerCase();
    const isAdminEmail = ADMIN_EMAILS.includes(authEmail);
    const snap = isAdminEmail ? null : await fb.getDoc(ref('vendedores', authEmail));
    if (!isAdminEmail && !snap.exists()) { await fb.signOut(auth); showLogin('Seu cadastro de vendedor não foi encontrado. Fale com o administrador.'); return; }
    const profile = isAdminEmail
      ? { id: authEmail, email: authEmail, nome: user.email, role: 'admin', status: 'ativo' }
      : { id: authEmail, ...snap.data(), email: authEmail, role: 'vendedor' };
    state.user = user;
    state.profile = profile;
    state.role = roleOf({ ...profile, email: profile.email || user.email }) || 'vendedor';
    if (sellerAccessBlocked(profile) || profile.bloqueado) { showBlockedAccess(); return; }
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
