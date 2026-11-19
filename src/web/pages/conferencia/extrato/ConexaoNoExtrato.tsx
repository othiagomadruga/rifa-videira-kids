import { useEffect, useState } from "react";
import { Aviso } from "../../../components/ui";
import {
  obterConexaoRifei,
  situacaoDaConexao,
  type EstadoConexaoRifei,
} from "../../acessos/conexao-rifei-api";

// A situação da conexão com a Rifei no topo da Conferência do extrato (RIFA-070, D32; só o admin): "Conectado:
// testado às hh:mm" ou "A Rifei recusou o token: cole um novo". Lê de novo quando `versao` muda (depois de marcar).
// Falha ao ler não atrapalha a tela: o aviso só some.
export function ConexaoNoExtrato({ versao }: { versao: number }) {
  const [estado, setEstado] = useState<EstadoConexaoRifei | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    obterConexaoRifei({ signal: controle.signal }).then(setEstado, () => {
      if (!controle.signal.aborted) setEstado(null);
    });
    return () => controle.abort();
  }, [versao]);

  if (!estado) return null;
  const situacao = situacaoDaConexao(estado);
  return (
    <Aviso tom={situacao.tom} titulo="Conexão com a Rifei" anuncio="nenhum">
      <p>{situacao.texto}</p>
    </Aviso>
  );
}
