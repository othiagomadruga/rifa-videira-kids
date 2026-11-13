import type { ComponentProps } from "react";
import { juntarClasses } from "./classes";
import "./Button.css";

/**
 * `perigo-discreto` (RIFA-049): ação destrutiva leve (ex.: "Excluir" numa linha), texto vermelho sem fundo; o `perigo`
 * cheio fica para a confirmação.
 */
export type VarianteBotao =
  "primario" | "secundario" | "discreto" | "perigo" | "perigo-discreto";
export type TamanhoBotao = "normal" | "pequeno";

type OpcoesBotao = {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  /** Ocupa a largura toda (útil em formulários no celular). */
  larguraTotal?: boolean;
};

/** Classes do botão, para dar cara de botão a um link: <Link className={classesBotao()}>. */
export function classesBotao(
  {
    variante = "primario",
    tamanho = "normal",
    larguraTotal = false,
  }: OpcoesBotao = {},
  extra?: string,
): string {
  return juntarClasses(
    "ui-button",
    `ui-button--${variante}`,
    tamanho === "pequeno" && "ui-button--pequeno",
    larguraTotal && "ui-button--largura-total",
    extra,
  );
}

type Props = ComponentProps<"button"> & OpcoesBotao;

// Botão com variantes. O type padrão é "button" (não envia formulário sem querer).
export function Button({
  variante,
  tamanho,
  larguraTotal,
  className,
  type = "button",
  ...resto
}: Props) {
  return (
    <button
      type={type}
      className={classesBotao({ variante, tamanho, larguraTotal }, className)}
      {...resto}
    />
  );
}
