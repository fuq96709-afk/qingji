package expo.modules.qingjinotifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentScreenPolicyTest {
  @Test fun onlyPaymentWindowsFromSupportedPackagesAreEligible() {
    assertTrue(PaymentScreenPolicy.allowedWindow("com.tencent.mm", "com.tencent.mm.plugin.wallet.pay.ui.WalletPayUI"))
    assertTrue(PaymentScreenPolicy.allowedWindow("com.eg.android.AlipayGphone", "com.alipay.mobile.nebulax.integration.mpaas.activity.H5Activity"))
    assertFalse(PaymentScreenPolicy.allowedWindow("com.tencent.mm", "com.tencent.mm.ui.LauncherUI"))
    assertFalse(PaymentScreenPolicy.allowedWindow("com.tencent.mm", "com.tencent.mm.ui.chatting.ChattingUI"))
    assertFalse(PaymentScreenPolicy.allowedWindow("other.app", "other.app.wallet.PayUI"))
    assertFalse(PaymentScreenPolicy.allowedWindow("com.tencent.mm", "other.app.wallet.PayUI"))
  }

  @Test fun successPagesNeedProminentSuccessAmountAndCompletion() {
    assertTrue(PaymentScreenPolicy.isSuccessPage(listOf("支付成功", "￥32.00", "完成")))
    assertTrue(PaymentScreenPolicy.isSuccessPage(listOf("付款成功 32.00元", "商户名称：餐厅", "返回商家")))
    assertFalse(PaymentScreenPolicy.isSuccessPage(listOf("待付款", "￥32.00", "完成")))
    assertFalse(PaymentScreenPolicy.isSuccessPage(listOf("支付成功", "￥32.00", "商户名称：餐厅")))
    assertFalse(PaymentScreenPolicy.isSuccessPage(listOf("支付成功", "未知金额", "完成")))
    assertFalse(PaymentScreenPolicy.isSuccessPage(listOf("聊天", "消息", "消息", "消息", "支付成功", "￥32.00", "完成")))
  }

  @Test fun refundsPasswordsAndTransferScreensAreNotRetained() {
    for (text in listOf("退款成功", "撤销", "支付失败", "待支付", "转账成功", "确认收款", "验证码", "支付密码", "确认支付")) {
      assertFalse(text, PaymentScreenPolicy.isSuccessPage(listOf("支付成功", "￥32.00", text, "完成")))
    }
  }
}
