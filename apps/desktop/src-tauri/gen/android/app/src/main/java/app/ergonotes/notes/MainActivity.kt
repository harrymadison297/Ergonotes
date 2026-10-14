package app.ergonotes.notes

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  // Text shared to the app from another app; the web UI picks it up through ErgoShare.take() and files it as a Capture.
  private var pending: String? = null
  private var web: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    remember(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    remember(intent)
    web?.post { web?.evaluateJavascript("window.dispatchEvent(new Event('ergo-share'))", null) }
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun take(): String {
        val t = pending ?: ""
        pending = null
        return t
      }
    }, "ErgoShare")
  }

  private fun remember(i: Intent?) {
    if (i?.action != Intent.ACTION_SEND || i.type?.startsWith("text/") != true) return
    val text = i.getStringExtra(Intent.EXTRA_TEXT) ?: return
    val subject = i.getStringExtra(Intent.EXTRA_SUBJECT)
    pending = if (subject.isNullOrBlank()) text else "$subject\n\n$text"
  }
}
