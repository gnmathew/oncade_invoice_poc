// Placeholder server (work plan task 2.2).
// Proves the container, the port and the tunnel work before any Oncade code is added.
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.get("/", (_req, res) => {
  res
    .type("html")
    .send("<h1>Oncade Invoice POC</h1><p>Hello! The app container is running.</p>");
});

app.listen(port, () => {
  console.log(`App listening on http://localhost:${port}`);
});
