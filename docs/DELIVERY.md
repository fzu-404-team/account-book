# 协作与交付清单

## 课程时间节点（2026-11-07）

- 17:00：提交新建的 GitHub 仓库链接，发布当前软件的 Release。
- 17:00–17:15：现场演示，以助教通知为准。
- 23:00：提交团队博客链接，同时核查仓库和博客链接可访问。

## 实际分工

每位成员应独立编写至少一个模块，使用自己的账号提交实际完成的代码。单纯整理文档、修改署名或替他人提交不等于完成模块开发。基础功能之外的增强模块当前状态如下（核对时间 2026-11-07 16:40，以 GitHub 上的实际合并记录为准）：

| 模块 | 交付范围 | 可验证结果 | 状态 |
| --- | --- | --- | --- |
| CSV 导出 | 导出当前筛选结果、中文表头、正确处理逗号和换行 | 用表格软件打开并核对金额、行数 | 已合并（#10、#13） |
| 月度预算 | 本地预算存储、设置界面、超预算提醒 | 修改预算后提醒和余额正确更新 | 已合并（#11、#12） |
| 备份恢复 | 导出 JSON、导入前完整校验、确认恢复 | 无效文件不破坏账本，合法文件可恢复 | 已合并（#15、#17），说明见 [BACKUP_DELIVERY.md](BACKUP_DELIVERY.md) |
| 一句话记账 | 本地规则把“昨天午饭 15”解析为日期、金额、收支、类别和备注，预填“记一笔”对话框，确认后才保存 | 识别结果与输入一致；解析接口不写入账本；无金额等输入给出可读提示 | 已在本地实现并通过测试，待提交 PR |
| 月度趋势 | 按月份汇总、收入支出对比图 | 跨年和无记录月份显示正确 | 未实现 |

实际认领和提交应由对应成员完成。按照课程要求如实说明已有代码的生成方式和工具使用情况。

一句话记账的实现位置：

- `ledger/quick_entry.py`：解析规则，核心函数 `parse_text(text, today)`，只解析不保存。
- `app.py`：`POST /api/quick-parse`，请求 `{"text": "昨天午饭 15"}`，成功返回 `kind`、`amount_cents`、`date`、`category`、`note` 及识别说明 `tokens`、提醒 `warnings`；无法识别时返回 400 和中文原因。
- `static/index.html`、`static/app.js`、`static/styles.css`：标题区输入框与示例、对话框中的识别结果提示；保存仍走原有 `POST /api/records` 及其校验。
- `tests/test_quick_entry.py`、`tests/test_http.py`：解析规则与接口测试。

## 提交与 Release 前待处理

- `new/account-book-main/` 是通过网页上传的早期完整副本（约 540 KB），含 7 个 `__pycache__/*.pyc` 和旧打包文件，与根目录代码重复，建议由上传者确认后删除。
- `dist/youshu-v1.0.0.zip` 由最初版本打包，不含预算、导出、备份恢复和一句话记账；若保留，发布前需重新打包或删除后改用 GitHub 自动生成的源码包。
- 远程仓库目前没有任何 Release。

## 新建独立 GitHub 仓库

1. 在 GitHub 创建本作业专用仓库，确认课程要求的可见性，邀请实际成员。
2. 在当前项目目录初始化 Git（尚未初始化时）：

   ```powershell
   git init -b main
   git add .
   git commit -m "实现本地个人记账基础功能"
   git remote add origin <新仓库地址>
   git push -u origin main
   ```

3. 提交前确认 Git 作者配置属于实际提交者，检查 `git diff --cached`，不要将真实账本加入仓库。
4. 成员在自己分支上开发独立模块，提交后通过 Pull Request 复审合并。提交信息描述真实修改，不回填或伪造时间与作者。
5. 使用 `git log --all --date=iso --pretty=format:"%h %an %ad %s"` 查看实际历史，博客附可访问的 commit 链接。

## Release

1. 运行 `python -m unittest discover -s tests -v`。
2. 按 `DEMO.md` 验证浏览器中的实际运行结果。
3. 将通过验证的代码推送到新仓库。
4. 在 GitHub 的 Releases 页面创建发布，标签建议 `v1.0.0`，选择通过验证的提交。
5. 标题可用「有数记账 v1.0.0」。说明填写支持功能、Python 版本、启动命令和本地数据路径；GitHub 自动提供源码压缩包。
6. 从 Release 下载源码到另一个目录，运行 `python app.py --open`，确认初次使用正常。
7. 用非登录窗口核查最终仓库、Release 和博客地址，避免提交本地地址或编辑页面地址。

目标仓库：[fzu-404-team/account-book](https://github.com/fzu-404-team/account-book)。Release 尚未发布；上传源码与创建 Release 是两个独立步骤。实际时间与提交结果以 GitHub 为准。
