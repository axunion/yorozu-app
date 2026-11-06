/**
 * Japanese messages for Zod's built-in checks. The API returns validation
 * messages to the SPAs as-is, so they must read as display text — e.g.
 * 「店舗名を入力してください。」 rather than Zod's default
 * "Too small: expected string to have >=1 characters".
 *
 * Installed globally by importing this module (types/primitives.ts does), so
 * every schema in this package and every route validating with it gets the
 * same wording. Refinements with their own `message` keep it.
 */
import { z } from "zod";

/** Field names as a person reads them; the last named path segment wins. */
const FIELD_LABEL: Record<string, string> = {
  name: "名前",
  email: "メールアドレス",
  new_email: "新しいメールアドレス",
  code: "確認コード",
  display_name: "表示名",
  role: "権限",
  price: "価格",
  price_delta: "追加料金",
  description: "説明",
  category_id: "カテゴリ",
  sort_order: "表示順",
  is_available: "販売状態",
  option_group_ids: "オプショングループ",
  option_ids: "オプション",
  min_select: "最小選択数",
  max_select: "最大選択数",
  items: "商品",
  menu_item_id: "商品",
  quantity: "数量",
  note: "メモ",
  order_id: "注文",
  method: "支払い方法",
  discount_amount: "値引き額",
  discount_reason: "値引きの理由",
  void_reason: "取り消しの理由",
  confirm_name: "確認用の店舗名",
  start_date: "開始日",
  end_date: "終了日",
  work_date: "日付",
  submission_deadline: "提出締切",
  start_minutes: "開始時刻",
  end_minutes: "終了時刻",
  break_minutes: "休憩時間",
  weekday: "曜日",
  required_headcount: "必要人数",
  hourly_wage: "時給",
  weekly_cap_minutes: "週の上限時間",
  is_minor: "18歳未満",
  member_id: "スタッフ",
  position_id: "ポジション",
  position_ids: "ポジション",
  period_id: "期間",
  entries: "希望",
  kind: "種類",
};

function labelOf(path: PropertyKey[] | undefined): string {
  const key = [...(path ?? [])]
    .reverse()
    .find((segment): segment is string => typeof segment === "string");
  return (key && FIELD_LABEL[key]) ?? "入力値";
}

z.config({
  customError: (issue) => {
    // No path: the body itself is missing or not an object.
    if ((issue.path?.length ?? 0) === 0 && issue.code === "invalid_type") {
      return "リクエストの内容が正しくありません。";
    }
    const label = labelOf(issue.path);
    switch (issue.code) {
      case "too_small": {
        const min = Number(issue.minimum);
        if (issue.origin === "string") {
          return min <= 1
            ? `${label}を入力してください。`
            : `${label}は${min}文字以上で入力してください。`;
        }
        if (issue.origin === "array") {
          return `${label}を${min}件以上指定してください。`;
        }
        return issue.inclusive
          ? `${label}は${min}以上にしてください。`
          : `${label}は${min}より大きくしてください。`;
      }
      case "too_big": {
        const max = Number(issue.maximum);
        if (issue.origin === "string") {
          return `${label}は${max}文字以内で入力してください。`;
        }
        if (issue.origin === "array") {
          return `${label}は${max}件までです。`;
        }
        return issue.inclusive
          ? `${label}は${max}以下にしてください。`
          : `${label}は${max}より小さくしてください。`;
      }
      case "invalid_type":
        if (issue.input === undefined || issue.input === null) {
          return `${label}を入力してください。`;
        }
        return issue.expected === "int"
          ? `${label}は整数で入力してください。`
          : `${label}の形式が正しくありません。`;
      case "invalid_format":
        return `${label}の形式が正しくありません。`;
      case "invalid_value":
        return `${label}の値が正しくありません。`;
      case "custom":
        // A refinement's own message wins; this is only its fallback.
        return `${label}が正しくありません。`;
      default:
        return "入力内容が正しくありません。";
    }
  },
});
