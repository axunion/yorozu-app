/**
 * Email delivery via the Resend REST API.
 *
 * When resendApiKey is not provided (local dev), the passcode is written to
 * the console instead of being sent, so the full auth flow can be exercised
 * without a live Resend account.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "noreply@yorozu-app.example.com";

type Purpose = "signup" | "login" | "email_change" | "invite" | "reactivate";

interface SendVerificationCodeOptions {
  to: string;
  /** The passcode itself. Never store this — only its keyed digest goes to D1. */
  code: string;
  purpose: Purpose;
  /**
   * Where to type the code in. Only invite emails carry one: everyone else
   * asked for their code from the screen that is already waiting for it,
   * whereas an invitee has no open tab and no way to guess the URL.
   */
  loginUrl?: string;
}

interface EmailConfig {
  /** Resend API key. Omit in local dev to log the URL to the console instead. */
  resendApiKey?: string;
  /** Sender address. Defaults to DEFAULT_FROM when not provided. */
  mailFrom?: string;
}

/**
 * Sends a passcode email.
 *
 * In local dev (resendApiKey unset) the code is logged to the console and the
 * function returns without making a network request.
 *
 * Throws on Resend API errors so callers can surface a 500 to the client.
 * The stores record is intentionally NOT rolled back on failure (pending
 * status is kept so the owner can retry via /login).
 */
export async function sendVerificationCodeEmail(
  { to, code, purpose, loginUrl }: SendVerificationCodeOptions,
  { resendApiKey, mailFrom }: EmailConfig,
): Promise<void> {
  // Local-dev fallback: no API key → log the code to console.
  if (!resendApiKey) {
    console.log(
      `[email] Passcode (${purpose}) for ${to}: ${code}${
        loginUrl ? `\n  Enter it at: ${loginUrl}` : ""
      }`,
    );
    return;
  }

  const from = mailFrom || DEFAULT_FROM;
  const { subject, html } = buildEmailContent(purpose, code, loginUrl);

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "yorozu-app/1.0",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
}

/**
 * Subject and HTML body for a passcode email.
 *
 * `loginUrl` is rendered only when supplied (invite). The others deliberately
 * carry no link at all: a URL is what mail-security scanners follow ahead of
 * the recipient, and following one is what used to consume the credential.
 */
export function buildEmailContent(
  purpose: Purpose,
  code: string,
  loginUrl?: string,
): { subject: string; html: string } {
  const codeBlock = `
    <p style="font-size:24px;letter-spacing:0.2em;font-weight:bold">${code}</p>
    <p>このコードは10分間有効で、一度しか使用できません。</p>
  `;
  const where = loginUrl
    ? `<p>以下のページを開き、コードを入力してください。<br>
       <a href="${loginUrl}">${loginUrl}</a></p>`
    : "";
  const ignore = "<p>このメールに心当たりがない場合は無視してください。</p>";

  if (purpose === "reactivate") {
    return {
      subject: "アカウント再開用コード",
      html: `
        <p>オーダーマネージャーの店舗アカウントが一時停止中です。</p>
        <p>管理画面で以下のコードを入力して店舗を再開してください。</p>
        ${codeBlock}
        ${ignore}
      `,
    };
  }
  if (purpose === "invite") {
    return {
      subject: "スタッフ招待のご案内",
      html: `
        <p>オーダーマネージャーの店舗スタッフとして招待されました。</p>
        ${where}
        ${codeBlock}
        ${ignore}
      `,
    };
  }
  if (purpose === "signup") {
    return {
      subject: "メールアドレス確認用コード",
      html: `
        <p>オーダーマネージャーへのお申し込みありがとうございます。</p>
        <p>お申し込み画面で以下のコードを入力し、登録を完了してください。</p>
        ${codeBlock}
        ${ignore}
      `,
    };
  }
  if (purpose === "email_change") {
    return {
      subject: "メールアドレス変更用コード",
      html: `
        <p>オーダーマネージャーの管理画面で、このメールアドレスへの変更が
        リクエストされました。</p>
        <p>管理画面で以下のコードを入力して変更を確定してください。</p>
        ${codeBlock}
        <p>このメールに心当たりがない場合は無視してください。メールアドレスは
        変更されません。</p>
      `,
    };
  }
  return {
    subject: "ログイン用コード",
    html: `
      <p>ログイン画面で以下のコードを入力してください。</p>
      ${codeBlock}
      ${ignore}
    `,
  };
}
