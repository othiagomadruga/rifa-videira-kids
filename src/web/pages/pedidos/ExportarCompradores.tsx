import { useEffect, useId, useRef, useState } from "react";
import { Aviso, Button, ComDica, Icone } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { baixarCompradores } from "./pedidos-api";
import { DICAS } from "./textos";

type Resultado =
  | { tipo: "nada" }
  | { tipo: "baixado"; nome: string }
  | { tipo: "erro"; erro: unknown };

// "Exportar compradores (Excel)" (RIFA-076, D36), SÓ ADMIN, no topo da aba Pedidos: baixa a planilha com uma linha por
// comprador (nome, telefone, células, pedidos, bilhetes, total pago, primeira e última compra e situação), para
// agradecer a compra e para as campanhas da igreja. A trilha registra quem baixou (sem os dados). Um download por vez.
export function ExportarCompradores() {
  const id = useId();
  const [soPagou, setSoPagou] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [resultado, setResultado] = useState<Resultado>({ tipo: "nada" });
  const [anuncio, setAnuncio] = useState("");
  const emAndamento = useRef(false);
  const saida = useRef<AbortController | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    saida.current = controle;
    return () => controle.abort();
  }, []);

  async function baixar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    const sinal = saida.current?.signal;
    setBaixando(true);
    setResultado({ tipo: "nada" });
    setAnuncio("Baixando a planilha de compradores…");
    try {
      const nome = await baixarCompradores(soPagou, { signal: sinal });
      if (sinal?.aborted) return;
      setResultado({ tipo: "baixado", nome });
      setAnuncio(`Planilha baixada: ${nome}.`);
    } catch (erro) {
      if (sinal?.aborted) return;
      if (erro instanceof ErroApi && erro.status === 401) {
        setAnuncio("");
        return;
      }
      setResultado({ tipo: "erro", erro });
      setAnuncio(`Não foi possível baixar a planilha. ${mensagemDoErro(erro)}`);
    } finally {
      emAndamento.current = false;
      if (!sinal?.aborted) setBaixando(false);
    }
  }

  return (
    <section className="pedidos-exportar" aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`} className="pedidos-exportar__titulo">
        Compradores
      </h2>
      <p className="pedidos-exportar__intro">
        Planilha com o nome e o telefone de quem reservou ou comprou, um por
        linha, para agradecer e para as próximas campanhas. Só o admin vê.
      </p>
      <div className="pedidos-exportar__acoes">
        <span className="pedidos-exportar__opcao">
          <ComDica texto={DICAS.soQuemPagou}>
            <input
              id={`${id}-so-pagou`}
              type="checkbox"
              checked={soPagou}
              onChange={(evento) => setSoPagou(evento.target.checked)}
            />
          </ComDica>
          <label htmlFor={`${id}-so-pagou`}>Só quem pagou</label>
        </span>
        <ComDica texto={DICAS.exportarCompradores}>
          <Button
            variante="secundario"
            onClick={() => void baixar()}
            aria-disabled={baixando || undefined}
          >
            <Icone nome="baixar" />
            {baixando ? "Baixando…" : "Exportar compradores (Excel)"}
          </Button>
        </ComDica>
      </div>
      {resultado.tipo === "baixado" && (
        <p className="pedidos-exportar__baixado">
          <Icone nome="check" /> Baixado: {resultado.nome}. Fica na pasta de
          downloads do aparelho.
        </p>
      )}
      {resultado.tipo === "erro" && (
        <Aviso
          tom="perigo"
          anuncio="nenhum"
          titulo="Não foi possível baixar a planilha"
        >
          {mensagemDoErro(resultado.erro)}
        </Aviso>
      )}
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
    </section>
  );
}
