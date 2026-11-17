import { useId, useState } from "react";
import { Button, Card, ComDica, EmptyState } from "../../components/ui";
import type { CelulaAdesao } from "./adesao-api";
import { linkTelefone } from "./formatos";
import { DICAS } from "./textos";
import { ajuda } from "../ajuda-sob-demanda";

// Células que ainda não têm afiliado: a coordenação chama o líder ali mesmo, na reunião.
export function QuemFalta({ celulas }: { celulas: CelulaAdesao[] }) {
  const faltam = celulas.filter((celula) => !celula.vinculada);
  const idTitulo = useId();
  return (
    <section aria-labelledby={idTitulo}>
      <Card
        titulo={<span id={idTitulo}>Quem falta ({faltam.length})</span>}
        ajuda={ajuda("quemFalta")}
      >
        {faltam.length === 0 ? (
          <EmptyState titulo="Todas as células já têm afiliado." />
        ) : (
          <ul className="adesao-lista">
            {faltam.map((celula) => (
              <li key={celula.celula_id}>
                <ItemQuemFalta celula={celula} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function ItemQuemFalta({ celula }: { celula: CelulaAdesao }) {
  const [copia, setCopia] = useState<"copiado" | "falhou" | null>(null);
  const telefone = celula.lider_telefone;

  async function copiar(numero: string) {
    try {
      // Sem a área de transferência (navegador antigo ou página sem HTTPS), cai no aviso de falha.
      if (!navigator.clipboard)
        throw new Error("Área de transferência indisponível");
      await navigator.clipboard.writeText(numero);
      setCopia("copiado");
    } catch {
      setCopia("falhou");
    }
  }

  return (
    <article className="adesao-item">
      <h3 className="adesao-item__titulo" data-sem-ajuda="nome da célula">
        {celula.celula_nome}
      </h3>
      <p className="adesao-item__detalhe">Líder: {celula.lider_nome}</p>
      {telefone ? (
        <div className="adesao-telefone">
          <ComDica texto={DICAS.ligar}>
            <a
              className="adesao-telefone__numero"
              href={linkTelefone(telefone)}
            >
              {telefone}
            </a>
          </ComDica>
          <ComDica texto={DICAS.copiarTelefone}>
            <Button variante="secundario" onClick={() => void copiar(telefone)}>
              Copiar{" "}
              <span className="visualmente-oculto">
                o telefone de {celula.lider_nome}
              </span>
            </Button>
          </ComDica>
          <span className="adesao-telefone__retorno" role="status">
            {copia === "copiado"
              ? "Telefone copiado."
              : copia === "falhou"
                ? "Não deu para copiar: anote o número."
                : ""}
          </span>
        </div>
      ) : (
        <p className="adesao-item__detalhe">Sem telefone na planilha.</p>
      )}
    </article>
  );
}
