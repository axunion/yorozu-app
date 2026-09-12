import { Card } from "@yorozu/ui";
import RegisterForm from "../components/RegisterForm";
import styles from "./RegisterPage.module.css";

export default function RegisterPage() {
  return (
    <main class={styles.page}>
      <Card class={styles.card}>
        <h1 class={styles.heading}>店舗登録</h1>
        <p class={styles.subtitle}>
          店舗名とメールアドレスを入力してください。届いた確認コードを次の画面で入力すると登録が完了します。
        </p>
        <RegisterForm />
      </Card>
    </main>
  );
}
