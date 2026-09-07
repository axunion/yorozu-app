import { Card } from "@yorozu/ui";
import LoginForm from "../components/LoginForm";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  return (
    <main class={styles.loginPage}>
      <Card class={styles.card}>
        <h1 class={styles.title}>シフト管理</h1>
        <p class={styles.subtitle}>
          登録済みのメールアドレスを入力してください。ログインリンクをお送りします。
        </p>
        <LoginForm />
      </Card>
    </main>
  );
}
