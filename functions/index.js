const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { toCents, positiveQuantity } = require('./order-domain');

initializeApp();
const db = getFirestore();
const ADMIN_EMAIL = 'albericoprestes2014@gmail.com';

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function requireEmail(request) {
  if (!request.auth || !request.auth.token || !request.auth.token.email) {
    throw new HttpsError('unauthenticated', 'Faça login novamente para continuar.');
  }
  return normalizedEmail(request.auth.token.email);
}

function requireAdmin(request) {
  const email = requireEmail(request);
  if (email !== ADMIN_EMAIL || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Somente o administrador pode processar pedidos.');
  }
  return email;
}


exports.createSeller = onCall({ region: 'us-central1', enforceAppCheck: false }, async (request) => {
  const adminEmail = requireAdmin(request);
  const input = request.data || {};
  const name = safeText(input.nome, 160);
  const email = normalizedEmail(input.email);
  const status = input.status === 'bloqueado' ? 'bloqueado' : 'ativo';
  if (!name || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Informe nome e e-mail válidos para o vendedor.');
  }
  if (email === ADMIN_EMAIL) {
    throw new HttpsError('invalid-argument', 'A conta administrativa não pode ser cadastrada como vendedor.');
  }

  const sellerRef = db.collection('vendedores').doc(email);
  const existingProfile = await sellerRef.get();
  if (existingProfile.exists) {
    throw new HttpsError('already-exists', 'Já existe um cadastro de vendedor com este e-mail. Edite o cadastro existente.');
  }

  const auth = getAuth();
  let userRecord;
  let accountCreated = false;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    try {
      userRecord = await auth.createUser({ email, displayName: name, disabled: false });
      accountCreated = true;
    } catch (createError) {
      if (createError.code === 'auth/email-already-exists') {
        userRecord = await auth.getUserByEmail(email);
      } else {
        throw createError;
      }
    }
  }

  if (userRecord.disabled) {
    throw new HttpsError('failed-precondition', 'Esta conta Firebase está desativada. Reative-a no Firebase Authentication antes de cadastrar o vendedor.');
  }

  try {
    await sellerRef.create({
      email,
      nome: name,
      status,
      authUid: userRecord.uid,
      criadoPor: adminEmail,
      criadoEm: Timestamp.now(),
      atualizadoEm: Timestamp.now()
    });
  } catch (error) {
    if (error.code === 6 || error.code === 'already-exists') {
      if (accountCreated) {
        try { await auth.deleteUser(userRecord.uid); } catch (rollbackError) { console.error('Could not roll back newly created seller Auth user', rollbackError); }
      }
      throw new HttpsError('already-exists', 'Já existe um cadastro de vendedor com este e-mail.');
    }
    // Roll back only an account created by this invocation; never delete a pre-existing account.
    if (accountCreated) {
      try { await auth.deleteUser(userRecord.uid); } catch (rollbackError) { console.error('Could not roll back newly created seller Auth user', rollbackError); }
    }
    throw error;
  }

  const resetLink = await auth.generatePasswordResetLink(email);
  return { ok: true, email, resetLink, accountAlreadyExisted: !accountCreated };
});

function moneyToCents(value) {
  try {
    return toCents(value);
  } catch {
    throw new HttpsError('failed-precondition', 'O produto possui um preço inválido.');
  }
}

function qtyInteger(value) {
  try {
    return positiveQuantity(value);
  } catch {
    throw new HttpsError('invalid-argument', 'A quantidade de cada produto deve ser um inteiro positivo.');
  }
}

function activeSellerData(data) {
  if (!data || data.bloqueado === true || data.status === 'bloqueado' || data.ativo === false) return false;
  if (data.status) return data.status === 'ativo';
  return data.ativo === true;
}

function safeText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function historyEntry(status, email, name) {
  return {
    status,
    at: Timestamp.now(),
    by: email,
    byName: safeText(name || email, 120)
  };
}

