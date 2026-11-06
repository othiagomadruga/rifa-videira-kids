import { EmptyState } from "./ui";

/** Aviso das telas que ainda são só a casca, com a tarefa do backlog que vai construí-las. */
export function EmConstrucao({ tarefa }: { tarefa: string }) {
  return <EmptyState titulo={`Em construção (${tarefa})`} />;
}
