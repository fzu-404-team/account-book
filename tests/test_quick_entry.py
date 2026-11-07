from datetime import date
import unittest

from ledger.models import CATEGORIES
from ledger.quick_entry import EXPENSE_KEYWORDS, INCOME_KEYWORDS, MAX_TEXT_LENGTH, parse_text

# 固定“今天”为 2026-11-07（星期六），保证相对日期的结果可复现。
TODAY = date(2026, 11, 7)


def parse(text):
    return parse_text(text, TODAY)


class QuickEntryTests(unittest.TestCase):
    def assertDraft(self, text, kind, amount_cents, record_date, category, note):
        result = parse(text)
        self.assertEqual(
            (result["kind"], result["amount_cents"], result["date"], result["category"], result["note"]),
            (kind, amount_cents, record_date, category, note),
        )
        return result

    def test_basic_expense_with_relative_date(self):
        result = self.assertDraft("昨天午饭 15", "expense", 1500, "2026-11-06", "餐饮", "午饭")
        self.assertEqual(result["warnings"], [])
        self.assertIn({"type": "date", "text": "昨天", "value": "11 月 6 日"}, result["tokens"])
        self.assertIn({"type": "amount", "text": "15", "value": "¥15.00"}, result["tokens"])

    def test_income_detection(self):
        self.assertDraft("收到工资 5000", "income", 500000, "2026-11-07", "工资", "收到工资")
        self.assertDraft("+200 家教", "income", 20000, "2026-11-07", "兼职", "家教")
        self.assertDraft("奖学金到账 3000", "income", 300000, "2026-11-07", "奖金", "奖学金到账")
        # “发红包”是支出，不能因为包含“红包”被判成收入。
        self.assertEqual(parse("发红包 50")["kind"], "expense")

    def test_dates_and_times_are_not_taken_as_amount(self):
        self.assertDraft("11月5日 打车 23.5元", "expense", 2350, "2026-11-05", "交通", "打车")
        self.assertDraft("12:30 奶茶 18", "expense", 1800, "2026-11-07", "餐饮", "奶茶")
        self.assertDraft("下午3点 打车 15", "expense", 1500, "2026-11-07", "交通", "打车")
        self.assertDraft("2026-11-01 房租 1200", "expense", 120000, "2026-11-01", "居住", "房租")
        self.assertDraft("3天前 买书 46.8", "expense", 4680, "2026-11-04", "学习", "买书")

    def test_week_dates(self):
        self.assertEqual(parse("周五 电影 45")["date"], "2026-11-06")
        self.assertEqual(parse("上周五 电影 45")["date"], "2026-10-30")
        self.assertEqual(parse("周日 聚餐 80")["date"], "2026-11-01")

    def test_amount_rules(self):
        self.assertDraft("3杯奶茶 54 和室友", "expense", 5400, "2026-11-07", "餐饮", "3杯奶茶 和室友")
        self.assertEqual(parse("午饭15块5")["amount_cents"], 1550)
        self.assertEqual(parse("今天 吃饭花了 22")["note"], "吃饭")
        # 多个数字时优先带单位的那个，并提醒用户确认。
        result = parse("2个面包 8元 牛奶 5")
        self.assertEqual(result["amount_cents"], 800)
        self.assertTrue(any("多个数字" in warning for warning in result["warnings"]))
        # 金额精度沿用 parse_amount：0.1 + 0.2 不会产生浮点误差。
        self.assertEqual(parse("零食 0.1")["amount_cents"] + parse("零食 0.2")["amount_cents"], 30)

    def test_full_width_input(self):
        self.assertDraft("昨天　午饭　１５元", "expense", 1500, "2026-11-06", "餐饮", "午饭")

    def test_fallback_category_has_warning(self):
        result = self.assertDraft("理发 30", "expense", 3000, "2026-11-07", "其他支出", "理发")
        self.assertTrue(any("其他支出" in warning for warning in result["warnings"]))

    def test_future_date_warning(self):
        result = parse("11月20日 房租 1200")
        self.assertEqual(result["date"], "2026-11-20")
        self.assertIn("日期晚于今天，请确认", result["warnings"])

    def test_invalid_inputs(self):
        cases = {
            "": "请输入要识别的一句话",
            "   ": "请输入要识别的一句话",
            "买了本书": "没有识别到金额",
            "2月30日 午饭 15": "不存在",
            "午饭 0": "金额必须大于 0",
            "午饭 1.234": "最多保留两位小数",
            "午饭" + "很" * MAX_TEXT_LENGTH + " 15": "最多",
        }
        for text, message in cases.items():
            with self.subTest(text=text), self.assertRaises(ValueError) as context:
                parse(text)
            self.assertIn(message, str(context.exception))
        with self.assertRaises(ValueError):
            parse_text(None, TODAY)

    def test_keyword_categories_match_ledger_categories(self):
        # 关键词表里的类别必须是账本允许的类别，否则预填后保存会失败。
        self.assertLessEqual(set(EXPENSE_KEYWORDS), set(CATEGORIES["expense"]))
        self.assertLessEqual(set(INCOME_KEYWORDS), set(CATEGORIES["income"]))
        for text in ["昨天午饭 15", "收到工资 5000", "理发 30", "红包 88"]:
            result = parse(text)
            self.assertIn(result["category"], CATEGORIES[result["kind"]])


if __name__ == "__main__":
    unittest.main()
