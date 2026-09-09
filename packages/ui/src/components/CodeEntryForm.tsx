import { createSignal, onCleanup, onMount, Show } from "solid-js";
import Button from "./Button";
import styles from "./CodeEntryForm.module.css";
import Field from "./Field";

/**
 * Seconds the resend button stays inert after a send.
 *
 * Resending is rate-limited server-side, and hitting that limit is silent by
 * design — the response is identical whether or not mail went out, so an
 * attacker cannot use it to find registered addresses. A user who taps resend
 * repeatedly would therefore burn their remaining sends and get no feedback,
 * so the cooldown exists to keep them from reaching that state by accident.
 */
const RESEND_COOLDOWN_SECONDS = 60;

interface CodeEntryFormProps {
  /** Distinguishes the input when more than one of these shares a page. */
  id: string;
  /**
   * Address a code was just sent to, shown above the input. Omit when this
   * screen did not send one — arriving from an invite, say, where the code
   * came with the invitation.
   */
  sentTo?: string;
  /** Label for the confirm button, e.g. "ログイン" or "変更を確定する". */
  submitLabel: string;
  error?: string;
  submitting?: boolean;
  /** Receives the code as typed; normalization and validation are the API's. */
  onSubmit: (code: string) => void;
  onResend: () => void;
}

/**
 * The passcode step shared by admin login, shift login, signup and the email
 * change in settings — the same input, resend affordance and cooldown in all
 * four, which is what earns it a place here rather than in one app.
 *
 * Holds no network logic: submitting and resending are the caller's, so this
 * stays a primitive rather than a piece of the auth flow. It does carry its
 * own Japanese copy, unlike the other primitives — see the Component
 * Ownership Policy in `apps/admin/DESIGN.md` for why.
 */
export default function CodeEntryForm(props: CodeEntryFormProps) {
  const [code, setCode] = createSignal("");
  const [cooldown, setCooldown] = createSignal(0);
  const [resent, setResent] = createSignal(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  let input: HTMLInputElement | undefined;

  // The previous step is replaced wholesale by this one, which would otherwise
  // drop focus to <body> and leave a keyboard or screen-reader user with no
  // idea where they are.
  onMount(() => input?.focus());
  onCleanup(() => clearInterval(timer));

  const coolingDown = () => cooldown() > 0;
  const resendBlocked = () => coolingDown() || Boolean(props.submitting);

  const tick = () => {
    const next = Math.max(0, cooldown() - 1);
    setCooldown(next);
    if (next === 0) clearInterval(timer);
  };

  const handleResend = () => {
    // Guarded rather than `disabled`: a button that disables itself under the
    // pointer takes the focus with it.
    if (resendBlocked()) return;
    props.onResend();
    setResent(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  };

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    props.onSubmit(code());
  };

  return (
    <form onSubmit={handleSubmit} class={styles.form}>
      <Show when={props.sentTo}>
        {(to) => (
          <p class={styles.sent}>{`${to()} に確認コードを送信しました。`}</p>
        )}
      </Show>
      <Field
        ref={input}
        id={props.id}
        label="確認コード"
        // Not type="number": that drops leading zeros, shows a spinner, and
        // opens the wrong iOS keyboard. inputMode gets the numeric pad without
        // any of it, and one-time-code lets the OS offer the code directly.
        inputMode="numeric"
        autocomplete="one-time-code"
        // Deliberately larger than the six digits: the API normalizes away
        // spacing and hyphens, so a pasted "123-456" must survive the input
        // to reach that. Capping at 6 would truncate it to "123-45" and
        // reject a code the user entered correctly.
        maxLength={12}
        value={code()}
        onInput={(e) => setCode(e.currentTarget.value)}
        placeholder="000000"
        required
        disabled={props.submitting}
        error={props.error}
      />
      <Button type="submit" fullWidth disabled={props.submitting}>
        <Show when={props.submitting} fallback={props.submitLabel}>
          確認中...
        </Show>
      </Button>
      {/* Announced once per resend. The countdown below changes every second,
          so it is deliberately not live — it would talk over everything. */}
      <Show when={resent()}>
        <p class={styles.status} role="status">
          確認コードを再送しました。
        </p>
      </Show>
      <Button
        type="button"
        variant="ghost"
        fullWidth
        class={resendBlocked() ? styles.inert : undefined}
        aria-disabled={resendBlocked()}
        onClick={handleResend}
      >
        <Show when={coolingDown()} fallback="コードを再送する">
          {`あと${cooldown()}秒で再送できます`}
        </Show>
      </Button>
    </form>
  );
}
