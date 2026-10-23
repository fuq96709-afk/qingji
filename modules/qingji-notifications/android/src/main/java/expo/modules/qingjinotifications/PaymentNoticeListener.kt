package expo.modules.qingjinotifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class PaymentNoticeListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try { captureNotice(sbn) } catch (_: Exception) {
      // A malformed capture or system denial must not crash the ledger process.
    }
  }

  private fun captureNotice(sbn: StatusBarNotification) {
    if (sbn.packageName !in setOf("com.tencent.mm", "com.eg.android.AlipayGphone")) return
    if (!NoticeStore.prefs(this).getBoolean("enabled", false)) return
    val notice = sbn.notification
    if ((notice.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
    val extras = notice.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(200) ?: return
    // Reject ordinary chat notifications before reading or retaining their bodies.
    if (sbn.packageName == "com.tencent.mm" && title.trim() !in setOf("微信支付", "微信支付凭证", "微信支付通知", "支付凭证")) return
    val text = listOfNotNull(
      extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
      extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
      extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n")
    ).distinct().joinToString("\n")
    if (text.length > 2048) return
    val content = "$title\n$text"
    if (!Regex("支付成功|付款成功|消费成功|扣款成功|成功支付|成功付款|成功消费|成功扣款|支付金额|付款金额|消费金额|实付金额|扣款金额|微信支付凭证").containsMatchIn(content)) return
    if (Regex("退款|退回|撤销|失败|未支付|待支付|待付款|取消|转账|收款成功|到账|收入|红包|验证码|验证代码|付款码|支付请求|付款请求|请求付款|支付提醒|优惠券").containsMatchIn(content)) return
    if (!Regex("[¥￥]\\s*[0-9]|[0-9]\\s*元|金额[：:\\s]*[0-9]").containsMatchIn(content)) return
    NoticeStore.append(this, PaymentCapture.create(sbn.packageName, title, text,
      sbn.postTime, "notification", "${sbn.key}|${sbn.postTime}"))
  }
}
