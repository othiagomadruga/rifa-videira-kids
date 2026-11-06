import "./Estados.css";

type Props = {
  texto?: string;
};

// Carregando: anunciado aos leitores de tela (role="status"). O indicador para
// de girar com prefers-reduced-motion.
export function Loading({ texto = "Carregando…" }: Props) {
  return (
    <p className="ui-loading" role="status">
      <span className="ui-loading__indicador" aria-hidden="true" />
      {texto}
    </p>
  );
}
