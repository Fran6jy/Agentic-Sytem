import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");
const port = Number(process.env.PORT || 8787);

app.use(express.static(distPath));

// A missing build asset must 404, not fall through to index.html (HTML served as JS breaks the page).
app.get(/^\/(assets|icons)\//, (_request, response) => {
  response.status(404).end();
});

app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Chalk Lab listening on http://127.0.0.1:${port}`);
});
