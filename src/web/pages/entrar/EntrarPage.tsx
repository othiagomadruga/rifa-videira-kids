import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { Aviso, Card, Loading, PageHeader } from "../../components/ui";
import {
  destinoDoPapel,
  esquecerDestino,
  lerEstadoEntrar,
  useSessao,
} from "../../lib/sessao";
import { IconeDaTela } from "./IconeDaTela";
import "./entrar.css";

// Como entrar (sem sessão): o acesso é pelo link pessoal que chega no WhatsApp, sem senha. Quem já tem
// sessão vai direto para a área do papel (/coordenacao ou /minha), ou para a tela que tinha pedido, quando
// veio da guarda e a tela é da área dele.
export function EntrarPage() {
  const { estado, verificar } = useSessao();
  const navigate = useNavigate();
  const { de, motivo } = lerEstadoEntrar(useLocation().state);
  const { situacao } = estado;
  const papel = estado.situacao === "conectada" ? estado.usuario.papel : null;

  useEffect(() => {
    if (situacao === "desconhecida") verificar();
  }, [situacao, verificar]);

  useEffect(() => {
    if (papel === null) return;
    esquecerDestino();
    void navigate(destinoDoPapel(de, papel), { replace: true });
  }, [papel, de, navigate]);

  const conferindo =
    situacao === "desconhecida" ||
    situacao === "verificando" ||
    situacao === "conectada";

  return (
    <>
      <PageHeader
        titulo="Entrar"
        descricao="Coordenação, líderes, discipuladores e redes da Rifa Videira Kids."
      />
      {conferindo ? (
        <Loading texto="Conferindo o seu acesso…" />
      ) : (
        <>
          {motivo === "saiu" && (
            <Aviso tom="sucesso" titulo="Você saiu do sistema neste aparelho.">
              <p>Para entrar de novo, abra o seu link pessoal.</p>
            </Aviso>
          )}
          {motivo === "expirou" && (
            <Aviso tom="info" titulo="Sua sessão terminou.">
              <p>Para continuar, entre de novo pelo seu link pessoal.</p>
            </Aviso>
          )}
          <Card>
            <div className="entrar-explicacao">
              {/* O ícone do link no topo do cartão (RIFA-050), acima do título. */}
              <IconeDaTela nome="link" />
              <h2 className="entrar-titulo">Como entrar</h2>
              <p>
                O acesso é pelo seu <strong>link pessoal</strong>, sem senha. O
                link chega pelo <strong>WhatsApp</strong>, mandado pela
                coordenação.
              </p>
              <ol className="entrar-passos">
                <li>Abra a conversa do WhatsApp em que você recebeu o link.</li>
                <li>
                  Toque no link e, na página que abrir, toque em{" "}
                  <strong>Entrar</strong>.
                </li>
              </ol>
              {de && (
                <p>Depois de entrar, você volta para a tela em que estava.</p>
              )}
              <p>
                Não achou o link ou ele não funciona mais? Peça um link novo à
                coordenação.
              </p>
              <p className="entrar-nota">
                O link é só seu: não repasse. Quem tiver o link entra como você.
              </p>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
