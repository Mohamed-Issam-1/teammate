import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/server/auth";
import { createGuardedAuthHandler } from "@/server/auth/http-handler";

const guardedAuthHandler = createGuardedAuthHandler(auth.handler);

export const { GET, POST } = toNextJsHandler(guardedAuthHandler);
