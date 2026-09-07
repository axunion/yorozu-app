/**
 * Email delivery via the Resend REST API.
 *
 * When resendApiKey is not provided (local dev), the Magic Link URL is written
 * to the console instead of being sent, so the full auth flow can be tested
 * without a live Resend account.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "noreply@yorozu-app.example.com";

interface SendMagicLinkOptions {
  to: string;
  magicLinkUrl: string;
  purpose: "signup" | "login" | "email_change" | "invite" | "reactivate";
}

interface EmailConfig {
  /** Resend API key. Omit in local dev to log the URL to the console instead. */
  resendApiKey?: string;
  /** Sender address. Defaults to DEFAULT_FROM when not provided. */
  mailFrom?: string;
}

/**
 * Sends a Magic Link email to the store owner.
 *
 * In local dev (resendApiKey unset) the URL is logged to the console
 * and the function returns without making a network request.
 *
 * Throws on Resend API errors so callers can surface a 500 to the client.
 * The stores record is intentionally NOT rolled back on failure (pending
 * status is kept so the owner can retry via /login).
 */
export async function sendMagicLinkEmail(
  { to, magicLinkUrl, purpose }: SendMagicLinkOptions,
  { resendApiKey, mailFrom }: EmailConfig,
): Promise<void> {
  // Local-dev fallback: no API key → log URL to console.
  if (!resendApiKey) {
    console.log(
      `[email] Magic Link (${purpose}) for ${to} — open in browser:\n  ${magicLinkUrl}`,
    );
    return;
  }

  const from = mailFrom || DEFAULT_FROM;
  const { subject, html } = buildEmailContent(purpose, magicLinkUrl);

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

export function buildEmailContent(
  purpose: "signup" | "login" | "email_change" | "invite" | "reactivate",
  magicLinkUrl: string,
): { subject: string; html: string } {
  if (purpose === "reactivate") {
    return {
      subject: "アカウントの再開",
      html: `
        <p>オーダーマネージャーの店舗アカウントが一時停止中です。</p>
        <p>以下のリンクをクリックして店舗を再開してください。<br>
        このリンクは15分間有効で、一度しか使用できません。</p>
        <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
        <p>このメールに心当たりがない場合は無視してください。</p>
      `,
    };
  }
  if (purpose === "invite") {
    return {
      subject: "スタッフ招待のご案内",
      html: `
        <p>オーダーマネージャーの店舗スタッフとして招待されました。</p>
        <p>以下のリンクをクリックしてメールアドレスを確認し、管理画面へ進んでください。<br>
        このリンクは15分間有効です。</p>
        <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
        <p>このメールに心当たりがない場合は無視してください。</p>
      `,
    };
  }
  if (purpose === "signup") {
    return {
      subject: "メールアドレスを確認してください",
      html: `
        <p>オーダーマネージャーへのお申し込みありがとうございます。</p>
        <p>以下のリンクをクリックしてメールアドレスを確認し、管理画面へ進んでください。<br>
        このリンクは15分間有効です。</p>
        <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
        <p>このメールに心当たりがない場合は無視してください。</p>
      `,
    };
  }
  if (purpose === "email_change") {
    return {
      subject: "メールアドレス変更の確認",
      html: `
        <p>オーダーマネージャーの管理画面で、このメールアドレスへの変更が
        リクエストされました。</p>
        <p>以下のリンクをクリックして変更を確定してください。<br>
        このリンクは15分間有効で、一度しか使用できません。</p>
        <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
        <p>このメールに心当たりがない場合は無視してください。メールアドレスは
        変更されません。</p>
      `,
    };
  }
  return {
    subject: "ログインリンク",
    html: `
      <p>以下のリンクをクリックして管理画面にログインしてください。<br>
      このリンクは15分間有効で、一度しか使用できません。</p>
      <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
      <p>このメールに心当たりがない場合は無視してください。</p>
    `,
  };
}
