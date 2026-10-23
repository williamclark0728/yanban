// Cloudflare Pages Function: serves /api/relay in production.
import { relay } from "../../relay/handler";

export const onRequest = ({ request }: { request: Request }) => relay(request);
