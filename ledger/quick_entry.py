"""一句话记账：把“昨天午饭 15”这类短句解析成待确认的记账草稿。

只做解析，不写入账本；结果交给前端预填“记一笔”对话框，由用户确认后再走正常的保存接口。
解析完全基于本地规则，不依赖网络或第三方服务。
"""

from datetime import date, timedelta
import re

from .models import CATEGORIES, parse_amount

MAX_TEXT_LENGTH = 100

# 全角数字和常用符号转半角，方便统一用正则匹配。
_HALF_WIDTH = str.maketrans("０１２３４５６７８９．：－／＋￥　，", "0123456789.:-/+¥ ,")

# 关键词按类别归类；同一句话命中多个关键词时取最长的那个，例如“共享单车”优先于“车”。
EXPENSE_KEYWORDS = {
    "餐饮": ["早饭", "早餐", "午饭", "午餐", "中饭", "晚饭", "晚餐", "夜宵", "宵夜", "吃饭", "食堂", "外卖", "奶茶",
           "咖啡", "火锅", "烧烤", "零食", "水果", "饮料", "面包", "麻辣烫", "聚餐", "请客", "饭"],
    "交通": ["地铁", "公交", "打车", "滴滴", "出租车", "高铁", "动车", "火车", "机票", "飞机", "共享单车", "单车",
           "加油", "停车", "车费", "路费"],
    "购物": ["淘宝", "京东", "拼多多", "超市", "便利店", "衣服", "裤子", "鞋", "日用品", "生活用品", "洗发水",
           "纸巾", "化妆品", "数码", "耳机", "网购"],
    "居住": ["房租", "租金", "水费", "电费", "水电", "燃气", "网费", "宽带", "话费", "物业", "住宿"],
    "娱乐": ["电影", "游戏", "KTV", "唱歌", "演唱会", "剧本杀", "会员", "旅游", "门票", "健身"],
    "医疗": ["药", "医院", "挂号", "看病", "体检", "牙"],
    "学习": ["书", "课程", "网课", "培训", "打印", "复印", "资料", "文具", "报名费", "考试", "学费"],
}
INCOME_KEYWORDS = {
    "工资": ["工资", "薪水", "薪资", "发工资"],
    "奖金": ["奖学金", "奖金", "补助", "助学金"],
    "兼职": ["兼职", "家教", "实习工资", "稿费", "外包"],
    "理财": ["理财", "利息", "收益", "分红", "基金"],
    "红包": ["红包", "转账"],
    "其他收入": ["生活费", "报销", "退款"],
}
# 出现这些词时判定为收入；“发红包”这类支出说法优先排除。
INCOME_HINTS = ["收到", "收入", "进账", "到账", "领了", "抢到", "收红包", "抢红包", "工资", "薪水", "薪资",
                "奖学金", "奖金", "助学金", "补助", "兼职", "家教", "稿费", "利息", "收益", "分红", "生活费",
                "报销", "退款"]
EXPENSE_OVERRIDES = ["发红包", "给红包", "包红包", "发了红包", "交学费"]

_RELATIVE_DAYS = {"大前天": 3, "前天": 2, "昨天": 1, "昨日": 1, "今天": 0, "今日": 0}
_WEEKDAYS = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6,
             "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6}

_FULL_DATE = re.compile(r"(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?")
_MONTH_DAY = re.compile(r"(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?")
_MONTH_DAY_DASH = re.compile(r"(?<![\d.])(\d{1,2})[-/](\d{1,2})(?![\d.])")
_DAYS_AGO = re.compile(r"(\d{1,2})\s*天前")
_RELATIVE = re.compile("|".join(sorted(_RELATIVE_DAYS, key=len, reverse=True)))
_WEEK = re.compile(r"(上上|上)?(?:周|星期|礼拜)([一二三四五六日天1-7])")
_TIMES = [re.compile(r"(?<!\d)\d{1,2}:\d{2}(?!\d)"),
          re.compile(r"(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?(?<!\d)\d{1,2}\s*点(?:半|\d{1,2}\s*分?)?")]
# “15块5”表示 15.5 元，需要在通用金额规则之前处理。
_YUAN_JIAO = re.compile(r"(?<![\d.])(\d+)\s*块\s*(\d)(?![\d.])")
_AMOUNT = re.compile(r"(¥|￥)?\s*(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])\s*(元|块钱|块|rmb|RMB)?")
# 数字后面紧跟量词时视为数量而不是金额，例如“3杯奶茶 18”。
_QUANTITY_UNITS = ("杯", "个", "份", "次", "张", "本", "件", "瓶", "包", "斤", "人", "位", "盒", "袋", "支",
                   "条", "双", "顿", "节", "公里", "小时", "分钟", "天", "号", "月", "年", "点")
_FILLER = re.compile(r"^(?:花了|花费|花|用了|付了|一共|共|总共)+|(?:花了|花费|用了|付了|一共|共|总共)+$")


