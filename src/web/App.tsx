import type { DataRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

type Props = {
  // createBrowserRouter(rotas) no main.tsx; createMemoryRouter(rotas) nos testes
  // (veja test/renderizar.tsx).
  roteador: DataRouter;
};

export function App({ roteador }: Props) {
  return <RouterProvider router={roteador} />;
}
