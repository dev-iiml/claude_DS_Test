import { writeFileSync } from "node:fs";

import { renderTokensCss } from "../render-css";

writeFileSync("src/app/tokens.css", renderTokensCss());
process.stdout.write("✓ wrote src/app/tokens.css\n");
