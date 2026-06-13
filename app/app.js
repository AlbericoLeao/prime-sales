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
  productEditId: '',
  clientEditId: ''
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
  state.vendedores = [];
  state.cart = {};
  state.pedidoClienteId = '';
  state.pedidoObs = '';
  state.pedidoFiltro = 'todos';
  state.clienteFiltro = '';
  state.catalogoBusca = '';
  state.productEditId = '';
  state.clientEditId = '';
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
  if (isAdmin()) listen(col('users'), docs => { state.vendedores = docs.filter(u => u.role === 'vendedor').sort(byName); rerender(); });
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
  return head('Clientes', 'Carteiras atribuídas aos vendedores.') + clienteForm() + clientesList(state.clientes, true);
}

function renderAdminProdutos() {
  return head('Produtos', 'Produtos ativos disponíveis no catálogo.') + produtoForm() + productList(state.produtos, true);
}

function renderCarteira() {
  const term = state.clienteFiltro.toLowerCase();
  const list = ownClientes().filter(c => !term || (c.nome || c.razaoSocial || '').toLowerCase().includes(term) || (c.doc || c.cnpj || '').toLowerCase().includes(term));
  return head('Minha Carteira', 'Somente clientes com vendedorId igual ao seu UID.') +
    `<section class="card"><label>Pesquisar cliente<input id="cliente-search" placeholder="Nome ou CNPJ" value="${escapeHtml(state.clienteFiltro)}"></label></section><div id="cliente-list">${clientesList(list, false)}</div>`;
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
  const statuses = ['todos', 'enviado', 'aprovado', 'faturado', 'rejeitado', 'cancelado'];
  const mine = ownPedidos();
  const list = state.pedidoFiltro === 'todos' ? mine : mine.filter(p => p.status === state.pedidoFiltro);
  return head('Meus Pedidos', 'Acompanhe os pedidos enviados ao admin.') +
    `<div class="filters">${statuses.map(s => `<button type="button" class="btn small ${state.pedidoFiltro === s ? 'primary' : ''}" data-filter-ped="${s}">${s === 'todos' ? 'Todos' : STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function clientesList(list, admin) {
  if (!list.length) return '<div class="empty">Nenhum cliente encontrado.</div>';
  return `<div class="list">${list.map(c => `<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(c.nome || c.razaoSocial || 'Cliente')}</div><div class="row-sub">${escapeHtml(c.doc || c.cnpj || '')} · ${escapeHtml(c.tel || c.telefone || '')}</div><div class="row-sub">${escapeHtml(c.cidade || '')} ${escapeHtml(c.estado || '')}</div></div><span class="badge ${c.status === 'inativo' ? 'rejeitado' : 'faturado'}">${escapeHtml(c.status || 'ativo')}</span></div><div class="row-sub">vendedorId: ${escapeHtml(c.vendedorId || 'sem vendedor')}</div>${admin ? `<div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-edit-client="${c.id}">Editar</button></div>` : `<div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-start-order="${c.id}">Iniciar Pedido</button></div>`}</article>`).join('')}</div>`;
}

function productList(list, admin) {
  if (!list.length) return '<div class="empty">Nenhum produto ativo encontrado.</div>';
  return `<div class="list">${list.map(p => productCard(p, admin)).join('')}</div>`;
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
  return `<section class="card"><div class="card-title"><h3>${p.id ? 'Editar produto' : 'Novo produto'}</h3></div><input type="hidden" id="prod-id" value="${escapeHtml(p.id || '')}"><div class="form-row"><label>Código<input id="prod-codigo" value="${escapeHtml(p.codigo || p.ref || '')}"></label><label>Nome<input id="prod-nome" value="${escapeHtml(p.nome || '')}"></label></div><div class="form-row"><label>Marca<input id="prod-marca" value="${escapeHtml(p.marca || '')}"></label><label>Preço<input id="prod-preco" type="number" min="0" step="0.01" value="${Number(p.preco || 0)}"></label></div><div class="form-row"><label>Estoque<input id="prod-estoque" type="number" min="0" value="${Number(p.estoque || 0)}"></label><label>Status<select id="prod-status"><option value="ativo" ${p.ativo === false || p.status === 'inativo' ? '' : 'selected'}>Ativo</option><option value="inativo" ${p.ativo === false || p.status === 'inativo' ? 'selected' : ''}>Inativo</option></select></label></div><div class="actions"><button type="button" class="btn primary" data-save-product>Salvar produto</button>${p.id ? '<button type="button" class="btn" data-new-product>Novo produto</button>' : ''}</div></section>`;
}

function clienteForm() {
  const c = state.clientEditId ? state.clientes.find(cli => cli.id === state.clientEditId) || {} : {};
  const vendedorOptions = state.vendedores.map(v => `<option value="${v.id}" ${c.vendedorId === v.id ? 'selected' : ''}>${escapeHtml(v.nome || v.email || v.id)}</option>`).join('');
  return `<section class="card"><div class="card-title"><h3>${c.id ? 'Editar cliente' : 'Novo cliente'}</h3></div><input type="hidden" id="cliente-id" value="${escapeHtml(c.id || '')}"><label>Razão social / Nome<input id="cliente-nome" value="${escapeHtml(c.nome || c.razaoSocial || '')}"></label><div class="form-row"><label>CNPJ<input id="cliente-cnpj" value="${escapeHtml(c.cnpj || c.doc || '')}"></label><label>Telefone<input id="cliente-telefone" value="${escapeHtml(c.telefone || c.tel || '')}"></label></div><div class="form-row"><label>Cidade<input id="cliente-cidade" value="${escapeHtml(c.cidade || '')}"></label><label>Estado<input id="cliente-estado" maxlength="2" value="${escapeHtml(c.estado || '')}"></label></div><div class="form-row"><label>Vendedor responsável<select id="cliente-vendedor"><option value="">Sem vendedor</option>${vendedorOptions}</select></label><label>Status<select id="cliente-status"><option value="ativo" ${c.status === 'inativo' ? '' : 'selected'}>Ativo</option><option value="inativo" ${c.status === 'inativo' ? 'selected' : ''}>Inativo</option></select></label></div><div class="actions"><button type="button" class="btn primary" data-save-client>Salvar cliente</button>${c.id ? '<button type="button" class="btn" data-new-client>Novo cliente</button>' : ''}</div></section>`;
}

function orderList(list) {
  if (!list.length) return '<div class="empty">Nenhum pedido encontrado.</div>';
  return `<div class="list">${list.map(orderCard).join('')}</div>`;
}

function orderCard(p) {
  const actions = [`<button type="button" class="btn small" data-pdf="${p.id}">PDF</button>`];
  if (isAdmin() && p.status === 'enviado') actions.push(`<button type="button" class="btn green small" data-approve="${p.id}">Aprovar</button><button type="button" class="btn red small" data-reject="${p.id}">Rejeitar</button><button type="button" class="btn red small" data-cancel-order="${p.id}">Cancelar</button>`);
  if (isAdmin() && p.status === 'aprovado') actions.push(`<button type="button" class="btn blue small" data-bill="${p.id}">Marcar como faturado</button><button type="button" class="btn red small" data-cancel-order="${p.id}">Cancelar</button>`);
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
  $('[data-send-order]')?.addEventListener('click', e => sendOrder(e.currentTarget));
  $$('[data-approve]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.approve, 'aprovado'));
  $$('[data-reject]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.reject, 'rejeitado'));
  $$('[data-bill]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.bill, 'faturado'));
  $$('[data-cancel-order]').forEach(btn => btn.onclick = () => changeOrderStatus(btn.dataset.cancelOrder, 'cancelado'));
  $$('[data-pdf]').forEach(btn => btn.onclick = () => gerarPedidoPDF(state.pedidos.find(p => p.id === btn.dataset.pdf)));
  $$('[data-edit-product]').forEach(btn => btn.onclick = () => { state.productEditId = btn.dataset.editProduct; renderPage(); });
  $('[data-new-product]')?.addEventListener('click', () => { state.productEditId = ''; renderPage(); });
  $('[data-save-product]')?.addEventListener('click', saveProduct);
  $$('[data-edit-client]').forEach(btn => btn.onclick = () => { state.clientEditId = btn.dataset.editClient; renderPage(); });
  $('[data-new-client]')?.addEventListener('click', () => { state.clientEditId = ''; renderPage(); });
  $('[data-save-client]')?.addEventListener('click', saveClient);
}

function bindStartOrderButtons() {
  $$('[data-start-order]').forEach(btn => btn.onclick = () => {
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

function renderCatalogoProductList() {
  const target = $('#catalogo-product-list');
  if (!target) return;
  target.innerHTML = productList(searchedProducts(), false);
  bindQtyButtons();
}

function updateQty(id, delta) {
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

async function sendOrder(button) {
  if (!isVend()) return toast('Somente vendedores enviam pedidos.');
  const cliente = state.clientes.find(c => c.id === state.pedidoClienteId && c.vendedorId === state.user.uid);
  const itens = Object.values(state.cart).filter(item => Number(item.qty || 0) > 0);
  if (!cliente) return toast('Selecione um cliente da sua carteira.');
  if (!itens.length) return toast('Adicione produtos ao pedido.');
  const numero = `PS-${Date.now().toString(36).toUpperCase()}`;
  if (button) button.disabled = true;
  try {
    await fb.addDoc(col('pedidos'), {
      numero,
      vendedorId: state.user.uid,
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
  } catch (err) {
    console.error(err);
    toast(`Erro ao enviar pedido: ${err.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveProduct() {
  if (!isAdmin()) return toast('Somente admin salva produtos.');
  const id = $('#prod-id')?.value || ($('#prod-codigo')?.value || $('#prod-nome')?.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const codigo = ($('#prod-codigo')?.value || '').trim();
  const nome = ($('#prod-nome')?.value || '').trim();
  if (!id || !codigo || !nome) return toast('Informe código e nome do produto.');
  const status = $('#prod-status')?.value === 'inativo' ? 'inativo' : 'ativo';
  await fb.setDoc(ref('produtos', id), {
    codigo,
    ref: codigo,
    nome,
    marca: ($('#prod-marca')?.value || '').trim(),
    preco: Number($('#prod-preco')?.value || 0),
    estoque: Number($('#prod-estoque')?.value || 0),
    ativo: status === 'ativo',
    status,
    atualizadoEm: fb.serverTimestamp()
  }, { merge: true });
  state.productEditId = id;
  toast('Produto salvo.');
}

async function saveClient() {
  if (!isAdmin()) return toast('Somente admin salva clientes.');
  const id = $('#cliente-id')?.value || '';
  const nome = ($('#cliente-nome')?.value || '').trim();
  if (!nome) return toast('Informe razão social / nome do cliente.');
  const vendedorId = $('#cliente-vendedor')?.value || '';
  const vendedor = state.vendedores.find(v => v.id === vendedorId);
  const data = {
    nome,
    razaoSocial: nome,
    cnpj: ($('#cliente-cnpj')?.value || '').trim(),
    doc: ($('#cliente-cnpj')?.value || '').trim(),
    telefone: ($('#cliente-telefone')?.value || '').trim(),
    tel: ($('#cliente-telefone')?.value || '').trim(),
    cidade: ($('#cliente-cidade')?.value || '').trim(),
    estado: ($('#cliente-estado')?.value || '').trim().toUpperCase(),
    vendedorId,
    vendedorNome: vendedor ? (vendedor.nome || vendedor.email || vendedor.id) : '',
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

async function changeOrderStatus(id, status) {
  if (!isAdmin()) return toast('Somente admin altera status.');
  const pedido = state.pedidos.find(p => p.id === id);
  if (!pedido) return;
  const allowed = { enviado: ['aprovado', 'rejeitado', 'cancelado'], aprovado: ['faturado', 'cancelado'] };
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
