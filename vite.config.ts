import { defineConfig } from "vite";

export default defineConfig({
  base: "/claudemotorways/",
  server: {
    port: process.env.CONDUCTOR_PORT
      ? Number(process.env.CONDUCTOR_PORT)
      : 5173,
  },
});
