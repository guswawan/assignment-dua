import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { prdRouter } from "./modules/prd/router.js";

const app = new Hono().route("/prd", prdRouter);

serve(
  {
    fetch: app.fetch,
    port: 8000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
