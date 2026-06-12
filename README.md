# Prime Sales

Sistema mobile-first de gestão comercial e força de vendas da Prime Representações.

## Arquivo de produção

A versão operacional usa `index.html` como entrada e foi reconstruída a partir da base `prime-sales-v12-fase2.html` em estrutura modular:

- `app/app.js`: orquestra telas, estado, autenticação, permissões e fluxos operacionais.
- `app/firebase-service.js`: inicialização Firebase e exports de Auth/Firestore.
- `app/pdf.js`: geração de PDF do pedido.
- `app/utils.js`: utilitários de formatação, sanitização, CSV e UI.
- `app/styles.css`: interface mobile-first e responsiva.
- `manifest.json`, `sw.js`, `public/icons/icon.svg`: PWA instalável.

## Funcionalidades principais

### Administrador

- Dashboard com vendas totais, vendas do mês, pedidos enviados, aprovados e faturados.
- Vendas por vendedor, ticket médio e progresso de metas.
- Aprovação, rejeição, faturamento e PDF de pedidos.
- Cadastro, edição, exclusão, importação CSV e flags de produtos.
- Gestão de clientes, transferência de carteira e aprovação de sugestões de clientes.
- Gestão de vendedores com bloqueio/desbloqueio.
- Meta geral e metas individuais.
- Ranking baseado somente em pedidos faturados.

### Vendedor

- Dashboard individual com vendas do dia/mês, meta, percentual atingido e valor restante.
- Visualização apenas de sua própria carteira e seus próprios pedidos.
- Sugestão de novo cliente para aprovação do Admin.
- Catálogo mobile com filtros, selos, quantidade por toque, desconto de até 7% por item e subtotal em tempo real.
- Envio de pedidos para aprovação com observações comerciais.
- PDF do pedido.
- Notificações operacionais.

## Status de pedido

Fluxo principal:

`ENVIADO -> APROVADO -> FATURADO`

Estados alternativos:

`REJEITADO`, `CANCELADO`

Pedidos históricos não devem ser removidos. Atualizações de status registram histórico no documento.

## Firebase

O app espera `firebase-config.js` com `window.FIREBASE_CONFIG`.

Regras recomendadas estão em `firestore.rules`. Publique-as antes de uso real para garantir que vendedores não acessem dados de outros vendedores.

## Rodar localmente

Como é um app estático, use qualquer servidor HTTP:

```bash
python3 -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## CSV de produtos

Modelo de colunas:

```csv
codigo,nome,descricao,marca,categoria,preco,estoque,ativo,destaque,oferta,maisVendido
P001,Produto exemplo,Descrição,Marca,Cat,99.90,10,true,true,false,false
```
