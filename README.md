# 轻记 Qingji

一个紫白配色、界面简洁的个人记账 App。无需注册账号，账单保存在本机，日常记账可以离线使用。

<img src="assets/qingji-icon-v2.png" alt="轻记图标" width="96" />

## 安卓下载

当前版本：**1.0.4**（Android versionCode 6），安装包约 **22.43 MB**。

- [下载 APK](https://github.com/fuq96709-afk/qingji/releases/download/v1.0.4/qingji-1.0.4-android.apk)
- [GitHub 版本发布页](https://github.com/fuq96709-afk/qingji/releases)

当前 APK 面向 **Android 7 及以上的 ARM64 手机**，不限三星；不包含 32 位 ARM 或 x86 安装包。各品牌的权限、后台运行和实际显示仍需验证。

升级请直接覆盖安装，**不要先卸载旧版**。卸载、清除应用数据或丢失手机会导致本机记录不可用；可在「统计 → ⋯ → 数据管理」导出备份。

## 主要功能

- **快速记账**：先选收支分类，再填写金额和备注；金额支持加减算式。
- **备注历史**：按收支类型和分类分别保存最近使用的备注，点击即可填入。
- **消费类型**：可选情绪消费或理性消费，账本支持筛选。
- **账本与统计**：按日期查看记录，按年、月、周查看分类金额和占比。
- **修改与删除**：长按单笔账单操作，删除前确认；统计分类可进入逐笔明细。
- **日期滚轮**：选择年月日；账本可单独切换查看月份。
- **备份与导入**：导出 JSON 备份、CSV 表格；支持导入预览、追加及重复记录处理。

## 消费识别（Android 试用功能）

提供两个独立、需要主动授权的通道：微信／支付宝消费通知识别，以及部分支付成功页面的无障碍文字识别。识别结果先进入待确认列表，核对并保存后才计入账本。

识别在本机处理，不上传到服务器；普通聊天通知不保存。页面识别不执行点击、代付或读取密码。可随时暂停识别和撤销权限。

这项功能仍在试验阶段：通知未送达、内容隐藏、支付页面变化、权限受限或系统后台限制都可能导致漏记。它不能保证完整捕获所有交易，也不是无需确认的全自动记账。使用原生服务需要安装独立 Android 构建，Expo Go 无法验证此功能。

## 本地开发

技术栈：Expo SDK 57、React Native 0.86、React 19、TypeScript。使用 Node.js 22.13 或更高版本。

```sh
npm ci
npm start
```

浏览器预览：

```sh
npm run web
```

检查：

```sh
npm test
npm run typecheck
npm run lint
```

当前有 77 项 JavaScript 测试，覆盖金额、日期、统计、数据保存与恢复、导入导出、编辑交互以及消费识别处理。编译和自动测试不能代替手机验证。

## Android 构建

```sh
npx eas-cli@latest build --platform android --profile preview
```

`preview` 生成 ARM64 APK，启用代码压缩及资源裁剪，同时运行消费页面识别的原生策略单元测试。`android-universal` 是用于多架构构建的备用配置，尚未验证发布。

Fork 后请先登录自己的 Expo 账号，在 `app.json` 中移除原 `extra.eas.projectId`，再通过 `eas init` 关联自己的项目，并使用自己的签名。原项目标识仅用于项目关联，不提供账户或签名权限；签名密钥不在本仓库中。自行构建且签名不同的 APK 无法直接覆盖官方版本。

## 项目结构

```text
App.tsx                         账本、统计及页面入口
src/EntryEditor.tsx             记账编辑器
src/DateWheel.tsx               日期与月份滚轮
src/ledger.ts                   金额、分类与统计逻辑
src/ledgerStore.ts              本机保存、冲突检测与恢复
src/DataManager.tsx             备份与导入界面
src/NotificationInbox.tsx       消费识别授权与待确认列表
modules/qingji-notifications/   Android 通知及页面识别模块
tests/                         自动测试
DESIGN.md                      界面约定
```

## 1.0.4 更新

- 修复滚轮初始化、自动定位事件覆盖已选日期的问题。
- 年份与月日分开排版，避免日期末位显示不全。
- 删除日期弹窗底部的「上下滑动选择」和「今天」整行。
- 保留原包名、签名和本机存储位置。

APK SHA-256：

```text
39b88af13cc1c40ab3b6c5926ee10bbca6f704f911200c7030c4aff457a0436f
```

## 许可证

见 [LICENSE](LICENSE)。保留 Expo 模板的原始版权声明。依赖项目各自的许可证以对应项目为准。
