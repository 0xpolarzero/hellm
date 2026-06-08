import { authFetch } from "../auth/authClient";

/**
 * Extract and validate the ticket from a `/api/auth/sse-ticket` response body.
 * Pure, so the validation (missing / blank / non-string throws) is unit-testable
 * without a network. Trimmed because the ticket rides in a URL query param.
 */
export function parseTicketResponse(body: unknown): string {
  const raw = (body as { ticket?: unknown } | null)?.ticket;
  const ticket = typeof raw === "string" ? raw.trim() : "";
  if (!ticket) {
    throw new Error("WebSocket ticket response did not include a ticket");
  }
  return ticket;
}

/**
 * Issue a one-time WebSocket/SSE auth ticket. Browsers can't set an auth header
 * on an EventSource or WebSocket, so jjhub mints a short-lived ticket the client
 * appends as `?ticket=` when opening the stream. The terminal PTY
 * (`/api/repos/{o}/{r}/workspace/sessions/{id}/terminal`) and the notification
 * SSE both use this. Mirrors jjhub's `Terminal` issueWebSocketTicket, over the
 * same-origin auth proxy (`/api/auth/*` -> AUTH_API_BASE_URL). Throws on a
 * non-2xx response or a missing ticket.
 */
export async function issueWebSocketTicket(signal?: AbortSignal): Promise<string> {
  const response = await authFetch("/api/auth/sse-ticket", { method: "POST", signal });
  if (!response.ok) {
    throw new Error(`WebSocket ticket request failed (${response.status})`);
  }
  const body = await response.json().catch(() => null);
  return parseTicketResponse(body);
}
