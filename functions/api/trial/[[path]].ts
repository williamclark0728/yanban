import { d1Limiter, trial, type TrialEnv } from "../../../relay/trial";

/** Without a D1 binding there is no way to cap usage, so the trial stays off. */
export const onRequest = ({ request, env }: { request: Request; env: TrialEnv }) =>
  trial(request, env, request.headers.get("cf-connecting-ip") ?? "unknown", env.DB ? d1Limiter(env.DB) : null);
