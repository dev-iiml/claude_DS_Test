import { writeFileSync } from "node:fs";

import { renderDesignSystemTokens } from "../render-json";

writeFileSync("design-system/tokens.json", `${JSON.stringify(renderDesignSystemTokens(), null, 2)}\n`);
process.stdout.write("✓ wrote design-system/tokens.json\n");
