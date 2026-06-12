import { auth, db, fb, col, ref, createSecondaryUser } from './firebase-service.js';
import { $, $$, money, ym, startOfDay, startOfMonth, tsMs, formatDate, escapeHtml, slug, percent, progressCircle, toast, csvRows } from './utils.js';
import { gerarPedidoPDF } from './pdf.js';

const state = {
  user: null, profile: null, role: null, page: 'resumo', unsubs: [], deferredInstall: null,
  pedidos: [], produtos: [], vendedores: [], clientes: [], solicitacoes: [], metas: {}, metasVend: {}, notificacoes: [],
  pedidoClienteId: '', pedidoObs: '', cart: {}, produtoFiltros: { texto: '', marca: '', destaque: false, oferta: false, maisVendido: false },
  pedidoFiltro: 'todos', clienteFiltro: '', clienteResponsavel: 'todos', clienteFormOpen: false, clienteEditId: '', metaTab: 'geral'
};

const STATUS = {
  rascunho: 'Rascunho', enviado: 'Enviado', aprovado: 'Aprovado', faturado: 'Faturado', rejeitado: 'Rejeitado', cancelado: 'Cancelado'
};
const ADMIN_NAV = [
  ['resumo','📊','Resumo'], ['pedidos','📋','Pedidos'], ['produtos','📦','Produtos'], ['clientes','👥','Clientes'], ['vendedores','🧑‍💼','Vendedores'], ['metas','🎯','Metas'], ['ranking','🏆','Ranking'], ['notificacoes','🔔','Avisos']
];
const VEND_NAV = [
  ['inicio','📊','Início'], ['carteira','👥','Carteira'], ['catalogo','📦','Catálogo'], ['meus','📋','Pedidos'], ['sugerir','➕','Cliente'], ['notificacoes','🔔','Avisos']
];

function isAdmin() { return state.role === 'admin'; }
function isVend() { return state.role === 'vendedor'; }
function vendedorNome(uid) {
  if (!uid) return '';
  return state.vendedores.find(v => v.id === uid)?.nome || (uid === state.user?.uid ? (state.profile?.nome || state.user?.email) : '') || 'Vendedor';
}
function mesAtual() { return ym(); }
function getMetaGeral() { return Number(state.metas[mesAtual()]?.valor || 0); }
function getMetaVend(uid = state.user?.uid) { return Number(state.metasVend[`${uid}-${mesAtual()}`]?.valor || 0); }
function faturadosDoMes(uid) { return state.pedidos.filter(p => p.status === 'faturado' && (!uid || p.vendedorId === uid) && tsMs(p.faturadoEm || p.atualizadoEm || p.criadoEm) >= startOfMonth()); }
function totalFaturado(lista = state.pedidos) { return lista.filter(p => p.status === 'faturado').reduce((s,p)=>s+Number(p.total||0),0); }
function ownPedidos() { return state.pedidos.filter(p => p.vendedorId === state.user?.uid); }
function ownClientes() { return state.clientes.filter(c => c.vendedorId === state.user?.uid); }
function activeProducts() { return state.produtos.filter(p => p.ativo !== false && p.status !== 'inativo'); }

function statusHistory(status, note = '') {
  return { status, note, at: new Date().toISOString(), by: state.user?.uid || '', byName: state.profile?.nome || state.user?.email || '' };
}

