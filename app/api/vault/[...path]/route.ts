import { env } from "cloudflare:workers";
import { handleVault, type VaultEnv } from "../../../../server/vault";

export const dynamic = "force-dynamic";
const handle = (request: Request) => handleVault(request, env as unknown as VaultEnv);
export { handle as GET, handle as POST, handle as DELETE };
