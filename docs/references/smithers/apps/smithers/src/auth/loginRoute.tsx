import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../app/rootRoute";
import { LoginPage } from "./LoginPage";

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});
