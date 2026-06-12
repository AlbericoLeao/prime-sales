import { money, formatDate } from './utils.js';

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

export function gerarPedidoPDF(pedido) {
  if (!pedido) throw new Error('Pedido não informado para geração do PDF.');
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('Biblioteca jsPDF não carregada.');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 42;
  let y = 46;
  pdf.setFillColor(245, 168, 0);
  pdf.roundedRect(margin, y - 20, 54, 54, 12, 12, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('Prime Representações', margin + 68, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text('Pedido comercial gerado pelo Prime Sales', margin + 68, y + 16);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(`Pedido #${String(pedido.numero || pedido.id || '').slice(-8).toUpperCase()}`, margin, y + 76);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  y += 100;
  const cliente = pedido.cliente || {};
  const rows = [
    ['Cliente', cliente.nome || pedido.clienteNome || '—'],
    ['Documento', cliente.doc || cliente.cnpj || '—'],
    ['Vendedor', pedido.vendedorNome || '—'],
    ['Status', String(pedido.status || '').toUpperCase()],
    ['Data', formatDate(pedido.enviadoEm || pedido.criadoEm)]
  ];
  rows.forEach(([k, v]) => { pdf.setFont('helvetica', 'bold'); pdf.text(`${k}:`, margin, y); pdf.setFont('helvetica', 'normal'); pdf.text(String(v), margin + 78, y); y += 16; });
  y += 16;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Produtos', margin, y);
  y += 18;
  pdf.setFontSize(9);
  (pedido.itens || []).forEach(item => {
    if (y > 720) { pdf.addPage(); y = 48; }
    const nome = `${item.codigo || item.ref || ''} ${item.nome || ''}`.trim();
    pdf.setFont('helvetica', 'bold'); pdf.text(nome.slice(0, 58), margin, y);
    pdf.setFont('helvetica', 'normal');
    y += 13;
    const quantidade = numeric(firstDefined(item.qty, item.quantidade), 0);
    const precoOriginal = numeric(firstDefined(item.precoOriginal, item.preco), 0);
    const precoFinal = numeric(firstDefined(item.precoFinal, item.preco), precoOriginal);
    const subtotal = numeric(firstDefined(item.subtotal), precoFinal * quantidade);
    pdf.text(`Qtd: ${quantidade}  Original: ${money(precoOriginal)}  Desc.: ${item.descontoPct || 0}%  Final: ${money(precoFinal)}`, margin, y);
    pdf.text(money(subtotal), 500, y, { align: 'right' });
    y += 22;
  });
  y += 10;
  pdf.setDrawColor(230); pdf.line(margin, y, 552, y); y += 22;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14);
  pdf.text(`Total: ${money(pedido.total)}`, 552, y, { align: 'right' });
  y += 30;
  pdf.setFontSize(10); pdf.text('Observações Comerciais', margin, y); y += 14;
  pdf.setFont('helvetica', 'normal');
  pdf.text(pdf.splitTextToSize(pedido.observacoes || '—', 510), margin, y);
  pdf.save(`prime-sales-pedido-${String(pedido.numero || pedido.id || 'pedido').slice(-8)}.pdf`);
}
