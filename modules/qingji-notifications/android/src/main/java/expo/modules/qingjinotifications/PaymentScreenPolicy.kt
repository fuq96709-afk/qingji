package expo.modules.qingjinotifications

internal object PaymentScreenPolicy {
  val packages = setOf("com.tencent.mm", "com.eg.android.AlipayGphone")
  private val success = Regex("^(支付成功|付款成功|扣款成功)(?:[：:\\s]*[¥￥]?\\s*\\d[\\d,.]*\\s*元?)?$")
  private val rejected = Regex("退款|退回|撤销|失败|未支付|待支付|待付款|取消支付|转账成功|确认收款|收款成功|到账|验证码|输入密码|支付密码|确认支付")

  fun isActivityClass(pkg: String, activity: String): Boolean = pkg in packages &&
    (activity.startsWith("$pkg.") || (pkg == "com.eg.android.AlipayGphone" && activity.startsWith("com.alipay.")))

  fun allowedWindow(pkg: String, activity: String): Boolean {
    if (!isActivityClass(pkg, activity)) return false
    // A trial allowlist avoids inspecting ordinary WeChat conversations and editors.
    return if (pkg == "com.tencent.mm") Regex("wallet|\\.pay\\.|cashier", RegexOption.IGNORE_CASE).containsMatchIn(activity)
    else Regex("H5Activity|cashier|payresult|flybird|trade", RegexOption.IGNORE_CASE).containsMatchIn(activity)
  }

  fun isSuccessPage(lines: List<String>): Boolean = lines.size >= 3 &&
    lines.take(4).any { success.matches(it) } &&
    lines.any { it in setOf("完成", "回首页", "返回商家") } &&
    !rejected.containsMatchIn(lines.joinToString("\n")) &&
    lines.any { Regex("[¥￥]\\s*\\d|\\d\\s*元|(?:实付|付款金额|支付金额)[：:\\s]*\\d").containsMatchIn(it) }
}
