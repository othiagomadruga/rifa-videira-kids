import { useState } from "react";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComAjuda,
  ComDica,
  DataTable,
  Loading,
  type ColunaTabela,
} from "../../components/ui";
import { numeroDoWhatsApp } from "../../components/qr/compartilhar";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import {
  gerarConvitesNaRifei,
  lerAfiliadosDaRifei,
  mensagemDoConvite,
  sincronizarAfiliadosDaRifei,
  telefoneParaWhatsApp,
  type RespostaAfiliadosRifei,
  type RespostaConvitesRifei,
} from "./afiliados-rifei-api";
import { ajuda } from "../ajuda-sob-demanda";

type Afiliado = RespostaAfiliadosRifei["afiliados"][number];
type Convite = RespostaConvitesRifei["convites"][number];

type Estado =
  | { tipo: "parado" }
  | { tipo: "carregando"; texto: string }
  | { tipo: "ok"; dados: RespostaAfiliadosRifei }
  | { tipo: "erro"; mensagem: string };

const TEXTOS = {
  titulo: "Afiliados na Rifei (automático)",
  explicacao:
    "O sistema lê os afiliados da conta na Rifei, liga cada um à célula pelo e-mail do líder e gera os convites das células que ainda não têm afiliado. Só o admin vê.",
  ler: "Ler os afiliados da Rifei",
  dicaLer: "Busca na Rifei quem já é afiliado. Não muda nada.",
  sincronizar: "Sincronizar com a Rifei",
  dicaSincronizar:
    "Grava o código de cada afiliado (o do link de vendas) e liga à célula quem tem o e-mail do líder. Nunca troca um vínculo que já existe.",
  gerarTodos: (n: number) =>
    `Gerar ${n === 1 ? "o convite" : `os ${n} convites`} das células sem afiliado`,
  dicaGerar:
    "Cria na Rifei um convite por célula. Cada convite vale 1 dia e só pode ser usado uma vez: gere no dia de mandar.",
  semConfiguracao:
    "A integração com a Rifei ainda não está ligada no servidor (falta o token da Rifei). Até lá, use o painel da Rifei: Afiliados → Convidar.",
} as const;

function mensagemDaFalha(erro: unknown): string {
  return erro instanceof ErroApi && erro.codigo === "nao_configurado"
    ? TEXTOS.semConfiguracao
    : mensagemDoErro(erro);
}

const COLUNAS_AFILIADOS: ColunaTabela<Afiliado>[] = [
  {
    chave: "nome",
    titulo: "Afiliado",
    principal: true,
    celula: ({ nome, email }) => (
      <span className="adesao-rifei__pessoa">
        <span>{nome ?? "Sem nome"}</span>
        {email && <span className="adesao-rifei__suave">{email}</span>}
      </span>
    ),
  },
  {
    chave: "codigo",
    titulo: "Código",
    celula: ({ codigo }) => codigo ?? "—",
  },
  {
    chave: "celula",
    titulo: "Célula",
    celula: ({ celula, sugestao }) =>
      celula ? (
        celula.celula_nome
      ) : sugestao ? (
        <span className="adesao-rifei__pessoa">
          <Badge tom="alerta">Pelo e-mail</Badge>
          <span>{sugestao.celula_nome}</span>
        </span>
      ) : (
        <Badge tom="neutro">Sem célula</Badge>
      ),
  },
];

function ConviteGerado({ convite }: { convite: Convite }) {
  const [copiado, setCopiado] = useState(false);
  const telefone = numeroDoWhatsApp(
    telefoneParaWhatsApp(convite.lider_telefone),
  );
  const whatsapp = `https://wa.me/${telefone}?text=${encodeURIComponent(
    mensagemDoConvite(convite.lider_nome, convite.celula_nome, convite.link),
  )}`;
  return (
    <li className="adesao-rifei__convite">
      <strong>{convite.celula_nome}</strong>
      <span className="adesao-rifei__suave">{convite.lider_nome}</span>
      <span className="adesao-rifei__link">{convite.link}</span>
      <span className="adesao-rifei__acoes">
        <ComDica texto="Copia o link do convite para mandar ao líder.">
          <Button
            variante="secundario"
            tamanho="pequeno"
            onClick={() => {
              void navigator.clipboard?.writeText(convite.link).then(
                () => setCopiado(true),
                () => setCopiado(false),
              );
            }}
          >
            {copiado ? "Copiado" : "Copiar convite"}
          </Button>
        </ComDica>
        <ComDica texto="Abre o WhatsApp com a mensagem e o convite prontos (no número do líder, se o cadastro tiver).">
          <a
            className="ui-button ui-button--secundario ui-button--pequeno"
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            Enviar no WhatsApp
          </a>
        </ComDica>
      </span>
    </li>
  );
}

