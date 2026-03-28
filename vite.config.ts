import { defineConfig } from "vite";

const basePort = process.env.CONDUCTOR_PORT
  ? Number(process.env.CONDUCTOR_PORT)
  : 5173;

export default defineConfig({
  base: "/",
  server: {
    port: basePort,
    proxy: {
      "/api": {
        target: `http://localhost:${basePort + 1}`,
        changeOrigin: true,
      },
    },
  },
});
