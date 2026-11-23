import type { RespostaVisaoIndividual } from "../../../shared/contracts/api";
import { Aviso, EmptyState, ErrorState } from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarHora } from "../../lib/formatadores";
import { useUsuarioConectado } from "../../lib/sessao";
import { Cabecalho, EsqueletoDaVisao } from "./Cabecalho";
import { CurvaIndividual } from "./CurvaIndividual";
import { CartaoPeriodo, Destaque } from "./Destaque";
import { Equipe } from "./Equipe";
import { LinksDeVendas } from "./LinksDeVendas";
import { MaioresCompradores } from "./MaioresCompradores";
import { QuemComprou } from "./QuemComprou";
import { RankingIndividual } from "./RankingIndividual";
import { TodasAsRedes } from "./TodasAsRedes";
import { useVisaoIndividual } from "./useVisaoIndividual";
import "./minha.css";

// O conteúdo da visão individual (carregado à parte, só em /minha: veja MinhaPage.tsx): o cabeçalho, os
// estados (carregando, com o esqueleto; erro, neutro quando é a conexão; sem campanha) e a visão do alvo, que se atualiza sozinha a cada minuto, com o
// link de vendas (RIFA-046), pedido uma vez (e de novo quando os vínculos do líder mudam).
export function VisaoIndividual() {
  const usuario = useUsuarioConectado();
  const { estado, tentarDeNovo } = useVisaoIndividual();
  const visao = estado.tipo === "ok" ? estado.visao : null;
  // O alvo vem da sessão (lido da hierarquia na hora) e, depois da primeira carga, da própria visão.
  const alvo = visao?.alvo ?? usuario.alvo ?? null;

  return (
    <>
      {/* Sem ranking por divisão (D27), o cabeçalho não fala da divisão (o padrão, até a visão chegar). */}
      <Cabecalho
        alvo={alvo}
        nome={usuario.nome}
        porDivisao={visao?.ranking.por_divisao !== false}
      />
      {estado.tipo === "carregando" && <EsqueletoDaVisao />}
      {estado.tipo === "erro" && (
        <ErrorState
          titulo="Não foi possível carregar os seus números."
          mensagem={`${mensagemDoErro(estado.erro)} A página tenta de novo sozinha a cada minuto.`}
          aoTentarDeNovo={tentarDeNovo}
          conexao={ehFalhaDeConexao(estado.erro)}
        />
      )}
      {estado.tipo === "desligado" && (
        <Aviso tom="alerta" titulo={estado.texto}>
          <p>
            Os seus números voltam a aparecer aqui quando a coordenação ligar o
            acesso de novo. A página confere sozinha a cada minuto.
          </p>
        </Aviso>
      )}
      {estado.tipo === "sem_campanha" && (
        <EmptyState
          titulo="A campanha ainda não está ativa."
          descricao="Os seus números aparecem aqui quando a coordenação ativar a campanha."
        />
      )}
      {estado.tipo === "ok" && (
        <Visao visao={estado.visao} falhou={estado.falha !== null} />
      )}
    </>
  );
}

function Visao({
  visao,
  falhou,
}: {
  visao: RespostaVisaoIndividual;
  falhou: boolean;
}) {
  const { referencia, desempenho, unidade, alvo } = visao;
  const semAfiliado =
    alvo.tipo === "celula" && visao.afiliados_vinculados === 0;
  return (
    <div className="minha-visao">
      {semAfiliado && (
        <Aviso
          tom="alerta"
          titulo="Seu link de afiliado ainda não está ligado à sua célula: fale com a coordenação."
        >
          <p>
            Enquanto isso, as vendas feitas pelo seu link não aparecem nos
            números da célula.
          </p>
        </Aviso>
      )}
      <div className="minha-cartoes">
        <Destaque visao={visao} />
        {desempenho.periodo && referencia.periodo && (
          <CartaoPeriodo
            periodo={desempenho.periodo}
            info={referencia.periodo}
            unidade={unidade}
          />
        )}
      </div>
      {/* O link de vendas (RIFA-046): o do líder logo abaixo dos números; os da equipe, depois dela. Pedido uma
          vez (o cartão fica montado nas atualizações de cada minuto) e de novo só quando os vínculos do líder mudam. */}
      {alvo.tipo === "celula" && (
        <LinksDeVendas alvo={alvo} vinculos={visao.afiliados_vinculados} />
      )}
      <CurvaIndividual visao={visao} />
      <RankingIndividual visao={visao} />
      {alvo.tipo !== "celula" && <Equipe visao={visao} />}
      {/* Os maiores compradores das células dele (RIFA-083, D38): só o discipulador, depois do ranking das células. */}
      {alvo.tipo === "discipulador" && (
        <MaioresCompradores atualizadoEm={visao.atualizado_em} />
      )}
      {/* Quem comprou (RIFA-089, adendo da D38): só o líder da célula, as compras pagas dela, depois do ranking. */}
      {alvo.tipo === "celula" && (
        <QuemComprou atualizadoEm={visao.atualizado_em} />
      )}
      {alvo.tipo !== "celula" && <LinksDeVendas alvo={alvo} />}
      {/* O ranking geral (RIFA-090): todos os discipuladores e todas as células, embaixo de tudo; o líder não vê. */}
      {alvo.tipo !== "celula" && (
        <TodasAsRedes alvo={alvo} atualizadoEm={visao.atualizado_em} />
      )}
      <div className="minha-rodape">
        <p>
          Atualizado às {formatarHora(visao.atualizado_em)}. A página se
          atualiza sozinha a cada minuto.
        </p>
        {/* Região viva fixa: avisa quando uma atualização automática falha. */}
        <p className="minha-rodape__falha" role="status">
          {falhou
            ? "Não foi possível atualizar agora. A página tenta de novo em 1 minuto."
            : ""}
        </p>
      </div>
    </div>
  );
}
