import { FundoFixoFormaPagamento, FundoFixoSaque, FundoFixoSolicitacao } from '../models/fundo-fixo.model';

// Quanto de uma compra já finalizada foi pago numa forma de pagamento específica —
// soma a forma principal e a secundária (quando a compra foi dividida entre duas
// formas) que baterem com `forma`. Pra compra não dividida (formaPagamentoSecundaria
// null) se comporta exatamente como antes: só considera a forma principal.
export function valorPagoNaForma(s: FundoFixoSolicitacao, forma: FundoFixoFormaPagamento): number {
  let total = 0;
  if (s.formaPagamento === forma) total += s.valorFinal ?? s.valorEstimado;
  if (s.formaPagamentoSecundaria === forma) total += s.valorFinalSecundario ?? 0;
  return total;
}

// Dinheiro que o admin tem fisicamente em mãos: soma de tudo que já sacou, menos o
// que já usou em compras pagas em dinheiro/reembolso. É um saldo corrido — não
// reseta por mês, ao contrário do limite do cartão.
export function calcularSaldoCaixa(saques: FundoFixoSaque[], solicitacoes: FundoFixoSolicitacao[]): number {
  const totalSacado = saques.reduce((sum, s) => sum + s.valor, 0);
  const totalUsadoEmCaixa = solicitacoes
    .filter(s => s.status === 'comprado')
    .reduce((sum, s) => sum + valorPagoNaForma(s, 'dinheiro_caixa') + valorPagoNaForma(s, 'reembolso'), 0);
  return totalSacado - totalUsadoEmCaixa;
}

// Total do mês que deve bater com a fatura do cartão: pendentes/aprovados contam pelo
// valor estimado (previsão), compras já feitas no cartão contam pelo valor final (só a
// parte paga no cartão, se a compra foi dividida), e saques (+ taxa) contam no mês em
// que caem na fatura. Compras pagas em dinheiro/reembolso NÃO entram aqui de novo — o
// valor já foi contabilizado quando o saque que as financiou foi registrado, senão o
// total ficaria duplicado.
export function calcularTotalComprometidoMes(
  solicitacoes: FundoFixoSolicitacao[],
  saques: FundoFixoSaque[],
  mes: string,
): number {
  const totalSolicitacoes = solicitacoes
    .filter(s => s.mesReferencia === mes)
    .reduce((sum, s) => {
      if (s.status === 'pendente' || s.status === 'aprovado') return sum + (s.valorFinal ?? s.valorEstimado);
      if (s.status === 'comprado') return sum + valorPagoNaForma(s, 'cartao');
      return sum;
    }, 0);
  const totalSaques = saques
    .filter(s => s.mesReferencia === mes && s.tipo === 'saque')
    .reduce((sum, s) => sum + s.valor + (s.taxa ?? 0), 0);
  return totalSolicitacoes + totalSaques;
}

// Mês seguinte a partir de um 'YYYY-MM' — usado quando uma compra é feita depois que a
// fatura do cartão já tinha fechado no mês, então só vai aparecer na fatura seguinte.
export function proximoMes(mes: string): string {
  const [ano, mesNum] = mes.split('-').map(Number);
  const d = new Date(ano, mesNum, 1); // mesNum já é o índice do mês seguinte (1-indexed = mês atual em base 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
