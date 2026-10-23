package expo.modules.qingjinotifications

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class PaymentScreenService : AccessibilityService() {
  private val handler = Handler(Looper.getMainLooper())
  private var pkg = ""
  private var activity = ""
  private var window = -1
  private var session = System.currentTimeMillis()
  private var lastFingerprint = ""
  private val capture = Runnable { capturePage() }

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    try { handleEvent(event) } catch (_: Exception) { reset() }
  }

  private fun handleEvent(event: AccessibilityEvent) {
    if (!NoticeStore.prefs(this).getBoolean("screenEnabled", false)) return
    val nextPkg = event.packageName?.toString() ?: return
    if (nextPkg !in PaymentScreenPolicy.packages) { reset(); return }
    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      val nextActivity = event.className?.toString().orEmpty()
      if (PaymentScreenPolicy.isActivityClass(nextPkg, nextActivity)) {
        if (pkg != nextPkg || activity != nextActivity || window != event.windowId) {
          lastFingerprint = ""; session = System.currentTimeMillis()
        }
        pkg = nextPkg; activity = nextActivity; window = event.windowId
      }
    }
    if (nextPkg != pkg || !PaymentScreenPolicy.allowedWindow(pkg, activity)) { resetCapture(); return }
    handler.removeCallbacks(capture)
    handler.postDelayed(capture, 350)
  }

  private fun capturePage() {
    var root: AccessibilityNodeInfo? = null
    try {
      if (!NoticeStore.prefs(this).getBoolean("screenEnabled", false)) return
      if (!PaymentScreenPolicy.allowedWindow(pkg, activity)) return
      val activeRoot = rootInActiveWindow ?: return
      root = activeRoot
      if (activeRoot.packageName?.toString() != pkg) return
      val lines = mutableListOf<String>()
      var visited = 0
      var chars = 0
      fun collect(node: AccessibilityNodeInfo, depth: Int) {
        if (++visited > 180 || depth > 14 || chars > 2048 || node.isPassword || node.isEditable) return
        if (node.isVisibleToUser) {
          for (value in listOf(node.text, node.contentDescription)) {
            value?.toString()?.trim()?.takeIf { it.isNotEmpty() && it !in lines }?.let {
              chars += it.length + 1
              if (chars <= 2048) lines.add(it)
            }
          }
        }
        for (i in 0 until node.childCount) {
          if (visited >= 180 || chars > 2048) break
          val child = node.getChild(i) ?: continue
          try { collect(child, depth + 1) } finally { child.recycle() }
        }
      }
      collect(activeRoot, 0)
      if (chars > 2048 || !PaymentScreenPolicy.isSuccessPage(lines)) { resetCapture(); return }
      val text = lines.joinToString("\n")
      val fingerprint = PaymentCapture.hash("$pkg|$text")
      if (fingerprint == lastFingerprint) return
      lastFingerprint = fingerprint
      NoticeStore.append(this, PaymentCapture.create(pkg, "支付成功页面", text,
        System.currentTimeMillis(), "screen", "$session|$window"))
    } catch (_: Exception) {
      // Includes malformed capture storage; retain it for diagnosis and keep manual entry working.
      reset()
    } finally { runCatching { root?.recycle() } }
  }

  private fun resetCapture() { handler.removeCallbacks(capture); lastFingerprint = ""; session = System.currentTimeMillis() }
  private fun reset() { resetCapture(); pkg = ""; activity = ""; window = -1 }
  override fun onInterrupt() { reset() }
  override fun onDestroy() { reset(); super.onDestroy() }
}