function resetSessionState() {
  state.unsubs.forEach(fn => fn());
  state.user = null;
  state.profile = null;
  state.role = null;
  state.page = 'resumo';
  state.unsubs = [];
  state.pedidos = [];
  state.produtos = [];
  state.vendedores = [];
  state.clientes = [];
  state.solicitacoes = [];
  state.metas = {};
  state.metasVend = {};
  state.notificacoes = [];
  state.pedidoClienteId = '';
  state.pedidoObs = '';
  state.cart = {};
  state.produtoFiltros = { texto: '', marca: '', destaque: false, oferta: false, maisVendido: false };
  state.pedidoFiltro = 'todos';
  state.clienteFiltro = '';
  state.clienteResponsavel = 'todos';
  state.clienteFormOpen = false;
  state.clienteEditId = '';
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
  if (message) {
    $('#auth-error').textContent = message;
    $('#auth-error').classList.remove('hidden');
  } else {
    $('#auth-error').classList.add('hidden');
  }
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

function setPage(page) {
  state.page = page;
  $('#page-subtitle').textContent = navItems().find(i => i[0] === page)?.[2] || 'Prime Sales';
  renderNav();
  renderPage();
  if (!isDesktopNav()) closeMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navItems() { return isAdmin() ? ADMIN_NAV : VEND_NAV; }

function handleNavClick(page) {
  console.debug('[PrimeSales] nav click', page);
  setPage(page);
}

function renderNav() {
  const items = navItems();
  const html = items.map(([key, icon, label]) => `<button data-page="${key}" class="${state.page === key ? 'active' : ''}"><b>${icon}</b><span>${label}</span></button>`).join('');
  $('#main-nav').innerHTML = html;
  $('#bottom-nav').innerHTML = html;
  $$('#main-nav button,#bottom-nav button').forEach(btn => btn.addEventListener('click', () => handleNavClick(btn.dataset.page)));
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

async function notifyUser(uid, titulo, texto, pedidoId = '') {
  if (!uid) return;
  await fb.addDoc(col('notificacoes'), { uid, titulo, texto, pedidoId, lida: false, criadoEm: fb.serverTimestamp() });
}

function subscribe(name, callback, order = 'criadoEm') {
  const q = order ? fb.query(col(name), fb.orderBy(order, 'desc')) : col(name);
  const unsub = fb.onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => toast(`Erro ao carregar ${name}: ${err.message}`));
  state.unsubs.push(unsub);
}

function listen(source, callback) {
  const unsub = fb.onSnapshot(source, snap => {
    if (snap.docs) callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    else callback(snap.exists() ? [{ id: snap.id, ...snap.data() }] : []);
  }, err => toast(`Erro ao carregar dados: ${err.message}`));
  state.unsubs.push(unsub);
}

function startListeners() {
  state.unsubs.forEach(fn => fn()); state.unsubs = [];
  const uid = state.user.uid;
  const pedidosQuery = isAdmin() ? fb.query(col('pedidos'), fb.orderBy('criadoEm','desc')) : fb.query(col('pedidos'), fb.where('vendedorId','==',uid));
  listen(pedidosQuery, docs => { state.pedidos = docs.sort((a,b)=>tsMs(b.criadoEm)-tsMs(a.criadoEm)); rerender(); });
  listen(col('produtos'), docs => { state.produtos = docs.sort(sortProducts); rerender(); });
  if (isAdmin()) listen(col('users'), docs => { state.vendedores = docs.filter(u => u.role === 'vendedor').sort((a,b)=>(a.nome||'').localeCompare(b.nome||'')); rerender(); });
  else state.vendedores = [{ id: uid, ...state.profile }];
  const clientesQuery = isAdmin() ? col('clientes') : fb.query(col('clientes'), fb.where('vendedorId','==',uid));
  listen(clientesQuery, docs => { state.clientes = docs.sort((a,b)=>(a.nome||'').localeCompare(b.nome||'')); rerender(); });
  const solicQuery = isAdmin() ? fb.query(col('solicitacoesClientes'), fb.orderBy('criadoEm','desc')) : fb.query(col('solicitacoesClientes'), fb.where('vendedorId','==',uid));
  listen(solicQuery, docs => { state.solicitacoes = docs.sort((a,b)=>tsMs(b.criadoEm)-tsMs(a.criadoEm)); rerender(); });
  listen(col('metas'), docs => { state.metas = Object.fromEntries(docs.map(d => [d.mes || d.id, d])); rerender(); });
  if (isAdmin()) listen(col('metas-vend'), docs => { state.metasVend = Object.fromEntries(docs.map(d => [d.id, d])); rerender(); });
  else listen(ref('metas-vend', `${uid}-${mesAtual()}`), docs => { state.metasVend = Object.fromEntries(docs.map(d => [d.id, d])); rerender(); });
  listen(fb.query(col('notificacoes'), fb.where('uid','==',uid)), docs => { state.notificacoes = docs.sort((a,b)=>tsMs(b.criadoEm)-tsMs(a.criadoEm)).slice(0, 40); rerender(); });
}

function rerender() {
  if (!state.user) return;
  renderNav();
  renderPage();
}

function sortProducts(a,b) {
  const score = p => (p.destaque ? 30 : 0) + (p.oferta ? 20 : 0) + (p.maisVendido ? 10 : 0);
  return score(b) - score(a) || (a.nome || '').localeCompare(b.nome || '');
}

function renderPage() {
  const active = document.activeElement;
  const activeId = active?.id || '';
  const selectionStart = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
  const pages = {
    resumo: renderAdminDashboard, pedidos: renderAdminPedidos, produtos: renderAdminProdutos, clientes: renderAdminClientes,
    vendedores: renderVendedores, metas: renderMetas, ranking: renderRanking, notificacoes: renderNotificacoes,
    inicio: renderVendedorDashboard, carteira: renderCarteira, catalogo: renderCatalogo, meus: renderMeusPedidos, sugerir: renderSugerirCliente
  };
  $('#content').innerHTML = (pages[state.page] || renderAdminDashboard)();
  bindPageEvents();
  if (activeId) {
    const next = document.getElementById(activeId);
    if (next) {
      next.focus();
      if (selectionStart !== null && typeof next.setSelectionRange === 'function') next.setSelectionRange(selectionStart, selectionStart);
    }
  }
}

function head(title, subtitle = '', actions = '') {
  return `<div class="page-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function stat(label, value, extra = '', cls = '') { return `<div class="stat ${cls}"><small>${label}</small><strong>${value}</strong>${extra ? `<span class="row-sub">${extra}</span>` : ''}</div>`; }

function renderAdminDashboard() {
  const faturados = state.pedidos.filter(p => p.status === 'faturado');
  const mes = faturadosDoMes();
  const enviados = state.pedidos.filter(p => p.status === 'enviado').length;
  const aprovados = state.pedidos.filter(p => p.status === 'aprovado').length;
  const meta = getMetaGeral();
  const totalMes = totalFaturado(mes);
  const pct = percent(totalMes, meta);
  return head('Dashboard Administrativo', 'Visão geral em tempo real, considerando vendas somente faturadas.') +
    `<div class="grid four">${stat('Vendas totais', money(totalFaturado(faturados)), '', 'gold')}${stat('Vendas do mês', money(totalMes))}${stat('Pedidos enviados', enviados)}${stat('Pedidos aprovados', aprovados)}${stat('Pedidos faturados', faturados.length)}</div>` +
    `<div class="grid two"><section class="card"><div class="card-title"><h3>Meta geral do mês</h3><span>${money(meta)}</span></div>${progressCircle(pct, 'atingido', `${money(Math.max(meta-totalMes,0))} restantes`)}</section><section class="card"><div class="card-title"><h3>Vendas por vendedor</h3></div>${vendasPorVendedorHtml()}</section></div>` +
    `<section class="card"><div class="card-title"><h3>Pedidos aguardando aprovação</h3><button class="btn small" data-page-jump="pedidos">Ver todos</button></div>${orderList(state.pedidos.filter(p => p.status === 'enviado').slice(0,5))}</section>` +
    `<section class="card"><div class="card-title"><h3>Solicitações de novos clientes</h3><button class="btn small" data-page-jump="clientes">Analisar</button></div>${solicitacoesHtml(state.solicitacoes.filter(s=>s.status==='pendente').slice(0,4))}</section>`;
}

function vendasPorVendedorHtml() {
  const rows = state.vendedores.map(v => {
    const fat = faturadosDoMes(v.id);
    const total = totalFaturado(fat);
    const qtd = fat.length;
    const meta = getMetaVend(v.id);
    const pct = percent(total, meta);
    return `<div class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(v.nome || v.email)}</div><div class="row-sub">${qtd} pedido(s) · Ticket médio ${money(qtd ? total/qtd : 0)}</div></div><strong>${money(total)}</strong></div><div class="row-sub">Meta: ${money(meta)} · ${pct}%</div></div>`;
  });
  return rows.join('') || '<div class="empty">Nenhum vendedor cadastrado.</div>';
}

function renderVendedorDashboard() {
  const mine = ownPedidos();
  const fatMes = faturadosDoMes(state.user.uid);
  const fatHoje = mine.filter(p => p.status === 'faturado' && tsMs(p.faturadoEm || p.atualizadoEm) >= startOfDay());
  const totalMes = totalFaturado(fatMes);
  const meta = getMetaVend();
  const pct = percent(totalMes, meta);
  return head('Meu Dashboard', 'Indicadores individuais atualizados em tempo real.') +
    `<div class="grid four">${stat('Vendas do dia', money(totalFaturado(fatHoje)), '', 'gold')}${stat('Vendas do mês', money(totalMes))}${stat('Meta individual', money(meta))}${stat('Falta para meta', money(Math.max(meta-totalMes,0)))}${stat('Enviados', mine.filter(p=>p.status==='enviado').length)}${stat('Aprovados', mine.filter(p=>p.status==='aprovado').length)}${stat('Faturados', mine.filter(p=>p.status==='faturado').length)}${stat('Clientes na carteira', ownClientes().length)}</div>` +
    `<div class="grid two"><section class="card"><div class="card-title"><h3>Progresso da meta</h3></div>${progressCircle(pct, 'atingido', `${money(Math.max(meta-totalMes,0))} restantes`)}</section><section class="card"><div class="card-title"><h3>Últimos pedidos</h3></div>${orderList(mine.slice(0,5))}</section></div>`;
}

function renderAdminPedidos() {
  const statuses = ['todos','enviado','aprovado','faturado','rejeitado','cancelado'];
  const base = state.pedidos.filter(p => p.status !== 'rascunho');
  const list = state.pedidoFiltro === 'todos' ? base : base.filter(p => p.status === state.pedidoFiltro);
  return head('Pedidos', 'Aprove, rejeite, fature e gere PDF dos pedidos.') +
    `<div class="filters">${statuses.map(s=>`<button class="btn small ${state.pedidoFiltro===s?'primary':''}" data-filter-ped="${s}">${s==='todos'?'Todos':STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function renderMeusPedidos() {
  const mine = ownPedidos();
  const statuses = ['todos','rascunho','enviado','aprovado','faturado','rejeitado','cancelado'];
  const list = state.pedidoFiltro === 'todos' ? mine : mine.filter(p => p.status === state.pedidoFiltro);
  return head('Meus Pedidos', 'Acompanhe pedidos enviados, aprovados e faturados.') +
    `<div class="filters">${statuses.map(s=>`<button class="btn small ${state.pedidoFiltro===s?'primary':''}" data-filter-ped="${s}">${s==='todos'?'Todos':STATUS[s]}</button>`).join('')}</div>` + orderList(list);
}

function orderList(list) {
  if (!list.length) return '<div class="empty">Nenhum pedido encontrado.</div>';
  return `<div class="list">${list.map(orderCard).join('')}</div>`;
}

function orderCard(p) {
  const actions = [];
  actions.push(`<button class="btn small" data-pdf="${p.id}">PDF</button>`);
  if (isAdmin() && p.status === 'enviado') actions.push(`<button class="btn green small" data-approve="${p.id}">Aprovar</button><button class="btn red small" data-reject="${p.id}">Rejeitar</button>`);
  if (isAdmin() && p.status === 'aprovado') actions.push(`<button class="btn blue small" data-bill="${p.id}">Marcar faturado</button>`);
  if (isVend() && p.status === 'rascunho') actions.push(`<button class="btn green small" data-send-draft="${p.id}">Enviar</button><button class="btn red small" data-cancel-order="${p.id}">Cancelar</button>`);
  const itens = (p.itens || []).map(i => `<div class="row-sub">${escapeHtml(i.nome)} · ${i.qty}x · desc. ${i.descontoPct||0}% · ${money(i.subtotal)}</div>`).join('');
  return `<article class="row-card"><div class="row-top"><div><div class="row-title">#${escapeHtml(String(p.numero || p.id).slice(-8).toUpperCase())} · ${escapeHtml(p.cliente?.nome || p.clienteNome || 'Cliente')}</div><div class="row-sub">${escapeHtml(p.vendedorNome || '')} · ${formatDate(p.enviadoEm || p.criadoEm)}</div></div><span class="badge ${p.status}">${STATUS[p.status] || p.status}</span></div>${itens}<div class="row-top" style="margin-top:10px"><strong>${money(p.total)}</strong><div class="actions">${actions.join('')}</div></div>${p.observacoes ? `<div class="row-sub">Obs.: ${escapeHtml(p.observacoes)}</div>` : ''}</article>`;
}

function renderAdminProdutos() {
  return head('Produtos', 'Cadastre, importe e atualize produtos por código.', '<button class="btn primary" data-open-product-form>Novo produto</button>') +
    `<section class="card" id="product-form-card" style="display:none">${produtoForm()}</section>` +
    `<section class="card"><div class="card-title"><h3>Importação CSV</h3><button class="btn small" data-download-model>Baixar modelo</button></div><input type="file" id="csv-file" accept=".csv,text/csv"><small class="row-sub">Colunas: codigo,nome,descricao,marca,preco,estoque,ativo,destaque,oferta,maisVendido</small></section>` +
    productFiltersHtml() + productListHtml(state.produtos, true);
}

function produtoForm(p = {}) {
  return `<div class="card-title"><h3>${p.id ? 'Editar produto' : 'Novo produto'}</h3></div><input type="hidden" id="prod-id" value="${escapeHtml(p.id||'')}"><div class="form-row"><label>Código<input id="prod-codigo" value="${escapeHtml(p.codigo||p.ref||'')}"></label><label>Marca<input id="prod-marca" value="${escapeHtml(p.marca||'')}"></label></div><label>Nome<input id="prod-nome" value="${escapeHtml(p.nome||'')}"></label><label>Descrição<textarea id="prod-descricao">${escapeHtml(p.descricao||p.obs||'')}</textarea></label><div class="form-row"><label>Preço<input type="number" min="0" step="0.01" id="prod-preco" value="${Number(p.preco||0)}"></label><label>Estoque<input type="number" min="0" id="prod-estoque" value="${Number(p.estoque||0)}"></label></div><div class="form-row"><label>Categoria<input id="prod-categoria" value="${escapeHtml(p.categoria||'')}"></label><label>Imagem URL<input id="prod-imagem" value="${escapeHtml(p.imagem||'')}"></label></div><div class="grid four"><label><input type="checkbox" id="prod-ativo" ${p.ativo===false?'':'checked'}> Ativo</label><label><input type="checkbox" id="prod-destaque" ${p.destaque?'checked':''}> Destaque</label><label><input type="checkbox" id="prod-oferta" ${p.oferta?'checked':''}> Oferta</label><label><input type="checkbox" id="prod-mais" ${p.maisVendido?'checked':''}> Mais vendido</label></div><div class="actions"><button class="btn primary" data-save-product>Salvar produto</button><button class="btn" data-cancel-product>Cancelar</button></div>`;
}

function productFiltersHtml() {
  const marcas = [...new Set(state.produtos.map(p => p.marca).filter(Boolean))].sort();
  return `<section class="card"><div class="form-row"><label>Pesquisar<input id="prod-search" placeholder="Nome ou código" value="${escapeHtml(state.produtoFiltros.texto)}"></label><label>Marca<select id="prod-brand"><option value="">Todas</option>${marcas.map(m=>`<option ${state.produtoFiltros.marca===m?'selected':''}>${escapeHtml(m)}</option>`).join('')}</select></label></div><div class="filters"><button class="btn small ${state.produtoFiltros.destaque?'primary':''}" data-prod-flag="destaque">Destaque</button><button class="btn small ${state.produtoFiltros.oferta?'primary':''}" data-prod-flag="oferta">Oferta</button><button class="btn small ${state.produtoFiltros.maisVendido?'primary':''}" data-prod-flag="maisVendido">Mais vendido</button></div></section>`;
}

function filteredProducts(includeInactive = false) {
  const f = state.produtoFiltros;
  const base = includeInactive ? state.produtos : activeProducts();
  return base.filter(p => {
    const t = f.texto.toLowerCase();
    return (!t || (p.nome||'').toLowerCase().includes(t) || (p.codigo||p.ref||p.id||'').toLowerCase().includes(t)) &&
      (!f.marca || p.marca === f.marca) && (!f.destaque || p.destaque) && (!f.oferta || p.oferta) && (!f.maisVendido || p.maisVendido);
  }).sort(sortProducts);
}

function productListHtml(list, admin = false) {
  const products = (admin ? filteredProducts(true) : filteredProducts()).sort(sortProducts);
  if (!products.length) return '<div class="empty">Nenhum produto encontrado.</div>';
  return `<div class="list">${products.map(p => productCard(p, admin)).join('')}</div>`;
}

function productBadges(p) {
  return `${p.destaque?'<span class="badge destaque">Destaque</span>':''}${p.oferta?'<span class="badge oferta">Oferta</span>':''}${p.maisVendido?'<span class="badge maisVendido">Mais Vendido</span>':''}${p.ativo===false?'<span class="badge rejeitado">Inativo</span>':''}`;
}

function productCard(p, admin = false) {
  const id = p.id;
  const qty = state.cart[id]?.qty || 0;
  const desc = state.cart[id]?.descontoPct || 0;
  const priceFinal = Number(p.preco||0) * (1 - desc/100);
  return `<article class="product-card"><div><div class="row-top"><div><div class="product-name">${escapeHtml(p.nome||'Sem nome')}</div><div class="product-meta">${escapeHtml(p.codigo||p.ref||id)} · ${escapeHtml(p.marca||'Sem marca')} · Estoque ${Number(p.estoque||0)}</div></div><div class="price">${money(p.preco)}</div></div><div class="actions">${productBadges(p)}</div>${p.descricao?`<div class="row-sub">${escapeHtml(p.descricao)}</div>`:''}</div>${admin ? `<div class="actions"><button class="btn small" data-edit-product="${id}">Editar</button><button class="btn red small" data-delete-product="${id}">Excluir</button></div>` : `<div><div class="qty"><button data-qty="${id}" data-delta="-1">−</button><span>${qty}</span><button data-qty="${id}" data-delta="1">+</button></div><label>Desconto: ${desc}%<input type="range" min="0" max="7" step="1" value="${desc}" data-discount="${id}"></label><div class="row-top"><span class="row-sub">Subtotal</span><strong>${money(priceFinal*qty)}</strong></div></div>`}</article>`;
}

function renderCatalogo() {
  const clientes = ownClientes();
  const total = cartTotal();
  const itemCount = Object.values(state.cart).filter(i => Number(i.qty || 0) > 0).length;
  return head('Catálogo', 'Monte pedidos rapidamente pelo celular.') +
    `<section class="card"><label>Cliente<select id="pedido-cliente"><option value="">Selecione cliente da carteira</option>${clientes.map(c=>`<option value="${c.id}" ${state.pedidoClienteId===c.id?'selected':''}>${escapeHtml(c.nome)}</option>`).join('')}</select></label><label>Observações Comerciais<textarea id="pedido-obs" placeholder="Prazo, frete, condições especiais, entrega parcial...">${escapeHtml(state.pedidoObs)}</textarea></label><button class="btn small" data-save-draft>Salvar rascunho</button></section>` + productFiltersHtml() + productListHtml(activeProducts(), false) +
    `<div class="cart-bar"><div><strong>${money(total)}</strong><div>${itemCount} item(ns) no pedido</div></div><button class="btn" data-send-order>Enviar para aprovação</button></div>`;
}

function cartTotal() { return Object.values(state.cart).reduce((s,i)=>s+Number(i.subtotal||0),0); }

function renderCarteira() {
  const t = (state.clienteFiltro || '').toLowerCase();
  const list = ownClientes().filter(c => !t || (c.nome||'').toLowerCase().includes(t) || (c.doc||c.cnpj||'').toLowerCase().includes(t));
  return head('Minha Carteira', 'Somente clientes atribuídos a você.') + `<section class="card"><label>Pesquisar cliente<input id="cliente-search" placeholder="Nome, CNPJ ou telefone" value="${escapeHtml(state.clienteFiltro)}"></label></section>` + clientesList(list, false);
}

function renderAdminClientes() {
  const edit = state.clienteEditId ? state.clientes.find(c => c.id === state.clienteEditId) : {};
  return head('Clientes', 'Carteira geral, atribuição, transferência e aprovação de novos clientes.') +
    `<section class="card"><div class="card-title"><h3>Solicitações pendentes</h3></div>${solicitacoesHtml(state.solicitacoes)}</section>` +
    `<section class="card"><div class="form-row"><label>Pesquisar<input id="cliente-search" placeholder="Nome, CNPJ ou telefone" value="${escapeHtml(state.clienteFiltro)}"></label><label>Filtrar responsável<select id="cliente-resp"><option value="todos" ${state.clienteResponsavel==='todos'?'selected':''}>Todos</option><option value="geral" ${state.clienteResponsavel==='geral'?'selected':''}>Carteira geral</option>${state.vendedores.map(v=>`<option value="${v.id}" ${state.clienteResponsavel===v.id?'selected':''}>${escapeHtml(v.nome||v.email)}</option>`).join('')}</select></label></div><button class="btn primary full" data-new-client>Novo cliente</button></section>` +
    (state.clienteFormOpen ? clienteForm(edit || {}) : '') + clientesList(filtrarClientesAdmin(), true);
}

function clienteForm(c = {}) {
  return `<section class="card" id="client-form-card"><div class="card-title"><h3>${c.id ? 'Editar cliente' : 'Novo cliente'}</h3></div><input type="hidden" id="cliente-id" value="${escapeHtml(c.id||'')}"><label>Nome / Razão social<input id="cliente-nome" value="${escapeHtml(c.nome||c.razaoSocial||'')}"></label><div class="form-row"><label>CNPJ / CPF<input id="cliente-doc" value="${escapeHtml(c.doc||c.cnpj||'')}"></label><label>Telefone<input id="cliente-tel" value="${escapeHtml(c.tel||c.telefone||'')}"></label></div><div class="form-row"><label>Cidade<input id="cliente-cidade" value="${escapeHtml(c.cidade||'')}"></label><label>Estado<input id="cliente-estado" maxlength="2" value="${escapeHtml(c.estado||'')}"></label></div><label>Vendedor responsável<select id="cliente-vendedor"><option value="">Carteira geral</option>${state.vendedores.map(v=>`<option value="${v.id}" ${c.vendedorId===v.id?'selected':''}>${escapeHtml(v.nome||v.email)}</option>`).join('')}</select></label><label>Observações<textarea id="cliente-obs">${escapeHtml(c.obs || '')}</textarea></label><div class="actions"><button class="btn primary" data-save-cliente>Salvar cliente</button><button class="btn" data-cancel-cliente>Cancelar</button></div></section>`;
}

function filtrarClientesAdmin() {
  const search = (state.clienteFiltro || '').toLowerCase();
  let list = state.clientes;
  if (state.clienteResponsavel === 'geral') list = list.filter(c => !c.vendedorId);
  if (state.vendedores.some(v => v.id === state.clienteResponsavel)) list = list.filter(c => c.vendedorId === state.clienteResponsavel);
  if (search) list = list.filter(c => (c.nome||'').toLowerCase().includes(search) || (c.doc||c.cnpj||'').toLowerCase().includes(search) || (c.tel||c.telefone||'').includes(search));
  return list;
}

function clientesList(list, admin) {
  if (!list.length) return '<div class="empty">Nenhum cliente encontrado.</div>';
  return `<div class="list">${list.map(c => `<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(c.nome||c.razaoSocial||'Cliente')}</div><div class="row-sub">${escapeHtml(c.doc||c.cnpj||'')} · ${escapeHtml(c.tel||c.telefone||'')}</div><div class="row-sub">${escapeHtml(c.cidade||'')} ${escapeHtml(c.estado||'')}</div></div><span class="badge ${c.status==='inativo'?'rejeitado':'faturado'}">${c.status||'ativo'}</span></div><div class="row-sub">Responsável: ${escapeHtml(c.vendedorNome || vendedorNome(c.vendedorId) || 'Carteira geral')}</div><div class="actions" style="margin-top:10px"><button class="btn small" data-start-order="${c.id}">Iniciar pedido</button>${admin?`<button class="btn small" data-edit-client="${c.id}">Editar</button><button class="btn small" data-transfer-client="${c.id}">Transferir</button><button class="btn red small" data-delete-client="${c.id}">Excluir</button>`:''}</div></article>`).join('')}</div>`;
}

function solicitacoesHtml(list) {
  if (!list.length) return '<div class="empty">Nenhuma solicitação.</div>';
  return `<div class="list">${list.map(s => `<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(s.razaoSocial||s.nome||'Cliente solicitado')}</div><div class="row-sub">${escapeHtml(s.cnpj||'')} · ${escapeHtml(s.cidade||'')}/${escapeHtml(s.estado||'')} · ${escapeHtml(s.vendedorNome||'')}</div></div><span class="badge ${s.status==='aprovado'?'faturado':s.status==='rejeitado'?'rejeitado':'enviado'}">${s.status||'pendente'}</span></div>${s.observacoes?`<div class="row-sub">${escapeHtml(s.observacoes)}</div>`:''}${isAdmin()&&s.status==='pendente'?`<div class="actions" style="margin-top:10px"><button class="btn green small" data-approve-client-request="${s.id}">Aprovar</button><button class="btn red small" data-reject-client-request="${s.id}">Rejeitar</button></div>`:''}</article>`).join('')}</div>`;
}

function renderSugerirCliente() {
  return head('Sugerir Novo Cliente', 'A sugestão será enviada para aprovação do administrador.') +
    `<section class="card"><label>Razão social<input id="sug-razao"></label><label>Nome fantasia<input id="sug-fantasia"></label><div class="form-row"><label>CNPJ<input id="sug-cnpj"></label><label>Telefone<input id="sug-tel"></label></div><div class="form-row"><label>Cidade<input id="sug-cidade"></label><label>Estado<input id="sug-estado" maxlength="2"></label></div><label>Observações<textarea id="sug-obs"></textarea></label><button class="btn primary full" data-send-client-request>Enviar solicitação</button></section>` +
    `<section class="card"><div class="card-title"><h3>Minhas solicitações</h3></div>${solicitacoesHtml(state.solicitacoes)}</section>`;
}

function renderVendedores() {
  return head('Vendedores', 'Gestão de acessos, bloqueio e desbloqueio.') +
    `<section class="card"><div class="card-title"><h3>Criar vendedor</h3></div><label>Nome<input id="vend-nome"></label><label>E-mail<input id="vend-email" type="email"></label><label>Senha inicial<input id="vend-senha" type="password"></label><button class="btn primary full" data-create-vend>Criar acesso</button></section>` +
    `<div class="list">${state.vendedores.map(v=>`<article class="row-card"><div class="row-top"><div><div class="row-title">${escapeHtml(v.nome||'Sem nome')}</div><div class="row-sub">${escapeHtml(v.email||'')}</div></div><span class="badge ${v.bloqueado?'rejeitado':'faturado'}">${v.bloqueado?'Bloqueado':'Ativo'}</span></div><div class="actions" style="margin-top:10px"><button class="btn ${v.bloqueado?'green':'red'} small" data-toggle-vend="${v.id}">${v.bloqueado?'Reativar':'Bloquear'}</button></div></article>`).join('') || '<div class="empty">Nenhum vendedor.</div>'}</div>`;
}

function renderMetas() {
  const meta = state.metas[mesAtual()]?.valor || 0;
  return head('Metas', 'Configure meta geral e metas individuais por vendedor.') +
    `<section class="card"><div class="card-title"><h3>Meta geral de ${mesAtual()}</h3></div><label>Valor<input type="number" id="meta-geral" value="${meta}"></label><button class="btn primary full" data-save-meta>Salvar meta geral</button></section>` +
    `<section class="card"><div class="card-title"><h3>Metas por vendedor</h3></div>${state.vendedores.map(v=>{const val=getMetaVend(v.id);const total=totalFaturado(faturadosDoMes(v.id));return `<div class="row-card"><div class="row-title">${escapeHtml(v.nome||v.email)}</div><div class="form-row"><label>Meta<input type="number" data-meta-vend-value="${v.id}" value="${val}"></label><div>${progressCircle(percent(total,val),'atingido',money(total))}</div></div><button class="btn small primary" data-save-meta-vend="${v.id}">Salvar</button></div>`}).join('')}</section>`;
}

function renderRanking() {
  const rows = state.vendedores.map(v => ({ ...v, total: totalFaturado(faturadosDoMes(v.id)), qtd: faturadosDoMes(v.id).length })).sort((a,b)=>b.total-a.total);
  return head('Ranking de Vendedores', 'Baseado somente em pedidos faturados no mês atual.') + `<div class="list">${rows.map((v,i)=>`<article class="row-card"><div class="row-top"><div><div class="row-title">${i+1}º Lugar · ${escapeHtml(v.nome||v.email)}</div><div class="row-sub">${v.qtd} pedido(s) faturado(s)</div></div><strong>${money(v.total)}</strong></div></article>`).join('') || '<div class="empty">Sem vendas faturadas.</div>'}</div>`;
}

function renderNotificacoes() {
  return head('Notificações', 'Acompanhe eventos importantes da operação.') + `<div class="list">${state.notificacoes.map(n=>`<article class="row-card notification"><div class="row-title">${escapeHtml(n.titulo)}</div><div class="row-sub">${escapeHtml(n.texto)} · ${formatDate(n.criadoEm)}</div></article>`).join('') || '<div class="empty">Nenhuma notificação.</div>'}</div>`;
}

async function saveProduct() {
  const id = $('#prod-id').value || slug($('#prod-codigo').value || $('#prod-nome').value);
  const data = {
    codigo: $('#prod-codigo').value.trim(), ref: $('#prod-codigo').value.trim(), nome: $('#prod-nome').value.trim(), descricao: $('#prod-descricao').value.trim(),
    marca: $('#prod-marca').value.trim(), categoria: $('#prod-categoria').value.trim(), imagem: $('#prod-imagem').value.trim(),
    preco: Number($('#prod-preco').value || 0), estoque: Number($('#prod-estoque').value || 0), ativo: $('#prod-ativo').checked,
    destaque: $('#prod-destaque').checked, oferta: $('#prod-oferta').checked, maisVendido: $('#prod-mais').checked, atualizadoEm: fb.serverTimestamp()
  };
  if (!data.nome || !data.codigo) return toast('Informe código e nome do produto.');
  await fb.setDoc(ref('produtos', id), data, { merge: true });
  toast('Produto salvo.');
}

async function saveDraft() { return saveOrder('rascunho'); }
async function sendOrder() { return saveOrder('enviado'); }

async function saveOrder(status) {
  if (!state.pedidoClienteId) return toast('Selecione um cliente.');
  const cliente = state.clientes.find(c => c.id === state.pedidoClienteId);
  const itens = Object.values(state.cart).filter(item => Number(item.qty || 0) > 0);
  if (!cliente || !itens.length) return toast('Adicione produtos ao pedido.');
  const numero = `PS-${Date.now().toString(36).toUpperCase()}`;
  const pedido = { numero, vendedorId: state.user.uid, vendedorNome: vendedorNome(state.user.uid), clienteId: cliente.id,
    cliente: { id: cliente.id, nome: cliente.nome || cliente.razaoSocial, doc: cliente.doc || cliente.cnpj, telefone: cliente.tel || cliente.telefone, cidade: cliente.cidade, estado: cliente.estado },
    itens, observacoes: state.pedidoObs.trim(), total: cartTotal(), status, historico: [statusHistory(status, status === 'rascunho' ? 'Pedido salvo como rascunho' : 'Pedido enviado para aprovação')],
    criadoEm: fb.serverTimestamp(), atualizadoEm: fb.serverTimestamp() };
  if (status === 'enviado') pedido.enviadoEm = fb.serverTimestamp();
  await fb.addDoc(col('pedidos'), pedido);
  state.cart = {}; state.pedidoClienteId = ''; state.pedidoObs = '';
  toast(status === 'rascunho' ? 'Rascunho salvo.' : 'Pedido enviado para aprovação.');
  setPage('meus');
}

async function changeOrderStatus(id, status) {
  const p = state.pedidos.find(x=>x.id===id); if (!p) return;
  const allowed = { enviado: ['aprovado','rejeitado'], aprovado: ['faturado'], rascunho: ['enviado','cancelado'] };
  if (!allowed[p.status]?.includes(status)) return toast(`Transição inválida: ${STATUS[p.status] || p.status} → ${STATUS[status] || status}.`);
  const update = { status, atualizadoEm: fb.serverTimestamp(), historico: [...(p.historico||[]), statusHistory(status)] };
  if (status === 'aprovado') { update.aprovadoEm = fb.serverTimestamp(); await baixarEstoqueDoPedido(p); update.estoqueBaixado = true; }
  if (status === 'faturado') update.faturadoEm = fb.serverTimestamp();
  if (status === 'rejeitado') update.rejeitadoEm = fb.serverTimestamp();
  if (status === 'enviado') update.enviadoEm = fb.serverTimestamp();
  await fb.updateDoc(ref('pedidos', id), update);
  if (isAdmin()) await notifyUser(p.vendedorId, `Pedido ${STATUS[status]}`, `Pedido #${String(p.numero||id).slice(-8)} foi ${STATUS[status].toLowerCase()}.`, id);
  toast(`Pedido ${STATUS[status].toLowerCase()}.`);
}

async function baixarEstoqueDoPedido(p) {
  if (p.estoqueBaixado) return;
  const batch = fb.writeBatch(db);
  (p.itens || []).forEach(item => {
    const prod = state.produtos.find(x => x.id === item.prodId);
    if (!prod) return;
    batch.update(ref('produtos', item.prodId), { estoque: Math.max(0, Number(prod.estoque || 0) - Number(item.qty || 0)), atualizadoEm: fb.serverTimestamp() });
  });
  await batch.commit();
}

async function approveClientRequest(id, approved) {
  const s = state.solicitacoes.find(x=>x.id===id); if (!s) return;
  if (approved) {
    const duplicate = state.clientes.find(c => (c.doc || c.cnpj) && (c.doc || c.cnpj) === s.cnpj);
    if (duplicate && !confirm('Já existe cliente com este CNPJ. Aprovar mesmo assim?')) return;
    await fb.addDoc(col('clientes'), { nome: s.razaoSocial, razaoSocial: s.razaoSocial, fantasia: s.nomeFantasia, doc: s.cnpj, cnpj: s.cnpj, tel: s.telefone, telefone: s.telefone, cidade: s.cidade, estado: s.estado, obs: s.observacoes, status: 'ativo', vendedorId: s.vendedorId, vendedorNome: s.vendedorNome, criadoEm: fb.serverTimestamp(), atualizadoEm: fb.serverTimestamp() });
  }
  await fb.updateDoc(ref('solicitacoesClientes', id), { status: approved ? 'aprovado' : 'rejeitado', atualizadoEm: fb.serverTimestamp(), analisadoEm: fb.serverTimestamp() });
  await notifyUser(s.vendedorId, approved ? 'Cliente aprovado' : 'Cliente rejeitado', `${s.razaoSocial} foi ${approved ? 'aprovado e entrou na sua carteira' : 'rejeitado pelo admin'}.`);
  toast(approved ? 'Cliente aprovado.' : 'Solicitação rejeitada.');
}

function bindPageEvents() {
  $$('[data-page-jump]').forEach(b => b.onclick = () => setPage(b.dataset.pageJump));
  $$('[data-filter-ped]').forEach(b => b.onclick = () => { state.pedidoFiltro = b.dataset.filterPed; renderPage(); });
  $$('[data-pdf]').forEach(b => b.onclick = () => gerarPedidoPDF(state.pedidos.find(p=>p.id===b.dataset.pdf)));
  $$('[data-approve]').forEach(b => b.onclick = () => changeOrderStatus(b.dataset.approve, 'aprovado'));
  $$('[data-reject]').forEach(b => b.onclick = () => changeOrderStatus(b.dataset.reject, 'rejeitado'));
  $$('[data-bill]').forEach(b => b.onclick = () => changeOrderStatus(b.dataset.bill, 'faturado'));
  $$('[data-send-draft]').forEach(b => b.onclick = () => changeOrderStatus(b.dataset.sendDraft, 'enviado'));
  $$('[data-cancel-order]').forEach(b => b.onclick = () => changeOrderStatus(b.dataset.cancelOrder, 'cancelado'));
  $('[data-open-product-form]')?.addEventListener('click', () => { $('#product-form-card').style.display = 'block'; $('#product-form-card').innerHTML = produtoForm(); bindPageEvents(); });
  $('[data-cancel-product]')?.addEventListener('click', () => { $('#product-form-card').style.display = 'none'; });
  $('[data-save-product]')?.addEventListener('click', saveProduct);
  $$('[data-edit-product]').forEach(b => b.onclick = () => { $('#product-form-card').style.display='block'; $('#product-form-card').innerHTML = produtoForm(state.produtos.find(p=>p.id===b.dataset.editProduct)); bindPageEvents(); });
  $$('[data-delete-product]').forEach(b => b.onclick = async () => { if(confirm('Excluir produto?')) await fb.deleteDoc(ref('produtos', b.dataset.deleteProduct)); });
  $('#prod-search')?.addEventListener('input', e => { state.produtoFiltros.texto = e.target.value; renderPage(); });
  $('#prod-brand')?.addEventListener('change', e => { state.produtoFiltros.marca = e.target.value; renderPage(); });
  $$('[data-prod-flag]').forEach(b => b.onclick = () => { state.produtoFiltros[b.dataset.prodFlag] = !state.produtoFiltros[b.dataset.prodFlag]; renderPage(); });
  $$('[data-qty]').forEach(b => b.onclick = () => updateQty(b.dataset.qty, Number(b.dataset.delta)));
  $$('[data-discount]').forEach(i => i.oninput = () => updateDiscount(i.dataset.discount, Number(i.value)));
  $('#pedido-cliente')?.addEventListener('change', e => { state.pedidoClienteId = e.target.value; });
  $('#pedido-obs')?.addEventListener('input', e => { state.pedidoObs = e.target.value; });
  $('[data-save-draft]')?.addEventListener('click', saveDraft);
  $('[data-send-order]')?.addEventListener('click', sendOrder);
  $$('[data-start-order]').forEach(b => b.onclick = () => { state.pedidoClienteId = b.dataset.startOrder; setPage('catalogo'); });
  $('#cliente-search')?.addEventListener('input', e => { state.clienteFiltro = e.target.value; renderPage(); });
  $('#cliente-resp')?.addEventListener('change', e => { state.clienteResponsavel = e.target.value; renderPage(); });
  $$('[data-approve-client-request]').forEach(b => b.onclick = () => approveClientRequest(b.dataset.approveClientRequest, true));
  $$('[data-reject-client-request]').forEach(b => b.onclick = () => approveClientRequest(b.dataset.rejectClientRequest, false));
  $('[data-send-client-request]')?.addEventListener('click', sendClientRequest);
  $('[data-create-vend]')?.addEventListener('click', createVendedor);
  $$('[data-toggle-vend]').forEach(b => b.onclick = () => toggleVendedor(b.dataset.toggleVend));
  $('[data-new-client]')?.addEventListener('click', () => { state.clienteFormOpen = true; state.clienteEditId = ''; renderPage(); });
  $('[data-cancel-cliente]')?.addEventListener('click', () => { state.clienteFormOpen = false; state.clienteEditId = ''; renderPage(); });
  $('[data-save-cliente]')?.addEventListener('click', () => upsertCliente($('#cliente-id')?.value || ''));
  $$('[data-edit-client]').forEach(b => b.onclick = () => { state.clienteFormOpen = true; state.clienteEditId = b.dataset.editClient; renderPage(); });
  $$('[data-transfer-client]').forEach(b => b.onclick = () => transferCliente(b.dataset.transferClient));
  $$('[data-delete-client]').forEach(b => b.onclick = () => deleteCliente(b.dataset.deleteClient));
  $('[data-save-meta]')?.addEventListener('click', saveMetaGeral);
  $$('[data-save-meta-vend]').forEach(b => b.onclick = () => saveMetaVend(b.dataset.saveMetaVend));
  $('#csv-file')?.addEventListener('change', importCsv);
  $('[data-download-model]')?.addEventListener('click', downloadModel);
}

function updateQty(id, delta) {
  const p = state.produtos.find(x=>x.id===id); if (!p) return;
  const item = state.cart[id] || { prodId:id, codigo:p.codigo||p.ref||id, nome:p.nome, marca:p.marca, precoOriginal:Number(p.preco||0), descontoPct:0, qty:0 };
  item.qty = Math.max(0, Math.min(Number(p.estoque||9999), item.qty + delta));
  if (!item.qty) delete state.cart[id]; else { item.precoFinal = item.precoOriginal * (1 - item.descontoPct/100); item.subtotal = item.precoFinal * item.qty; state.cart[id] = item; }
  renderPage();
}
function updateDiscount(id, pct) {
  const p = state.produtos.find(x=>x.id===id); if (!p) return;
  const item = state.cart[id] || { prodId:id, codigo:p.codigo||p.ref||id, nome:p.nome, marca:p.marca, precoOriginal:Number(p.preco||0), qty:0 };
  item.descontoPct = Math.max(0, Math.min(7, pct)); item.precoFinal = item.precoOriginal * (1 - item.descontoPct/100); item.subtotal = item.precoFinal * item.qty; state.cart[id] = item;
  if (!item.qty) item.qty = 0;
  renderPage();
}

async function sendClientRequest() {
  const razaoSocial = $('#sug-razao').value.trim();
  const cnpj = $('#sug-cnpj').value.trim();
  if (!razaoSocial || !cnpj) return toast('Informe razão social e CNPJ.');
  const dup = state.clientes.find(c => (c.doc||c.cnpj) === cnpj) || state.solicitacoes.find(s => s.cnpj === cnpj && s.status === 'pendente');
  if (dup) return toast('Já existe cliente/solicitação para este CNPJ.');
  await fb.addDoc(col('solicitacoesClientes'), { razaoSocial, nomeFantasia: $('#sug-fantasia').value.trim(), cnpj, telefone: $('#sug-tel').value.trim(), cidade: $('#sug-cidade').value.trim(), estado: $('#sug-estado').value.trim().toUpperCase(), observacoes: $('#sug-obs').value.trim(), vendedorId: state.user.uid, vendedorNome: vendedorNome(state.user.uid), status:'pendente', criadoEm: fb.serverTimestamp(), atualizadoEm: fb.serverTimestamp() });
  toast('Solicitação enviada ao admin.'); setPage('sugerir');
}


async function upsertCliente(id = '') {
  const atual = id ? state.clientes.find(c => c.id === id) : {};
  const nome = $('#cliente-nome')?.value.trim() || '';
  if (!nome) return toast('Informe o nome/razão social do cliente.');
  const docCli = $('#cliente-doc')?.value.trim() || '';
  const tel = $('#cliente-tel')?.value.trim() || '';
  const cidade = $('#cliente-cidade')?.value.trim() || '';
  const estado = ($('#cliente-estado')?.value.trim() || '').toUpperCase();
  const vendedorId = $('#cliente-vendedor')?.value || '';
  const vendedorNomeResp = vendedorId ? vendedorNome(vendedorId) : '';
  const data = { nome, razaoSocial: nome, doc: docCli, cnpj: docCli, tel, telefone: tel, cidade, estado, vendedorId, vendedorNome: vendedorNomeResp, obs: $('#cliente-obs')?.value.trim() || '', status: atual?.status || 'ativo', atualizadoEm: fb.serverTimestamp() };
  if (id) await fb.updateDoc(ref('clientes', id), data); else await fb.addDoc(col('clientes'), { ...data, criadoEm: fb.serverTimestamp() });
  if (vendedorId) await notifyUser(vendedorId, 'Cliente atribuído', `${nome} foi atribuído à sua carteira.`);
  state.clienteFormOpen = false; state.clienteEditId = '';
  toast(id ? 'Cliente atualizado.' : 'Cliente cadastrado.');
}

async function transferCliente(id) {
  const cliente = state.clientes.find(c => c.id === id); if (!cliente) return;
  const vendedorId = prompt('Novo UID do vendedor responsável (vazio = carteira geral)', cliente.vendedorId || '') || '';
  const vendedorNomeResp = vendedorId ? vendedorNome(vendedorId) : '';
  await fb.updateDoc(ref('clientes', id), { vendedorId, vendedorNome: vendedorNomeResp, atualizadoEm: fb.serverTimestamp() });
  if (vendedorId) await notifyUser(vendedorId, 'Cliente atribuído', `${cliente.nome} foi transferido para sua carteira.`);
  toast('Cliente transferido.');
}

async function deleteCliente(id) {
  if (!confirm('Excluir este cliente?')) return;
  await fb.deleteDoc(ref('clientes', id));
  toast('Cliente excluído.');
}

async function createVendedor() {
  const nome = $('#vend-nome').value.trim(), email = $('#vend-email').value.trim(), senha = $('#vend-senha').value;
  if (!nome || !email || senha.length < 6) return toast('Preencha nome, e-mail e senha com 6+ caracteres.');
  const cred = await createSecondaryUser(email, senha);
  await fb.setDoc(ref('users', cred.user.uid), { uid: cred.user.uid, nome, email, role:'vendedor', bloqueado:false, criadoEm: fb.serverTimestamp() });
  toast('Vendedor criado com sucesso.');
}
async function toggleVendedor(uid) { const v = state.vendedores.find(x=>x.id===uid); if(!v) return; await fb.updateDoc(ref('users',uid), { bloqueado: !v.bloqueado, atualizadoEm: fb.serverTimestamp() }); toast(v.bloqueado?'Vendedor reativado.':'Vendedor bloqueado.'); }
async function saveMetaGeral() { await fb.setDoc(ref('metas', mesAtual()), { mes: mesAtual(), valor: Number($('#meta-geral').value||0), atualizadoEm: fb.serverTimestamp() }, { merge:true }); toast('Meta geral salva.'); }
async function saveMetaVend(uid) { const input = $(`[data-meta-vend-value="${uid}"]`); await fb.setDoc(ref('metas-vend', `${uid}-${mesAtual()}`), { vendedorId: uid, mes: mesAtual(), valor: Number(input.value||0), atualizadoEm: fb.serverTimestamp() }, { merge:true }); toast('Meta individual salva.'); }
async function importCsv(e) { const file = e.target.files[0]; if(!file) return; const rows = csvRows(await file.text()); const batch = fb.writeBatch(db); rows.forEach(r => { const codigo = r.codigo || r.cod || r.ref; if(!codigo) return; batch.set(ref('produtos', slug(codigo)), { codigo, ref: codigo, nome: r.nome, descricao: r.descricao, marca: r.marca, categoria: r.categoria, imagem: r.imagem, preco: Number(String(r.preco||0).replace(',','.')), estoque: Number(r.estoque||0), ativo: !['false','0','inativo'].includes(String(r.ativo).toLowerCase()), destaque: ['true','1','sim'].includes(String(r.destaque).toLowerCase()), oferta: ['true','1','sim'].includes(String(r.oferta).toLowerCase()), maisVendido: ['true','1','sim'].includes(String(r.maisvendido||r.maisVendido).toLowerCase()), atualizadoEm: fb.serverTimestamp() }, { merge:true }); }); await batch.commit(); toast(`${rows.length} produto(s) importados/atualizados.`); }
function downloadModel() { const csv = 'codigo,nome,descricao,marca,categoria,preco,estoque,ativo,destaque,oferta,maisVendido\nP001,Produto exemplo,Descrição,Marca,Cat,99.90,10,true,true,false,false\n'; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); a.download = 'modelo-produtos-prime-sales.csv'; a.click(); URL.revokeObjectURL(a.href); }