exports.createOrder = onCall({ region: 'us-central1', enforceAppCheck: false }, async (request) => {
  const email = requireEmail(request);
  const input = request.data || {};
  const clienteId = safeText(input.clienteId, 180);
  const observacoes = safeText(input.observacoes, 2000);
  if (!clienteId || !Array.isArray(input.itens) || input.itens.length < 1 || input.itens.length > 100) {
    throw new HttpsError('invalid-argument', 'Informe um cliente e de 1 a 100 itens válidos.');
  }

  const quantities = new Map();
  for (const raw of input.itens) {
    const prodId = safeText(raw && raw.prodId, 180);
    if (!prodId) throw new HttpsError('invalid-argument', 'Há um produto sem identificador.');
    const qty = qtyInteger(raw.qty);
    quantities.set(prodId, (quantities.get(prodId) || 0) + qty);
  }
  for (const qty of quantities.values()) {
    if (!Number.isSafeInteger(qty) || qty > 100000) {
      throw new HttpsError('invalid-argument', 'A quantidade acumulada de um produto é inválida.');
    }
  }

  const sellerRef = db.collection('vendedores').doc(email);
  const clientRef = db.collection('clientes').doc(clienteId);
  const productRefs = [...quantities.keys()].map(id => db.collection('produtos').doc(id));
  const orderRef = db.collection('pedidos').doc();
  const createdAt = Timestamp.now();

  const result = await db.runTransaction(async (tx) => {
    const sellerSnap = await tx.get(sellerRef);
    const clientSnap = await tx.get(clientRef);
    const productSnaps = [];
    for (const productRef of productRefs) productSnaps.push(await tx.get(productRef));

    if (!sellerSnap.exists || !activeSellerData(sellerSnap.data())) {
      throw new HttpsError('permission-denied', 'Seu cadastro de vendedor não está ativo.');
    }
    const seller = sellerSnap.data();
    if (!clientSnap.exists) throw new HttpsError('failed-precondition', 'O cliente selecionado não existe.');
    const client = clientSnap.data();
    if (normalizedEmail(client.vendedorEmail) !== email || String(client.status || '').toLowerCase() === 'inativo') {
      throw new HttpsError('permission-denied', 'O cliente não pertence à sua carteira ou está inativo.');
    }

    const itens = [];
    let totalCents = 0;
    for (let i = 0; i < productSnaps.length; i++) {
      const snap = productSnaps[i];
      const prodId = productRefs[i].id;
      if (!snap.exists) throw new HttpsError('failed-precondition', 'Um dos produtos não existe mais.');
      const product = snap.data();
      if (product.ativo !== true || String(product.status || '').toLowerCase() === 'inativo') {
        throw new HttpsError('failed-precondition', 'Um dos produtos não está ativo.');
      }
      const qty = quantities.get(prodId);
      const unitCents = moneyToCents(product.preco);
      const subtotalCents = unitCents * qty;
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > Number.MAX_SAFE_INTEGER - totalCents) {
        throw new HttpsError('invalid-argument', 'O valor total do pedido é muito alto.');
      }
      totalCents += subtotalCents;
      itens.push({
        prodId,
        codigo: safeText(product.codigo || product.ref || prodId, 120),
        nome: safeText(product.nome, 250),
        marca: safeText(product.marca, 160),
        preco: unitCents / 100,
        precoOriginal: unitCents / 100,
        precoFinal: unitCents / 100,
        descontoPct: 0,
        qty,
        subtotal: subtotalCents / 100
      });
    }

    const total = totalCents / 100;
    const order = {
      numero: 'PS-' + orderRef.id.slice(-10).toUpperCase(),
      vendedorEmail: email,
      vendedorNome: safeText(seller.nome || email, 160),
      clienteId,
      cliente: {
        id: clienteId,
        nome: safeText(client.nome || client.razaoSocial, 250),
        fantasia: safeText(client.fantasia || client.nomeFantasia, 250),
        cnpj: safeText(client.cnpj || client.doc, 40),
        telefone: safeText(client.telefone || client.tel, 60),
        cidade: safeText(client.cidade, 120),
        estado: safeText(client.estado, 8)
      },
      itens,
      observacoes,
      total,
      status: 'pendente',
      validadoServidor: true,
      historico: [historyEntry('pendente', email, seller.nome)],
      enviadoEm: createdAt,
      criadoEm: createdAt,
      atualizadoEm: createdAt
    };
    tx.create(orderRef, order);
    return { orderId: orderRef.id, numero: order.numero, total: order.total };
  });

  return { ok: true, ...result };
});