def parse_text(text, today=None):
    """解析一句话，返回可直接预填“记一笔”表单的草稿。

    返回字段：kind、amount_cents、date、category、note 与现有记录结构一致；
    tokens 说明每个片段被识别成了什么，warnings 提示需要用户留意的地方。
    """
    if not isinstance(text, str):
        raise ValueError("请输入要识别的一句话")
    today = today or date.today()
    raw = re.sub(r"\s+", " ", text.translate(_HALF_WIDTH)).strip()
    if not raw:
        raise ValueError("请输入要识别的一句话，例如“昨天午饭 15”")
    if len(raw) > MAX_TEXT_LENGTH:
        raise ValueError(f"一句话最多 {MAX_TEXT_LENGTH} 个字，太长请直接用“记一笔”填写")

    tokens, warnings = [], []
    work = raw
    record_date, work = _take_date(work, today, tokens, warnings)
    for pattern in _TIMES:
        work = pattern.sub(lambda match: " " * len(match.group()), work)
    amount_cents, work = _take_amount(work, tokens, warnings)
    kind = _detect_kind(raw, tokens)
    category = _match_category(raw, kind, tokens, warnings)
    note = _clean_note(work)
    return {
        "kind": kind,
        "amount_cents": amount_cents,
        "date": record_date.isoformat(),
        "category": category,
        "note": note,
        "tokens": tokens,
        "warnings": warnings,
    }


def _mask(work, match):
    start, end = match.span()
    return work[:start] + " " * (end - start) + work[end:]


def _real_date(year, month, day, source):
    try:
        return date(year, month, day)
    except ValueError:
        raise ValueError(f"日期“{source}”不存在，请检查月份和日期") from None


def _take_date(work, today, tokens, warnings):
    """按从具体到模糊的顺序找第一个日期；都没有时默认今天。"""
    result = None
    match = _FULL_DATE.search(work)
    if match:
        result = _real_date(*map(int, match.groups()), match.group().strip())
    if result is None:
        match = _MONTH_DAY.search(work) or _MONTH_DAY_DASH.search(work)
        if match:
            result = _real_date(today.year, int(match.group(1)), int(match.group(2)), match.group().strip())
    if result is None:
        match = _DAYS_AGO.search(work)
        if match:
            result = today - timedelta(days=int(match.group(1)))
    if result is None:
        match = _RELATIVE.search(work)
        if match:
            result = today - timedelta(days=_RELATIVE_DAYS[match.group()])
    if result is None:
        match = _WEEK.search(work)
        if match:
            prefix, weekday = match.groups()
            monday = today - timedelta(days=today.weekday())
            result = monday + timedelta(days=_WEEKDAYS[weekday])
            if prefix:
                result -= timedelta(days=7 * len(prefix))
            elif result > today:
                result -= timedelta(days=7)
    if result is None:
        tokens.append({"type": "date", "text": "（未写日期）", "value": _date_label(today, today)})
        return today, work
    if result > today:
        warnings.append("日期晚于今天，请确认")
    tokens.append({"type": "date", "text": match.group().strip(), "value": _date_label(result, today)})
    return result, _mask(work, match)


def _date_label(value, today):
    label = f"{value.month} 月 {value.day} 日"
    return label if value.year == today.year else f"{value.year} 年 {label}"


def _take_amount(work, tokens, warnings):
    """找出金额：优先带“元/块/¥”的数字，否则取最后一个不是数量的数字。"""
    candidates = []
    special = _YUAN_JIAO.search(work)
    if special:
        candidates.append((True, f"{special.group(1)}.{special.group(2)}", special))
    for match in _AMOUNT.finditer(work):
        if special and match.start() < special.end() and match.end() > special.start():
            continue
        currency, number, unit = match.groups()
        following = work[match.end():].lstrip()
        if not currency and not unit and following.startswith(_QUANTITY_UNITS):
            continue
        candidates.append((bool(currency or unit), number, match))
    if not candidates:
        raise ValueError("没有识别到金额，试试“午饭 15”或“打车 23.5 元”")
    marked = [item for item in candidates if item[0]]
    _, number, match = (marked or candidates)[-1]
    amount_cents = parse_amount(number)
    if len(candidates) > 1:
        warnings.append(f"识别到多个数字，已按 ¥{amount_cents / 100:,.2f} 计算，请确认")
    tokens.append({"type": "amount", "text": match.group().strip(), "value": f"¥{amount_cents / 100:,.2f}"})
    return amount_cents, _mask(work, match)


def _detect_kind(raw, tokens):
    if raw.startswith("+"):
        tokens.append({"type": "kind", "text": "+", "value": "收入"})
        return "income"
    if raw.startswith("-") or any(word in raw for word in EXPENSE_OVERRIDES):
        return "expense"
    hint = next((word for word in INCOME_HINTS if word in raw), None)
    if hint:
        tokens.append({"type": "kind", "text": hint, "value": "收入"})
        return "income"
    return "expense"


def _match_category(raw, kind, tokens, warnings):
    table = EXPENSE_KEYWORDS if kind == "expense" else INCOME_KEYWORDS
    best = None
    for category, words in table.items():
        for word in [category, *words]:
            position = raw.find(word)
            if position >= 0 and (best is None or len(word) > len(best[1]) or
                                  (len(word) == len(best[1]) and position < best[2])):
                best = (category, word, position)
    if best:
        tokens.append({"type": "category", "text": best[1], "value": best[0]})
        return best[0]
    fallback = CATEGORIES[kind][-1]
    warnings.append(f"没找到对应类别，已归入“{fallback}”，可以在对话框里修改")
    return fallback


def _clean_note(work):
    note = re.sub(r"\s+", " ", work).strip(" ,，。.;；、:：+-")
    note = _FILLER.sub("", note).strip(" ,，。.;；、")
    return note[:200]