async function boot() {
  $('#login-button').onclick = login;
  $('#login-password').onkeydown = e => { if (e.key === 'Enter') login(); };
  $('#logout-button').onclick = logout;
  $('#menu-button').onclick = openMenu; $('#sidebar-backdrop').onclick = closeMenu;
  window.addEventListener('resize', syncSidebarForViewport);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.deferredInstall = e; $('#install-button').style.display = 'inline-block'; });
  $('#install-button').onclick = async () => { if (state.deferredInstall) { state.deferredInstall.prompt(); state.deferredInstall = null; } };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  fb.onAuthStateChanged(auth, onAuth);
}

async function login() {
  $('#auth-error').classList.add('hidden');
  $('#login-button').textContent = 'Entrando...'; $('#login-button').disabled = true;
  fb.signInWithEmailAndPassword(auth, $('#login-email').value.trim(), $('#login-password').value).catch(err => {
    $('#auth-error').textContent = 'E-mail ou senha inválidos.'; $('#auth-error').classList.remove('hidden');
    $('#login-button').textContent = 'Entrar'; $('#login-button').disabled = false; console.error(err);
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
    if (!snap.exists()) {
      await fb.signOut(auth);
      showLogin('Usuário sem cadastro no sistema.');
      return;
    }

    const profile = { id: user.uid, ...snap.data() };
    if (profile.bloqueado) {
      await fb.signOut(auth);
      showLogin('Acesso bloqueado. Fale com o administrador.');
      return;
    }

    state.user = user;
    state.profile = profile;
    state.role = profile.role || 'vendedor';
    state.page = isAdmin() ? 'resumo' : 'inicio';
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    syncSidebarForViewport();
    $('#role-pill').textContent = isAdmin() ? 'ADMIN' : 'VENDEDOR';
    $('#role-pill').className = `role-pill ${state.role}`;
    $('#user-name').textContent = state.profile.nome || user.email;
    startListeners(); renderNav(); renderPage(); setLoading(true); toast('Conectado com sucesso.');
  } catch (err) {
    console.error(err);
    await fb.signOut(auth);
    showLogin('Não foi possível validar sua sessão. Faça login novamente.');
  }
}

boot();
