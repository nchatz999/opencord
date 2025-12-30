import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')

  return {
    plugins: [tailwindcss(), solid()],
    envDir: '../',
    server: {
      allowedHosts: [env.VITE_DOMAIN, "localhost"],
    },
  }
});
