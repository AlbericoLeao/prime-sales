import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, addDoc, updateDoc
} from 'firebase/firestore';

const projectId = 'demo-prime-sales';
const adminEmail = 'albericoprestes2014@gmail.com';
const sellerEmail = 'vendedor@example.com';
const otherSellerEmail = 'outro@example.com';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'vendedores', sellerEmail), {
      email: sellerEmail, nome: 'Vendedor', status: 'ativo'
    });
    await setDoc(doc(db, 'vendedores', otherSellerEmail), {
      email: otherSellerEmail, nome: 'Outro', status: 'ativo'
    });
    await setDoc(doc(db, 'clientes', 'cliente-1'), {
      nome: 'Cliente do vendedor', vendedorEmail: sellerEmail, status: 'ativo'
    });
    await setDoc(doc(db, 'clientes', 'cliente-2'), {
      nome: 'Cliente de outro vendedor', vendedorEmail: otherSellerEmail, status: 'ativo'
    });
    await setDoc(doc(db, 'produtos', 'produto-1'), {
      nome: 'Produto ativo', ativo: true, preco: 10, estoque: 20
    });
    await setDoc(doc(db, 'produtos', 'produto-inativo'), {
      nome: 'Produto inativo', ativo: false, status: 'inativo', preco: 10, estoque: 20
    });
  });
});

function asAdmin() {
  return env.authenticatedContext('admin-uid', { email: adminEmail }).firestore();
}
function asSeller(email = sellerEmail) {
  return env.authenticatedContext('seller-uid', { email }).firestore();
}

test('admin can read and update product records', async () => {
  const db = asAdmin();
  await assertSucceeds(getDoc(doc(db, 'produtos', 'produto-1')));
  await assertSucceeds(updateDoc(doc(db, 'produtos', 'produto-1'), { estoque: 19 }));
});

test('active seller can read active products but cannot change stock', async () => {
  const db = asSeller();
  await assertSucceeds(getDoc(doc(db, 'produtos', 'produto-1')));
  await assertFails(getDoc(doc(db, 'produtos', 'produto-inativo')));
  await assertFails(updateDoc(doc(db, 'produtos', 'produto-1'), { estoque: 0 }));
});

test('seller can query only their own clients and orders', async () => {
  const db = asSeller();
  const ownClients = query(collection(db, 'clientes'), where('vendedorEmail', '==', sellerEmail));
  await assertSucceeds(getDocs(ownClients));
  await assertFails(getDoc(doc(db, 'clientes', 'cliente-2')));
});

test('seller cannot create orders directly; trusted callable function owns creation', async () => {
  const db = asSeller();
  await assertFails(addDoc(collection(db, 'pedidos'), {
    numero: 'PS-TEST-1',
    vendedorEmail: sellerEmail,
    vendedorNome: 'Vendedor',
    clienteId: 'cliente-1',
    cliente: { id: 'cliente-1', nome: 'Cliente do vendedor' },
    itens: [{ prodId: 'produto-1', nome: 'Produto ativo', preco: 10, qty: 1, subtotal: 10 }],
    observacoes: '',
    total: 10,
    status: 'pendente',
    historico: [{ status: 'pendente' }],
    enviadoEm: new Date(),
    criadoEm: new Date(),
    atualizadoEm: new Date()
  }));
});

test('seller cannot create an order for another seller client or set another owner', async () => {
  const db = asSeller();
  const now = new Date();
  const payload = {
    numero: 'PS-TEST-2',
    vendedorEmail: sellerEmail,
    vendedorNome: 'Vendedor',
    clienteId: 'cliente-2',
    cliente: { id: 'cliente-2', nome: 'Cliente de outro vendedor' },
    itens: [{ prodId: 'produto-1', nome: 'Produto ativo', preco: 10, qty: 1, subtotal: 10 }],
    observacoes: '',
    total: 10,
    status: 'pendente',
    historico: [{ status: 'pendente' }],
    enviadoEm: now,
    criadoEm: now,
    atualizadoEm: now
  };
  await assertFails(addDoc(collection(db, 'pedidos'), payload));
  await assertFails(addDoc(collection(db, 'pedidos'), { ...payload, vendedorEmail: otherSellerEmail, clienteId: 'cliente-1' }));
});

test('seller cannot alter an existing order or access another seller order', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pedidos', 'pedido-outro'), {
      vendedorEmail: otherSellerEmail, status: 'pendente', total: 100
    });
  });
  const db = asSeller();
  await assertFails(getDoc(doc(db, 'pedidos', 'pedido-outro')));
  await assertFails(updateDoc(doc(db, 'pedidos', 'pedido-outro'), { status: 'faturado' }));
});

test('admin can approve a pending order, but seller cannot approve it', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pedidos', 'pedido-1'), {
      vendedorEmail: sellerEmail, status: 'pendente', total: 10, historico: []
    });
  });
  const db = asAdmin();
  await assertFails(updateDoc(doc(db, 'pedidos', 'pedido-1'), {
    status: 'aprovado', historico: [{ status: 'aprovado' }],
    atualizadoEm: new Date(), aprovadoEm: new Date(), estoqueBaixado: true
  }));
  await assertFails(updateDoc(doc(asSeller(), 'pedidos', 'pedido-1'), { status: 'faturado' }));
});

test('blocked seller cannot access product catalogue', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'vendedores', sellerEmail), { status: 'bloqueado' });
  });
  await assertFails(getDoc(doc(asSeller(), 'produtos', 'produto-1')));
});
