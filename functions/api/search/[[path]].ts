import { siteSearch, type SearchEnv } from "../../../relay/search";
import { d1Limiter } from "../../../relay/trial";

/** Needs the same D1 binding as the trial to count searches; without it site search stays off. */
export const onRequest = ({ request, env }: { request: Request; env: SearchEnv }) =>
  siteSearch(request, env, request.headers.get("cf-connecting-ip") ?? "unknown", env.DB ? d1Limiter(env.DB) : null);
