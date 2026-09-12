import { useSearchParams } from "@solidjs/router";
import { Card } from "@yorozu/ui";
import LoginForm from "../components/LoginForm";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  // Invite emails link here with ?email=. Read on this side of the component
  // boundary so LoginForm stays renderable without a Router around it.
  const [searchParams] = useSearchParams();
  const invitedEmail = () => {
    const value = searchParams.email;
    return typeof value === "string" ? value : undefined;
  };

  return (
    <main class={styles.loginPage}>
      <Card class={styles.card}>
        <h1 class={styles.title}>ログイン</h1>
        <p class={styles.subtitle}>
          登録済みのメールアドレスを入力してください。確認コードをお送りします。
        </p>
        <LoginForm initialEmail={invitedEmail()} />
      </Card>
    </main>
  );
}
