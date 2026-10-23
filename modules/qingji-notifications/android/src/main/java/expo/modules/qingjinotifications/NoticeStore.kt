package expo.modules.qingjinotifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal object NoticeStore {
  fun prefs(context: Context) = context.getSharedPreferences("qingji_payment_notices", Context.MODE_PRIVATE)

  @Synchronized fun setEnabled(context: Context, enabled: Boolean) {
    val prefs = prefs(context)
    val edit = prefs.edit().putBoolean("enabled", enabled)
    if (enabled && !prefs.getBoolean("enabled", false)) edit.putLong("since", System.currentTimeMillis())
    edit.apply()
  }

  @Synchronized fun setScreenEnabled(context: Context, enabled: Boolean) {
    val prefs = prefs(context)
    val edit = prefs.edit().putBoolean("screenEnabled", enabled)
    if (enabled && !prefs.getBoolean("screenEnabled", false)) edit.putLong("screenSince", System.currentTimeMillis())
    edit.apply()
  }

  @Synchronized fun append(context: Context, notice: JSONObject) {
    val prefs = prefs(context)
    val screen = notice.optString("channel") == "screen"
    if (!prefs.getBoolean(if (screen) "screenEnabled" else "enabled", false) ||
      notice.getLong("postedAt") < prefs.getLong(if (screen) "screenSince" else "since", Long.MAX_VALUE)) return
    val seen = JSONArray(prefs.getString("seen", "[]"))
    val id = notice.getString("id")
    if ((0 until seen.length()).any { seen.getString(it) == id }) return
    val nextSeen = JSONArray()
    for (i in maxOf(0, seen.length() - 999) until seen.length()) nextSeen.put(seen.getString(i))
    nextSeen.put(id)
    val pending = JSONArray(prefs.getString("pending", "[]"))
    val edit = prefs.edit().putString("seen", nextSeen.toString())
    if (pending.length() >= 200) edit.putInt("dropped", prefs.getInt("dropped", 0) + 1)
    else edit.putString("pending", pending.put(notice).toString())
    edit.apply()
  }

  @Synchronized fun acknowledge(context: Context, ids: List<String>) {
    val prefs = prefs(context)
    val pending = JSONArray(prefs.getString("pending", "[]"))
    val next = JSONArray()
    for (i in 0 until pending.length()) {
      val notice = pending.getJSONObject(i)
      if (notice.getString("id") !in ids && notice.optString("captureId") !in ids) next.put(notice)
    }
    prefs.edit().putString("pending", next.toString()).apply()
  }

  @Synchronized fun state(context: Context, granted: Boolean, screenGranted: Boolean): String {
    val prefs = prefs(context)
    return JSONObject().put("enabled", prefs.getBoolean("enabled", false))
      .put("granted", granted).put("dropped", prefs.getInt("dropped", 0))
      .put("screenEnabled", prefs.getBoolean("screenEnabled", false)).put("screenGranted", screenGranted)
      .put("pending", JSONArray(prefs.getString("pending", "[]"))).toString()
  }
}