// Afiliados da Rifei na Adesão (RIFA-070, D32), só o admin. Nada é lido sozinho (cada botão chama a Rifei uma vez):
// a tela da reunião continua atualizando pelo sistema, e a Rifei não é chamada a cada 15 s.
export function AfiliadosDaRifei({ aoMudar }: { aoMudar: () => void }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "parado" });
  const [convites, setConvites] = useState<RespostaConvitesRifei | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroConvites, setErroConvites] = useState<string | null>(null);
  const ocupado = estado.tipo === "carregando" || gerando;

  async function carregar(sincronizar: boolean) {
    if (ocupado) return;
    setEstado({
      tipo: "carregando",
      texto: sincronizar
        ? "Sincronizando com a Rifei…"
        : "Lendo os afiliados da Rifei…",
    });
    try {
      const dados = sincronizar
        ? await sincronizarAfiliadosDaRifei()
        : await lerAfiliadosDaRifei();
      setEstado({ tipo: "ok", dados });
      if (sincronizar) aoMudar();
    } catch (erro) {
      setEstado({ tipo: "erro", mensagem: mensagemDaFalha(erro) });
    }
  }

  async function gerar(celulas: number[]) {
    if (ocupado || celulas.length === 0) return;
    setGerando(true);
    setErroConvites(null);
    try {
      const resposta = await gerarConvitesNaRifei(celulas);
      setConvites(resposta);
    } catch (erro) {
      setErroConvites(mensagemDaFalha(erro));
    } finally {
      setGerando(false);
    }
  }

  const dados = estado.tipo === "ok" ? estado.dados : null;
  const semAfiliado = dados?.celulas_sem_afiliado ?? [];
  const sugeridos =
    dados?.afiliados.filter((a) => a.sugestao !== null).length ?? 0;

  return (
    <Card titulo={TEXTOS.titulo} ajuda={ajuda("afiliadosNaRifei")}>
      <div className="adesao-rifei">
        <p className="adesao-rifei__suave">{TEXTOS.explicacao}</p>
        <div className="adesao-rifei__acoes">
          <ComDica texto={TEXTOS.dicaLer}>
            <Button
              variante="secundario"
              aria-disabled={ocupado || undefined}
              onClick={() => void carregar(false)}
            >
              {TEXTOS.ler}
            </Button>
          </ComDica>
          <ComDica texto={TEXTOS.dicaSincronizar}>
            <Button
              aria-disabled={ocupado || undefined}
              onClick={() => void carregar(true)}
            >
              {TEXTOS.sincronizar}
            </Button>
          </ComDica>
        </div>

        {estado.tipo === "carregando" && <Loading texto={estado.texto} />}
        {estado.tipo === "erro" && (
          <Aviso tom="perigo" anuncio="nenhum">
            <p>{estado.mensagem}</p>
          </Aviso>
        )}

        {dados && (
          <>
            {dados.sincronizacao && (
              <Aviso tom="sucesso" anuncio="status">
                <p>
                  Sincronizado: {dados.sincronizacao.vinculados}{" "}
                  {dados.sincronizacao.vinculados === 1
                    ? "afiliado ligado"
                    : "afiliados ligados"}{" "}
                  à célula pelo e-mail do líder e{" "}
                  {dados.sincronizacao.codigos_gravados}{" "}
                  {dados.sincronizacao.codigos_gravados === 1
                    ? "código gravado"
                    : "códigos gravados"}
                  .
                </p>
              </Aviso>
            )}
            {sugeridos > 0 && !dados.sincronizacao && (
              <Aviso tom="info" anuncio="nenhum">
                <p>
                  {sugeridos === 1
                    ? "1 afiliado tem o e-mail de um líder"
                    : `${sugeridos} afiliados têm o e-mail de um líder`}
                  : clique em Sincronizar para ligar à célula.
                </p>
              </Aviso>
            )}
            {dados.afiliados.length === 0 ? (
              <p className="adesao-rifei__suave">
                Nenhum afiliado na conta da Rifei ainda.
              </p>
            ) : (
              <DataTable
                colunas={COLUNAS_AFILIADOS}
                linhas={dados.afiliados}
                chaveDaLinha={(afiliado) => String(afiliado.affiliate_id)}
                legenda="Afiliados na Rifei"
              />
            )}

            <ComAjuda
              texto={ajuda("convites")}
              idDoTitulo="adesao-rifei-convites"
            >
              <h3
                id="adesao-rifei-convites"
                className="adesao-rifei__subtitulo"
              >
                Convites das células sem afiliado
              </h3>
            </ComAjuda>
            {semAfiliado.length === 0 ? (
              <p className="adesao-rifei__suave">
                Todas as células já têm afiliado.
              </p>
            ) : (
              <>
                <p className="adesao-rifei__suave">
                  {semAfiliado.map((celula) => celula.celula_nome).join(", ")}.
                  Depois que o líder criar a conta pelo convite, clique em
                  Sincronizar (com o e-mail dele no cadastro da célula, a
                  ligação é automática).
                </p>
                <ComDica texto={TEXTOS.dicaGerar}>
                  <Button
                    aria-disabled={ocupado || undefined}
                    onClick={() =>
                      void gerar(semAfiliado.map((celula) => celula.celula_id))
                    }
                  >
                    {gerando
                      ? "Gerando os convites…"
                      : TEXTOS.gerarTodos(semAfiliado.length)}
                  </Button>
                </ComDica>
              </>
            )}
          </>
        )}

        {erroConvites && (
          <Aviso tom="perigo" anuncio="nenhum">
            <p>{erroConvites}</p>
          </Aviso>
        )}
        {convites && (
          <>
            {convites.convites.length > 0 && (
              <ul className="adesao-rifei__convites">
                {convites.convites.map((convite) => (
                  <ConviteGerado key={convite.celula_id} convite={convite} />
                ))}
              </ul>
            )}
            {convites.falhas.length > 0 && (
              <Aviso tom="alerta" anuncio="nenhum">
                <p>
                  {convites.falhas.length === 1
                    ? "1 convite não foi gerado:"
                    : `${convites.falhas.length} convites não foram gerados:`}{" "}
                  {convites.falhas[0].mensagem}
                </p>
              </Aviso>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
