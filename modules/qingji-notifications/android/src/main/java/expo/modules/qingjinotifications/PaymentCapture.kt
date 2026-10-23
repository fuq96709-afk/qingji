package expo.modules.qingjinotifications

import java.security.MessageDigest
import org.json.JSONObject

internal object PaymentCapture {
  private val reference = Regex("(?:交易单号|交易订单号|交易号)[：:\\s]+([A-Za-z0-9_-]{8,64})(?![A-Za-z0-9_-])")
  fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 0xff) }

  fun create(pkg: String, title: String, text: String, postedAt: Long, channel: String, seed: String): JSONObject {
    // Keep notification identities stable across upgrades.
    val identity = if (channel == "notification") "$pkg|$seed|$title\n$text" else "$pkg|$channel|$seed|$title|$text"
    val capture = JSONObject().put("id", "notice-${hash(identity)}")
      .put("packageName", pkg).put("title", title).put("text", text)
      .put("postedAt", postedAt).put("channel", channel)
    reference.find(text)?.groupValues?.get(1)?.let { ref ->
      capture.put("transactionRef", ref).put("captureId", "notice-${hash("$pkg|transaction|$ref")}")
    }
    return capture
  }
}
