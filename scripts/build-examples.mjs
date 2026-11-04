 
import { createJiti } from "jiti";
import path from "node:path";

const root = process.cwd();
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src"), "server-only": path.join(root, "tests/server-only-stub.ts") } });
const { main } = await jiti.import("./build-examples.ts");
process.exit(await main(process.argv.slice(2)));
