import { createSignal, onCleanup, Show } from "solid-js";
import Button from "./Button";
import styles from "./CodeEntryForm.module.css";
import Field from "./Field";

/**
 * Seconds the resend button stays disabled after a send.
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
  /** Address the code went to, shown above the input. */
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
 * stays a primitive rather than a piece of the auth flow.
 */
export default function CodeEntryForm(props: CodeEntryFormProps) {
  const [code, setCode] = createSignal("");
  const [cooldown, setCooldown] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  onCleanup(() => clearInterval(timer));

  const handleResend = () => {
    props.onResend();
    setCooldown(RESEND_COOLDOWN_SECONDS);
    clearInterval(timer);
    timer = setInterval(() => {
      setCooldown((remaining) => {
        if (remaining <= 1) clearInterval(timer);
        return Math.max(0, remaining - 1);
      });
    }, 1000);
  };

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    props.onSubmit(code());
  };

  return (
    <form onSubmit={handleSubmit} class={styles.form}>
      <Show when={props.sentTo}>
        {(to) => <p class={styles.sent}>{to()} に確認コードを送信しました。</p>}
      </Show>
      <Field
        id={props.id}
        label="確認コード"
        // Not type="number": that drops leading zeros, shows a spinner, and
        // opens the wrong iOS keyboard. inputMode gets the numeric pad without
        // any of it, and one-time-code lets the OS offer the code directly.
        inputMode="numeric"
        autocomplete="one-time-code"
        maxLength={6}
        value={code()}
        onInput={(e) => setCode(e.currentTarget.value)}
        placeholder="000000"
        required
        disabled={props.submitting}
        error={props.error}
      />
      <Button type="submit" fullWidth disabled={props.submitting}>
        {props.submitting ? "確認中..." : props.submitLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        fullWidth
        onClick={handleResend}
        disabled={cooldown() > 0 || props.submitting}
      >
        <Show
          when={cooldown() > 0}
          fallback="コードを再送する"
        >{`再送できます（${cooldown()}秒）`}</Show>
      </Button>
    </form>
  );
}
