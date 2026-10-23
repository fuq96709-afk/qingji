package expo.modules.qingjinotifications

import android.app.NotificationManager
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class QingjiNotificationsModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val changed = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key == "pending" || key == "enabled" || key == "screenEnabled" || key == "dropped") {
      runCatching { sendEvent("onChanged", emptyMap<String, Any>()) }
    }
  }

  private fun openSettings(action: String) {
    try { context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    catch (_: ActivityNotFoundException) {
      context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun screenGranted(): Boolean {
    val component = ComponentName(context, PaymentScreenService::class.java)
    return context.getSystemService(AccessibilityManager::class.java)
      .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      .any { ComponentName(it.resolveInfo.serviceInfo.packageName, it.resolveInfo.serviceInfo.name) == component }
  }

  private fun granted(): Boolean {
    val component = ComponentName(context, PaymentNoticeListener::class.java)
    if (Build.VERSION.SDK_INT >= 27) {
      return context.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(component)
    }
    return (Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: "")
      .split(':').any { ComponentName.unflattenFromString(it) == component }
  }

  override fun definition() = ModuleDefinition {
    Name("QingjiNotifications")
    Events("onChanged")
    OnStartObserving { NoticeStore.prefs(context).registerOnSharedPreferenceChangeListener(changed) }
    OnStopObserving { NoticeStore.prefs(context).unregisterOnSharedPreferenceChangeListener(changed) }
    AsyncFunction("getStateAsync") { NoticeStore.state(context, granted(), screenGranted()) }
    AsyncFunction("setEnabledAsync") { enabled: Boolean -> NoticeStore.setEnabled(context, enabled) }
    AsyncFunction("setScreenEnabledAsync") { enabled: Boolean -> NoticeStore.setScreenEnabled(context, enabled) }
    AsyncFunction("acknowledgeAsync") { ids: List<String> -> NoticeStore.acknowledge(context, ids) }
    AsyncFunction("openSettingsAsync") {
      openSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    }
    AsyncFunction("openScreenSettingsAsync") {
      openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)
    }
  }
}
