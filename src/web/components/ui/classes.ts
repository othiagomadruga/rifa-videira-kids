/** Junta nomes de classe, ignorando os vazios: juntarClasses("a", cond && "b"). */
export function juntarClasses(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}