exports.processOrder = onCall({ region: 'us-central1', enforceAppCheck: false }, async (request) => {
  const email = requireAdmin(request);
  const input = request.data || {};
  const orderId = safeText(input.orderId, 180);
  const action = safeText(input.action, 30);
  if (!orderId || !['aprovado', 'rejeitado', 'faturado'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Pedido ou ação inválida.');
  }

  const orderRef = db.collection('pedidos').doc(orderId);
  const now = Timestamp.now();
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Pedido não encontrado.');
    const order = orderSnap.data();

    // Idempotency: retries of the same completed action never deduct stock twice.
    if (order.status === action && (action !== 'aprovado' || order.estoqueBaixado === true)) {
      return { ok: true, alreadyProcessed: true, status: action };
    }

    if (action === 'aprovado' || action === 'rejeitado') {
      if (order.status !== 'pendente') {
        throw new HttpsError('failed-precondition', 'Somente pedidos pendentes podem ser aprovados ou rejeitados.');
      }
      if (!Array.isArray(order.itens) || order.itens.length === 0) {
        throw new HttpsError('failed-precondition', 'O pedido não possui itens válidos.');
      }

      const updates = [];
      let legacyValidatedItems = null;
      let legacyValidatedTotal = null;
      if (action === 'aprovado') {
        const isServerValidated = order.validadoServidor === true;
        let legacySellerSnap = null;
        let legacyClientSnap = null;
        if (!isServerValidated) {
          const legacySellerEmail = normalizedEmail(order.vendedorEmail);
          const legacyClientId = safeText(order.clienteId, 180);
          if (!legacySellerEmail || !legacyClientId) {
            throw new HttpsError('failed-precondition', 'O pedido legado não tem vendedor ou cliente válido. Revise o cadastro antes de aprovar.');
          }
          const legacySellerRef = db.collection('vendedores').doc(legacySellerEmail);
          const legacyClientRef = db.collection('clientes').doc(legacyClientId);
          legacySellerSnap = await tx.get(legacySellerRef);
          legacyClientSnap = await tx.get(legacyClientRef);
          if (!legacySellerSnap.exists || !activeSellerData(legacySellerSnap.data())) {
            throw new HttpsError('failed-precondition', 'O vendedor deste pedido não está ativo. Revise o pedido antes de aprovar.');
          }
          if (!legacyClientSnap.exists || normalizedEmail(legacyClientSnap.data().vendedorEmail) !== normalizedEmail(order.vendedorEmail) || String(legacyClientSnap.data().status || '').toLowerCase() === 'inativo') {
            throw new HttpsError('failed-precondition', 'A carteira do pedido mudou. Revise o cliente antes de aprovar.');
          }
        }
        const quantities = new Map();
        for (const item of order.itens) {
          const prodId = safeText(item.prodId, 180);
          const qty = qtyInteger(item.qty);
          if (!prodId) throw new HttpsError('failed-precondition', 'Há um item sem produto vinculado.');
          quantities.set(prodId, (quantities.get(prodId) || 0) + qty);
        }

        const productRefs = [...quantities.keys()].map(id => db.collection('produtos').doc(id));
        const productSnaps = [];
        // Complete all reads before writing inside the transaction.
        for (const productRef of productRefs) productSnaps.push(await tx.get(productRef));

        let calculatedTotalCents = 0;
        if (!isServerValidated) legacyValidatedItems = [];
        for (let i = 0; i < productSnaps.length; i++) {
          const snap = productSnaps[i];
          const productRef = productRefs[i];
          if (!snap.exists) throw new HttpsError('failed-precondition', 'Um produto do pedido foi removido.');
          const product = snap.data();
          const qty = quantities.get(productRef.id);
          const stock = Number(product.estoque);
          if (!Number.isSafeInteger(stock) || stock < 0) {
            throw new HttpsError('failed-precondition', 'Estoque inválido no produto ' + safeText(product.nome, 120) + '.');
          }
          if (stock < qty) {
            throw new HttpsError('failed-precondition', 'Estoque insuficiente para ' + safeText(product.nome, 120) + '. Disponível: ' + stock + ', solicitado: ' + qty + '.');
          }

          const lineItems = order.itens.filter(item => safeText(item.prodId, 180) === productRef.id);
          let itemTotalCents = 0;
          for (const item of lineItems) {
            const unitCents = isServerValidated ? moneyToCents(item.preco) : moneyToCents(product.preco);
            const expectedSubtotal = unitCents * qtyInteger(item.qty);
            if (!Number.isSafeInteger(expectedSubtotal) || (isServerValidated && moneyToCents(item.subtotal) !== expectedSubtotal)) {
              throw new HttpsError('failed-precondition', 'O subtotal salvo no pedido não confere.');
            }
            itemTotalCents += expectedSubtotal;
            if (!isServerValidated) {
              legacyValidatedItems.push({
                prodId: productRef.id,
                codigo: safeText(product.codigo || product.ref || productRef.id, 120),
                nome: safeText(product.nome, 250),
                marca: safeText(product.marca, 160),
                preco: unitCents / 100,
                precoOriginal: unitCents / 100,
                precoFinal: unitCents / 100,
                descontoPct: 0,
                qty: qtyInteger(item.qty),
                subtotal: expectedSubtotal / 100
              });
            }
          }
          calculatedTotalCents += itemTotalCents;
          updates.push({ ref: productRef, stock: stock - qty, name: safeText(product.nome, 120) });
        }
        if (isServerValidated && moneyToCents(order.total) !== calculatedTotalCents) {
          throw new HttpsError('failed-precondition', 'O total salvo no pedido não confere com os itens.');
        }
        if (!isServerValidated) legacyValidatedTotal = calculatedTotalCents / 100;
        for (const update of updates) {
          tx.update(update.ref, { estoque: update.stock, atualizadoEm: now });
        }
      }

      const nextOrder = {
        status: action,
        atualizadoEm: now,
        historico: [...(Array.isArray(order.historico) ? order.historico : []), historyEntry(action, email, 'Administrador')]
      };
      if (action === 'aprovado') {
        nextOrder.aprovadoEm = now;
        nextOrder.estoqueBaixado = true;
        nextOrder.validadoServidor = true;
        if (legacyValidatedItems) {
          nextOrder.itens = legacyValidatedItems;
          nextOrder.total = legacyValidatedTotal;
        }
      } else {
        nextOrder.rejeitadoEm = now;
      }
      tx.update(orderRef, nextOrder);
      return { ok: true, alreadyProcessed: false, status: action };
    }

    if (action === 'faturado') {
      if (order.status !== 'aprovado' || order.estoqueBaixado !== true) {
        throw new HttpsError('failed-precondition', 'Somente pedidos aprovados e com estoque baixado podem ser faturados.');
      }
      tx.update(orderRef, {
        status: 'faturado',
        faturadoEm: now,
        faturadoPor: email,
        faturadoPorEmail: email,
        atualizadoEm: now,
        historico: [...(Array.isArray(order.historico) ? order.historico : []), historyEntry('faturado', email, 'Administrador')]
      });
      return { ok: true, alreadyProcessed: false, status: 'faturado' };
    }
    throw new HttpsError('invalid-argument', 'Ação não suportada.');
  });
});
