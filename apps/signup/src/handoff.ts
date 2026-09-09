/**
 * Registration and the code screen are separated by a full page navigation,
 * so the address just registered has to survive the trip. sessionStorage
 * rather than the query string: an email address in the URL sticks around in
 * browser history and in anything that later reads `location`.
 *
 * One key, read and written in exactly two places — kept here so the two
 * cannot drift apart silently.
 */
const HANDOFF_KEY = "yorozu:signup-handoff";

export interface SignupHandoff {
  email: string;
  /** Dev-only passcode echoed by the API; never present in production. */
  code?: string;
}

export function writeSignupHandoff(value: SignupHandoff): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The code
    // screen copes by telling the visitor to start again.
  }
}

export function readSignupHandoff(): SignupHandoff | undefined {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SignupHandoff;
    return typeof parsed.email === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
