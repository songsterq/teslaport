import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  build: {
    target: "es2019",
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: page("./index.html"),
        receiver: page("./r/index.html"),
        sender: page("./s/index.html"),
        debug: page("./debug/index.html"),
      },
    },
  },
});
