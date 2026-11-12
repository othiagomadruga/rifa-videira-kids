import { useState } from "react";
import type {
  Celula,
  Discipulador,
  Divisao,
  Rede,
} from "../../../shared/contracts";
import {
  Badge,
  Button,
  ComDica,
  DataTable,
  EmptyState,
  Input,
  Select,
  type ColunaTabela,
} from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";
import {
  DICAS,
  DIVISOES,
  ROTULO_DIVISAO,
  compararNomes,
  paraBusca,
  plural,
  type Entidade,
} from "./textos";

type AcoesDaLinha<T> = {
  aoEditar: (item: T) => void;
  aoExcluir: (item: T) => void;
};

// ---------------------------------------------------------------------------------------------------
// Células: filtro por divisão e por rede, busca por nome (célula, líder ou discipulador, sem acento)
// ---------------------------------------------------------------------------------------------------

type PropsCelulas = AcoesDaLinha<Celula> & {
  celulas: readonly Celula[];
  redes: readonly Rede[];
  /** Botão do estado vazio: leva à importação da planilha. */
  aoIrParaImportar: () => void;
};

export function TabelaCelulas({
  celulas,
  redes,
  aoEditar,
  aoExcluir,
  aoIrParaImportar,
}: PropsCelulas) {
  const [divisao, setDivisao] = useState<Divisao | "">("");
  const [redeId, setRedeId] = useState("");
  const [busca, setBusca] = useState("");

  if (celulas.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma célula ainda: importe a planilha"
        descricao="Baixe o modelo, preencha uma linha por célula e importe o arquivo: as redes e os discipuladores entram junto."
        acao={
          <ComDica texto={DICAS.irParaImportar}>
            <Button onClick={aoIrParaImportar}>Importar planilha</Button>
          </ComDica>
        }
      />
    );
  }

  const redesDaDivisao = redes
    .filter((rede) => divisao === "" || rede.divisao === divisao)
    .sort((a, b) => compararNomes(a.nome, b.nome));
  // A rede escolhida pode ter saído da lista (outra divisão ou excluída): vale como "todas".
  const redeFiltro = redesDaDivisao.some((rede) => String(rede.id) === redeId)
    ? redeId
    : "";
  const termo = paraBusca(busca);
  const filtradas = celulas
    .filter(
      (celula) =>
        (divisao === "" || celula.divisao === divisao) &&
        (redeFiltro === "" || String(celula.rede_id) === redeFiltro) &&
        (termo === "" ||
          [celula.nome, celula.lider_nome, celula.discipulador_nome].some(
            (texto) => paraBusca(texto).includes(termo),
          )),
    )
    .sort(
      (a, b) =>
        compararNomes(a.rede_nome, b.rede_nome) ||
        compararNomes(a.discipulador_nome, b.discipulador_nome) ||
        compararNomes(a.nome, b.nome),
    );
  const pessoas = filtradas.reduce(
    (total, celula) => total + celula.qtd_pessoas,
    0,
  );
  const temFiltro = divisao !== "" || redeFiltro !== "" || termo !== "";

  function limparFiltros() {
    setDivisao("");
    setRedeId("");
    setBusca("");
  }

  const colunas: ColunaTabela<Celula>[] = [
    {
      chave: "celula",
      titulo: "Célula",
      principal: true,
      celula: (celula) => celula.nome,
    },
    {
      chave: "discipulador",
      titulo: "Discipulador",
      celula: (celula) => celula.discipulador_nome,
    },
    { chave: "rede", titulo: "Rede", celula: (celula) => celula.rede_nome },
    {
      chave: "divisao",
      titulo: "Divisão",
      celula: (celula) => <EtiquetaDivisao divisao={celula.divisao} />,
    },
    {
      chave: "pessoas",
      titulo: "Pessoas",
      alinhamento: "fim",
      celula: (celula) => formatarNumero(celula.qtd_pessoas),
    },
    { chave: "lider", titulo: "Líder", celula: (celula) => celula.lider_nome },
    {
      chave: "contato",
      titulo: "Contato",
      celula: (celula) => (
        <Contato email={celula.lider_email} telefone={celula.lider_telefone} />
      ),
    },
    {
      chave: "acoes",
      titulo: "Ações",
      celula: (celula) => (
        <BotoesDaLinha
          entidade="celula"
          nome={celula.nome}
          aoEditar={() => aoEditar(celula)}
          aoExcluir={() => aoExcluir(celula)}
        />
      ),
    },
  ];

  return (
    <div className="hierarquia-painel">
      <div className="hierarquia-filtros">
        <ComDica texto={DICAS.filtroDivisao}>
          <Select
            rotulo="Divisão"
            value={divisao}
            onChange={(evento) => {
              const nova = evento.currentTarget.value as Divisao | "";
              setDivisao(nova);
              const rede = redes.find((item) => String(item.id) === redeId);
              if (nova !== "" && rede && rede.divisao !== nova) setRedeId("");
            }}
          >
            <option value="">Todas</option>
            {DIVISOES.map((item) => (
              <option key={item} value={item}>
                {ROTULO_DIVISAO[item]}
              </option>
            ))}
          </Select>
        </ComDica>
        <ComDica texto={DICAS.filtroRede}>
          <Select
            rotulo="Rede"
            value={redeFiltro}
            onChange={(evento) => setRedeId(evento.currentTarget.value)}
          >
            <option value="">Todas as redes</option>
            {redesDaDivisao.map((rede) => (
              <option key={rede.id} value={rede.id}>
                {rede.nome}
              </option>
            ))}
          </Select>
        </ComDica>
        <ComDica texto={DICAS.busca}>
          <Input
            rotulo="Buscar por nome"
            dica="Célula, líder ou discipulador"
            type="search"
            value={busca}
            onChange={(evento) => setBusca(evento.currentTarget.value)}
          />
        </ComDica>
      </div>
      <p className="hierarquia-contagem" role="status">
        {temFiltro
          ? `Mostrando ${filtradas.length.toLocaleString("pt-BR")} de ${plural(celulas.length, "célula", "células")}`
          : plural(celulas.length, "célula", "células")}{" "}
        ({plural(pessoas, "pessoa", "pessoas")})
      </p>
      <div className="hierarquia-tabela">
        <DataTable
          colunas={colunas}
          linhas={filtradas}
          chaveDaLinha={(celula) => celula.id}
          legenda="Células"
          vazio={
            <EmptyState
              titulo="Nenhuma célula encontrada com esses filtros."
              acao={
                <ComDica texto={DICAS.limparFiltros}>
                  <Button variante="secundario" onClick={limparFiltros}>
                    Limpar filtros
                  </Button>
                </ComDica>
              }
            />
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Discipuladores e redes, com as contagens tiradas das listas
// ---------------------------------------------------------------------------------------------------

type PropsDiscipuladores = AcoesDaLinha<Discipulador> & {
  discipuladores: readonly Discipulador[];
  celulas: readonly Celula[];
};

export function TabelaDiscipuladores({
  discipuladores,
  celulas,
  aoEditar,
  aoExcluir,
}: PropsDiscipuladores) {
  if (discipuladores.length === 0) {
    return (
      <EmptyState
        titulo="Nenhum discipulador ainda: importe a planilha"
        descricao="Os discipuladores entram junto com as células, pela planilha."
      />
    );
  }
  const quantidade = contarPor(celulas, (celula) => celula.discipulador_id);
  const pessoas = somarPessoasPor(celulas, (celula) => celula.discipulador_id);
  const linhas = [...discipuladores].sort(
    (a, b) =>
      compararNomes(a.rede_nome, b.rede_nome) || compararNomes(a.nome, b.nome),
  );
  const colunas: ColunaTabela<Discipulador>[] = [
    {
      chave: "discipulador",
      titulo: "Discipulador",
      principal: true,
      celula: (item) => item.nome,
    },
    { chave: "rede", titulo: "Rede", celula: (item) => item.rede_nome },
    {
      chave: "divisao",
      titulo: "Divisão",
      celula: (item) => <EtiquetaDivisao divisao={item.divisao} />,
    },
    {
      chave: "celulas",
      titulo: "Células",
      alinhamento: "fim",
      celula: (item) => formatarNumero(quantidade.get(item.id) ?? 0),
    },
    {
      chave: "pessoas",
      titulo: "Pessoas",
      alinhamento: "fim",
      celula: (item) => formatarNumero(pessoas.get(item.id) ?? 0),
    },
    {
      chave: "acoes",
      titulo: "Ações",
      celula: (item) => (
        <BotoesDaLinha
          entidade="discipulador"
          nome={item.nome}
          aoEditar={() => aoEditar(item)}
          aoExcluir={() => aoExcluir(item)}
        />
      ),
    },
  ];
  return (
    <div className="hierarquia-tabela">
      <DataTable
        colunas={colunas}
        linhas={linhas}
        chaveDaLinha={(item) => item.id}
        legenda="Discipuladores"
      />
    </div>
  );
}

type PropsRedes = AcoesDaLinha<Rede> & {
  redes: readonly Rede[];
  discipuladores: readonly Discipulador[];
  celulas: readonly Celula[];
};

export function TabelaRedes({
  redes,
  discipuladores,
  celulas,
  aoEditar,
  aoExcluir,
}: PropsRedes) {
  if (redes.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma rede ainda: importe a planilha"
        descricao="As redes entram junto com as células, pela planilha."
      />
    );
  }
  const discipuladoresPorRede = contarPor(
    discipuladores,
    (item) => item.rede_id,
  );
  const celulasPorRede = contarPor(celulas, (celula) => celula.rede_id);
  const pessoasPorRede = somarPessoasPor(celulas, (celula) => celula.rede_id);
  const linhas = [...redes].sort(
    (a, b) =>
      compararNomes(a.divisao, b.divisao) || compararNomes(a.nome, b.nome),
  );
  const colunas: ColunaTabela<Rede>[] = [
    { chave: "rede", titulo: "Rede", principal: true, celula: (r) => r.nome },
    {
      chave: "divisao",
      titulo: "Divisão",
      celula: (rede) => <EtiquetaDivisao divisao={rede.divisao} />,
    },
    {
      chave: "responsavel",
      titulo: "Responsável",
      celula: (rede) =>
        rede.responsavel_nome ?? (
          <span className="hierarquia-suave">Não informado</span>
        ),
    },
    {
      chave: "discipuladores",
      titulo: "Discipuladores",
      alinhamento: "fim",
      celula: (rede) => formatarNumero(discipuladoresPorRede.get(rede.id) ?? 0),
    },
    {
      chave: "celulas",
      titulo: "Células",
      alinhamento: "fim",
      celula: (rede) => formatarNumero(celulasPorRede.get(rede.id) ?? 0),
    },
    {
      chave: "pessoas",
      titulo: "Pessoas",
      alinhamento: "fim",
      celula: (rede) => formatarNumero(pessoasPorRede.get(rede.id) ?? 0),
    },
    {
      chave: "acoes",
      titulo: "Ações",
      celula: (rede) => (
        <BotoesDaLinha
          entidade="rede"
          nome={rede.nome}
          aoEditar={() => aoEditar(rede)}
          aoExcluir={() => aoExcluir(rede)}
        />
      ),
    },
  ];
  return (
    <div className="hierarquia-tabela">
      <DataTable
        colunas={colunas}
        linhas={linhas}
        chaveDaLinha={(rede) => rede.id}
        legenda="Redes"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Peças das linhas
// ---------------------------------------------------------------------------------------------------

/** Quantos itens há por chave (ex.: células por rede). */
function contarPor<T>(
  itens: readonly T[],
  chave: (item: T) => number,
): Map<number, number> {
  const totais = new Map<number, number>();
  for (const item of itens) {
    totais.set(chave(item), (totais.get(chave(item)) ?? 0) + 1);
  }
  return totais;
}

/** Soma de pessoas das células por chave (ex.: por rede). */
function somarPessoasPor(
  celulas: readonly Celula[],
  chave: (celula: Celula) => number,
): Map<number, number> {
  const totais = new Map<number, number>();
  for (const celula of celulas) {
    const id = chave(celula);
    totais.set(id, (totais.get(id) ?? 0) + celula.qtd_pessoas);
  }
  return totais;
}

function EtiquetaDivisao({ divisao }: { divisao: Divisao }) {
  return (
    <Badge tom={divisao === "jovens" ? "info" : "neutro"}>
      {ROTULO_DIVISAO[divisao]}
    </Badge>
  );
}

function Contato({
  email,
  telefone,
}: {
  email: string | null;
  telefone: string | null;
}) {
  if (!email && !telefone) {
    return <span className="hierarquia-suave">Não informado</span>;
  }
  const discagem = telefone ? enderecoTel(telefone) : null;
  return (
    <span className="hierarquia-contato">
      {email && <a href={`mailto:${email}`}>{email}</a>}
      {telefone &&
        (discagem ? (
          <a href={discagem}>{telefone}</a>
        ) : (
          <span>{telefone}</span>
        ))}
    </span>
  );
}

/**
 * `tel:` só com dígitos (e o + do código do país, se vier no começo). Só um número escrito como telefone
 * (dígitos, espaços, parênteses, hífen e ponto), com 8 a 15 dígitos, vira link: dois números no mesmo
 * campo ou "ramal 2" discariam outro número e ficam como texto.
 */
function enderecoTel(telefone: string): string | null {
  const texto = telefone.trim();
  if (!/^\+?[\d\s().-]+$/.test(texto)) return null;
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `tel:${texto.startsWith("+") ? "+" : ""}${digitos}`;
}

function BotoesDaLinha({
  entidade,
  nome,
  aoEditar,
  aoExcluir,
}: {
  entidade: Entidade;
  nome: string;
  aoEditar: () => void;
  aoExcluir: () => void;
}) {
  return (
    <span className="hierarquia-acoes">
      <ComDica texto={DICAS.editar[entidade]}>
        <Button variante="secundario" onClick={aoEditar}>
          Editar <span className="visualmente-oculto">{nome}</span>
        </Button>
      </ComDica>
      <ComDica texto={DICAS.excluir[entidade]}>
        <Button variante="discreto" onClick={aoExcluir}>
          Excluir <span className="visualmente-oculto">{nome}</span>
        </Button>
      </ComDica>
    </span>
  );
}
