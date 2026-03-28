import express from "express";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const app = express();
const basePort = process.env.CONDUCTOR_PORT
  ? Number(process.env.CONDUCTOR_PORT)
  : 5173;
const port = basePort + 1;

const citiesDir = join(import.meta.dirname, "cities");

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// List all cities (name derived from filename)
app.get("/api/cities", async (_req, res) => {
  try {
    const files = await readdir(citiesDir);
    const cities = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const slug = basename(f, ".json");
        const name = slug
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return { name, file: slug };
      });
    res.json(cities);
  } catch {
    res.json([]);
  }
});

// Get a specific city's data
app.get("/api/cities/:slug", async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-z0-9-]/gi, "");
    const filePath = join(citiesDir, `${slug}.json`);
    const data = await readFile(filePath, "utf-8");
    res.type("json").send(data);
  } catch {
    res.status(404).json({ error: "City not found" });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
