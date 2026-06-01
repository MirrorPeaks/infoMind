# InfoMind Clipper for Safari

Safari 版本使用同一套 Web Extension 资源：`extensions/web-extension`。

后续签名分发流程：

1. 用 Xcode 创建 Safari Web Extension App。
2. 把 `extensions/web-extension` 作为扩展资源导入。
3. 配置扩展权限说明：只在用户点击保存时读取当前页面内容，并发送到本机 InfoMind。
4. 使用 Apple Developer 账号签名。
5. 将 Safari Host App 与 InfoMind DMG 或独立安装包一起分发。

这条路径不需要用户配置 cookie，也不要求 Hermes/OpenClaw 登录平台账号。
