import type { LinkAcesso, Usuario } from "../../../shared/contracts";
import { Badge, Button, Card } from "../../components/ui";
import {
  formatarData,
  formatarDataHora,
  formatarNumero,
} from "../../lib/formatadores";
import { ROTULO_PAPEL } from "../../lib/sessao";

/** Ids dos botões de cada pessoa (para devolver o foco depois de revogar um link). */
export const idBotaoGerar = (usuarioId: number) => `acessos-gerar-${usuarioId}`;
export const idBotaoAtivo = (usuarioId: number) => `acessos-ativo-${usuarioId}`;

type Props = {
  pessoa: Usuario;
  /** É quem está conectado: o cartão não oferece "Desativar acesso" (a API recusaria com 409). */
  ehVoce: boolean;
  /** Ação desta pessoa em andamento (gerar link ou reativar). */
  ocupada: "gerando" | "reativando" | null;
  aoGerarLink: () => void;
  aoRevogar: (link: LinkAcesso) => void;
  aoDesativar: () => void;
  aoReativar: () => void;
};

// Cartão de uma pessoa da coordenação: papel, situação, links válidos (cada um com "Revogar") e as ações.
export function PessoaCartao({
  pessoa,
  ehVoce,
  ocupada,
  aoGerarLink,
  aoRevogar,
  aoDesativar,
  aoReativar,
}: Props) {
  const validos = pessoa.links.filter((link) => link.situacao === "valido");
  const outros = pessoa.links.length - validos.length;

  return (
    <Card titulo={pessoa.nome} className="acessos-pessoa">
      <div className="acessos-pessoa__corpo">
        <p className="acessos-selos">
          <Badge tom={pessoa.papel === "admin" ? "info" : "neutro"}>
            {ROTULO_PAPEL[pessoa.papel]}
          </Badge>
          <Badge tom={pessoa.ativo ? "sucesso" : "alerta"}>
            {pessoa.ativo ? "Ativo" : "Desativado"}
          </Badge>
          {ehVoce && <Badge tom="neutro">Você</Badge>}
        </p>
        <dl className="acessos-dados">
          {pessoa.email && (
            <div>
              <dt>E-mail</dt>
              <dd>{pessoa.email}</dd>
            </div>
          )}
          <div>
            <dt>Links válidos</dt>
            <dd>{formatarNumero(validos.length)}</dd>
          </div>
          <div>
            <dt>Aparelhos conectados</dt>
            <dd>{formatarNumero(pessoa.sessoes_ativas)}</dd>
          </div>
        </dl>
        {!pessoa.ativo && (
          <p className="acessos-suave">
            Acesso desativado: os links não abrem sessão. Reative para a pessoa
            voltar a entrar.
          </p>
        )}
        {validos.length > 0 ? (
          <ul
            className="acessos-links"
            aria-label={`Links válidos de ${pessoa.nome}`}
          >
            {validos.map((link) => (
              <li key={link.id} className="acessos-link">
                <p>
                  Criado em {formatarDataHora(link.criado_em)}, vale até{" "}
                  {formatarData(link.expira_em)}.
                </p>
                <p className="acessos-suave">
                  {link.ultimo_uso_em
                    ? `Último uso em ${formatarDataHora(link.ultimo_uso_em)}.`
                    : "Ainda não usado."}
                </p>
                <Button variante="secundario" onClick={() => aoRevogar(link)}>
                  Revogar link{" "}
                  <span className="visualmente-oculto">
                    de {pessoa.nome} criado em{" "}
                    {formatarDataHora(link.criado_em)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="acessos-suave">
            Nenhum link válido: gere um link novo para a pessoa entrar.
          </p>
        )}
        {outros > 0 && (
          <p className="acessos-suave">
            {outros === 1
              ? "1 link revogado ou vencido."
              : `${formatarNumero(outros)} links revogados ou vencidos.`}
          </p>
        )}
        <div className="acessos-acoes">
          {pessoa.ativo && (
            <Button
              id={idBotaoGerar(pessoa.id)}
              variante="secundario"
              onClick={aoGerarLink}
              aria-disabled={ocupada !== null || undefined}
            >
              {ocupada === "gerando" ? "Gerando…" : "Gerar link novo"}{" "}
              <span className="visualmente-oculto">para {pessoa.nome}</span>
            </Button>
          )}
          {!(ehVoce && pessoa.ativo) && (
            <Button
              id={idBotaoAtivo(pessoa.id)}
              variante="secundario"
              onClick={pessoa.ativo ? aoDesativar : aoReativar}
              aria-disabled={ocupada !== null || undefined}
            >
              {pessoa.ativo
                ? "Desativar acesso"
                : ocupada === "reativando"
                  ? "Reativando…"
                  : "Reativar acesso"}{" "}
              <span className="visualmente-oculto">de {pessoa.nome}</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
